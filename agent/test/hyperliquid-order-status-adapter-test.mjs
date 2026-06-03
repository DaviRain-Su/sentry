import assert from 'node:assert/strict';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import {
  fetchHyperliquidOrderStatus,
  hyperliquidOrderStatusRequest,
} from '../src/hyperliquid-order-status-adapter.mjs';

const user = '0x0000000000000000000000000000000000000001';
const cloid = '0x00000000000000000000000000000001';
const keyMetadata = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_agent_status',
  account_ref: 'hyperliquid:subaccount:status',
  read_account_address: user,
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
};
const built = buildHyperliquidPlaceOrderTask({
  taskId: 'task_hl_status_1',
  keyMetadata,
  coin: 'BTC',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  cloid,
});
assert.equal(built.status, 'ok');
const result = {
  task_id: built.task.task_id,
  status: 'submitted',
  evidence: {
    venue_id: 'hyperliquid',
    venue_order_id: '123456789',
    client_order_id: cloid,
    coin: 'BTC',
  },
};

const request = hyperliquidOrderStatusRequest({
  task: built.task,
  result,
  user,
});
assert.equal(request.status, 'ok');
assert.equal(request.method, 'POST');
assert.deepEqual(request.body, {
  type: 'orderStatus',
  user,
  oid: 123456789,
});
assert.equal(request.idempotency_key, cloid);

let capturedBody = null;
const open = await fetchHyperliquidOrderStatus({
  keyMetadata,
  task: built.task,
  result,
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: 'order',
          order: {
            order: {
              coin: 'BTC',
              oid: 123456789,
              cloid,
              side: 'B',
              limitPx: '99000',
              sz: '0.01',
              origSz: '0.01',
            },
            status: 'open',
            statusTimestamp: 1_780_000_001_000,
          },
        };
      },
    };
  },
});
assert.equal(open.status, 'ok');
assert.deepEqual(capturedBody, request.body);
assert.equal(open.order_state, 'open');
assert.equal(open.terminal, false);
assert.equal(open.venue_order_id, '123456789');
assert.equal(open.client_order_id, cloid);
assert.equal(open.retry.retry_count, 0);

const filled = await fetchHyperliquidOrderStatus({
  keyMetadata,
  task: built.task,
  result,
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        status: 'order',
        order: {
          order: {
            coin: 'BTC',
            oid: 123456789,
            cloid,
            side: 'B',
            limitPx: '99000',
            sz: '0.01',
            origSz: '0.01',
          },
          status: 'filled',
          statusTimestamp: 1_780_000_001_000,
        },
      };
    },
  }),
});
assert.equal(filled.status, 'ok');
assert.equal(filled.order_state, 'filled');
assert.equal(filled.terminal, true);
assert.equal(filled.filled_size, '0.01');

const mismatch = await fetchHyperliquidOrderStatus({
  keyMetadata,
  task: built.task,
  result,
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        status: 'order',
        order: {
          order: {
            coin: 'BTC',
            oid: 123456789,
            cloid: '0x00000000000000000000000000000002',
          },
          status: 'open',
        },
      };
    },
  }),
});
assert.equal(mismatch.status, 'error');
assert.equal(mismatch.code, 'HYPERLIQUID_CLOID_MISMATCH');

const retrySleeps = [];
let attempts = 0;
const retried = await fetchHyperliquidOrderStatus({
  keyMetadata,
  task: built.task,
  result,
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 5, max_backoff_ms: 5 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 429,
        headers: { 'retry-after': '0.005' },
        async json() {
          return { error: 'rate limit' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          status: 'order',
          order: {
            order: { coin: 'BTC', oid: 123456789, cloid },
            status: 'open',
          },
        };
      },
    };
  },
});
assert.equal(retried.status, 'ok');
assert.equal(attempts, 2);
assert.deepEqual(retrySleeps, [5]);
assert.equal(retried.retry.retry_count, 1);

let missingUserFetchCalled = false;
const missingUser = await fetchHyperliquidOrderStatus({
  keyMetadata: {
    ...keyMetadata,
    read_account_address: null,
    account_ref: 'hyperliquid:subaccount:status',
  },
  task: {
    ...built.task,
    policy_context: {
      ...built.task.policy_context,
      read_account_address: null,
    },
  },
  result,
  env: {},
  fetchImpl: async () => {
    missingUserFetchCalled = true;
    throw new Error('fetch should not run without a Hyperliquid user address');
  },
});
assert.equal(missingUser.status, 'error');
assert.equal(missingUser.code, 'HYPERLIQUID_USER_ADDRESS_REQUIRED');
assert.equal(missingUserFetchCalled, false);

console.log('ALL HYPERLIQUID ORDER STATUS ADAPTER TESTS PASS');
