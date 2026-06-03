import assert from 'node:assert/strict';
import {
  applyCommandResult,
  commandIdFromPath,
  commandRecordFromMessage,
  rememberCommandRecord,
  summarizeCommandPayload,
} from '../src/agent-session-command-records.ts';

const taskPayload = {
  type: 'agent.dispatch',
  target_agent: 'codex',
  timeout_ms: 1000,
  task: {
    task_id: 'task_1',
    policy_id: 'policy_1',
    venue_id: 'hyperliquid',
    action: { type: 'place_order', params: { coin: 'ETH' } },
  },
};

const summary = summarizeCommandPayload(taskPayload);
assert.deepEqual(summary, {
  type: 'agent.dispatch',
  agent_id: null,
  target_agent: 'codex',
  task_id: 'task_1',
  policy_id: 'policy_1',
  venue_id: 'hyperliquid',
  action_type: 'place_order',
  dispatch: false,
  mark: false,
  live: false,
  limit: null,
  timeout_ms: 1000,
});

const command = {
  message_id: 'cmd_1',
  idempotency_key: 'idem_1',
  issued_at: '2026-06-03T00:00:00.000Z',
  expires_at: '2026-06-03T00:02:00.000Z',
  payload: taskPayload,
};
const record = commandRecordFromMessage(command);
assert.equal(record.command_id, 'cmd_1');
assert.equal(record.idempotency_key, 'idem_1');
assert.equal(record.type, 'agent.dispatch');
assert.equal(record.command_status, 'queued');
assert.equal(record.payload_summary.venue_id, 'hyperliquid');
assert.equal(JSON.stringify(record).includes('params'), false);

const remembered = rememberCommandRecord([], command);
assert.equal(remembered.length, 1);
assert.equal(remembered[0].command_id, 'cmd_1');

const completedByCommandId = applyCommandResult(
  remembered,
  {
    message_id: 'result_1',
    idempotency_key: 'idem_1',
    payload: {
      command_message_id: 'cmd_1',
      status: 'ok',
      probe_count: 1,
    },
  },
  '2026-06-03T00:00:01.000Z'
);
assert.equal(completedByCommandId[0].command_status, 'result');
assert.equal(completedByCommandId[0].result_status, 'ok');
assert.equal(completedByCommandId[0].result.probe_count, 1);

const second = rememberCommandRecord(completedByCommandId, {
  ...command,
  message_id: 'cmd_2',
  idempotency_key: 'idem_2',
  payload: { type: 'agent.probe', agent_id: 'codex' },
});
const completedByIdempotency = applyCommandResult(second, {
  message_id: 'result_2',
  idempotency_key: 'idem_2',
  payload: { status: 'blocked', code: 'AGENT_PROBE_FAILED' },
});
assert.equal(completedByIdempotency[0].command_id, 'cmd_2');
assert.equal(completedByIdempotency[0].command_status, 'result');
assert.equal(completedByIdempotency[0].result_status, 'blocked');

const unchanged = applyCommandResult(completedByIdempotency, {
  idempotency_key: 'missing',
  payload: { status: 'ok' },
});
assert.equal(unchanged, completedByIdempotency);

assert.equal(commandIdFromPath('/agent_test/commands/cmd_1'), 'cmd_1');
assert.equal(commandIdFromPath('/agent_test/commands'), null);

console.log('ALL AGENT SESSION COMMAND RECORD TESTS PASS');
