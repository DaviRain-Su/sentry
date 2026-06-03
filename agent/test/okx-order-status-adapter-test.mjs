import assert from 'node:assert/strict';
import { buildOkxPlaceOrderTask } from '../../core/okx-trade.js';
import { fetchOkxOrderStatus, okxOrderStatusRequest } from '../src/okx-order-status-adapter.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const keyMetadata = {
  venue_id: 'okx',
  key_handle: 'okx_key_status',
  account_ref: 'okx:subaccount:status',
  permissions: ['read', 'place_order', 'cancel_order'],
};

const built = buildOkxPlaceOrderTask({
  taskId: 'task_okx_status_1',
  keyMetadata,
  instrument: 'BTC-USDT',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  clientOrderId: 'sentry-status-1',
});
assert.equal(built.status, 'ok');

const request = okxOrderStatusRequest({
  task: built.task,
  result: {
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: '123456789',
      client_order_id: 'sentry-status-1',
    },
  },
  simulated: true,
});
assert.equal(request.status, 'ok');
assert.equal(request.method, 'GET');
assert.equal(
  request.requestPath,
  '/api/v5/trade/order?instId=BTC-USDT&ordId=123456789&clOrdId=sentry-status-1'
);
assert.equal(request.idempotency_key, 'sentry-status-1');
assert.equal(request.url, `https://www.okx.com${request.requestPath}`);

let capturedUrl = null;
let capturedHeaders = null;
const fetched = await fetchOkxOrderStatus({
  credentials: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-passphrase',
  },
  keyMetadata,
  task: built.task,
  result: {
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: '123456789',
      client_order_id: 'sentry-status-1',
    },
  },
  now: new Date(timestamp),
  simulated: true,
  fetchImpl: async (url, init) => {
    capturedUrl = url;
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
              ordId: '123456789',
              clOrdId: 'sentry-status-1',
              instId: 'BTC-USDT',
              state: 'partially_filled',
              accFillSz: '0.005',
              avgPx: '99000',
            },
          ],
        };
      },
    };
  },
});
assert.equal(fetched.status, 'ok');
assert.equal(fetched.order_state, 'partially_filled');
assert.equal(fetched.terminal, false);
assert.equal(fetched.venue_order_id, '123456789');
assert.equal(fetched.client_order_id, 'sentry-status-1');
assert.equal(capturedUrl, request.url);
assert.equal(capturedHeaders['OK-ACCESS-KEY'], 'test-key');
assert.equal(capturedHeaders['x-simulated-trading'], '1');
assert.equal(JSON.stringify(capturedHeaders).includes('test-secret'), false);

const mismatch = await fetchOkxOrderStatus({
  credentials: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-passphrase',
  },
  keyMetadata,
  task: built.task,
  result: {
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: '123456789',
      client_order_id: 'sentry-status-1',
    },
  },
  now: new Date(timestamp),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: '0',
        msg: '',
        data: [
          {
            ordId: '123456789',
            clOrdId: 'wrong-client-id',
            instId: 'BTC-USDT',
            state: 'live',
          },
        ],
      };
    },
  }),
});
assert.equal(mismatch.status, 'error');
assert.equal(mismatch.code, 'OKX_CLIENT_ORDER_ID_MISMATCH');

const noCredentials = await fetchOkxOrderStatus({ keyMetadata, task: built.task });
assert.equal(noCredentials.status, 'error');
assert.equal(noCredentials.code, 'OKX_CREDENTIALS_REQUIRED');

let retryCalls = 0;
const retrySleeps = [];
const retryStatus = await fetchOkxOrderStatus({
  credentials: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-passphrase',
  },
  keyMetadata,
  task: built.task,
  result: {
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: '123456789',
      client_order_id: 'sentry-status-1',
    },
  },
  now: () => new Date(timestamp),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 20, max_backoff_ms: 20 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return {
        ok: false,
        status: 503,
        async json() {
          return { code: '50000', msg: 'temporarily unavailable' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          msg: '',
          data: [
            {
              ordId: '123456789',
              clOrdId: 'sentry-status-1',
              instId: 'BTC-USDT',
              state: 'filled',
            },
          ],
        };
      },
    };
  },
});
assert.equal(retryStatus.status, 'ok');
assert.equal(retryStatus.retry.attempts, 2);
assert.equal(retryStatus.retry.retry_count, 1);
assert.deepEqual(retrySleeps, [20]);

console.log('ALL OKX ORDER STATUS ADAPTER TESTS PASS');
