export const DEFAULT_HYPERLIQUID_RATE_LIMIT_POLICY = {
  max_attempts: 3,
  base_backoff_ms: 250,
  max_backoff_ms: 2_000,
  min_interval_ms: 100,
  retry_http_statuses: [429, 500, 502, 503, 504],
};

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function policyWithDefaults(policy = {}) {
  return {
    ...DEFAULT_HYPERLIQUID_RATE_LIMIT_POLICY,
    ...policy,
    retry_http_statuses:
      policy.retry_http_statuses || DEFAULT_HYPERLIQUID_RATE_LIMIT_POLICY.retry_http_statuses,
  };
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || null;
}

export function parseHyperliquidRetryAfterMs(value, nowMs = Date.now()) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(text);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

export function hyperliquidBackoffDelayMs({
  attempt,
  response,
  policy = {},
  nowMs = Date.now(),
} = {}) {
  const merged = policyWithDefaults(policy);
  const retryAfter = parseHyperliquidRetryAfterMs(
    headerValue(response?.headers, 'retry-after'),
    nowMs
  );
  if (retryAfter !== null) return Math.min(retryAfter, merged.max_backoff_ms);
  const exponential = merged.base_backoff_ms * 2 ** Math.max(0, Number(attempt || 0));
  return Math.min(exponential, merged.max_backoff_ms);
}

export function isRetryableHyperliquidResult({ response, error, policy = {} } = {}) {
  const merged = policyWithDefaults(policy);
  if (error) return true;
  if (response && merged.retry_http_statuses.includes(Number(response.status))) return true;
  return false;
}

export function createHyperliquidRateLimiter(options = {}) {
  const { policy = {}, nowMs = () => Date.now(), sleep = defaultSleep } = options;
  const merged = policyWithDefaults(policy);
  const lastByBucket = new Map();

  return {
    async wait(bucket = 'hyperliquid:default') {
      const now = Number(nowMs());
      const last = Number(lastByBucket.get(bucket) || 0);
      const delay = Math.max(0, last + merged.min_interval_ms - now);
      if (delay > 0) await sleep(delay);
      lastByBucket.set(bucket, Number(nowMs()));
      return { status: 'ok', bucket, delay_ms: delay };
    },
    snapshot() {
      return Object.fromEntries(lastByBucket.entries());
    },
  };
}

export async function fetchHyperliquidJsonWithBackoff(options = {}) {
  const {
    fetchOnce,
    policy = {},
    sleep = defaultSleep,
    rateLimiter = null,
    bucket = 'hyperliquid:default',
    nowMs = () => Date.now(),
  } = options;
  const merged = policyWithDefaults(policy);
  const maxAttempts = Math.max(1, Number(merged.max_attempts || 1));
  const retry_events = [];

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (rateLimiter?.wait) await rateLimiter.wait(bucket);
    let result = null;
    try {
      result = await fetchOnce({ attempt });
    } catch (error) {
      result = {
        error,
        response: null,
        body: null,
      };
    }

    const retryable = isRetryableHyperliquidResult({ ...result, policy: merged });
    const attempts = attempt + 1;
    if (!retryable || attempts >= maxAttempts) {
      return {
        ...result,
        attempts,
        retry_events,
        retry_exhausted: retryable && attempts >= maxAttempts,
      };
    }

    const delay_ms = hyperliquidBackoffDelayMs({
      attempt,
      response: result.response,
      policy: merged,
      nowMs: Number(nowMs()),
    });
    retry_events.push({
      attempt: attempts,
      delay_ms,
      http_status: result.response?.status ?? null,
      error: result.error?.message || null,
    });
    await sleep(delay_ms);
  }

  return {
    response: null,
    body: null,
    attempts: maxAttempts,
    retry_events,
    retry_exhausted: true,
  };
}

export function hyperliquidRetrySummary(result = {}) {
  return {
    attempts: Number(result.attempts || 0),
    retry_count: Array.isArray(result.retry_events) ? result.retry_events.length : 0,
    retry_exhausted: Boolean(result.retry_exhausted),
    events: Array.isArray(result.retry_events) ? result.retry_events : [],
  };
}
