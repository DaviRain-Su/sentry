import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  appendLocalActivityEvent,
  buildLocalActivityEvent,
  readLocalActivityLog,
} from '../src/local-activity-log.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-local-activity-'));
const logPath = path.join(dir, 'nested', 'activity.jsonl');

try {
  const missing = await readLocalActivityLog({ logPath });
  assert.equal(missing.status, 'ok');
  assert.equal(missing.event_count, 0);
  assert.deepEqual(missing.events, []);

  const blockedEvent = buildLocalActivityEvent({
    type: 'agent.dispatch.blocked',
    commandMessageId: 'cmd_blocked_1',
    task: {
      task_id: 'task_blocked_1',
      policy_id: 'policy_1',
      venue_id: 'okx',
      action: { type: 'place_order' },
      authorization: {
        venue_id: 'okx',
        api_secret: 'should-not-leak-from-task',
      },
    },
    dispatch: {
      status: 'error',
      code: 'OKX_CREDENTIAL_SOURCE_MISSING',
      message: 'local credentials missing',
      local_decision: 'blocked_before_dispatch',
      agent_result: {
        evidence: {
          clOrdId: 'client-1',
          token: 'should-not-leak-from-evidence',
        },
      },
    },
    localDispatchReadiness: {
      status: 'error',
      code: 'OKX_CREDENTIAL_SOURCE_MISSING',
      venue_id: 'okx',
      ready_venue_ids: [],
      dispatch_ready_source: 'local_daemon',
      private_key: 'should-not-leak-from-readiness',
    },
    now: new Date('2026-06-03T00:00:00.000Z'),
  });

  assert.equal(blockedEvent.source, 'local_daemon');
  assert.equal(blockedEvent.type, 'agent.dispatch.blocked');
  assert.equal(blockedEvent.status, 'error');
  assert.equal(blockedEvent.local_decision, 'blocked_before_dispatch');
  assert.equal(blockedEvent.task_id, 'task_blocked_1');
  assert.equal(blockedEvent.venue_id, 'okx');
  assert.equal(blockedEvent.action_type, 'place_order');
  assert.equal(blockedEvent.evidence.client_order_id, 'client-1');
  assert.equal(JSON.stringify(blockedEvent).includes('should-not-leak'), false);
  assert.equal(JSON.stringify(blockedEvent).includes('private_key'), false);

  const appendBlocked = await appendLocalActivityEvent(blockedEvent, { logPath });
  assert.equal(appendBlocked.status, 'ok');
  assert.equal(appendBlocked.event.task_id, 'task_blocked_1');
  assert.equal(JSON.stringify(appendBlocked).includes('should-not-leak'), false);

  const acceptedEvent = buildLocalActivityEvent({
    commandMessageId: 'cmd_submit_1',
    task: {
      task_id: 'task_submit_1',
      policy_context: {
        policy_id: 'policy_1',
        venue_id: 'hyperliquid',
      },
      action: { type: 'place_order' },
    },
    dispatch: {
      status: 'ok',
      agent_result: {
        task_id: 'task_submit_1',
        status: 'submitted',
        summary: 'submitted',
        evidence: {
          venue_order_id: '12345',
          cloid: '0x00000000000000000000000000000001',
          raw_secret: 'should-not-leak-from-result',
        },
      },
      receipt_verification: {
        status: 'ok',
        venue_id: 'hyperliquid',
        observed_status: 'open',
        venue_order_id: '12345',
      },
    },
    registeredAgent: {
      agent_id: 'codex',
      capabilities: ['read_context', 'return_evidence'],
      secret: 'should-not-leak-from-agent',
    },
    now: new Date('2026-06-03T00:00:01.000Z'),
  });
  await appendLocalActivityEvent(acceptedEvent, { logPath });

  const disk = await readFile(logPath, 'utf8');
  assert.equal(disk.includes('should-not-leak'), false);
  assert.equal(disk.includes('raw_secret'), false);

  const tailAll = await readLocalActivityLog({ logPath, limit: 50 });
  assert.equal(tailAll.status, 'ok');
  assert.equal(tailAll.event_count, 2);
  assert.equal(tailAll.events.length, 2);
  assert.equal(tailAll.events[0].task_id, 'task_submit_1');
  assert.equal(tailAll.events[0].registered_agent.agent_id, 'codex');
  assert.equal(tailAll.events[0].receipt_verification.status, 'ok');
  assert.equal(tailAll.events[1].task_id, 'task_blocked_1');
  assert.equal(JSON.stringify(tailAll).includes('should-not-leak'), false);

  const tailOne = await readLocalActivityLog({ logPath, limit: 1 });
  assert.equal(tailOne.event_count, 2);
  assert.equal(tailOne.events.length, 1);
  assert.equal(tailOne.events[0].task_id, 'task_submit_1');

  await appendFile(logPath, '{bad json}\n');
  const withCorruptLine = await readLocalActivityLog({ logPath, limit: 1 });
  assert.equal(withCorruptLine.event_count, 3);
  assert.equal(withCorruptLine.events[0].code, 'ACTIVITY_LOG_LINE_INVALID');

  console.log('ALL LOCAL ACTIVITY LOG TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
