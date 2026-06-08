import assert from 'node:assert/strict';
import {
  ethereumRpcRequest,
  fetchEthereumReadState,
  isEthereumAddress,
  normalizeEthereumBalances,
  parseEthereumTokenList,
  resolveEthereumReadConfig,
} from '../src/ethereum-readonly-adapter.mjs';
import {
  fetchSolanaReadState,
  isSolanaAddress,
  normalizeSolanaBalanceResponses,
  resolveSolanaReadConfig,
  solanaRpcRequest,
} from '../src/solana-readonly-adapter.mjs';

const solanaOwner = '11111111111111111111111111111111';
const solanaUsdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
assert.equal(isSolanaAddress(solanaOwner), true);
assert.equal(resolveSolanaReadConfig({}).code, 'SOLANA_WALLET_ADDRESS_REQUIRED');
assert.equal(
  resolveSolanaReadConfig({ SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner }).owner,
  solanaOwner
);
assert.deepEqual(solanaRpcRequest('getBalance', [solanaOwner]), {
  jsonrpc: '2.0',
  id: 1,
  method: 'getBalance',
  params: [solanaOwner],
});

const solanaNormalized = normalizeSolanaBalanceResponses({
  owner: solanaOwner,
  observedAt: '2026-06-03T00:00:00.000Z',
  balanceBody: { result: { value: 1_500_000_000 } },
  tokenBody: {
    result: {
      value: [
        {
          pubkey: 'TokenAccount111',
          account: {
            data: {
              parsed: {
                info: {
                  mint: solanaUsdcMint,
                  tokenAmount: { amount: '1234500', decimals: 6, uiAmountString: '1.2345' },
                },
              },
            },
          },
        },
      ],
    },
  },
});
assert.equal(solanaNormalized.status, 'ok');
assert.equal(solanaNormalized.position_count, 2);
assert.equal(solanaNormalized.positions[0].asset, 'SOL');
assert.equal(solanaNormalized.positions[0].quantity, '1.5');
assert.equal(solanaNormalized.positions[1].asset, 'USDC');
assert.equal(solanaNormalized.positions[1].token_metadata.symbol, 'USDC');
assert.equal(solanaNormalized.positions[1].quantity, '1.2345');

const solanaCalls = [];
const solanaLive = await fetchSolanaReadState({
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
    SENTRY_SOLANA_RPC_URL: 'https://solana.example',
  },
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://solana.example');
    const body = JSON.parse(init.body);
    solanaCalls.push(body.method);
    return {
      ok: true,
      status: 200,
      async json() {
        if (body.method === 'getBalance') return { result: { value: 1_000_000_000 } };
        return { result: { value: [] } };
      },
    };
  },
});
assert.equal(solanaLive.status, 'ok');
assert.deepEqual(solanaCalls, ['getBalance', 'getTokenAccountsByOwner']);
assert.equal(solanaLive.positions[0].quantity, '1');
assert.equal(solanaLive.rpc_retry.getBalance.attempts, 1);

let solanaRetryCalls = 0;
const solanaRetrySleeps = [];
const solanaRetryLive = await fetchSolanaReadState({
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
    SENTRY_SOLANA_RPC_URL: 'https://solana.example',
  },
  now: new Date('2026-06-03T00:00:00.000Z'),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 5, max_backoff_ms: 5 },
  sleepImpl: async (ms) => solanaRetrySleeps.push(ms),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'getBalance') {
      solanaRetryCalls += 1;
      if (solanaRetryCalls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { 'retry-after': '0.005' },
          async json() {
            return { error: { code: -32005, message: 'rate limited' } };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: { value: 2_000_000_000 } };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { result: { value: [] } };
      },
    };
  },
});
assert.equal(solanaRetryLive.status, 'ok');
assert.equal(solanaRetryLive.positions[0].quantity, '2');
assert.equal(solanaRetryLive.rpc_retry.getBalance.retry_count, 1);
assert.deepEqual(solanaRetrySleeps, [5]);

const ethOwner = '0x0000000000000000000000000000000000000001';
assert.equal(isEthereumAddress(ethOwner), true);
assert.equal(resolveEthereumReadConfig({}).code, 'ETHEREUM_WALLET_ADDRESS_REQUIRED');
assert.deepEqual(parseEthereumTokenList('USDC:0x0000000000000000000000000000000000000002:6'), [
  { symbol: 'USDC', address: '0x0000000000000000000000000000000000000002', decimals: 6 },
]);
assert.deepEqual(ethereumRpcRequest('eth_getBalance', [ethOwner, 'latest']), {
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_getBalance',
  params: [ethOwner, 'latest'],
});

const ethNormalized = normalizeEthereumBalances({
  owner: ethOwner,
  nativeBalanceHex: '0xde0b6b3a7640000',
  observedAt: '2026-06-03T00:00:00.000Z',
  tokenBalances: [
    {
      symbol: 'USDC',
      address: '0x0000000000000000000000000000000000000002',
      decimals: 6,
      balanceHex: '0x0f4240',
    },
  ],
});
assert.equal(ethNormalized.status, 'ok');
assert.equal(ethNormalized.position_count, 2);
assert.equal(ethNormalized.positions[0].quantity, '1');
assert.equal(ethNormalized.positions[1].quantity, '1');

const ethCalls = [];
const ethLive = await fetchEthereumReadState({
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: ethOwner,
    SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.example',
    SENTRY_ETHEREUM_TOKENS: 'USDC:0x0000000000000000000000000000000000000002:6',
  },
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://ethereum.example');
    const body = JSON.parse(init.body);
    ethCalls.push(body.method);
    return {
      ok: true,
      status: 200,
      async json() {
        if (body.method === 'eth_getBalance') return { result: '0xde0b6b3a7640000' };
        return { result: '0x0f4240' };
      },
    };
  },
});
assert.equal(ethLive.status, 'ok');
assert.deepEqual(ethCalls, ['eth_getBalance', 'eth_call']);
assert.equal(ethLive.position_count, 2);
assert.equal(ethLive.rpc_retry.eth_getBalance.attempts, 1);

let ethRetryCalls = 0;
const ethRetrySleeps = [];
const ethRetryLive = await fetchEthereumReadState({
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: ethOwner,
    SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.example',
    SENTRY_ETHEREUM_TOKENS: 'USDC:0x0000000000000000000000000000000000000002:6',
  },
  now: new Date('2026-06-03T00:00:00.000Z'),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 7, max_backoff_ms: 7 },
  sleepImpl: async (ms) => ethRetrySleeps.push(ms),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === 'eth_getBalance') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { result: '0xde0b6b3a7640000' };
        },
      };
    }
    ethRetryCalls += 1;
    if (ethRetryCalls === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { error: { code: -32603, message: 'upstream unavailable' } };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { result: '0x1e8480' };
      },
    };
  },
});
assert.equal(ethRetryLive.status, 'ok');
assert.equal(ethRetryLive.positions[1].quantity, '2');
assert.equal(ethRetryLive.rpc_retry.eth_call[0].retry.retry_count, 1);
assert.deepEqual(ethRetrySleeps, [7]);

console.log('ALL CHAIN READONLY ADAPTER TESTS PASS');
