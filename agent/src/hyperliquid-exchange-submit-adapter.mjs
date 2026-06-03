import {
  HYPERLIQUID_EXCHANGE_ENDPOINT,
  hyperliquidCoinFromTask,
  hyperliquidCloidFromTask,
  normalizeHyperliquidSignedExchangeSubmitResult,
  validateHyperliquidSignedExchangePayload,
  verifyHyperliquidAgentTaskResult,
} from '../../core/hyperliquid-trade.js';
import {
  fetchHyperliquidJsonWithBackoff,
  hyperliquidRetrySummary,
} from './hyperliquid-rate-limit.mjs';
import {
  claimHyperliquidExchangeNonce,
  finalizeHyperliquidExchangeNonce,
} from './hyperliquid-nonce-store.mjs';

export const HYPERLIQUID_EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange';

export function hyperliquidSignedExchangeRequest(input = {}) {
  const validated = validateHyperliquidSignedExchangePayload(input.payload, {
    task: input.task,
    nowMs: input.nowMs || input.now_ms,
  });
  if (validated.status !== 'ok') return validated;
  return {
    status: 'ok',
    method: 'POST',
    endpoint: HYPERLIQUID_EXCHANGE_ENDPOINT,
    url: HYPERLIQUID_EXCHANGE_URL,
    body: validated.payload,
    idempotency_key: hyperliquidCloidFromTask(input.task),
    nonce: validated.payload.nonce,
    expires_after_ms: validated.payload.expiresAfter || null,
  };
}

export async function submitHyperliquidSignedExchangeAction({
  task,
  payload,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
  nonceStorePath = null,
} = {}) {
  const request = hyperliquidSignedExchangeRequest({
    task,
    payload,
    nowMs: (typeof now === 'function' ? now() : now).getTime?.() || Date.now(),
  });
  if (request.status !== 'ok') return request;

  const nonceClaim = await claimHyperliquidExchangeNonce({
    task,
    request,
    storePath: nonceStorePath,
    now,
  });
  if (nonceClaim.status === 'error') return nonceClaim;

  const fetched = await fetchHyperliquidJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `hyperliquid:exchange:${request.idempotency_key || request.nonce}`,
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
    const result = {
      status: 'error',
      code: 'HYPERLIQUID_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: hyperliquidRetrySummary(fetched),
    };
    await finalizeHyperliquidExchangeNonce({
      claim: nonceClaim,
      result,
      storePath: nonceStorePath,
      now,
    });
    return result;
  }
  const { response, body } = fetched;
  if (!response.ok) {
    const result = {
      status: 'error',
      code: response.status === 429 ? 'HYPERLIQUID_RATE_LIMITED' : 'HYPERLIQUID_HTTP_ERROR',
      http_status: response.status,
      message: body?.error || body?.message || `Hyperliquid HTTP ${response.status}`,
      hyperliquid_body: body,
      retry: hyperliquidRetrySummary(fetched),
    };
    await finalizeHyperliquidExchangeNonce({
      claim: nonceClaim,
      result,
      storePath: nonceStorePath,
      now,
    });
    return result;
  }

  const normalized = normalizeHyperliquidSignedExchangeSubmitResult(body, {
    task_id: task?.task_id,
    client_order_id: hyperliquidCloidFromTask(task),
    coin: hyperliquidCoinFromTask(task),
    nonce: request.nonce,
    expires_after_ms: request.expires_after_ms,
    observed_at: fetched.observed_at,
  });
  if (!['submitted', 'done'].includes(normalized.status)) {
    const result = { ...normalized, retry: hyperliquidRetrySummary(fetched) };
    await finalizeHyperliquidExchangeNonce({
      claim: nonceClaim,
      result,
      storePath: nonceStorePath,
      now,
    });
    return result;
  }

  const verified = verifyHyperliquidAgentTaskResult(normalized, task);
  if (verified.status !== 'ok') {
    await finalizeHyperliquidExchangeNonce({
      claim: nonceClaim,
      result: verified,
      storePath: nonceStorePath,
      now,
    });
    return verified;
  }

  const result = {
    ...normalized,
    idempotency_key: request.idempotency_key,
    retry: hyperliquidRetrySummary(fetched),
  };
  await finalizeHyperliquidExchangeNonce({
    claim: nonceClaim,
    result,
    storePath: nonceStorePath,
    now,
  });
  return result;
}
