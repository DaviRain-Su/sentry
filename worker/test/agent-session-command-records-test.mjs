import assert from 'node:assert/strict';
import {
  applyCommandAck,
  applyCommandResumeRequested,
  applyCommandSent,
  applyCommandResult,
  commandIdFromPath,
  commandRecordFromMessage,
  rememberCommandRecord,
  sanitizeCommandResult,
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
  target_venue_ids: [],
  action_type: 'place_order',
  dispatch: false,
  check_readiness: false,
  check_inventory: false,
  live_inventory: false,
  live_market: false,
  verify_receipt: true,
  verify_live_grant: false,
  verify_okx_live_read: false,
  require_signer_probe: false,
  signer_probe_timeout_ms: null,
  signer_timeout_ms: null,
  has_solana_signer_command: false,
  has_ethereum_signer_command: false,
  market_venues: [],
  market_symbols: [],
  has_market_snapshot: false,
  mark: false,
  live: false,
  simulated: false,
  limit: null,
  interval_ms: null,
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

const policySummary = summarizeCommandPayload({
  type: 'policy.local.add',
  policy: {
    policy_id: 'ui-policy-1',
    target_agent: 'codex',
    target_venue_ids: ['okx', 'hyperliquid'],
    task_templates: [{ api_secret: 'must-not-appear' }],
  },
  limit: 10,
  check_readiness: true,
  check_inventory: true,
  live_inventory: false,
  live_market: true,
  verify_receipt: true,
  verify_live_grant: false,
  verify_okx_live_read: true,
  require_signer_probe: true,
  signer_probe_timeout_ms: 3000,
  signer_timeout_ms: 30000,
  solana_signer_command: 'ows-solana submit --wallet local',
  ethereum_signer_command: 'safe-cli send-json --profile local',
  market_venues: ['okx', 'hyperliquid'],
  market_symbols: ['BTC', 'ETH'],
  has_market_snapshot: false,
  dispatch: false,
  mark: false,
  simulated: true,
  interval_ms: 60000,
});
assert.equal(policySummary.type, 'policy.local.add');
assert.equal(policySummary.policy_id, 'ui-policy-1');
assert.equal(policySummary.target_agent, 'codex');
assert.deepEqual(policySummary.target_venue_ids, ['okx', 'hyperliquid']);
assert.equal(JSON.stringify(policySummary).includes('must-not-appear'), false);
assert.equal(policySummary.limit, 10);
assert.equal(policySummary.check_readiness, true);
assert.equal(policySummary.check_inventory, true);
assert.equal(policySummary.live_inventory, false);
assert.equal(policySummary.live_market, true);
assert.equal(policySummary.verify_receipt, true);
assert.equal(policySummary.verify_live_grant, false);
assert.equal(policySummary.verify_okx_live_read, true);
assert.equal(policySummary.require_signer_probe, true);
assert.equal(policySummary.signer_probe_timeout_ms, 3000);
assert.equal(policySummary.signer_timeout_ms, 30000);
assert.equal(policySummary.has_solana_signer_command, true);
assert.equal(policySummary.has_ethereum_signer_command, true);
assert.deepEqual(policySummary.market_venues, ['okx', 'hyperliquid']);
assert.deepEqual(policySummary.market_symbols, ['BTC', 'ETH']);
assert.equal(policySummary.dispatch, false);
assert.equal(policySummary.simulated, true);
assert.equal(policySummary.interval_ms, 60000);
assert.equal(JSON.stringify(policySummary).includes('ows-solana'), false);
assert.equal(JSON.stringify(policySummary).includes('safe-cli'), false);

const sanitizedResult = sanitizeCommandResult({
  status: 'ok',
  credentials: {
    api_secret: 'super-secret',
    apiKey: 'key-material',
    token: 'session-token',
    privateKey: 'private-key-material',
  },
  results: [
    {
      venue_id: 'hyperliquid',
      evidence: {
        tx_hash: '0xabc',
        signature: 'sig_abc',
        mnemonic: 'seed words',
      },
    },
  ],
});
assert.equal(sanitizedResult.credentials.api_secret, '[REDACTED]');
assert.equal(sanitizedResult.credentials.apiKey, '[REDACTED]');
assert.equal(sanitizedResult.credentials.token, '[REDACTED]');
assert.equal(sanitizedResult.credentials.privateKey, '[REDACTED]');
assert.equal(sanitizedResult.results[0].evidence.mnemonic, '[REDACTED]');
assert.equal(sanitizedResult.results[0].evidence.tx_hash, '0xabc');
assert.equal(sanitizedResult.results[0].evidence.signature, 'sig_abc');
assert.equal(JSON.stringify(sanitizedResult).includes('super-secret'), false);
assert.equal(JSON.stringify(sanitizedResult).includes('private-key-material'), false);

const remembered = rememberCommandRecord([], command);
assert.equal(remembered.length, 1);
assert.equal(remembered[0].command_id, 'cmd_1');

const sent = applyCommandSent(
  remembered,
  command,
  '2026-06-03T00:00:00.500Z',
  15_000
);
assert.equal(sent[0].sent_at, '2026-06-03T00:00:00.500Z');
assert.equal(sent[0].send_count, 1);
assert.equal(sent[0].ack_deadline_at, '2026-06-03T00:00:15.500Z');

const acknowledged = applyCommandAck(
  sent,
  {
    message_id: 'ack_1',
    idempotency_key: 'idem_1',
    payload: {
      command_message_id: 'cmd_1',
      accepted: true,
    },
  },
  '2026-06-03T00:00:01.000Z'
);
assert.equal(acknowledged[0].command_status, 'acknowledged');
assert.equal(acknowledged[0].ack_received_at, '2026-06-03T00:00:01.000Z');
assert.equal(acknowledged[0].ack_message_id, 'ack_1');
assert.equal(acknowledged[0].ack_status, 'accepted');

const resumeRequested = applyCommandResumeRequested(
  acknowledged,
  acknowledged[0],
  {
    message_id: 'cmd_resume_1',
    idempotency_key: 'resume:cmd_1:abc',
    payload: {
      type: 'command.resume',
      command_message_id: 'cmd_1',
      idempotency_key: 'idem_1',
      original_type: 'agent.dispatch',
    },
  },
  '2026-06-03T00:00:02.000Z'
);
assert.equal(resumeRequested[0].command_status, 'acknowledged');
assert.equal(resumeRequested[0].resume_requested_at, '2026-06-03T00:00:02.000Z');
assert.equal(resumeRequested[0].resume_count, 1);
assert.equal(resumeRequested[0].resume_command_id, 'cmd_resume_1');

const secondResumeRequested = applyCommandResumeRequested(
  resumeRequested,
  resumeRequested[0],
  {
    message_id: 'cmd_resume_2',
    idempotency_key: 'resume:cmd_1:def',
    payload: { type: 'command.resume' },
  },
  '2026-06-03T00:00:03.000Z'
);
assert.equal(secondResumeRequested[0].resume_requested_at, '2026-06-03T00:00:03.000Z');
assert.equal(secondResumeRequested[0].resume_count, 2);
assert.equal(secondResumeRequested[0].resume_command_id, 'cmd_resume_2');

const replacedByIdempotency = rememberCommandRecord(remembered, {
  ...command,
  message_id: 'cmd_1_retry',
  payload: { type: 'agent.dispatch', task: { task_id: 'task_retry' } },
});
assert.equal(replacedByIdempotency.length, 1);
assert.equal(replacedByIdempotency[0].command_id, 'cmd_1_retry');
assert.equal(replacedByIdempotency[0].idempotency_key, 'idem_1');

const completedByCommandId = applyCommandResult(
  acknowledged,
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
assert.equal(completedByCommandId[0].ack_status, 'accepted');
assert.equal(completedByCommandId[0].result_status, 'ok');
assert.equal(completedByCommandId[0].result.probe_count, 1);

const completedWithSecrets = applyCommandResult(
  remembered,
  {
    message_id: 'result_secret',
    idempotency_key: 'idem_1',
    payload: {
      command_message_id: 'cmd_1',
      status: 'ok',
      credentials: {
        api_secret: 'super-secret',
        relay_token: 'relay-token',
        walletPrivateKey: 'wallet-private-key',
      },
      receipt_verification: {
        tx_hash: '0xabc',
        owner_control_token: 'owner-token',
      },
    },
  },
  '2026-06-03T00:00:02.000Z'
);
assert.equal(completedWithSecrets[0].result.credentials.api_secret, '[REDACTED]');
assert.equal(completedWithSecrets[0].result.credentials.relay_token, '[REDACTED]');
assert.equal(completedWithSecrets[0].result.credentials.walletPrivateKey, '[REDACTED]');
assert.equal(completedWithSecrets[0].result.receipt_verification.owner_control_token, '[REDACTED]');
assert.equal(completedWithSecrets[0].result.receipt_verification.tx_hash, '0xabc');
assert.equal(JSON.stringify(completedWithSecrets).includes('super-secret'), false);
assert.equal(JSON.stringify(completedWithSecrets).includes('relay-token'), false);
assert.equal(JSON.stringify(completedWithSecrets).includes('wallet-private-key'), false);

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
