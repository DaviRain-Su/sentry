import assert from 'node:assert/strict';
import {
  createOkxRateLimiter,
  fetchOkxJsonWithBackoff,
  isRetryableOkxResult,
  okxBackoffDelayMs,
  okxRetrySummary,
  parseRetryAfterMs,
} from '../src/okx-rate-limit.mjs';

assert.equal(parseRetryAfterMs('2', 1_000), 2_000);
assert.equal(parseRetryAfterMs('bad', 1_000), null);
assert.equal(
  parseRetryAfterMs('2026-06-03T00:00:02.000Z', Date.parse('2026-06-03T00:00:00.000Z')),
  2_000
);
assert.equal(
  okxBackoffDelayMs({ attempt: 2, policy: { base_backoff_ms: 100, max_backoff_ms: 250 } }),
  250
);
assert.equal(
  okxBackoffDelayMs({
    attempt: 0,
    response: { headers: { 'retry-after': '3' } },
    policy: { max_backoff_ms: 1_000 },
  }),
  1_000
);
assert.equal(isRetryableOkxResult({ response: { status: 429 } }), true);
assert.equal(isRetryableOkxResult({ body: { code: '50011' } }), true);
assert.equal(isRetryableOkxResult({ response: { status: 400 }, body: { code: '51008' } }), false);

const sleeps = [];
let calls = 0;
const fetched = await fetchOkxJsonWithBackoff({
  policy: { max_attempts: 3, base_backoff_ms: 10, max_backoff_ms: 50 },
  sleep: async (ms) => sleeps.push(ms),
  fetchOnce: async () => {
    calls += 1;
    if (calls < 3) {
      return {
        response: { ok: false, status: 429, headers: { 'retry-after': '0.01' } },
        body: { code: '50011', msg: 'rate limit' },
      };
    }
    return {
      response: { ok: true, status: 200 },
      body: { code: '0', data: [] },
    };
  },
});
assert.equal(fetched.response.ok, true);
assert.equal(fetched.attempts, 3);
assert.deepEqual(sleeps, [10, 10]);
assert.equal(okxRetrySummary(fetched).retry_count, 2);

let now = 1_000;
const limiterSleeps = [];
const limiter = createOkxRateLimiter({
  policy: { min_interval_ms: 100 },
  nowMs: () => now,
  sleep: async (ms) => {
    limiterSleeps.push(ms);
    now += ms;
  },
});
await limiter.wait('okx:key');
await limiter.wait('okx:key');
assert.deepEqual(limiterSleeps, [100]);

console.log('ALL OKX RATE LIMIT TESTS PASS');
