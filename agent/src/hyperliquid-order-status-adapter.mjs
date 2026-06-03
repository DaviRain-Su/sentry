import {
  buildHyperliquidOrderStatusQuery,
  normalizeHyperliquidOrderStatusResponse,
  verifyHyperliquidOrderStatusForTask,
} from '../../core/hyperliquid-trade.js';
import {
  HYPERLIQUID_INFO_URL,
  assertHyperliquidReadScope,
  isHyperliquidAddress,
  resolveHyperliquidUserAddress,
} from './hyperliquid-readonly-adapter.mjs';
import {
  fetchHyperliquidJsonWithBackoff,
  hyperliquidRetrySummary,
} from './hyperliquid-rate-limit.mjs';

export function hyperliquidOrderStatusRequest(input = {}) {
  const built = buildHyperliquidOrderStatusQuery(input);
  if (built.status !== 'ok') return built;
  return {
    status: 'ok',
    method: built.query.method,
    url: HYPERLIQUID_INFO_URL,
    body: built.query.body,
    idempotency_key: built.query.idempotency_key,
    expected: built.query.expected,
  };
}

export async function fetchHyperliquidOrderStatus({
  keyMetadata,
  task,
  result,
  user,
  venueOrderId,
  clientOrderId,
  fetchImpl = fetch,
  env = process.env,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const scope = assertHyperliquidReadScope(keyMetadata);
  if (scope.status !== 'ok') return scope;

  const resolvedUser = user
    ? {
        status: isHyperliquidAddress(user) ? 'ok' : 'error',
        user: String(user).toLowerCase(),
        code: 'HYPERLIQUID_USER_ADDRESS_INVALID',
        message: 'Hyperliquid user address must be a 42-character hex address.',
      }
    : resolveHyperliquidUserAddress(keyMetadata, env);
  if (resolvedUser.status !== 'ok') return resolvedUser;

  const request = hyperliquidOrderStatusRequest({
    task,
    result,
    user: resolvedUser.user,
    venueOrderId,
    clientOrderId,
  });
  if (request.status !== 'ok') return request;

  const fetched = await fetchHyperliquidJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `hyperliquid:orderStatus:${resolvedUser.user}:${request.idempotency_key || request.expected?.venue_order_id || 'order'}`,
    fetchOnce: async () => {
      const observedAt = (typeof now === 'function' ? now() : now).toISOString();
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const body = await response.json();
      return { response, body, observed_at: observedAt };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: hyperliquidRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok) {
    return {
      status: 'error',
      code: response.status === 429 ? 'HYPERLIQUID_RATE_LIMITED' : 'HYPERLIQUID_HTTP_ERROR',
      http_status: response.status,
      message: body?.error || body?.message || `Hyperliquid HTTP ${response.status}`,
      hyperliquid_body: body,
      retry: hyperliquidRetrySummary(fetched),
    };
  }

  const normalized = normalizeHyperliquidOrderStatusResponse(body, {
    venue_order_id: request.expected?.venue_order_id,
    client_order_id: request.expected?.client_order_id,
    coin: request.expected?.coin,
    observed_at: fetched.observed_at,
  });
  if (normalized.status !== 'ok') {
    return { ...normalized, retry: hyperliquidRetrySummary(fetched) };
  }

  if (task) {
    const verified = verifyHyperliquidOrderStatusForTask(normalized, task);
    if (verified.status !== 'ok') return verified;
  }

  return {
    ...normalized,
    user: resolvedUser.user,
    idempotency_key: request.idempotency_key,
    retry: hyperliquidRetrySummary(fetched),
  };
}
