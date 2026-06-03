import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  buildLocalPolicyTickSnapshot,
  loadLocalPolicyStore,
  loadLocalPolicyTickSnapshot,
  markLocalPolicyTick,
  readLocalPolicyConfig,
  updateLocalPolicyStatus,
  upsertLocalPolicy,
  validateLocalPolicyMetadata,
} from '../src/local-policy-store.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-policy-store-'));

try {
  const configPath = path.join(dir, 'policies.json');
  const missing = await readLocalPolicyConfig({ configPath });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.records.length, 0);

  const rawSecret = validateLocalPolicyMetadata({
    policy_id: 'bad-policy',
    target_venue_ids: ['okx'],
    api_secret: 'never-store-this',
  });
  assert.equal(rawSecret.status, 'error');
  assert.equal(rawSecret.code, 'RAW_SECRET_REJECTED');
  assert.equal(JSON.stringify(rawSecret).includes('never-store-this'), false);

  const unknownVenue = validateLocalPolicyMetadata({
    policy_id: 'unknown-venue',
    target_venue_ids: ['unknown-venue'],
  });
  assert.equal(unknownVenue.status, 'error');
  assert.equal(unknownVenue.code, 'UNKNOWN_TARGET_VENUE');

  const inserted = await upsertLocalPolicy(
    {
      policy_id: 'funding-arb-1',
      display_name: 'Funding Arb',
      target_agent: 'codex',
      target_venue_ids: ['hyperliquid', 'okx'],
      tick_interval_ms: 30_000,
      next_tick_after: '2026-06-03T00:00:00.000Z',
      constraints: {
        max_notional_usd: '100',
      },
    },
    {
      configPath,
      now: new Date('2026-06-03T00:00:00.000Z'),
    }
  );
  assert.equal(inserted.status, 'ok');
  assert.equal(inserted.policy.policy_id, 'funding-arb-1');
  assert.deepEqual(inserted.policy.target_venue_ids, ['hyperliquid', 'okx']);

  const mode = (await stat(configPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const loaded = await loadLocalPolicyStore({
    configPath,
    now: new Date('2026-06-03T00:00:00.000Z'),
  });
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.policy_count, 1);
  assert.equal(loaded.active_count, 1);
  assert.equal(JSON.stringify(loaded).includes('never-store-this'), false);

  const due = buildLocalPolicyTickSnapshot({
    policies: loaded.policies,
    now: new Date('2026-06-03T00:00:01.000Z'),
  });
  assert.equal(due.status, 'ok');
  assert.equal(due.due_count, 1);
  assert.equal(due.due_policies[0].policy_id, 'funding-arb-1');
  assert.deepEqual(due.due_policies[0].target_venue_ids, ['hyperliquid', 'okx']);

  const tickSnapshot = await loadLocalPolicyTickSnapshot({
    configPath,
    now: new Date('2026-06-03T00:00:01.000Z'),
  });
  assert.equal(tickSnapshot.due_count, 1);
  assert.equal(tickSnapshot.metadata_path, configPath);

  const marked = await markLocalPolicyTick(
    {
      policy_id: 'funding-arb-1',
      status: 'observed_no_trigger',
    },
    {
      configPath,
      now: new Date('2026-06-03T00:00:05.000Z'),
    }
  );
  assert.equal(marked.status, 'ok');
  assert.equal(marked.policy.last_tick_at, '2026-06-03T00:00:05.000Z');
  assert.equal(marked.policy.next_tick_after, '2026-06-03T00:00:35.000Z');

  const notDue = await loadLocalPolicyTickSnapshot({
    configPath,
    now: new Date('2026-06-03T00:00:10.000Z'),
  });
  assert.equal(notDue.due_count, 0);
  assert.equal(notDue.next_due_at, '2026-06-03T00:00:35.000Z');

  const paused = await updateLocalPolicyStatus(
    { policy_id: 'funding-arb-1', status: 'paused' },
    { configPath, now: new Date('2026-06-03T00:00:11.000Z') }
  );
  assert.equal(paused.status, 'ok');
  assert.equal(paused.policy.status, 'paused');
  assert.equal(paused.policy.paused_at, '2026-06-03T00:00:11.000Z');

  const resumed = await updateLocalPolicyStatus(
    { policy_id: 'funding-arb-1', status: 'active' },
    { configPath, now: new Date('2026-06-03T00:00:12.000Z') }
  );
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.policy.status, 'active');

  const revoked = await updateLocalPolicyStatus(
    { policy_id: 'funding-arb-1', status: 'revoked' },
    { configPath, now: new Date('2026-06-03T00:00:13.000Z') }
  );
  assert.equal(revoked.status, 'ok');
  assert.equal(revoked.policy.status, 'revoked');
  assert.equal(revoked.policy.revoked_at, '2026-06-03T00:00:13.000Z');

  const cliConfigPath = path.join(dir, 'cli-policies.json');
  const filePath = path.join(dir, 'policy.json');
  await writeFile(
    filePath,
    JSON.stringify({
      policy_id: 'sol-eth-1',
      display_name: 'Solana Ethereum Test',
      target_agent: 'codex',
      target_venue_ids: ['solana-mainnet', 'ethereum-mainnet'],
      tick_interval_ms: 60_000,
      next_tick_after: '2026-06-03T00:00:00.000Z',
    })
  );
  const { stdout: addOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'policy',
      'add',
      '--file',
      filePath,
      '--policy-store',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const cliAdded = JSON.parse(addOut);
  assert.equal(cliAdded.status, 'ok');
  assert.equal(cliAdded.policy.policy_id, 'sol-eth-1');

  const { stdout: listOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'policy', 'list', '--policy-store', cliConfigPath],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const cliList = JSON.parse(listOut);
  assert.equal(cliList.policy_count, 1);
  assert.equal(cliList.policies[0].policy_id, 'sol-eth-1');

  const { stdout: tickOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'policy', 'tick', '--policy-store', cliConfigPath, '--json'],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        SENTRY_POLICY_TICK_NOW: '2026-06-03T00:00:01.000Z',
      },
    }
  );
  const cliTick = JSON.parse(tickOut);
  assert.equal(cliTick.status, 'ok');
  assert.equal(cliTick.due_count, 1);
  assert.equal(cliTick.due_policies[0].policy_id, 'sol-eth-1');

  await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'policy', 'pause', 'sol-eth-1', '--policy-store', cliConfigPath, '--json'],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const afterPause = JSON.parse(await readFile(cliConfigPath, 'utf8'));
  assert.equal(afterPause.policies[0].status, 'paused');

  console.log('ALL LOCAL POLICY STORE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
