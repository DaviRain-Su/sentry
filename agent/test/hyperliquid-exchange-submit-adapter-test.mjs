import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import { readHyperliquidNonceStore } from '../src/hyperliquid-nonce-store.mjs';
import {
  hyperliquidSignedExchangeRequest,
  submitHyperliquidSignedExchangeAction,
} from '../src/hyperliquid-exchange-submit-adapter.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-hl-exchange-submit-'));

const cloid = '0x00000000000000000000000000000001';
const keyMetadata = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_agent_submit',
  account_ref: 'hyperliquid:subaccount:submit',
  read_account_address: '0x0000000000000000000000000000000000000001',
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
};
const built = buildHyperliquidPlaceOrderTask({
  taskId: 'task_hl_submit_1',
  keyMetadata,
  coin: 'BTC',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  cloid,
});
assert.equal(built.status, 'ok');

const signature = {
  r: '0x1111111111111111111111111111111111111111111111111111111111111111',
  s: '0x2222222222222222222222222222222222222222222222222222222222222222',
  v: 27,
};
const signedPayload = {
  action: {
    type: 'order',
    orders: [
      {
        a: 0,
        b: true,
        p: '99000',
        s: '0.01',
        r: false,
        t: { limit: { tif: 'Gtc' } },
        c: cloid,
      },
    ],
    grouping: 'na',
  },
  nonce: 1_780_000_000_000,
  signature,
  expiresAfter: 1_781_000_000_000,
};

try {
  const request = hyperliquidSignedExchangeRequest({
    task: built.task,
    payload: signedPayload,
    nowMs: 1_780_500_000_000,
  });
  assert.equal(request.status, 'ok');
  assert.equal(request.method, 'POST');
  assert.equal(request.endpoint, '/exchange');
  assert.equal(request.body.nonce, signedPayload.nonce);
  assert.equal(request.body.signature.r, signature.r);
  assert.equal(request.idempotency_key, cloid);
  assert.equal(JSON.stringify(request).includes('private_key'), false);

  const secretRejected = hyperliquidSignedExchangeRequest({
    task: built.task,
    payload: {
      ...signedPayload,
      private_key: 'must-not-submit',
    },
    nowMs: 1_780_500_000_000,
  });
  assert.equal(secretRejected.status, 'error');
  assert.equal(secretRejected.code, 'RAW_SECRET_FIELD_REJECTED');

  const cloidMismatch = hyperliquidSignedExchangeRequest({
    task: built.task,
    payload: {
      ...signedPayload,
      action: {
        ...signedPayload.action,
        orders: [
          {
            ...signedPayload.action.orders[0],
            c: '0x00000000000000000000000000000002',
          },
        ],
      },
    },
    nowMs: 1_780_500_000_000,
  });
  assert.equal(cloidMismatch.status, 'error');
  assert.equal(cloidMismatch.code, 'HYPERLIQUID_CLOID_MISMATCH');

  let capturedBody = null;
  const nonceStorePath = path.join(dir, 'submit-nonces.json');
  const submitted = await submitHyperliquidSignedExchangeAction({
    task: built.task,
    payload: signedPayload,
    now: new Date('2026-06-03T00:00:00.000Z'),
    nonceStorePath,
    fetchImpl: async (_url, init) => {
      capturedBody = JSON.parse(init.body);
      assert.equal(init.headers['content-type'], 'application/json');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'ok',
            response: {
              type: 'order',
              data: {
                statuses: [{ resting: { oid: 123456789, cloid } }],
              },
            },
          };
        },
      };
    },
  });
  assert.equal(submitted.status, 'submitted');
  assert.deepEqual(capturedBody, request.body);
  assert.equal(submitted.evidence.venue_order_id, '123456789');
  assert.equal(submitted.evidence.client_order_id, cloid);
  assert.equal(submitted.evidence.signed_exchange_submit, true);
  assert.equal(submitted.evidence.nonce, signedPayload.nonce);
  assert.equal(submitted.retry.retry_count, 0);

  const nonceStore = await readHyperliquidNonceStore({ storePath: nonceStorePath });
  assert.equal(nonceStore.records.length, 1);
  assert.equal(nonceStore.records[0].status, 'submitted');
  assert.equal(nonceStore.records[0].venue_order_id, '123456789');

  let duplicateFetchCalled = false;
  const duplicateSubmit = await submitHyperliquidSignedExchangeAction({
    task: built.task,
    payload: signedPayload,
    now: new Date('2026-06-03T00:00:01.000Z'),
    nonceStorePath,
    fetchImpl: async () => {
      duplicateFetchCalled = true;
      throw new Error('duplicate submit should not fetch');
    },
  });
  assert.equal(duplicateSubmit.status, 'error');
  assert.equal(duplicateSubmit.code, 'HYPERLIQUID_NONCE_ALREADY_USED');
  assert.equal(duplicateFetchCalled, false);

  const retrySleeps = [];
  let attempts = 0;
  const retryPayload = {
    ...signedPayload,
    nonce: 1_780_000_000_001,
    action: {
      ...signedPayload.action,
      orders: [
        {
          ...signedPayload.action.orders[0],
          c: '0x00000000000000000000000000000002',
        },
      ],
    },
  };
  const retryTask = buildHyperliquidPlaceOrderTask({
    taskId: 'task_hl_submit_2',
    keyMetadata,
    coin: 'BTC',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    cloid: '0x00000000000000000000000000000002',
  });
  assert.equal(retryTask.status, 'ok');
  const retried = await submitHyperliquidSignedExchangeAction({
    task: retryTask.task,
    payload: retryPayload,
    now: new Date('2026-06-03T00:00:00.000Z'),
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
            status: 'ok',
            response: {
              type: 'order',
              data: {
                statuses: [
                  {
                    filled: {
                      oid: 123456789,
                      cloid: '0x00000000000000000000000000000002',
                      totalSz: '0.01',
                      avgPx: '99000',
                    },
                  },
                ],
              },
            },
          };
        },
      };
    },
  });
  assert.equal(retried.status, 'done');
  assert.equal(retried.evidence.order_state, 'filled');
  assert.equal(attempts, 2);
  assert.deepEqual(retrySleeps, [5]);
  assert.equal(retried.retry.retry_count, 1);

  console.log('ALL HYPERLIQUID EXCHANGE SUBMIT ADAPTER TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
