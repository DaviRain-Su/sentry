export const MAX_AGENT_COMMAND_RECORDS = 50;

export type AgentCommandRecord = {
  command_id: string;
  idempotency_key: string;
  type: string;
  queued_at: string;
  expires_at: string | null;
  command_status: 'queued' | 'acknowledged' | 'result';
  sent_at?: string;
  send_count?: number;
  ack_deadline_at?: string | null;
  ack_received_at?: string;
  ack_message_id?: string | null;
  ack_status?: string | null;
  resume_requested_at?: string;
  resume_count?: number;
  resume_command_id?: string | null;
  payload_summary: Record<string, any>;
  result_received_at?: string;
  result_message_id?: string | null;
  result_status?: string | null;
  result?: Record<string, any>;
};

export type AgentCommandMessage = {
  message_id?: string;
  idempotency_key?: string;
  issued_at?: string;
  expires_at?: string;
  payload?: Record<string, any>;
};

export type AgentCommandResultMessage = {
  message_id?: string;
  idempotency_key?: string;
  payload?: Record<string, any>;
};

export type AgentCommandAckMessage = {
  message_id?: string;
  idempotency_key?: string;
  payload?: Record<string, any>;
};

const MAX_COMMAND_RESULT_DEPTH = 8;
const MAX_COMMAND_RESULT_ARRAY_ITEMS = 50;
const MAX_COMMAND_RESULT_OBJECT_KEYS = 80;
const MAX_COMMAND_RESULT_STRING_CHARS = 4096;
const REDACTED = '[REDACTED]';
const MAX_DEPTH = '[MaxDepth]';

const SECRET_RESULT_FIELDS = new Set([
  'accesstoken',
  'apikey',
  'apisecret',
  'authtoken',
  'keysecret',
  'mnemonic',
  'ownercontroltoken',
  'passphrase',
  'password',
  'privatekey',
  'rawsecret',
  'refreshtoken',
  'relaytoken',
  'secret',
  'secretkey',
  'seed',
  'sessiontoken',
  'signerkey',
  'signingkey',
  'token',
  'walletprivatekey',
]);

function normalizedResultFieldName(key: string): string {
  return key.replace(/[-_\s.]/g, '').toLowerCase();
}

function isSecretResultField(key: string): boolean {
  return SECRET_RESULT_FIELDS.has(normalizedResultFieldName(key));
}

export function commandIdFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const commandIndex = parts.lastIndexOf('commands');
  if (commandIndex === -1 || !parts[commandIndex + 1]) return null;
  return decodeURIComponent(parts[commandIndex + 1]);
}

function boundedNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function boundedStringList(value: unknown, maxItems = 8): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function summarizeCommandPayload(payload: Record<string, any> = {}): Record<string, any> {
  const task = payload.task && typeof payload.task === 'object' ? payload.task : null;
  const action = task?.action && typeof task.action === 'object' ? task.action : null;
  const policy = payload.policy && typeof payload.policy === 'object' ? payload.policy : null;
  return {
    type: payload.type ?? null,
    agent_id: payload.agent_id ?? payload.id ?? null,
    target_agent: payload.target_agent ?? policy?.target_agent ?? task?.target_agent ?? null,
    task_id: task?.task_id ?? null,
    policy_id: payload.policy_id ?? payload.id ?? policy?.policy_id ?? task?.policy_id ?? null,
    venue_id: payload.venue_id ?? task?.venue_id ?? task?.policy_context?.venue ?? null,
    target_venue_ids: boundedStringList(
      payload.target_venue_ids ?? payload.target_venues ?? policy?.target_venue_ids
    ),
    action_type: action?.type ?? null,
    dispatch: payload.dispatch === true,
    check_readiness: payload.check_readiness === true,
    check_inventory: payload.check_inventory === true,
    live_inventory: payload.live_inventory === true,
    live_market: payload.live_market === true,
    verify_receipt: payload.verify_receipt !== false,
    verify_live_grant: payload.verify_live_grant === true,
    verify_okx_live_read: payload.verify_okx_live_read === true,
    require_signer_probe: payload.require_signer_probe === true,
    signer_probe_timeout_ms: boundedNumber(payload.signer_probe_timeout_ms),
    signer_timeout_ms: boundedNumber(payload.signer_timeout_ms),
    has_solana_signer_command: payload.solana_signer_command != null,
    has_ethereum_signer_command: payload.ethereum_signer_command != null,
    market_venues: boundedStringList(payload.market_venues ?? payload.marketVenues),
    market_symbols: boundedStringList(payload.market_symbols ?? payload.marketSymbols),
    has_market_snapshot: payload.market_snapshot != null || payload.marketSnapshot != null,
    mark: payload.mark === true,
    live: payload.live === true,
    simulated: payload.simulated === true,
    limit: boundedNumber(payload.limit),
    interval_ms: boundedNumber(payload.interval_ms ?? payload.intervalMs),
    timeout_ms: boundedNumber(payload.timeout_ms),
  };
}

