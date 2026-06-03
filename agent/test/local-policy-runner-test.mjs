import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { upsertRegisteredAgent } from '../src/local-agent-registry.mjs';
import { loadLocalSecretStore, upsertVenueKeyMetadata } from '../src/local-venue-store.mjs';
import { runDuePolicyTasks } from '../src/local-policy-runner.mjs';
import { loadLocalPolicyStore, upsertLocalPolicy } from '../src/local-policy-store.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-policy-runner-'));
const NOW = new Date('2026-06-03T00:00:10.000Z');

async function addOkxKey(configPath) {
  const result = await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'okx_run_key',
      account_ref: 'okx:subaccount:runner',
      permissions: ['read', 'place_order', 'cancel_order'],
      ip_allowlist: true,
    },
    { configPath }
  );
  assert.equal(result.status, 'ok');
}

function okxPolicy(overrides = {}) {
  return {
    policy_id: overrides.policy_id || 'runner-okx-1',
    target_agent: overrides.target_agent || 'codex',
    target_venue_ids: ['okx'],
    tick_interval_ms: 60_000,
    next_tick_after: '2026-06-03T00:00:00.000Z',
    constraints: {
      max_quote_amount: overrides.max_quote_amount || '1000',
      ...(overrides.constraints || {}),
    },
    task_template: {
      venue_id: 'okx',
      action_type: 'place_order',
      key_handle: 'okx_run_key',
      instrument: 'BTC-USDT',
      side: 'buy',
      orderType: 'limit',
      size: '0.01',
      price: '90000',
      clientOrderId: overrides.clientOrderId || 'sentry-runner-okx-1',
      ...(overrides.task_template || {}),
    },
  };
}

