import assert from 'node:assert/strict';
import { buildLocalSecretStoreSnapshot } from '../../core/local-secrets.js';
import {
  okxCredentialEnvNames,
  redactCredentialResolution,
  resolveOkxCredentialsFromEnv,
} from '../src/local-credential-resolver.mjs';
import { buildLiveInventorySnapshot } from '../src/live-inventory-sync.mjs';

const key = {
  venue_id: 'okx',
  key_handle: 'okx_key_live',
  display_handle: 'okx_....live',
  account_ref: 'okx:subaccount:live',
  storage: 'os_keychain',
  permissions: ['read', 'place_order', 'cancel_order'],
  ip_allowlist: true,
};
const hyperliquidKey = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_agent_live',
  display_handle: 'hl_....live',
  account_ref: 'hyperliquid:subaccount:live',
  read_account_address: '0x0000000000000000000000000000000000000001',
  storage: 'os_keychain',
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  ip_allowlist: false,
};
const secretStore = buildLocalSecretStoreSnapshot([key, hyperliquidKey]);
assert.equal(secretStore.status, 'ok');

const envNames = okxCredentialEnvNames(key);
assert.deepEqual(envNames.apiKey, ['SENTRY_OKX_OKX_KEY_LIVE_API_KEY', 'SENTRY_OKX_API_KEY']);

const missing = resolveOkxCredentialsFromEnv(key, {});
assert.equal(missing.status, 'error');
assert.equal(missing.code, 'OKX_CREDENTIAL_ENV_MISSING');
assert.equal(missing.missing.length, 3);
assert.equal(JSON.stringify(missing).includes('secret-value'), false);

const resolved = resolveOkxCredentialsFromEnv(key, {
  SENTRY_OKX_OKX_KEY_LIVE_API_KEY: 'api-value',
  SENTRY_OKX_OKX_KEY_LIVE_SECRET_KEY: 'secret-value',
  SENTRY_OKX_OKX_KEY_LIVE_PASSPHRASE: 'pass-value',
});
assert.equal(resolved.status, 'ok');
assert.equal(resolved.credentials.secretKey, 'secret-value');
const redacted = redactCredentialResolution(resolved);
assert.equal(JSON.stringify(redacted).includes('secret-value'), false);
assert.equal(redacted.resolved_from.secretKey, 'SENTRY_OKX_OKX_KEY_LIVE_SECRET_KEY');

let capturedHeaders = null;
const live = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['okx'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  okxCcy: 'USDC',
  simulated: true,
  env: {
    SENTRY_OKX_OKX_KEY_LIVE_API_KEY: 'api-value',
    SENTRY_OKX_OKX_KEY_LIVE_SECRET_KEY: 'secret-value',
    SENTRY_OKX_OKX_KEY_LIVE_PASSPHRASE: 'pass-value',
  },
  fetchImpl: async (_url, init) => {
    capturedHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          msg: '',
          data: [
            {
              totalEq: '100.25',
              details: [
                {
                  ccy: 'USDC',
                  eq: '100',
                  eqUsd: '100.25',
                  cashBal: '100',
                  availBal: '90',
                  frozenBal: '10',
                },
              ],
            },
          ],
        };
      },
    };
  },
});
assert.equal(live.status, 'ok');
assert.equal(live.position_count, 1);
assert.equal(live.positions[0].venue_id, 'okx');
assert.equal(live.positions[0].asset, 'USDC');
assert.equal(live.positions[0].available, '90');
assert.equal(live.live_reads[0].status, 'ok');
assert.equal(JSON.stringify(live).includes('secret-value'), false);
assert.equal(JSON.stringify(capturedHeaders).includes('secret-value'), false);
assert.equal(capturedHeaders['x-simulated-trading'], '1');

const blocked = await buildLiveInventorySnapshot({
  secretStore: buildLocalSecretStoreSnapshot([key]),
  scope: ['okx'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without credentials');
  },
});
assert.equal(blocked.status, 'blocked');
assert.equal(blocked.position_count, 0);
assert.equal(blocked.access_issues[0].code, 'OKX_CREDENTIAL_SOURCE_MISSING');
assert.equal(blocked.live_reads[0].status, 'blocked');

