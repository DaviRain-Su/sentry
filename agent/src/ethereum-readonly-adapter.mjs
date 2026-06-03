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
  if (!value) return [];
  if (value.trim().startsWith('[')) {
    return JSON.parse(value).map((token) => ({
      symbol: token.symbol,
      address: String(token.address || '').toLowerCase(),
      decimals: Number(token.decimals ?? 18),
    }));
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [symbol, address, decimals = '18'] = item.split(':');
      return {
        symbol,
        address: String(address || '').toLowerCase(),
        decimals: Number(decimals),
      };
    })
    .filter((token) => token.symbol && isEthereumAddress(token.address));
}

async function postEthereumRpc({ rpcUrl, method, params, fetchImpl, id }) {
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ethereumRpcRequest(method, params, id)),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    return {
      status: 'error',
      code: body.error?.code ? 'ETHEREUM_RPC_ERROR' : 'ETHEREUM_HTTP_ERROR',
      rpc_code: body.error?.code ?? null,
      http_status: response.status,
      message: body.error?.message || `Ethereum HTTP ${response.status}`,
    };
  }
  return { status: 'ok', body };
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
  const positions = [
    {
      venue_id: 'ethereum-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      asset: 'ETH',
      quantity: formatUnits(nativeRaw, 18),
      raw_amount: nativeRaw.toString(),
      decimals: 18,
      observed_at: observedAt,
    },
  ];

  for (const token of tokenBalances || []) {
    const raw = hexToBigInt(token.balanceHex);
    positions.push({
      venue_id: 'ethereum-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      asset: token.symbol,
      token_contract: token.address,
      quantity: formatUnits(raw, token.decimals),
      raw_amount: raw.toString(),
      decimals: token.decimals,
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
  });
  if (native.status !== 'ok') return native;

  const tokenBalances = [];
  let id = 2;
  for (const token of config.tokens) {
    const balance = await postEthereumRpc({
      rpcUrl: config.rpc_url,
      method: 'eth_call',
      params: [{ to: token.address, data: balanceOfCallData(config.owner) }, 'latest'],
      fetchImpl,
      id,
    });
    id += 1;
    if (balance.status !== 'ok') return balance;
    tokenBalances.push({ ...token, balanceHex: balance.body.result });
  }

  return normalizeEthereumBalances({
    owner: config.owner,
    nativeBalanceHex: native.body.result,
    tokenBalances,
    observedAt,
  });
}
