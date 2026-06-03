import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-daemon-config-'));

try {
  const { stdout: defaultOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', '--print-config'],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: dir,
        SENTRY_HYPERLIQUID_NONCE_STORE: '',
      },
    }
  );
  const defaultConfig = JSON.parse(defaultOut);
  assert.equal(
    defaultConfig.hyperliquidNonceStorePath.endsWith('/.sentry/hyperliquid-nonces.json'),
    true
  );
  assert.equal(defaultConfig.policyStorePath.endsWith('/.sentry/policies.json'), true);
  assert.equal(defaultConfig.activityLogPath.endsWith('/.sentry/activity.jsonl'), true);
  assert.equal(defaultConfig.policyLoop.enabled, false);
  assert.equal(defaultConfig.policyLoop.dispatch, false);
  assert.equal(defaultConfig.policyLoop.markTicks, true);
  assert.equal(JSON.stringify(defaultConfig).includes('disabled'), false);

  const explicitPath = path.join(dir, 'custom-hl-nonces.json');
  const explicitPolicyStorePath = path.join(dir, 'custom-policies.json');
  const explicitActivityLogPath = path.join(dir, 'custom-activity.jsonl');
  const { stdout: explicitOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      '--print-config',
      '--hyperliquid-nonce-store',
      explicitPath,
      '--policy-store',
      explicitPolicyStorePath,
      '--activity-log',
      explicitActivityLogPath,
      '--policy-loop',
      '--policy-loop-interval-ms',
      '1500',
      '--policy-loop-check-readiness',
    ],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: dir,
      },
    }
  );
  const explicitConfig = JSON.parse(explicitOut);
  assert.equal(explicitConfig.hyperliquidNonceStorePath, explicitPath);
  assert.equal(explicitConfig.policyStorePath, explicitPolicyStorePath);
  assert.equal(explicitConfig.activityLogPath, explicitActivityLogPath);
  assert.equal(explicitConfig.policyLoop.enabled, true);
  assert.equal(explicitConfig.policyLoop.intervalMs, 1500);
  assert.equal(explicitConfig.policyLoop.checkReadiness, true);

  const { stdout: emptyActivityTailOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'activity',
      'tail',
      '--activity-log',
      path.join(dir, 'missing.jsonl'),
      '--json',
    ],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: dir,
      },
    }
  );
  const emptyActivityTail = JSON.parse(emptyActivityTailOut);
  assert.equal(emptyActivityTail.status, 'ok');
  assert.equal(emptyActivityTail.event_count, 0);
  assert.deepEqual(emptyActivityTail.events, []);

  const { stdout: signerProbeOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'signer', 'probe', '--json'],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        HOME: dir,
        SENTRY_SOLANA_WALLET_ADDRESS: '11111111111111111111111111111111',
        SENTRY_SOLANA_SIGNER_ADDRESS: '11111111111111111111111111111111',
        SENTRY_ETHEREUM_WALLET_ADDRESS: '0x0000000000000000000000000000000000000001',
        SENTRY_ETHEREUM_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000001',
      },
    }
  );
  const signerProbe = JSON.parse(signerProbeOut);
  assert.equal(signerProbe.status, 'ok');
  assert.deepEqual(
    signerProbe.probes.map((probe) => probe.status),
    ['ok', 'ok']
  );
  assert.equal(JSON.stringify(signerProbe).includes('private_key'), false);

  console.log('ALL DAEMON CONFIG TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
