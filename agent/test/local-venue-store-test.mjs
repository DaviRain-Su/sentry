import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildLocalInventorySnapshot } from '../../core/inventory.js';
import {
  loadLocalSecretStore,
  markVenueKeyMetadataRevoked,
  markVenueKeyMetadataRotated,
  readVenueConfig,
  removeVenueKeyMetadata,
  upsertVenueKeyMetadata,
} from '../src/local-venue-store.mjs';

const execFileAsync = promisify(execFile);

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-venue-store-'));

try {
  const configPath = path.join(dir, 'venues.json');
  const missing = await readVenueConfig({ configPath });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.records.length, 0);

  const okx = await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'okx_key_test',
      display_handle: 'okx_....test',
      account_ref: 'okx:subaccount:test',
      permissions: ['read', 'place_order', 'cancel_order'],
      ip_allowlist: true,
    },
    { configPath, now: '2026-06-03T00:00:00.000Z' }
  );
  assert.equal(okx.status, 'ok');
  assert.equal(okx.record_count, 1);
  assert.equal(okx.key.created_at, '2026-06-03T00:00:00.000Z');
  assert.equal(okx.key.rotated_at, '2026-06-03T00:00:00.000Z');

  const mode = (await stat(configPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const raw = await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'bad',
      api_secret: 'never-store-this',
      permissions: ['read'],
    },
    { configPath }
  );
  assert.equal(raw.status, 'error');
  assert.equal(raw.code, 'RAW_SECRET_REJECTED');

  const badRotationTimestamp = await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'bad_rotation',
      permissions: ['read'],
      rotated_at: 'not-a-date',
    },
    { configPath }
  );
  assert.equal(badRotationTimestamp.status, 'error');
  assert.equal(badRotationTimestamp.code, 'BAD_ROTATION_TIMESTAMP');

  const loaded = await loadLocalSecretStore({ configPath });
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.key_count, 1);
  assert.equal(loaded.keys[0].venue_id, 'okx');
  assert.equal(loaded.keys[0].permissions.includes('withdraw'), false);
  assert.equal(loaded.keys[0].permission_proof.source, 'metadata_attestation');
  assert.equal(loaded.keys[0].ip_allowlist_proof.source, 'metadata_attestation');
  assert.equal(loaded.keys[0].created_at, '2026-06-03T00:00:00.000Z');
  assert.equal(loaded.keys[0].rotated_at, '2026-06-03T00:00:00.000Z');
  assert.equal(JSON.stringify(loaded).includes('never-store-this'), false);

  const rotatedKey = await markVenueKeyMetadataRotated(
    {
      venue_id: 'okx',
      key_handle: 'okx_key_test',
      reason: 'test_rotation',
    },
    { configPath, now: '2026-06-05T00:00:00.000Z' }
  );
  assert.equal(rotatedKey.status, 'ok');
  assert.equal(rotatedKey.live_authority_rotated, false);
  assert.equal(rotatedKey.manual_rotation_required, true);
  const afterLocalRotate = await loadLocalSecretStore({ configPath });
  assert.equal(afterLocalRotate.keys[0].created_at, '2026-06-03T00:00:00.000Z');
  assert.equal(afterLocalRotate.keys[0].rotated_at, '2026-06-05T00:00:00.000Z');
  assert.equal(afterLocalRotate.keys[0].rotation_reason, 'test_rotation');

  const revokedKey = await markVenueKeyMetadataRevoked(
    {
      venue_id: 'okx',
      key_handle: 'okx_key_test',
      reason: 'test_revoke',
    },
    { configPath, now: '2026-06-04T00:00:00.000Z' }
  );
  assert.equal(revokedKey.status, 'ok');
  assert.equal(revokedKey.revoked, true);
  assert.equal(revokedKey.live_authority_revoked, false);
  assert.equal(revokedKey.manual_revoke_required, true);
  const afterLocalRevoke = await loadLocalSecretStore({ configPath });
  assert.equal(afterLocalRevoke.keys[0].status, 'revoked');
  assert.deepEqual(afterLocalRevoke.keys[0].permissions, ['read']);

  await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'okx_key_test',
      display_handle: 'okx_....test',
      account_ref: 'okx:subaccount:test',
      permissions: ['read', 'place_order', 'cancel_order'],
      ip_allowlist: true,
    },
    { configPath }
  );

  const inventory = buildLocalInventorySnapshot({
    secretStore: await loadLocalSecretStore({ configPath }),
    scope: ['okx'],
    now: '2026-06-03T00:00:00.000Z',
  });
  assert.equal(inventory.status, 'ok');
  assert.equal(inventory.sources[0].status, 'configured_readonly');
  assert.equal(inventory.sources[0].account_ref, 'okx:subaccount:test');

  const { stdout: credentialStatusOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'venue',
      'credentials',
      'status',
      '--venue',
      'okx',
      '--key-handle',
      'okx_key_test',
      '--venue-config',
      configPath,
    ],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        SENTRY_OKX_OKX_KEY_TEST_API_KEY: 'api-value',
        SENTRY_OKX_OKX_KEY_TEST_SECRET_KEY: 'secret-value',
        SENTRY_OKX_OKX_KEY_TEST_PASSPHRASE: 'pass-value',
      },
    }
  );
  const credentialStatus = JSON.parse(credentialStatusOut);
  assert.equal(credentialStatus.status, 'ok');
  assert.equal(credentialStatus.env.source, 'env');
  assert.equal(JSON.stringify(credentialStatus).includes('secret-value'), false);

  const cliConfigPath = path.join(dir, 'cli-venues.json');
  await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'venue',
      'add',
      '--venue',
      'hyperliquid',
      '--key-handle',
      'hl_agent_cli',
      '--account-ref',
      'hyperliquid:subaccount:cli',
      '--read-account-address',
      '0x0000000000000000000000000000000000000001',
      '--agent-wallet-address',
      '0x1111111111111111111111111111111111111111',
      '--agent-wallet-verified-at',
      '2026-06-03T00:00:00.000Z',
      '--rotated-at',
      '2026-06-03T00:00:00.000Z',
      '--permissions',
      'read,place_order,cancel_order,set_leverage',
      '--venue-config',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const { stdout: listOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'venue', 'list', '--venue-config', cliConfigPath],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const listed = JSON.parse(listOut);
  assert.equal(listed.key_count, 1);
  assert.equal(listed.keys[0].venue_id, 'hyperliquid');
  assert.equal(listed.keys[0].permissions.includes('set_leverage'), true);
  assert.equal(listed.keys[0].read_account_address, '0x0000000000000000000000000000000000000001');
  assert.equal(listed.keys[0].agent_wallet_address, '0x1111111111111111111111111111111111111111');
  assert.equal(listed.keys[0].agent_wallet.grant_status, 'active');
  assert.equal(listed.keys[0].agent_wallet.verified_at, '2026-06-03T00:00:00.000Z');
  assert.equal(listed.keys[0].rotated_at, '2026-06-03T00:00:00.000Z');

  await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'venue',
      'rotate',
      '--venue',
      'hyperliquid',
      '--key-handle',
      'hl_agent_cli',
      '--rotated-at',
      '2026-06-06T00:00:00.000Z',
      '--confirm',
      '--venue-config',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const afterCliRotate = await loadLocalSecretStore({ configPath: cliConfigPath });
  assert.equal(afterCliRotate.keys[0].rotated_at, '2026-06-06T00:00:00.000Z');
  assert.equal(afterCliRotate.keys[0].rotation_reason, 'local_key_rotation');

  await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'venue',
      'remove',
      '--venue',
      'hyperliquid',
      '--key-handle',
      'hl_agent_cli',
      '--venue-config',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const afterRemove = JSON.parse(await readFile(cliConfigPath, 'utf8'));
  assert.deepEqual(afterRemove.venues, []);

  const removed = await removeVenueKeyMetadata(
    { venue_id: 'okx', key_handle: 'okx_key_test' },
    { configPath }
  );
  assert.equal(removed.status, 'ok');
  assert.equal(removed.removed, true);
  assert.equal(removed.record_count, 0);

  console.log('ALL LOCAL VENUE STORE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