const hyperliquidBodies = [];
const hyperliquid = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['hyperliquid'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {},
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    hyperliquidBodies.push(body);
    return {
      ok: true,
      status: 200,
      async json() {
        if (body.type === 'clearinghouseState') {
          return {
            marginSummary: { accountValue: '1000', totalNtlPos: '500', totalMarginUsed: '50' },
            withdrawable: '950',
            assetPositions: [{ position: { coin: 'BTC', szi: '0.01', positionValue: '1000' } }],
          };
        }
        if (body.type === 'spotClearinghouseState') {
          return { balances: [{ coin: 'USDC', total: '100', hold: '0', entryNtl: '100' }] };
        }
        return [{ coin: 'BTC', oid: 123, side: 'B', limitPx: '99000', sz: '0.01' }];
      },
    };
  },
});
assert.equal(hyperliquid.status, 'ok');
assert.equal(hyperliquid.position_count, 2);
assert.deepEqual(
  hyperliquidBodies.map((body) => body.type),
  ['clearinghouseState', 'spotClearinghouseState', 'frontendOpenOrders']
);
assert.equal(hyperliquid.live_reads[0].venue_id, 'hyperliquid');
assert.equal(hyperliquid.live_reads[0].open_order_count, 1);

const missingHyperliquidAddress = await buildLiveInventorySnapshot({
  secretStore: buildLocalSecretStoreSnapshot([
    {
      ...hyperliquidKey,
      read_account_address: null,
      account_ref: 'hyperliquid:subaccount:no-address',
    },
  ]),
  scope: ['hyperliquid'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without hyperliquid user address');
  },
});
assert.equal(missingHyperliquidAddress.status, 'blocked');
assert.equal(missingHyperliquidAddress.access_issues[0].code, 'HYPERLIQUID_USER_ADDRESS_REQUIRED');

const solanaOwner = '11111111111111111111111111111111';
const solanaCalls = [];
const solanaLive = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['solana-mainnet'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
    SENTRY_SOLANA_RPC_URL: 'https://solana.example',
  },
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://solana.example');
    const body = JSON.parse(init.body);
    solanaCalls.push(body.method);
    return {
      ok: true,
      status: 200,
      async json() {
        if (body.method === 'getBalance') return { result: { value: 2_000_000_000 } };
        return {
          result: {
            value: [
              {
                pubkey: 'TokenAccount111',
                account: {
                  data: {
                    parsed: {
                      info: {
                        mint: 'USDCMint111',
                        tokenAmount: { amount: '2500000', decimals: 6, uiAmountString: '2.5' },
                      },
                    },
                  },
                },
              },
            ],
          },
        };
      },
    };
  },
});
assert.equal(solanaLive.status, 'ok');
assert.deepEqual(solanaCalls, ['getBalance', 'getTokenAccountsByOwner']);
assert.equal(solanaLive.position_count, 2);
assert.equal(solanaLive.positions[0].asset, 'SOL');
assert.equal(solanaLive.positions[0].quantity, '2');
assert.equal(solanaLive.positions[1].quantity, '2.5');
assert.equal(solanaLive.live_reads[0].venue_id, 'solana-mainnet');
assert.equal(solanaLive.live_reads[0].rpc_retry.getBalance.attempts, 1);

const missingSolanaAddress = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['solana-mainnet'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without solana wallet address');
  },
});
assert.equal(missingSolanaAddress.status, 'blocked');
assert.equal(missingSolanaAddress.access_issues[0].code, 'SOLANA_WALLET_ADDRESS_REQUIRED');

const ethereumOwner = '0x0000000000000000000000000000000000000001';
const ethereumCalls = [];
const ethereumLive = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['ethereum-mainnet'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: ethereumOwner,
    SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.example',
    SENTRY_ETHEREUM_TOKENS: 'USDC:0x0000000000000000000000000000000000000002:6',
  },
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://ethereum.example');
    const body = JSON.parse(init.body);
    ethereumCalls.push(body.method);
    return {
      ok: true,
      status: 200,
      async json() {
        if (body.method === 'eth_getBalance') return { result: '0x1bc16d674ec80000' };
        return { result: '0x2dc6c0' };
      },
    };
  },
});
assert.equal(ethereumLive.status, 'ok');
assert.deepEqual(ethereumCalls, ['eth_getBalance', 'eth_call']);
assert.equal(ethereumLive.position_count, 2);
assert.equal(ethereumLive.positions[0].asset, 'ETH');
assert.equal(ethereumLive.positions[0].quantity, '2');
assert.equal(ethereumLive.positions[1].asset, 'USDC');
assert.equal(ethereumLive.positions[1].quantity, '3');
assert.equal(ethereumLive.live_reads[0].venue_id, 'ethereum-mainnet');
assert.equal(ethereumLive.live_reads[0].rpc_retry.eth_getBalance.attempts, 1);

const missingEthereumAddress = await buildLiveInventorySnapshot({
  secretStore,
  scope: ['ethereum-mainnet'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  env: {},
  fetchImpl: async () => {
    throw new Error('fetch should not be called without ethereum wallet address');
  },
});
assert.equal(missingEthereumAddress.status, 'blocked');
assert.equal(missingEthereumAddress.access_issues[0].code, 'ETHEREUM_WALLET_ADDRESS_REQUIRED');

console.log('ALL LIVE INVENTORY SYNC TESTS PASS');
