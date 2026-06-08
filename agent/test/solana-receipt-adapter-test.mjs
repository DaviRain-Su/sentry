import assert from 'node:assert/strict';
import { buildSolanaSwapTask, normalizeSolanaExecutionResult } from '../../core/solana-trade.js';
import {
  fetchSolanaTransactionReceipt,
  normalizeSolanaSignatureStatusResponse,
  solanaSignatureStatusRequest,
} from '../src/solana-receipt-adapter.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const owner = '11111111111111111111111111111111';
const signature =
  '5KJvsngHeMpm884wtmM1ke22tjhMgZorT1fdS1T8yPzJkQdY1LZQmibZQj1A7wB8Qz3n8YdDsZc8QmvM1Qx3abc';
const built = buildSolanaSwapTask({
  taskId: 'task_solana_receipt_1',
  account: {
    owner,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'jupiter',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000000',
  quoteId: 'quote_solana_receipt_1',
});
assert.equal(built.status, 'ok');

const result = normalizeSolanaExecutionResult(
  {
    signature,
    quote_id: 'quote_solana_receipt_1',
  },
  { task_id: built.task.task_id, observed_at: timestamp }
);
assert.equal(result.status, 'submitted');

const request = solanaSignatureStatusRequest({ task: built.task, result });
assert.equal(request.status, 'ok');
assert.deepEqual(request.body, {
  jsonrpc: '2.0',
  id: 1,
  method: 'getSignatureStatuses',
  params: [[signature], { searchTransactionHistory: true }],
});
assert.equal(request.idempotency_key, 'quote_solana_receipt_1');

const normalized = normalizeSolanaSignatureStatusResponse(
  {
    result: {
      value: [
        {
          slot: 123456,
          confirmations: null,
          err: null,
          confirmationStatus: 'finalized',
        },
      ],
    },
  },
  {
    signature,
    observed_at: timestamp,
    idempotency_key: 'quote_solana_receipt_1',
  }
);
assert.equal(normalized.status, 'ok');
assert.equal(normalized.terminal, true);
assert.equal(normalized.confirmation_status, 'finalized');

let capturedBody = null;
const fetched = await fetchSolanaTransactionReceipt({
  task: built.task,
  result,
  now: new Date(timestamp),
  env: { SENTRY_SOLANA_RPC_URL: 'https://solana.invalid' },
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://solana.invalid');
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          result: {
            value: [
              {
                slot: 123456,
                confirmations: 5,
                err: null,
                confirmationStatus: 'confirmed',
              },
            ],
          },
        };
      },
    };
  },
});
assert.equal(fetched.status, 'ok');
assert.equal(fetched.terminal, false);
assert.equal(fetched.retry.attempts, 1);
assert.deepEqual(capturedBody, request.body);

let retryCalls = 0;
const retrySleeps = [];
const retryFetched = await fetchSolanaTransactionReceipt({
  task: built.task,
  result,
  now: new Date(timestamp),
  env: { SENTRY_SOLANA_RPC_URL: 'https://solana.invalid' },
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 6, max_backoff_ms: 6 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { error: { code: -32005, message: 'node is unhealthy' } };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          result: {
            value: [
              {
                slot: 123457,
                confirmations: null,
                err: null,
                confirmationStatus: 'finalized',
              },
            ],
          },
        };
      },
    };
  },
});
assert.equal(retryFetched.status, 'ok');
assert.equal(retryFetched.retry.retry_count, 1);
assert.deepEqual(retrySleeps, [6]);

const notFound = normalizeSolanaSignatureStatusResponse(
  {
    result: { value: [null] },
  },
  { signature }
);
assert.equal(notFound.status, 'error');
assert.equal(notFound.code, 'SOLANA_SIGNATURE_STATUS_NOT_FOUND');

const failed = normalizeSolanaSignatureStatusResponse(
  {
    result: {
      value: [
        {
          slot: 123456,
          confirmations: null,
          err: { InstructionError: [0, 'Custom'] },
          confirmationStatus: 'finalized',
        },
      ],
    },
  },
  { signature }
);
assert.equal(failed.status, 'error');
assert.equal(failed.code, 'SOLANA_TRANSACTION_REPORTED_ERROR');

const rpcError = await fetchSolanaTransactionReceipt({
  task: built.task,
  result,
  env: { SENTRY_SOLANA_RPC_URL: 'https://solana.invalid' },
  rateLimitPolicy: { max_attempts: 1 },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { error: { code: -32005, message: 'node is unhealthy' } };
    },
  }),
});
assert.equal(rpcError.status, 'error');
assert.equal(rpcError.code, 'SOLANA_RPC_ERROR');
assert.equal(rpcError.retry.retry_exhausted, true);

console.log('ALL SOLANA RECEIPT ADAPTER TESTS PASS');
