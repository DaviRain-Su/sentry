export const MAX_AGENT_COMMAND_RECORDS = 50;

export type AgentCommandRecord = {
  command_id: string;
  idempotency_key: string;
  type: string;
  queued_at: string;
  expires_at: string | null;
  command_status: 'queued' | 'result';
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

export function summarizeCommandPayload(payload: Record<string, any> = {}): Record<string, any> {
  const task = payload.task && typeof payload.task === 'object' ? payload.task : null;
  const action = task?.action && typeof task.action === 'object' ? task.action : null;
  return {
    type: payload.type ?? null,
    agent_id: payload.agent_id ?? payload.id ?? null,
    target_agent: payload.target_agent ?? task?.target_agent ?? null,
    task_id: task?.task_id ?? null,
    policy_id: payload.policy_id ?? task?.policy_id ?? null,
    venue_id: payload.venue_id ?? task?.venue_id ?? task?.policy_context?.venue ?? null,
    action_type: action?.type ?? null,
    dispatch: payload.dispatch === true,
    mark: payload.mark === true,
    live: payload.live === true,
    limit: boundedNumber(payload.limit),
    timeout_ms: boundedNumber(payload.timeout_ms),
  };
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
  return [record, ...records.filter((item) => item.command_id !== record.command_id)].slice(
    0,
    MAX_AGENT_COMMAND_RECORDS
  );
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
  const next = [...records];
  next[index] = {
    ...next[index],
    command_status: 'result',
    result_received_at: receivedAt,
    result_message_id: msg.message_id ?? null,
    result_status: typeof payload.status === 'string' ? payload.status : null,
    result: payload,
  };
  return next.slice(0, MAX_AGENT_COMMAND_RECORDS);
}
