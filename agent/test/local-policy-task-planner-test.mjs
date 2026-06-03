import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadLocalSecretStore, upsertVenueKeyMetadata } from '../src/local-venue-store.mjs';
import { buildDuePolicyTaskPlan, buildPolicyTaskPlan } from '../src/local-policy-task-planner.mjs';
import { loadLocalPolicyStore, upsertLocalPolicy } from '../src/local-policy-store.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-policy-plan-'));

const NOW = new Date('2026-06-03T00:00:10.000Z');
const SOLANA_OWNER = '11111111111111111111111111111111';
const SOLANA_INPUT_MINT = 'So11111111111111111111111111111111111111112';
const SOLANA_OUTPUT_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ETH_ACCOUNT = '0x1111111111111111111111111111111111111111';
const ETH_INPUT_TOKEN = '0x2222222222222222222222222222222222222222';
const ETH_OUTPUT_TOKEN = '0x3333333333333333333333333333333333333333';

try {
  const policyStorePath = path.join(dir, 'policies.json');
  const venueConfigPath = path.join(dir, 'venues.json');

  const okxKey = await upsertVenueKeyMetadata(
    {
      venue_id: 'okx',
      key_handle: 'okx_plan_key',
      account_ref: 'okx:subaccount:planner',
      permissions: ['read', 'place_order', 'cancel_order'],
      ip_allowlist: true,
    },
    { configPath: venueConfigPath }
  );
  assert.equal(okxKey.status, 'ok');

  const hyperliquidKey = await upsertVenueKeyMetadata(
    {
      venue_id: 'hyperliquid',
      key_handle: 'hl_plan_key',
      account_ref: 'hyperliquid:subaccount:planner',
      read_account_address: '0x0000000000000000000000000000000000000001',
      agent_wallet_address: '0x0000000000000000000000000000000000000002',
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      agent_wallet_grant: {
        status: 'active',
        source: 'metadata_attestation',
        permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      },
    },
    { configPath: venueConfigPath }
  );
  assert.equal(hyperliquidKey.status, 'ok');

  const policy = await upsertLocalPolicy(
    {
      policy_id: 'multivenue-plan-1',
      target_agent: 'codex',
      target_venue_ids: ['okx', 'hyperliquid', 'solana-mainnet', 'ethereum-mainnet'],
      tick_interval_ms: 60_000,
      next_tick_after: '2026-06-03T00:00:00.000Z',
      task_templates: [
        {
          venue_id: 'okx',
          action_type: 'place_order',
          key_handle: 'okx_plan_key',
          instrument: 'BTC-USDT',
          side: 'buy',
          orderType: 'limit',
          size: '0.01',
          price: '90000',
          clientOrderId: 'sentry-okx-plan-1',
        },
        {
          venue_id: 'hyperliquid',
          action_type: 'place_order',
          key_handle: 'hl_plan_key',
          coin: 'BTC',
          side: 'sell',
          orderType: 'limit',
          size: '0.01',
          price: '91000',
          tif: 'Gtc',
          cloid: '0x11111111111111111111111111111111',
        },
        {
          venue_id: 'solana-mainnet',
          action_type: 'swap',
          account: {
            owner: SOLANA_OWNER,
            capabilities: ['read', 'sign', 'submit_tx'],
          },
          adapter: 'jupiter',
          inputMint: SOLANA_INPUT_MINT,
          outputMint: SOLANA_OUTPUT_MINT,
          amount: '1000000',
          slippageBps: 50,
          quoteId: 'solana-quote-plan-1',
        },
        {
          venue_id: 'ethereum-mainnet',
          action_type: 'swap',
          account: {
            account: ETH_ACCOUNT,
            capabilities: ['read', 'sign', 'submit_tx'],
          },
          adapter: 'uniswap',
          inputToken: ETH_INPUT_TOKEN,
          outputToken: ETH_OUTPUT_TOKEN,
          amount: '1000000000000000',
          slippageBps: 50,
          quoteId: 'ethereum-quote-plan-1',
        },
      ],
    },
    { configPath: policyStorePath, now: NOW }
  );
  assert.equal(policy.status, 'ok');
  assert.equal(policy.policy.task_templates.length, 4);

  const [policyStore, secretStore] = await Promise.all([
    loadLocalPolicyStore({ configPath: policyStorePath, now: NOW }),
    loadLocalSecretStore({ configPath: venueConfigPath }),
  ]);
  const duePlan = buildDuePolicyTaskPlan({
    policyStore,
    secretStore,
    now: NOW,
    limit: 10,
  });
  assert.equal(duePlan.status, 'ok');
  assert.equal(duePlan.due_count, 1);
  assert.equal(duePlan.planned_task_count, 4);
  assert.equal(duePlan.blocked_task_count, 0);
  assert.deepEqual(
    duePlan.planned_tasks.map((entry) => entry.venue_id),
    ['okx', 'hyperliquid', 'solana-mainnet', 'ethereum-mainnet']
  );
  assert.equal(duePlan.planned_tasks[0].task.action.params.clOrdId, 'sentry-okx-plan-1');
  assert.equal(
    duePlan.planned_tasks[1].task.action.params.cloid,
    '0x11111111111111111111111111111111'
  );
  assert.equal(duePlan.planned_tasks[2].task.action.params.quote_id, 'solana-quote-plan-1');
  assert.equal(duePlan.planned_tasks[3].task.action.params.quote_id, 'ethereum-quote-plan-1');

  const noTemplate = buildPolicyTaskPlan({
    policy_id: 'missing-template',
    status: 'active',
    target_agent: 'codex',
    target_venue_ids: ['okx'],
  });
  assert.equal(noTemplate.status, 'blocked');
  assert.equal(noTemplate.blocked_tasks[0].code, 'POLICY_TASK_TEMPLATE_REQUIRED');

  const missingKey = buildPolicyTaskPlan(
    {
      policy_id: 'missing-key',
      status: 'active',
      target_agent: 'codex',
      target_venue_ids: ['okx'],
      task_templates: [
        {
          venue_id: 'okx',
          action_type: 'place_order',
          key_handle: 'okx_missing',
          instrument: 'BTC-USDT',
          side: 'buy',
          orderType: 'limit',
          size: '0.01',
          price: '90000',
        },
      ],
    },
    { secretStore, now: NOW }
  );
  assert.equal(missingKey.status, 'blocked');
  assert.equal(missingKey.blocked_tasks[0].code, 'OKX_KEY_METADATA_REQUIRED');

  const rawSecret = buildPolicyTaskPlan(
    {
      policy_id: 'raw-secret',
      status: 'active',
      target_agent: 'codex',
      target_venue_ids: ['okx'],
      task_templates: [
        {
          venue_id: 'okx',
          action_type: 'place_order',
          key_handle: 'okx_plan_key',
          instrument: 'BTC-USDT',
          side: 'buy',
          orderType: 'limit',
          size: '0.01',
          price: '90000',
          api_secret: 'never-store-this',
        },
      ],
    },
    { secretStore, now: NOW }
  );
  assert.equal(rawSecret.status, 'blocked');
  assert.equal(rawSecret.blocked_tasks[0].code, 'RAW_SECRET_REJECTED');
  assert.equal(JSON.stringify(rawSecret).includes('never-store-this'), false);

  const cliPolicyPath = path.join(dir, 'cli-policy.json');
  const cliPolicyStorePath = path.join(dir, 'cli-policies.json');
  await writeFile(
    cliPolicyPath,
    JSON.stringify({
      policy_id: 'cli-plan-1',
      target_agent: 'codex',
      target_venue_ids: ['okx'],
      tick_interval_ms: 60_000,
      next_tick_after: '2026-06-03T00:00:00.000Z',
      task_template: {
        venue_id: 'okx',
        action_type: 'place_order',
        key_handle: 'okx_plan_key',
        instrument: 'ETH-USDT',
        side: 'buy',
        orderType: 'limit',
        size: '0.1',
        price: '3000',
        clientOrderId: 'sentry-cli-plan-1',
      },
    })
  );
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
  const { stdout: cliPlanOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'policy',
      'plan',
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
  const cliPlan = JSON.parse(cliPlanOut);
  assert.equal(cliPlan.status, 'ok');
  assert.equal(cliPlan.planned_task_count, 1);
  assert.equal(cliPlan.planned_tasks[0].task.action.params.clOrdId, 'sentry-cli-plan-1');

  console.log('ALL LOCAL POLICY TASK PLANNER TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
