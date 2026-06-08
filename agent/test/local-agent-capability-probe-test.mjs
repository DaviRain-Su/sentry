import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { probeAgentRegistry, probeRegisteredAgent } from '../src/local-agent-capability-probe.mjs';
import { loadAgentRegistry, upsertRegisteredAgent } from '../src/local-agent-registry.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-agent-probe-'));

try {
  const fakeAgent = path.join(dir, 'fake-agent.mjs');
  await writeFile(
    fakeAgent,
    `
if (process.argv.includes('--version')) {
  console.log('codex 1.2.3');
  process.exit(0);
}
console.log(JSON.stringify({ status: 'idle' }));
`
  );

  const secretAgent = path.join(dir, 'secret-agent.mjs');
  await writeFile(
    secretAgent,
    `
if (process.argv.includes('--version')) {
  console.log('api_secret=do-not-return-this');
  process.exit(0);
}
`
  );

  const okProbe = await probeRegisteredAgent({
    agent_id: 'codex',
    display_name: 'Codex CLI',
    command: `${process.execPath} ${fakeAgent}`,
    capabilities: ['read_context', 'build_transaction', 'return_evidence'],
    task_capabilities: ['okx:place_order', 'solana-mainnet:submit_tx'],
    enabled: true,
  });
  assert.equal(okProbe.status, 'ok');
  assert.equal(okProbe.profile.kind, 'codex');
  assert.equal(okProbe.version_output, 'codex 1.2.3');
  assert.equal(okProbe.capabilities.missing_capabilities.length, 0);
  assert.deepEqual(okProbe.capabilities.declared_task_capabilities, [
    { venue_id: 'okx', action_type: 'place_order' },
    { venue_id: 'solana-mainnet', action_type: 'submit_tx' },
  ]);

  const partialProbe = await probeRegisteredAgent({
    agent_id: 'codex',
    command: `${process.execPath} ${fakeAgent}`,
    capabilities: ['read_context'],
    enabled: true,
  });
  assert.equal(partialProbe.status, 'partial');
  assert.deepEqual(partialProbe.capabilities.missing_capabilities, [
    'return_evidence',
    'build_transaction',
  ]);

  const disabledProbe = await probeRegisteredAgent({
    agent_id: 'codex',
    command: `${process.execPath} ${fakeAgent}`,
    capabilities: ['read_context', 'return_evidence'],
    enabled: false,
  });
  assert.equal(disabledProbe.status, 'blocked');
  assert.equal(disabledProbe.code, 'AGENT_DISABLED');

  const secretProbe = await probeRegisteredAgent({
    agent_id: 'custom',
    command: `${process.execPath} ${secretAgent}`,
    capabilities: ['read_context', 'return_evidence'],
    enabled: true,
  });
  assert.equal(secretProbe.status, 'ok');
  assert.equal(secretProbe.version_output, '[redacted-output]');
  assert.equal(JSON.stringify(secretProbe).includes('do-not-return-this'), false);

  const configPath = path.join(dir, 'agents.json');
  const registered = await upsertRegisteredAgent(
    {
      agent_id: 'codex',
      command: `${process.execPath} ${fakeAgent}`,
      capabilities: ['read_context', 'build_transaction', 'return_evidence'],
      task_capabilities: ['ethereum:swap'],
    },
    { configPath }
  );
  assert.equal(registered.status, 'ok');
  const registry = await loadAgentRegistry({ configPath });
  const registryProbe = await probeAgentRegistry(registry, { agent_id: 'codex' });
  assert.equal(registryProbe.status, 'ok');
  assert.equal(registryProbe.probe_count, 1);
  assert.equal(registryProbe.probes[0].version_output, 'codex 1.2.3');
  assert.deepEqual(registryProbe.probes[0].capabilities.declared_task_capabilities, [
    { venue_id: 'ethereum-mainnet', action_type: 'submit_tx' },
  ]);

  const missingProbe = await probeAgentRegistry(registry, { agent_id: 'missing' });
  assert.equal(missingProbe.status, 'blocked');
  assert.equal(missingProbe.code, 'AGENT_NOT_REGISTERED');

  const { stdout: cliProbeOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'agent', 'probe', 'codex', '--agent-registry', configPath, '--json'],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const cliProbe = JSON.parse(cliProbeOut);
  assert.equal(cliProbe.status, 'ok');
  assert.equal(cliProbe.probes[0].version_output, 'codex 1.2.3');

  console.log('ALL LOCAL AGENT CAPABILITY PROBE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
