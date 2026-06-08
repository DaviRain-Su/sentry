import assert from 'node:assert/strict';
import {
  chainRpcBackoffDelayMs,
  chainRpcRetrySummary,
  fetchChainRpcJsonWithBackoff,
  isRetryableChainRpcResult,
  parseChainRpcRetryAfterMs,
} from '../src/chain-rpc-rate-limit.mjs';

assert.equal(parseChainRpcRetryAfterMs('0.25'), 250);
assert.equal(
  parseChainRpcRetryAfterMs('Thu, 04 Jun 2026 00:00:01 GMT', Date.parse('2026-06-04T00:00:00Z')),
  1000
);
assert.equal(
  chainRpcBackoffDelayMs({
    attempt: 2,
    policy: { base_backoff_ms: 10, max_backoff_ms: 25 },
  }),
  25
);
assert.equal(isRetryableChainRpcResult({ response: { status: 429 } }), true);
assert.equal(isRetryableChainRpcResult({ body: { error: { code: -32005 } } }), true);
assert.equal(isRetryableChainRpcResult({ body: { error: { code: -32099 } } }), false);

let attempts = 0;
const sleeps = [];
const fetched = await fetchChainRpcJsonWithBackoff({
  policy: { max_attempts: 2, base_backoff_ms: 10, max_backoff_ms: 10 },
  sleep: async (ms) => sleeps.push(ms),
  fetchOnce: async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        response: { ok: false, status: 429, headers: { 'retry-after': '0.01' } },
        body: { error: { code: -32005, message: 'rate limited' } },
      };
    }
    return {
      response: { ok: true, status: 200 },
      body: { result: 'ok' },
    };
  },
});
assert.equal(fetched.body.result, 'ok');
assert.equal(fetched.attempts, 2);
assert.deepEqual(sleeps, [10]);
assert.deepEqual(chainRpcRetrySummary(fetched), {
  attempts: 2,
  retry_count: 1,
  retry_exhausted: false,
  events: [
    {
      attempt: 1,
      delay_ms: 10,
      http_status: 429,
      rpc_code: -32005,
      error: null,
    },
  ],
});

console.log('ALL CHAIN RPC RATE LIMIT TESTS PASS');
