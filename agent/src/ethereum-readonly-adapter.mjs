import {
  ETHEREUM_MAINNET_CHAIN_ID,
  getTokenByAddress,
  getTokenBySymbol,
  parseTokenList,
} from '../../core/token-registry.js';
import { chainRpcRetrySummary, fetchChainRpcJsonWithBackoff } from './chain-rpc-rate-limit.mjs';

export const ETHEREUM_MAINNET_RPC_URL = 'https://eth.llamarpc.com';
const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

export function isEthereumAddress(value) {
  return ETH_ADDRESS_RE.test(String(value || ''));
}

export function resolveEthereumReadConfig(env = process.env) {
  const owner = env.SENTRY_ETHEREUM_WALLET_ADDRESS || env.SENTRY_ETHEREUM_OWNER;
  if (!isEthereumAddress(owner)) {
    return {
      status: 'error',
      code: 'ETHEREUM_WALLET_ADDRESS_REQUIRED',
      message: 'Ethereum live inventory requires SENTRY_ETHEREUM_WALLET_ADDRESS.',
    };
  }
  return {
    status: 'ok',
    owner: owner.toLowerCase(),
    rpc_url: env.SENTRY_ETHEREUM_RPC_URL || ETHEREUM_MAINNET_RPC_URL,
    tokens: parseEthereumTokenList(env.SENTRY_ETHEREUM_TOKENS),
  };
}

export function ethereumRpcRequest(method, params = [], id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

export function parseEthereumTokenList(value) {
  return parseTokenList(value, {
    chain_id: ETHEREUM_MAINNET_CHAIN_ID,
    venue_id: 'ethereum-mainnet',
    decimals: 18,
  })
    .filter((token) => token.symbol && isEthereumAddress(token.address))
    .map((token) => ({
      symbol: token.symbol,
      address: token.address,
      decimals: token.decimals,
    }));
}

async function postEthereumRpc({
  rpcUrl,
  method,
  params,
  fetchImpl,
  id,
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
}) {
  const requestBody = ethereumRpcRequest(method, params, id);
  const fetched = await fetchChainRpcJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `ethereum:${method}`,
    fetchOnce: async () => {
      const response = await fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const body = await response.json();
      return { response, body };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'ETHEREUM_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: chainRpcRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok || body.error) {
    return {
      status: 'error',
      code: body.error?.code ? 'ETHEREUM_RPC_ERROR' : 'ETHEREUM_HTTP_ERROR',
      rpc_code: body.error?.code ?? null,
      http_status: response.status,
      message: body.error?.message || `Ethereum HTTP ${response.status}`,
      retry: chainRpcRetrySummary(fetched),
    };
  }
  return { status: 'ok', body, retry: chainRpcRetrySummary(fetched) };
}

function hexToBigInt(hex) {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex);
}

function formatUnits(value, decimals) {
  const raw = value.toString();
  const places = Number(decimals || 0);
  if (places <= 0) return raw;
  const padded = raw.padStart(places + 1, '0');
  const head = padded.slice(0, -places);
  const tail = padded.slice(-places).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

function balanceOfCallData(owner) {
  const address = owner.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return `${ERC20_BALANCE_OF_SELECTOR}${address}`;
}

export function normalizeEthereumBalances({ owner, nativeBalanceHex, tokenBalances, observedAt }) {
  const nativeRaw = hexToBigInt(nativeBalanceHex);
  const nativeToken = getTokenBySymbol(ETHEREUM_MAINNET_CHAIN_ID, 'ETH');
  const positions = [
    {
      venue_id: 'ethereum-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      asset: nativeToken?.symbol || 'ETH',
      quantity: formatUnits(nativeRaw, 18),
      raw_amount: nativeRaw.toString(),
      decimals: nativeToken?.decimals || 18,
      token_metadata: nativeToken,
      observed_at: observedAt,
    },
  ];

  for (const token of tokenBalances || []) {
    const raw = hexToBigInt(token.balanceHex);
    const registered = getTokenByAddress(ETHEREUM_MAINNET_CHAIN_ID, token.address);
    positions.push({
      venue_id: 'ethereum-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      asset: registered?.symbol || token.symbol,
      token_contract: token.address,
      quantity: formatUnits(raw, registered?.decimals || token.decimals),
      raw_amount: raw.toString(),
      decimals: registered?.decimals || token.decimals,
      token_metadata: registered,
      observed_at: observedAt,
    });
  }

  return {
    status: 'ok',
    venue_id: 'ethereum-mainnet',
    account_ref: owner,
    position_count: positions.length,
    positions,
    observed_at: observedAt,
  };
}

export async function fetchEthereumReadState({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const config = resolveEthereumReadConfig(env);
  if (config.status !== 'ok') return config;
  const observedAt = now.toISOString();
  const native = await postEthereumRpc({
    rpcUrl: config.rpc_url,
    method: 'eth_getBalance',
    params: [config.owner, 'latest'],
    fetchImpl,
    id: 1,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (native.status !== 'ok') return native;

  const tokenBalances = [];
  const tokenRetries = [];
  let id = 2;
  for (const token of config.tokens) {
    const balance = await postEthereumRpc({
      rpcUrl: config.rpc_url,
      method: 'eth_call',
      params: [{ to: token.address, data: balanceOfCallData(config.owner) }, 'latest'],
      fetchImpl,
      id,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    id += 1;
    if (balance.status !== 'ok') return balance;
    tokenBalances.push({ ...token, balanceHex: balance.body.result });
    tokenRetries.push({ address: token.address, retry: balance.retry });
  }

  return {
    ...normalizeEthereumBalances({
      owner: config.owner,
      nativeBalanceHex: native.body.result,
      tokenBalances,
      observedAt,
    }),
    rpc_retry: {
      eth_getBalance: native.retry,
      eth_call: tokenRetries,
    },
  };
}
