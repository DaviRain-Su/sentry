import assert from 'node:assert/strict';
import {
  createHyperliquidRateLimiter,
  fetchHyperliquidJsonWithBackoff,
  hyperliquidBackoffDelayMs,
  hyperliquidRetrySummary,
  isRetryableHyperliquidResult,
  parseHyperliquidRetryAfterMs,
} from '../src/hyperliquid-rate-limit.mjs';

assert.equal(parseHyperliquidRetryAfterMs('2', 1_000), 2_000);
assert.equal(parseHyperliquidRetryAfterMs('bad', 1_000), null);
assert.equal(
  parseHyperliquidRetryAfterMs('2026-06-03T00:00:02.000Z', Date.parse('2026-06-03T00:00:00.000Z')),
  2_000
);
assert.equal(
  hyperliquidBackoffDelayMs({ attempt: 2, policy: { base_backoff_ms: 100, max_backoff_ms: 250 } }),
  250
);
assert.equal(
  hyperliquidBackoffDelayMs({
    attempt: 0,
    response: { headers: { 'retry-after': '3' } },
    policy: { max_backoff_ms: 1_000 },
  }),
  1_000
);
assert.equal(isRetryableHyperliquidResult({ response: { status: 429 } }), true);
assert.equal(isRetryableHyperliquidResult({ response: { status: 503 } }), true);
assert.equal(isRetryableHyperliquidResult({ response: { status: 400 } }), false);

const sleeps = [];
let calls = 0;
const fetched = await fetchHyperliquidJsonWithBackoff({
  policy: { max_attempts: 3, base_backoff_ms: 10, max_backoff_ms: 50 },
  sleep: async (ms) => sleeps.push(ms),
  fetchOnce: async () => {
    calls += 1;
    if (calls < 3) {
      return {
        response: { ok: false, status: 429, headers: { 'retry-after': '0.01' } },
        body: { error: 'rate limit' },
      };
    }
    return {
      response: { ok: true, status: 200 },
      body: { ok: true },
    };
  },
});
assert.equal(fetched.response.ok, true);
assert.equal(fetched.attempts, 3);
assert.deepEqual(sleeps, [10, 10]);
assert.equal(hyperliquidRetrySummary(fetched).retry_count, 2);

let now = 1_000;
const limiterSleeps = [];
const limiter = createHyperliquidRateLimiter({
  policy: { min_interval_ms: 100 },
  nowMs: () => now,
  sleep: async (ms) => {
    limiterSleeps.push(ms);
    now += ms;
  },
});
await limiter.wait('hyperliquid:key');
await limiter.wait('hyperliquid:key');
assert.deepEqual(limiterSleeps, [100]);

console.log('ALL HYPERLIQUID RATE LIMIT TESTS PASS');
