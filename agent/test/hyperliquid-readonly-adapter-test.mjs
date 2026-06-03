import assert from 'node:assert/strict';
import {
  assertHyperliquidReadScope,
  fetchHyperliquidReadState,
  hyperliquidInfoRequest,
  isHyperliquidAddress,
  normalizeHyperliquidClearinghouseState,
  normalizeHyperliquidOpenOrders,
  normalizeHyperliquidSpotState,
  resolveHyperliquidUserAddress,
} from '../src/hyperliquid-readonly-adapter.mjs';

const user = '0x0000000000000000000000000000000000000001';
const keyMetadata = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_agent_test',
  account_ref: 'hyperliquid:subaccount:test',
  read_account_address: user,
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
};

assert.equal(isHyperliquidAddress(user), true);
assert.equal(isHyperliquidAddress('hyperliquid:subaccount:test'), false);
assert.equal(resolveHyperliquidUserAddress(keyMetadata).user, user);
assert.equal(
  resolveHyperliquidUserAddress(
    { ...keyMetadata, read_account_address: null },
    {
      SENTRY_HYPERLIQUID_USER: user,
    }
  ).user,
  user
);
assert.equal(
  resolveHyperliquidUserAddress({ ...keyMetadata, read_account_address: null }).code,
  'HYPERLIQUID_USER_ADDRESS_REQUIRED'
);

assert.equal(assertHyperliquidReadScope(keyMetadata).status, 'ok');
assert.equal(
  assertHyperliquidReadScope({ ...keyMetadata, permissions: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertHyperliquidReadScope({ ...keyMetadata, permissions: ['place_order'] }).code,
  'HYPERLIQUID_READ_PERMISSION_REQUIRED'
);

assert.deepEqual(hyperliquidInfoRequest('clearinghouseState', { user }).body, {
  type: 'clearinghouseState',
  user,
});

const clearing = normalizeHyperliquidClearinghouseState(
  {
    marginSummary: {
      accountValue: '1000',
      totalNtlPos: '500',
      totalMarginUsed: '50',
    },
    withdrawable: '950',
    assetPositions: [
      {
        position: {
          coin: 'BTC',
          szi: '0.01',
          entryPx: '100000',
          positionValue: '1000',
          unrealizedPnl: '25',
          marginUsed: '50',
          liquidationPx: '80000',
          leverage: { type: 'cross', value: 2 },
        },
      },
    ],
  },
  { account_ref: keyMetadata.account_ref, observed_at: '2026-06-03T00:00:00.000Z' }
);
assert.equal(clearing.status, 'ok');
assert.equal(clearing.position_count, 1);
assert.equal(clearing.positions[0].asset, 'BTC');
assert.equal(clearing.positions[0].quantity, '0.01');
assert.equal(clearing.account_value_usd, '1000');

const spot = normalizeHyperliquidSpotState(
  {
    balances: [
      { coin: 'USDC', total: '100', hold: '25', entryNtl: '100' },
      { coin: 'HYPE', total: '3', hold: '0', entryNtl: '90' },
    ],
  },
  { account_ref: keyMetadata.account_ref, observed_at: '2026-06-03T00:00:00.000Z' }
);
assert.equal(spot.status, 'ok');
assert.equal(spot.balance_count, 2);
assert.equal(spot.balances[0].available, '75');

const orders = normalizeHyperliquidOpenOrders([
  {
    coin: 'BTC',
    oid: 123,
    cloid: '0x00000000000000000000000000000001',
    side: 'B',
    orderType: 'Limit',
    limitPx: '99000',
    sz: '0.01',
    reduceOnly: false,
    timestamp: 1780473600000,
  },
]);
assert.equal(orders.status, 'ok');
assert.equal(orders.order_count, 1);
assert.equal(orders.orders[0].order_id, '123');

const seenBodies = [];
const state = await fetchHyperliquidReadState({
  keyMetadata,
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    seenBodies.push(body);
    const payloads = {
      clearinghouseState: {
        marginSummary: { accountValue: '1000', totalNtlPos: '500', totalMarginUsed: '50' },
        withdrawable: '950',
        assetPositions: [{ position: { coin: 'BTC', szi: '0.01', positionValue: '1000' } }],
      },
      spotClearinghouseState: { balances: [{ coin: 'USDC', total: '100', hold: '0' }] },
      frontendOpenOrders: [{ coin: 'BTC', oid: 123, side: 'B', limitPx: '99000', sz: '0.01' }],
    };
    return {
      ok: true,
      status: 200,
      async json() {
        return payloads[body.type];
      },
    };
  },
});
assert.equal(state.status, 'ok');
assert.deepEqual(
  seenBodies.map((body) => body.type),
  ['clearinghouseState', 'spotClearinghouseState', 'frontendOpenOrders']
);
assert.equal(state.positions.length, 2);
assert.equal(state.open_orders.length, 1);
assert.equal(state.account_summary.account_value_usd, '1000');
assert.equal(state.retry.clearinghouseState.retry_count, 0);

const retrySleeps = [];
let clearingAttempts = 0;
const retriedState = await fetchHyperliquidReadState({
  keyMetadata,
  now: new Date('2026-06-03T00:00:00.000Z'),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 5, max_backoff_ms: 5 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.type === 'clearinghouseState') {
      clearingAttempts += 1;
      if (clearingAttempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: { 'retry-after': '0.005' },
          async json() {
            return { error: 'rate limit' };
          },
        };
      }
    }
    const payloads = {
      clearinghouseState: {
        marginSummary: { accountValue: '1000', totalNtlPos: '500', totalMarginUsed: '50' },
        withdrawable: '950',
        assetPositions: [],
      },
      spotClearinghouseState: { balances: [] },
      frontendOpenOrders: [],
    };
    return {
      ok: true,
      status: 200,
      async json() {
        return payloads[body.type];
      },
    };
  },
});
assert.equal(retriedState.status, 'ok');
assert.equal(clearingAttempts, 2);
assert.deepEqual(retrySleeps, [5]);
assert.equal(retriedState.retry.clearinghouseState.retry_count, 1);

const missing = await fetchHyperliquidReadState({
  keyMetadata: {
    ...keyMetadata,
    read_account_address: null,
    account_ref: 'hyperliquid:subaccount:test',
  },
  fetchImpl: async () => {
    throw new Error('fetch should not be called without a user address');
  },
});
assert.equal(missing.status, 'error');
assert.equal(missing.code, 'HYPERLIQUID_USER_ADDRESS_REQUIRED');

console.log('ALL HYPERLIQUID READONLY ADAPTER TESTS PASS');
