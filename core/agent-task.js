import { validateTaskAuthorization } from './authorization.js';

export const AGENT_TASK_RESULT_STATUSES = ['proposed', 'submitted', 'done', 'blocked', 'error'];

export const RAW_AGENT_SECRET_FIELDS = [
  'secret',
  'api_secret',
  'apiSecret',
  'private_key',
  'privateKey',
  'wallet_private_key',
  'walletPrivateKey',
  'passphrase',
  'password',
  'seed',
  'mnemonic',
  'token',
  'raw_secret',
  'rawSecret',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function secretFieldPath(value, prefix = '') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && RAW_AGENT_SECRET_FIELDS.includes(key)) return path;
    const nested = secretFieldPath(child, path);
    if (nested) return nested;
  }
  return null;
}

function taskId(task) {
  return task?.task_id || task?.id || null;
}

function resultEvidence(result) {
  return {
    ...(isObject(result?.evidence) ? result.evidence : {}),
    ...(result?.tx_digest ? { tx_digest: result.tx_digest } : {}),
    ...(result?.tx_hash ? { tx_hash: result.tx_hash } : {}),
    ...(result?.transaction_hash ? { transaction_hash: result.transaction_hash } : {}),
    ...(result?.signature ? { signature: result.signature } : {}),
    ...(result?.tx_signature ? { tx_signature: result.tx_signature } : {}),
    ...(result?.venue_order_id ? { venue_order_id: result.venue_order_id } : {}),
    ...(result?.order_id ? { order_id: result.order_id } : {}),
  };
}

function hasExecutionEvidence(evidence) {
  return Boolean(
    evidence.tx_digest ||
      evidence.tx_hash ||
      evidence.transaction_hash ||
      evidence.signature ||
      evidence.tx_signature ||
      evidence.venue_order_id ||
      evidence.order_id ||
      evidence.simulation_id ||
      evidence.receipt_ref
  );
}

export function validateAgentTask(task, options = {}) {
  if (!isObject(task)) {
    return {
      status: 'error',
      code: 'BAD_AGENT_TASK',
      message: 'AgentTask must be an object.',
    };
  }

  const rawSecretPath = secretFieldPath(task);
  if (rawSecretPath) {
    return {
      status: 'error',
      code: 'RAW_SECRET_FIELD_REJECTED',
      message: `AgentTask must not include raw secret field: ${rawSecretPath}`,
      path: rawSecretPath,
    };
  }

  if (!taskId(task)) {
    return {
      status: 'error',
      code: 'TASK_ID_REQUIRED',
      message: 'AgentTask requires task_id.',
    };
  }
  if (!isObject(task.action) || !task.action.type) {
    return {
      status: 'error',
      code: 'TASK_ACTION_REQUIRED',
      message: 'AgentTask requires action.type.',
    };
  }
  const expiresAtMs = Number(task.expires_at_ms || 0);
  if (expiresAtMs > 0 && expiresAtMs <= (options.now_ms || Date.now())) {
    return {
      status: 'error',
      code: 'TASK_EXPIRED',
      message: 'AgentTask is expired.',
    };
  }

  const authorization = validateTaskAuthorization(task, {
    allow_planned: Boolean(options.allow_planned),
    local_dispatch_ready_venues: options.local_dispatch_ready_venues,
    localDispatchReadyVenues: options.localDispatchReadyVenues,
  });
  if (authorization.status !== 'ok') return authorization;

  return {
    status: 'ok',
    task,
    task_id: taskId(task),
    authorization: authorization.authorization,
    capabilities_required: authorization.capabilities_required,
  };
}

export function sanitizeAgentTaskForDispatch(task) {
  return {
    task_id: taskId(task),
    policy_id: task.policy_id || task.policy_context?.policy_id || null,
    venue_id:
      task.venue_id ||
      task.policy_context?.venue_id ||
      task.policy_context?.venue ||
      task.authorization?.venue_id ||
      task.authorization?.venue_account_id ||
      null,
    policy_context: task.policy_context || {},
    action: task.action || {},
    constraints: task.constraints || {},
    authorization: task.authorization || task.policy_context?.authorization || {},
    issued_at_ms: task.issued_at_ms || Date.now(),
    expires_at_ms: task.expires_at_ms || null,
  };
}

export function sanitizeAgentTaskResult(result) {
  const evidence = resultEvidence(result);
  return {
    task_id: taskId(result),
    status: result.status,
    code: result.code || null,
    summary: result.summary || result.message || null,
    evidence,
    observed_at: result.observed_at || new Date().toISOString(),
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export function validateAgentTaskResult(result, task, options = {}) {
  if (!isObject(result)) {
    return {
      status: 'error',
      code: 'BAD_AGENT_RESULT',
      message: 'AgentTaskResult must be a JSON object.',
    };
  }

  const rawSecretPath = secretFieldPath(result);
  if (rawSecretPath) {
    return {
      status: 'error',
      code: 'RAW_SECRET_FIELD_REJECTED',
      message: `AgentTaskResult must not include raw secret field: ${rawSecretPath}`,
      path: rawSecretPath,
    };
  }

  const expectedTaskId = taskId(task);
  if (!taskId(result)) {
    return {
      status: 'error',
      code: 'RESULT_TASK_ID_REQUIRED',
      message: 'AgentTaskResult requires task_id.',
    };
  }
  if (expectedTaskId && taskId(result) !== expectedTaskId) {
    return {
      status: 'error',
      code: 'RESULT_TASK_ID_MISMATCH',
      message: 'AgentTaskResult task_id does not match the dispatched AgentTask.',
      expected_task_id: expectedTaskId,
      actual_task_id: taskId(result),
    };
  }

  if (!AGENT_TASK_RESULT_STATUSES.includes(result.status)) {
    return {
      status: 'error',
      code: 'BAD_AGENT_RESULT_STATUS',
      message: `AgentTaskResult status must be one of: ${AGENT_TASK_RESULT_STATUSES.join(', ')}`,
    };
  }

  const evidence = resultEvidence(result);
  if (
    ['submitted', 'done'].includes(result.status) &&
    !hasExecutionEvidence(evidence) &&
    !options.allow_missing_evidence
  ) {
    return {
      status: 'error',
      code: 'EXECUTION_EVIDENCE_REQUIRED',
      message:
        'Submitted/done AgentTaskResult requires tx_digest, venue_order_id or equivalent evidence.',
    };
  }

  return {
    status: 'ok',
    result: sanitizeAgentTaskResult(result),
  };
}
