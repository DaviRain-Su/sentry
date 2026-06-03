import {
  buildOkxOrderStatusQuery,
  normalizeOkxOrderStatusResponse,
  verifyOkxOrderStatusForTask,
} from '../../core/okx-trade.js';
import {
  assertOkxReadScope,
  buildOkxAuthHeaders,
  buildOkxRequestPath,
  OKX_BASE_URL,
} from './okx-readonly-adapter.mjs';
import { fetchOkxJsonWithBackoff, okxRetrySummary } from './okx-rate-limit.mjs';

export function okxOrderStatusRequest(input = {}) {
  const built = buildOkxOrderStatusQuery(input);
  if (built.status !== 'ok') return built;
  const requestPath = buildOkxRequestPath(built.query.endpoint, built.query.params);
  return {
    status: 'ok',
    method: built.query.method,
    requestPath,
    url: `${OKX_BASE_URL}${requestPath}`,
    body: '',
    idempotency_key: built.query.idempotency_key,
    simulated: Boolean(input.simulated),
  };
}

export async function fetchOkxOrderStatus({
  credentials,
  keyMetadata,
  task,
  result,
  instrument,
  venueOrderId,
  clientOrderId,
  fetchImpl = fetch,
  now = new Date(),
  simulated = false,
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const scope = assertOkxReadScope(keyMetadata);
  if (scope.status !== 'ok') return scope;
  if (!credentials || typeof credentials !== 'object') {
    return {
      status: 'error',
      code: 'OKX_CREDENTIALS_REQUIRED',
      message: 'OKX credentials must be supplied by a local keychain/external-agent adapter.',
    };
  }

  const request = okxOrderStatusRequest({
    task,
    result,
    instrument,
    venueOrderId,
    clientOrderId,
    simulated,
  });
  if (request.status !== 'ok') return request;

  const fetched = await fetchOkxJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `okx:${keyMetadata.key_handle || 'key'}:${request.requestPath}`,
    fetchOnce: async () => {
      const timestamp = (typeof now === 'function' ? now() : now).toISOString();
      const headers = buildOkxAuthHeaders({
        ...credentials,
        timestamp,
        method: request.method,
        requestPath: request.requestPath,
        body: request.body,
        simulated,
      });
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers,
      });
      const body = await response.json();
      return { response, body, observed_at: timestamp };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'OKX_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: okxRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok) {
    return {
      status: 'error',
      code: response.status === 429 ? 'OKX_RATE_LIMITED' : 'OKX_HTTP_ERROR',
      http_status: response.status,
      message: body?.msg || `OKX HTTP ${response.status}`,
      okx_body: body,
      retry: okxRetrySummary(fetched),
    };
  }

  const normalized = normalizeOkxOrderStatusResponse(body, {
    instrument,
    venue_order_id: venueOrderId,
    client_order_id: clientOrderId || request.idempotency_key,
    observed_at: fetched.observed_at,
  });
  if (normalized.status !== 'ok') return { ...normalized, retry: okxRetrySummary(fetched) };

  if (task) {
    const verified = verifyOkxOrderStatusForTask(normalized, task);
    if (verified.status !== 'ok') return verified;
  }

  return {
    ...normalized,
    idempotency_key: request.idempotency_key,
    retry: okxRetrySummary(fetched),
  };
}
