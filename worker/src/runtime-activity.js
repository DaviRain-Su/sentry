export const MAX_RUNTIME_ACTIVITY = 50;

const ACTION_META = {
  activated: {
    kind: 'policy',
    title: 'Agent runtime activated',
    detail: 'Durable Object runtime registered this policy and scheduled autonomous ticks.',
  },
  no_op: {
    kind: 'monitor',
    title: 'Agent tick · no action',
    detail: 'Trigger condition was not met; the agent kept monitoring.',
  },
  blocked: {
    kind: 'guardian',
    title: 'Agent tick blocked',
    detail: 'Guardian or funding readiness blocked execution before any transaction was submitted.',
  },
  executed: {
    kind: 'exec',
    title: 'Agent trade executed',
    detail: 'Execution was submitted and resolved with on-chain evidence.',
  },
  stopped_revoked: {
    kind: 'guardian',
    title: 'Agent stopped · revoked',
    detail: 'Mandate is revoked on-chain; the runtime stopped future ticks.',
  },
  stopped_expired: {
    kind: 'guardian',
    title: 'Agent stopped · expired',
    detail: 'Mandate is expired on-chain; the runtime stopped future ticks.',
  },
  error: {
    kind: 'fail',
    title: 'Agent tick error',
    detail: 'Runtime tick failed without claiming execution success.',
  },
};

export function shortWrapperId(wrapperId) {
  if (!wrapperId || typeof wrapperId !== 'string') return 'runtime';
  return wrapperId.length > 12 ? `${wrapperId.slice(0, 6)}…${wrapperId.slice(-4)}` : wrapperId;
}

function dateParts(timestampMs) {
  const ms = Number(timestampMs);
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return { date: d.toISOString().slice(0, 10), t: d.toISOString().slice(11, 19) };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

/**
 * @param {Record<string, any>} result
 * @param {{wrapperId?: string | null, nowMs?: number}=} options
 */
export function runtimeEventFromTickResult(result, { wrapperId, nowMs = Date.now() } = {}) {
  const action = String(result?.action || 'error');
  const meta = ACTION_META[action] || ACTION_META.error;
  const code = result?.code || result?.blocker_code || null;
  const blockerCodes = normalizeStringArray(result?.blocker_codes || (code ? [code] : []));
  const blockerLabels = normalizeStringArray(result?.blocker_labels);
  const detail = String(
    result?.detail || (blockerLabels.length ? blockerLabels.join('; ') : meta.detail)
  );
  const txDigest = result?.tx_digest || result?.tx || null;
  const idParts = [nowMs, wrapperId || 'unknown', action, txDigest || code || 'runtime'];
  return {
    id: idParts.map(String).join(':'),
    source: 'runtime',
    timestamp_ms: nowMs,
    wrapper_id: wrapperId || result?.wrapper_id || null,
    mandate_id: result?.mandate_id || null,
    action,
    code,
    blocker_code: code,
    blocker_codes: blockerCodes,
    blocker_labels: blockerLabels,
    readiness_state: result?.readiness_state || null,
    execution_claimed: Boolean(result?.execution_claimed),
    execution_success_evidence: Boolean(result?.execution_success_evidence),
    title: meta.title,
    detail,
    tx: txDigest,
    tx_digest: txDigest,
    spend_delta: result?.spend_delta || null,
    spend_before: result?.spend_before || null,
    spend_after: result?.spend_after || null,
    balances: result?.balances || null,
  };
}

/**
 * @param {unknown} error
 * @param {{wrapperId?: string | null, nowMs?: number}=} options
 */
export function runtimeErrorEvent(error, { wrapperId, nowMs = Date.now() } = {}) {
  return runtimeEventFromTickResult(
    {
      action: 'error',
      code: 'RUNTIME_ERROR',
      blocker_code: 'RUNTIME_ERROR',
      blocker_codes: ['RUNTIME_ERROR'],
      blocker_labels: ['Runtime error'],
      detail: `Runtime error: ${String(error?.message || error)}`,
      execution_claimed: false,
    },
    { wrapperId, nowMs }
  );
}

export function appendRuntimeActivity(events, event, max = MAX_RUNTIME_ACTIVITY) {
  const prior = Array.isArray(events) ? events : [];
  return [event, ...prior].slice(0, max);
}

export function runtimeEventToFeedItem(event, policyLabel = shortWrapperId(event?.wrapper_id)) {
  const action = String(event?.action || 'error');
  const meta = ACTION_META[action] || ACTION_META.error;
  const { date, t } = dateParts(event?.timestamp_ms);
  const spendDelta = event?.spend_delta != null ? Number(event.spend_delta) / 1e6 : 0;
  return {
    t,
    date,
    kind: meta.kind,
    policy: policyLabel,
    title: event?.title || meta.title,
    detail: event?.detail || meta.detail,
    amount: action === 'executed' ? -Math.abs(spendDelta) : 0,
    tx: event?.tx_digest || event?.tx || null,
    risk: null,
    mode: 'cloud',
    source: 'runtime',
    timestamp_ms: Number(event?.timestamp_ms) || 0,
    action,
    blocker_codes: normalizeStringArray(event?.blocker_codes),
    blocker_labels: normalizeStringArray(event?.blocker_labels),
    execution_claimed: Boolean(event?.execution_claimed),
  };
}

export function sortActivityItems(items) {
  return [...(Array.isArray(items) ? items : [])].sort(
    (a, b) => Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0)
  );
}
