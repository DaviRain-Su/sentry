export const SOLANA_MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const SOLANA_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(value) {
  return SOLANA_ADDRESS_RE.test(String(value || ''));
}

export function resolveSolanaReadConfig(env = process.env) {
  const owner = env.SENTRY_SOLANA_WALLET_ADDRESS || env.SENTRY_SOLANA_OWNER;
  if (!isSolanaAddress(owner)) {
    return {
      status: 'error',
      code: 'SOLANA_WALLET_ADDRESS_REQUIRED',
      message: 'Solana live inventory requires SENTRY_SOLANA_WALLET_ADDRESS.',
    };
  }
  return {
    status: 'ok',
    owner,
    rpc_url: env.SENTRY_SOLANA_RPC_URL || SOLANA_MAINNET_RPC_URL,
  };
}

export function solanaRpcRequest(method, params = [], id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

async function postSolanaRpc({ rpcUrl, method, params, fetchImpl, id }) {
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(solanaRpcRequest(method, params, id)),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    return {
      status: 'error',
      code: body.error?.code ? 'SOLANA_RPC_ERROR' : 'SOLANA_HTTP_ERROR',
      rpc_code: body.error?.code ?? null,
      http_status: response.status,
      message: body.error?.message || `Solana HTTP ${response.status}`,
    };
  }
  return { status: 'ok', body };
}

function decimalFromAmount(amount, decimals) {
  const raw = String(amount || '0');
  const places = Number(decimals || 0);
  if (places <= 0) return raw;
  const padded = raw.padStart(places + 1, '0');
  const head = padded.slice(0, -places);
  const tail = padded.slice(-places).replace(/0+$/, '');
  return tail ? `${head}.${tail}` : head;
}

export function normalizeSolanaBalanceResponses({ owner, balanceBody, tokenBody, observedAt }) {
  const positions = [
    {
      venue_id: 'solana-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      asset: 'SOL',
      quantity: decimalFromAmount(balanceBody?.result?.value || 0, 9),
      raw_amount: String(balanceBody?.result?.value || '0'),
      decimals: 9,
      observed_at: observedAt,
    },
  ];

  for (const item of tokenBody?.result?.value || []) {
    const info = item.account?.data?.parsed?.info;
    const tokenAmount = info?.tokenAmount || {};
    positions.push({
      venue_id: 'solana-mainnet',
      source_type: 'chain_rpc',
      account_ref: owner,
      token_account: item.pubkey,
      asset: info?.mint || 'SPL',
      mint: info?.mint || null,
      quantity:
        tokenAmount.uiAmountString || decimalFromAmount(tokenAmount.amount, tokenAmount.decimals),
      raw_amount: String(tokenAmount.amount || '0'),
      decimals: Number(tokenAmount.decimals || 0),
      observed_at: observedAt,
    });
  }

  return {
    status: 'ok',
    venue_id: 'solana-mainnet',
    account_ref: owner,
    position_count: positions.length,
    positions,
    observed_at: observedAt,
  };
}

export async function fetchSolanaReadState({
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const config = resolveSolanaReadConfig(env);
  if (config.status !== 'ok') return config;
  const observedAt = now.toISOString();
  const balance = await postSolanaRpc({
    rpcUrl: config.rpc_url,
    method: 'getBalance',
    params: [config.owner],
    fetchImpl,
    id: 1,
  });
  if (balance.status !== 'ok') return balance;
  const tokens = await postSolanaRpc({
    rpcUrl: config.rpc_url,
    method: 'getTokenAccountsByOwner',
    params: [config.owner, { programId: SOLANA_TOKEN_PROGRAM_ID }, { encoding: 'jsonParsed' }],
    fetchImpl,
    id: 2,
  });
  if (tokens.status !== 'ok') return tokens;
  return normalizeSolanaBalanceResponses({
    owner: config.owner,
    balanceBody: balance.body,
    tokenBody: tokens.body,
    observedAt,
  });
}