export function sanitizeCommandResult(value: unknown, depth = 0): any {
  if (depth > MAX_COMMAND_RESULT_DEPTH) return MAX_DEPTH;
  if (value == null) return value;

  if (typeof value === 'string') {
    if (value.length <= MAX_COMMAND_RESULT_STRING_CHARS) return value;
    return `${value.slice(0, MAX_COMMAND_RESULT_STRING_CHARS)}...[Truncated ${
      value.length - MAX_COMMAND_RESULT_STRING_CHARS
    } chars]`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_COMMAND_RESULT_ARRAY_ITEMS)
      .map((item) => sanitizeCommandResult(item, depth + 1));
    if (value.length > MAX_COMMAND_RESULT_ARRAY_ITEMS) {
      result.push(`[Truncated ${value.length - MAX_COMMAND_RESULT_ARRAY_ITEMS} items]`);
    }
    return result;
  }

  const entries = Object.entries(value as Record<string, any>);
  const result: Record<string, any> = {};
  for (const [key, item] of entries.slice(0, MAX_COMMAND_RESULT_OBJECT_KEYS)) {
    result[key] = isSecretResultField(key) ? REDACTED : sanitizeCommandResult(item, depth + 1);
  }
  if (entries.length > MAX_COMMAND_RESULT_OBJECT_KEYS) {
    result.__truncated_keys = entries.length - MAX_COMMAND_RESULT_OBJECT_KEYS;
  }
  return result;
}

export function commandRecordFromMessage(command: AgentCommandMessage): AgentCommandRecord {
  return {
    command_id: String(command.message_id || ''),
    idempotency_key: String(command.idempotency_key || ''),
    type: String(command.payload?.type || ''),
    queued_at: String(command.issued_at || new Date().toISOString()),
    expires_at: command.expires_at ? String(command.expires_at) : null,
    command_status: 'queued',
    payload_summary: summarizeCommandPayload(command.payload || {}),
  };
}

export function rememberCommandRecord(
  records: AgentCommandRecord[],
  command: AgentCommandMessage
): AgentCommandRecord[] {
  const record = commandRecordFromMessage(command);
  return [
    record,
    ...records.filter(
      (item) =>
        item.command_id !== record.command_id &&
        (!record.idempotency_key || item.idempotency_key !== record.idempotency_key)
    ),
  ].slice(0, MAX_AGENT_COMMAND_RECORDS);
}

export function applyCommandSent(
  records: AgentCommandRecord[],
  command: AgentCommandMessage,
  sentAt = new Date().toISOString(),
  ackTimeoutMs = 15_000
): AgentCommandRecord[] {
  const commandId = String(command.message_id || '');
  const idempotencyKey = String(command.idempotency_key || '');
  const index = records.findIndex(
    (item) =>
      (commandId && item.command_id === commandId) ||
      (idempotencyKey && item.idempotency_key === idempotencyKey)
  );
  if (index === -1 || records[index].command_status === 'result') return records;
  const next = [...records];
  next[index] = {
    ...next[index],
    sent_at: sentAt,
    send_count: Number(next[index].send_count || 0) + 1,
    ack_deadline_at: new Date(Date.parse(sentAt) + Math.max(1000, ackTimeoutMs)).toISOString(),
  };
  return next.slice(0, MAX_AGENT_COMMAND_RECORDS);
}

export function applyCommandAck(
  records: AgentCommandRecord[],
  msg: AgentCommandAckMessage,
  receivedAt = new Date().toISOString()
): AgentCommandRecord[] {
  const payload = msg.payload ?? {};
  const commandId = String(payload.command_message_id || '');
  const idempotencyKey = String(msg.idempotency_key || '');
  const index = records.findIndex(
    (item) =>
      (commandId && item.command_id === commandId) ||
      (idempotencyKey && item.idempotency_key === idempotencyKey)
  );
  if (index === -1 || records[index].command_status === 'result') return records;
  const next = [...records];
  next[index] = {
    ...next[index],
    command_status: 'acknowledged',
    ack_received_at: receivedAt,
    ack_message_id: msg.message_id ?? null,
    ack_status:
      payload.accepted === true
        ? 'accepted'
        : typeof payload.status === 'string'
          ? payload.status
          : null,
  };
  return next.slice(0, MAX_AGENT_COMMAND_RECORDS);
}

export function applyCommandResumeRequested(
  records: AgentCommandRecord[],
  record: Pick<AgentCommandRecord, 'command_id' | 'idempotency_key'>,
  resumeCommand: AgentCommandMessage,
  requestedAt = new Date().toISOString()
): AgentCommandRecord[] {
  const commandId = String(record.command_id || '');
  const idempotencyKey = String(record.idempotency_key || '');
  const index = records.findIndex(
    (item) =>
      (commandId && item.command_id === commandId) ||
      (idempotencyKey && item.idempotency_key === idempotencyKey)
  );
  if (index === -1 || records[index].command_status === 'result') return records;
  const next = [...records];
  next[index] = {
    ...next[index],
    resume_requested_at: requestedAt,
    resume_count: Number(next[index].resume_count || 0) + 1,
    resume_command_id: resumeCommand.message_id ?? null,
  };
  return next.slice(0, MAX_AGENT_COMMAND_RECORDS);
}

export function applyCommandResult(
  records: AgentCommandRecord[],
  msg: AgentCommandResultMessage,
  receivedAt = new Date().toISOString()
): AgentCommandRecord[] {
  const payload = msg.payload ?? {};
  const commandId = String(payload.command_message_id || '');
  const idempotencyKey = String(msg.idempotency_key || '');
  const index = records.findIndex(
    (item) =>
      (commandId && item.command_id === commandId) ||
      (idempotencyKey && item.idempotency_key === idempotencyKey)
  );
  if (index === -1) return records;
  const safePayload = sanitizeCommandResult(payload) as Record<string, any>;
  const next = [...records];
  next[index] = {
    ...next[index],
    command_status: 'result',
    result_received_at: receivedAt,
    result_message_id: msg.message_id ?? null,
    result_status: typeof payload.status === 'string' ? payload.status : null,
    result: safePayload,
  };
  return next.slice(0, MAX_AGENT_COMMAND_RECORDS);
}
