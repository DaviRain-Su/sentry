import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { RAW_AGENT_SECRET_FIELDS } from '../../core/agent-task.js';

export const DEFAULT_LOCAL_ACTIVITY_LOG_PATH = join(homedir(), '.sentry', 'activity.jsonl');
export const DEFAULT_ACTIVITY_TAIL_LIMIT = 50;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function redactSecretFields(value) {
  if (Array.isArray(value)) return value.map(redactSecretFields);
  if (!isObject(value)) return value;
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = RAW_AGENT_SECRET_FIELDS.includes(key)
      ? '[redacted]'
      : redactSecretFields(child);
  }
  return redacted;
}

function evidenceSummary(dispatch = {}) {
  const evidence = isObject(dispatch.agent_result?.evidence) ? dispatch.agent_result.evidence : {};
  return redactSecretFields({
    venue_order_id: evidence.venue_order_id || evidence.order_id || null,
    client_order_id: evidence.client_order_id || evidence.clOrdId || evidence.cloid || null,
    tx_digest:
      evidence.tx_digest ||
      evidence.tx_hash ||
      evidence.transaction_hash ||
      evidence.signature ||
      evidence.tx_signature ||
      null,
    quote_id: evidence.quote_id || null,
    receipt_status: evidence.receipt_status || null,
    confirmation_status: evidence.confirmation_status || null,
  });
}

export function resolveLocalActivityLogPath(input) {
  const value = stringValue(input || process.env.SENTRY_ACTIVITY_LOG);
  return value || DEFAULT_LOCAL_ACTIVITY_LOG_PATH;
}

export function buildLocalActivityEvent(input = {}) {
  const {
    type = 'agent.dispatch',
    task = {},
    commandMessageId = null,
    dispatch = {},
    localDispatchReadiness = null,
    receiptVerification = dispatch.receipt_verification || null,
    registeredAgent = null,
    now = new Date(),
  } = input;
  const observedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const evidence = evidenceSummary(dispatch);
  const status = dispatch.status || input.status || 'error';
  const code = dispatch.code || input.code || null;
  const venueId =
    task.venue_id ||
    task.policy_context?.venue_id ||
    task.authorization?.venue_id ||
    dispatch.agent_result?.evidence?.venue_id ||
    null;
  const taskId = task.task_id || dispatch.agent_result?.task_id || null;
  const id = [
    observedAt,
    commandMessageId || 'local',
    taskId || 'unknown-task',
    status,
    code || dispatch.local_decision || 'event',
  ]
    .filter(Boolean)
    .join(':');

  return redactSecretFields({
    id,
    source: 'local_daemon',
    type,
    observed_at: observedAt,
    timestamp_ms: Date.parse(observedAt),
    command_message_id: commandMessageId,
    task_id: taskId,
    policy_id: task.policy_id || task.policy_context?.policy_id || null,
    venue_id: venueId,
    action_type: task.action?.type || null,
    status,
    code,
    local_decision: dispatch.local_decision || input.local_decision || null,
    summary: dispatch.agent_result?.summary || dispatch.message || input.message || null,
    registered_agent: registeredAgent
      ? {
          agent_id: registeredAgent.agent_id || null,
          capabilities: Array.isArray(registeredAgent.capabilities)
            ? registeredAgent.capabilities
            : [],
        }
      : null,
    evidence,
    receipt_verification: receiptVerification
      ? {
          status: receiptVerification.status || null,
          venue_id: receiptVerification.venue_id || venueId,
          observed_status: receiptVerification.observed_status || null,
          code: receiptVerification.code || null,
          tx_digest:
            receiptVerification.tx_digest ||
            receiptVerification.tx_hash ||
            receiptVerification.signature ||
            null,
          venue_order_id:
            receiptVerification.venue_order_id || receiptVerification.order_id || null,
        }
      : null,
    local_dispatch_readiness: localDispatchReadiness
      ? {
          status: localDispatchReadiness.status,
          venue_id: localDispatchReadiness.venue_id || venueId,
          ready_venue_ids: Array.isArray(localDispatchReadiness.ready_venue_ids)
            ? localDispatchReadiness.ready_venue_ids
            : [],
          dispatch_ready_source: localDispatchReadiness.dispatch_ready_source || null,
          code: localDispatchReadiness.code || null,
        }
      : null,
  });
}

export async function appendLocalActivityEvent(event, { logPath } = {}) {
  const resolvedPath = resolveLocalActivityLogPath(logPath);
  const sanitizedEvent = redactSecretFields(event);
  await mkdir(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await appendFile(resolvedPath, `${JSON.stringify(sanitizedEvent)}\n`, {
    mode: 0o600,
  });
  return {
    status: 'ok',
    log_path: resolvedPath,
    event: sanitizedEvent,
  };
}

export async function readLocalActivityLog({ logPath, limit = DEFAULT_ACTIVITY_TAIL_LIMIT } = {}) {
  const resolvedPath = resolveLocalActivityLogPath(logPath);
  let text = '';
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'ok',
        log_path: resolvedPath,
        events: [],
        event_count: 0,
      };
    }
    return {
      status: 'error',
      code: 'ACTIVITY_LOG_READ_FAILED',
      message: error?.message || String(error),
      log_path: resolvedPath,
      events: [],
      event_count: 0,
    };
  }

  const events = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(redactSecretFields(JSON.parse(line)));
    } catch {
      events.push({
        source: 'local_daemon',
        type: 'activity_log_corrupt_line',
        status: 'error',
        code: 'ACTIVITY_LOG_LINE_INVALID',
      });
    }
  }
  const cappedLimit = Math.max(0, Number(limit) || DEFAULT_ACTIVITY_TAIL_LIMIT);
  const selected = cappedLimit > 0 ? events.slice(-cappedLimit).reverse() : [];
  return {
    status: 'ok',
    log_path: resolvedPath,
    events: selected,
    event_count: events.length,
  };
}
