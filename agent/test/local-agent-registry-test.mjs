import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assessAgentTaskCapability,
  loadAgentRegistry,
  parseTaskCapabilityList,
  readAgentRegistryConfig,
  resolveAgentDispatchCommand,
  removeRegisteredAgent,
  resolveRegisteredAgentCommand,
  upsertRegisteredAgent,
  validateRegisteredAgentMetadata,
} from '../src/local-agent-registry.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-agent-registry-'));

try {
  const configPath = path.join(dir, 'agents.json');
  const missing = await readAgentRegistryConfig({ configPath });
  assert.equal(missing.status, 'missing');
  assert.equal(missing.records.length, 0);

  const registered = await upsertRegisteredAgent(
    {
      agent_id: 'Codex',
      display_name: 'Codex CLI',
      command: `${process.execPath} ./fake-agent.mjs`,
      capabilities: ['read_context', 'return_evidence'],
      task_capabilities: ['okx:place_order', 'solana:swap'],
    },
    { configPath }
  );
  assert.equal(registered.status, 'ok');
  assert.equal(registered.agent.agent_id, 'codex');
  assert.equal(registered.record_count, 1);

  const mode = (await stat(configPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const loaded = await loadAgentRegistry({ configPath });
  assert.equal(loaded.status, 'ok');
  assert.equal(loaded.agent_count, 1);
  assert.equal(loaded.enabled_count, 1);
  assert.equal(loaded.agents[0].command, `${process.execPath} ./fake-agent.mjs`);
  assert.deepEqual(loaded.agents[0].task_capabilities, [
    { venue_id: 'okx', action_type: 'place_order' },
    { venue_id: 'solana-mainnet', action_type: 'submit_tx' },
  ]);
  assert.deepEqual(parseTaskCapabilityList('ethereum:swap,hyperliquid/place_order,*'), [
    { venue_id: 'ethereum-mainnet', action_type: 'submit_tx' },
    { venue_id: 'hyperliquid', action_type: 'place_order' },
    { venue_id: '*', action_type: '*' },
  ]);

  const resolved = resolveRegisteredAgentCommand(loaded, 'Codex');
  assert.equal(resolved.status, 'ok');
  assert.equal(resolved.agent_id, 'codex');
  assert.equal(resolved.command, `${process.execPath} ./fake-agent.mjs`);
  assert.equal(resolved.task_capability.status, 'skipped');

  const matchingCapability = assessAgentTaskCapability(loaded.agents[0], {
    venue_id: 'okx',
    action: { type: 'place_order' },
  });
  assert.equal(matchingCapability.status, 'ok');
  assert.equal(matchingCapability.matched_task_capability.venue_id, 'okx');

  const deniedCapability = assessAgentTaskCapability(loaded.agents[0], {
    venue_id: 'ethereum-mainnet',
    action: { type: 'submit_tx' },
  });
  assert.equal(deniedCapability.status, 'error');
  assert.equal(deniedCapability.code, 'AGENT_TASK_CAPABILITY_DENIED');

  const dispatchCommand = resolveAgentDispatchCommand({
    registry: loaded,
    payload: {
      target_agent: 'codex',
      task: { venue_id: 'okx', action: { type: 'place_order' } },
    },
  });
  assert.equal(dispatchCommand.status, 'ok');
  assert.equal(dispatchCommand.agent_id, 'codex');
  assert.equal(dispatchCommand.unregistered_command, undefined);
  assert.equal(dispatchCommand.task_capability.status, 'ok');

  const deniedDispatchCommand = resolveAgentDispatchCommand({
    registry: loaded,
    payload: {
      target_agent: 'codex',
      task: { venue_id: 'ethereum-mainnet', action: { type: 'submit_tx' } },
    },
  });
  assert.equal(deniedDispatchCommand.status, 'error');
  assert.equal(deniedDispatchCommand.code, 'AGENT_TASK_CAPABILITY_DENIED');

  const missingDispatchCommand = resolveAgentDispatchCommand({
    registry: loaded,
    payload: { target_agent: 'missing-agent' },
  });
  assert.equal(missingDispatchCommand.status, 'error');
  assert.equal(missingDispatchCommand.code, 'AGENT_NOT_REGISTERED');

  const inlineDispatchCommand = resolveAgentDispatchCommand({
    registry: loaded,
    payload: { command: 'codex' },
  });
  assert.equal(inlineDispatchCommand.status, 'ok');
  assert.equal(inlineDispatchCommand.unregistered_command, true);

  const secretArg = validateRegisteredAgentMetadata({
    agent_id: 'bad',
    command: 'codex --token=do-not-store-this',
  });
  assert.equal(secretArg.status, 'error');
  assert.equal(secretArg.code, 'RAW_SECRET_ARG_REJECTED');
  assert.equal(JSON.stringify(secretArg).includes('do-not-store-this'), false);

  const cliConfigPath = path.join(dir, 'cli-agents.json');
  const { stdout: registerOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'agent',
      'register',
      'claude-code',
      '--command',
      `${process.execPath} ./claude-agent.mjs`,
      '--capabilities',
      'read_context,return_evidence',
      '--task-capabilities',
      'okx:place_order,hyperliquid:place_order',
      '--agent-registry',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const cliRegistered = JSON.parse(registerOut);
  assert.equal(cliRegistered.status, 'ok');
  assert.equal(cliRegistered.agent.agent_id, 'claude-code');
  assert.deepEqual(cliRegistered.agent.task_capabilities, [
    { venue_id: 'okx', action_type: 'place_order' },
    { venue_id: 'hyperliquid', action_type: 'place_order' },
  ]);

  const { stdout: listOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'agent', 'list', '--agent-registry', cliConfigPath],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const listed = JSON.parse(listOut);
  assert.equal(listed.agent_count, 1);
  assert.equal(listed.agents[0].agent_id, 'claude-code');
  assert.equal(JSON.stringify(listed).includes('do-not-store-this'), false);

  await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'agent',
      'remove',
      'claude-code',
      '--agent-registry',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const afterRemove = JSON.parse(await readFile(cliConfigPath, 'utf8'));
  assert.deepEqual(afterRemove.agents, []);

  const removed = await removeRegisteredAgent({ agent_id: 'codex' }, { configPath });
  assert.equal(removed.status, 'ok');
  assert.equal(removed.removed, true);
  assert.equal(removed.record_count, 0);

  console.log('ALL LOCAL AGENT REGISTRY TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
