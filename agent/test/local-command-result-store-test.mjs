import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findLocalCommandResult,
  loadLocalCommandResultStore,
  rememberLocalCommandResult,
  sanitizeLocalCommandResult,
} from '../src/local-command-result-store.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-command-results-'));
const storePath = path.join(dir, 'nested', 'command-results.json');

try {
  const missing = await loadLocalCommandResultStore({ storePath });
  assert.equal(missing.status, 'ok');
  assert.equal(missing.config_status, 'missing');
  assert.equal(missing.result_count, 0);

  const sanitized = sanitizeLocalCommandResult({
    status: 'ok',
    api_secret: 'must-not-leak',
    relayToken: 'relay-token',
    nested: {
      privateKey: 'private-key',
      evidence: { tx_hash: '0xabc' },
    },
  });
  assert.equal('api_secret' in sanitized, false);
  assert.equal('relayToken' in sanitized, false);
  assert.equal('privateKey' in sanitized.nested, false);
  assert.equal(sanitized.__redacted_fields, 2);
  assert.equal(sanitized.nested.__redacted_fields, 1);
  assert.equal(sanitized.nested.evidence.tx_hash, '0xabc');
  assert.equal(JSON.stringify(sanitized).includes('must-not-leak'), false);

  const remembered = await rememberLocalCommandResult(
    {
      command_message_id: 'cmd_1',
      idempotency_key: 'idem_1',
      type: 'agent.dispatch',
      result_payload: {
        command_message_id: 'cmd_1',
        status: 'ok',
        secret_key: 'secret-key',
        evidence: { venue_order_id: 'hl-order-1' },
      },
    },
    { storePath }
  );
  assert.equal(remembered.status, 'ok');
  assert.equal(remembered.result.command_message_id, 'cmd_1');

  const mode = (await stat(storePath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const disk = await readFile(storePath, 'utf8');
  assert.equal(disk.includes('secret-key'), false);
  assert.equal(disk.includes('secret_key'), false);

  const foundByCommand = await findLocalCommandResult({ commandMessageId: 'cmd_1' }, { storePath });
  assert.equal(foundByCommand.status, 'ok');
  assert.equal(foundByCommand.found, true);
  assert.equal(foundByCommand.result.result_payload.evidence.venue_order_id, 'hl-order-1');
  assert.equal('secret_key' in foundByCommand.result.result_payload, false);
  assert.equal(foundByCommand.result.result_payload.__redacted_fields, 1);

  const replaced = await rememberLocalCommandResult(
    {
      command_message_id: 'cmd_1',
      idempotency_key: 'idem_1',
      type: 'agent.dispatch',
      result_payload: {
        command_message_id: 'cmd_1',
        status: 'error',
        code: 'COMMAND_RESUME_NOT_FOUND',
      },
    },
    { storePath }
  );
  assert.equal(replaced.status, 'ok');
  assert.equal(replaced.result_count, 1);

  const foundByIdem = await findLocalCommandResult({ idempotencyKey: 'idem_1' }, { storePath });
  assert.equal(foundByIdem.found, true);
  assert.equal(foundByIdem.result.result_payload.status, 'error');
  assert.equal(foundByIdem.result.result_payload.code, 'COMMAND_RESUME_NOT_FOUND');

  for (let index = 0; index < 5; index += 1) {
    const written = await rememberLocalCommandResult(
      {
        command_message_id: `cmd_extra_${index}`,
        idempotency_key: `idem_extra_${index}`,
        type: 'agent.status',
        result_payload: { status: 'ok', index },
      },
      { storePath, maxRecords: 3 }
    );
    assert.equal(written.status, 'ok');
  }
  const capped = await loadLocalCommandResultStore({ storePath });
  assert.equal(capped.result_count, 3);
  assert.equal(capped.results[0].command_message_id, 'cmd_extra_4');

  console.log('ALL LOCAL COMMAND RESULT STORE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