try {
  const venueConfigPath = path.join(dir, 'venues.json');
  const agentRegistryPath = path.join(dir, 'agents.json');
  await addOkxKey(venueConfigPath);
  const secretStore = await loadLocalSecretStore({ configPath: venueConfigPath });

  const planPolicyStorePath = path.join(dir, 'plan-policies.json');
  await upsertLocalPolicy(okxPolicy(), { configPath: planPolicyStorePath, now: NOW });
  const planPolicyStore = await loadLocalPolicyStore({ configPath: planPolicyStorePath, now: NOW });
  const planOnly = await runDuePolicyTasks({
    policyStore: planPolicyStore,
    secretStore,
    now: NOW,
  });
  assert.equal(planOnly.status, 'ok');
  assert.equal(planOnly.mode, 'plan');
  assert.equal(planOnly.result_count, 1);
  assert.equal(planOnly.results[0].status, 'planned');
  assert.equal(planOnly.results[0].local_decision, 'planned_no_dispatch');

  const cappedPolicyStorePath = path.join(dir, 'capped-policies.json');
  await upsertLocalPolicy(okxPolicy({ policy_id: 'runner-okx-capped', max_quote_amount: '10' }), {
    configPath: cappedPolicyStorePath,
    now: NOW,
  });
  const cappedPolicyStore = await loadLocalPolicyStore({
    configPath: cappedPolicyStorePath,
    now: NOW,
  });
  const capped = await runDuePolicyTasks({
    policyStore: cappedPolicyStore,
    secretStore,
    now: NOW,
  });
  assert.equal(capped.status, 'blocked');
  assert.equal(capped.results[0].code, 'POLICY_BUDGET_EXCEEDED');

  const agent = await upsertRegisteredAgent(
    {
      agent_id: 'codex',
      command: `${process.execPath} fake-agent.mjs`,
      capabilities: ['return_evidence'],
    },
    { configPath: agentRegistryPath }
  );
  assert.equal(agent.status, 'ok');

  let readinessCalled = false;
  let dispatchCalled = false;
  const dispatchRun = await runDuePolicyTasks({
    policyStore: planPolicyStore,
    secretStore,
    agentRegistry: {
      status: 'ok',
      agents: [agent.agent],
    },
    now: NOW,
    dispatch: true,
    verifyReceipt: false,
    getReadiness: async ({ task }) => {
      readinessCalled = true;
      assert.equal(task.venue_id, 'okx');
      return {
        status: 'ok',
        venue_id: 'okx',
        ready_venue_ids: ['okx'],
        dispatch_ready_source: 'local_daemon',
      };
    },
    dispatchTask: async ({ task, commandLine, localDispatchReadyVenues }) => {
      dispatchCalled = true;
      assert.equal(task.venue_id, 'okx');
      assert.equal(commandLine, `${process.execPath} fake-agent.mjs`);
      assert.deepEqual(localDispatchReadyVenues, ['okx']);
      return {
        status: 'ok',
        local_decision: 'accepted_result',
        task_id: task.task_id,
        agent_result: {
          task_id: task.task_id,
          status: 'submitted',
          summary: 'accepted by mock agent',
          evidence: {
            venue_id: 'okx',
            venue_order_id: 'okx-order-runner-1',
            client_order_id: task.action.params.clOrdId,
          },
        },
      };
    },
  });
  assert.equal(readinessCalled, true);
  assert.equal(dispatchCalled, true);
  assert.equal(dispatchRun.status, 'ok');
  assert.equal(dispatchRun.mode, 'dispatch');
  assert.equal(dispatchRun.dispatched_task_count, 1);
  assert.equal(dispatchRun.results[0].status, 'dispatched');
  assert.equal(dispatchRun.results[0].registered_agent.agent_id, 'codex');
  assert.equal(
    dispatchRun.results[0].dispatch.receipt_verification.reason,
    'disabled_by_policy_run_once'
  );

  let missingCommandDispatchCalled = false;
  const missingCommandRun = await runDuePolicyTasks({
    policyStore: planPolicyStore,
    secretStore,
    agentRegistry: { status: 'ok', agents: [] },
    now: NOW,
    dispatch: true,
    getReadiness: async () => {
      throw new Error('readiness should not run without command');
    },
    dispatchTask: async () => {
      missingCommandDispatchCalled = true;
    },
  });
  assert.equal(missingCommandRun.status, 'blocked');
  assert.equal(missingCommandRun.results[0].code, 'AGENT_NOT_REGISTERED');
  assert.equal(missingCommandDispatchCalled, false);

  const markedPolicyStorePath = path.join(dir, 'marked-policies.json');
  await upsertLocalPolicy(okxPolicy({ policy_id: 'runner-okx-marked' }), {
    configPath: markedPolicyStorePath,
    now: NOW,
  });
  const markedStore = await loadLocalPolicyStore({ configPath: markedPolicyStorePath, now: NOW });
  const marked = await runDuePolicyTasks({
    policyStore: markedStore,
    policyStorePath: markedPolicyStorePath,
    secretStore,
    now: NOW,
    markTicks: true,
  });
  assert.equal(marked.status, 'ok');
  assert.equal(marked.marked.length, 1);
  assert.equal(marked.marked[0].policy.last_tick_status, 'run_once_planned');

  const cliPolicyPath = path.join(dir, 'cli-run-policy.json');
  const cliPolicyStorePath = path.join(dir, 'cli-run-policies.json');
  await writeFile(cliPolicyPath, JSON.stringify(okxPolicy({ policy_id: 'cli-runner-okx-1' })));
  await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'policy',
      'add',
      '--file',
      cliPolicyPath,
      '--policy-store',
      cliPolicyStorePath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const { stdout: cliRunOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'policy',
      'run-once',
      '--policy-store',
      cliPolicyStorePath,
      '--venue-config',
      venueConfigPath,
      '--json',
    ],
    {
      cwd: path.join(import.meta.dirname, '..'),
      env: {
        ...process.env,
        SENTRY_POLICY_TICK_NOW: '2026-06-03T00:00:10.000Z',
      },
    }
  );
  const cliRun = JSON.parse(cliRunOut);
  assert.equal(cliRun.status, 'ok');
  assert.equal(cliRun.mode, 'plan');
  assert.equal(cliRun.results[0].status, 'planned');

  console.log('ALL LOCAL POLICY RUNNER TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
