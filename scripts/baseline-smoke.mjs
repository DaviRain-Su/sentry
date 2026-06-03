// Baseline readiness smoke for the real Sui Testnet mission.
// Prints public IDs, endpoint status, and key-name presence only; never prints
// worker secret values from worker/.dev.vars.
import { readFileSync, existsSync } from 'node:fs';
import deploymentJson from '../deployment.testnet.json' with { type: 'json' };
import coreDeployment from '../core/deployment.js';
import workerDeployment from '../worker/src/deployment.js';
import { getClient, DEPLOYMENT } from '../worker/src/sui-tx.js';
import { decideTick } from '../worker/src/tick.js';
import { readBalanceManagerBalance } from '../worker/src/chain.js';

const REQUIRED_WORKER_KEYS = [
  'AGENT_KEY',
  'INTERNAL_AGENT_TICK_TOKEN',
  'SENTRY_DEMO_MODE',
  'EXECUTION_ENABLED',
];
const FRONTEND_URL = 'http://localhost:5173';
const WORKER_URL = 'http://localhost:8787';
const INDEXER = 'https://deepbook-indexer.testnet.mystenlabs.com';

let failures = 0;

function ok(label, detail = '') {
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failures++;
  console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

function assert(label, condition, detail = '') {
  if (condition) ok(label, detail);
  else fail(label, detail);
}

function readEnvKeys(path) {
  if (!existsSync(path)) return { exists: false, keys: new Set(), values: new Map() };
  const text = readFileSync(path, 'utf8');
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    values.set(line.slice(0, i), line.slice(i + 1));
  }
  return { exists: true, keys: new Set(values.keys()), values };
}

function getLabel(d, label) {
  switch (label) {
    case 'sentry_package':
      return d.sentry.package_id;
    case 'movegate_package':
      return d.movegate.package_id_original;
    case 'agent':
      return d.agent.address;
    case 'agent_passport':
      return d.agent.passport_id;
    case 'balance_manager':
      return d.agent.balance_manager_id;
    case 'deepbook_sui_dbusdc_pool':
      return d.deepbook.pools.SUI_DBUSDC.pool_id;
    case 'dbusdc_coin_type':
      return d.deepbook.dbusdc_coin_type;
    default:
      throw new Error(`unknown label ${label}`);
  }
}

async function checkJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, text, json };
}

async function main() {
  console.log('Sentry baseline smoke (secret-safe)');

  const labels = [
    'sentry_package',
    'movegate_package',
    'agent',
    'agent_passport',
    'balance_manager',
    'deepbook_sui_dbusdc_pool',
    'dbusdc_coin_type',
  ];
  for (const label of labels) {
    const rootValue = getLabel(deploymentJson, label);
    const coreValue = getLabel(coreDeployment, label);
    const workerValue = getLabel(workerDeployment, label);
    assert(
      `deployment consistency: ${label}`,
      rootValue === coreValue && coreValue === workerValue,
      rootValue
    );
  }

  const frontendEnv = readEnvKeys('.env.local');
  assert('frontend env file exists', frontendEnv.exists, '.env.local');
  assert(
    'frontend points to local Worker',
    frontendEnv.values.get('VITE_WORKER_URL') === WORKER_URL,
    'VITE_WORKER_URL=http://localhost:8787'
  );

  const workerEnv = readEnvKeys('worker/.dev.vars');
  assert('worker env file exists', workerEnv.exists, 'worker/.dev.vars');
  for (const key of REQUIRED_WORKER_KEYS) {
    assert(`worker env key present: ${key}`, workerEnv.keys.has(key), 'key-name only');
  }
  const executionEnabled = workerEnv.values.get('EXECUTION_ENABLED') === 'true';
  console.log(`INFO execution_enabled_true=${executionEnabled}`);

  const frontend = await fetch(FRONTEND_URL);
  const frontendHtml = await frontend.text();
  assert(
    'frontend service reachable on reserved port',
    frontend.status === 200 &&
      frontendHtml.includes('Sentry') &&
      frontendHtml.includes('/src/main.jsx'),
    `${FRONTEND_URL} status=${frontend.status}`
  );
  const frontendApi = await fetch(`${FRONTEND_URL}/src/api.js`);
  const frontendApiSource = await frontendApi.text();
  assert(
    'frontend Vite env exposes local Worker URL',
    frontendApiSource.includes('"VITE_WORKER_URL": "http://localhost:8787"'),
    'Vite source sanitized'
  );

  const workerRoot = await checkJson(`${WORKER_URL}/`);
  assert(
    'worker service reachable on reserved port',
    workerRoot.status === 200 && workerRoot.json?.service === 'sentry-worker',
    `${WORKER_URL} status=${workerRoot.status}`
  );

  const client = getClient();
  const checkpoint = await client.getLatestCheckpointSequenceNumber();
  assert(
    'Sui Testnet fullnode reachable',
    Number(checkpoint) > 0,
    `latest_checkpoint=${checkpoint}`
  );

  const objectChecks = [
    ['Sentry package', DEPLOYMENT.sentry.package_id],
    ['agent passport', DEPLOYMENT.agent.passport_id],
    ['BalanceManager', DEPLOYMENT.agent.balance_manager_id],
    ['DeepBook SUI_DBUSDC pool', DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id],
  ];
  for (const [label, id] of objectChecks) {
    const obj = await client.getObject({ id, options: { showType: true, showContent: true } });
    assert(`${label} readable on Testnet`, !!obj.data && !obj.error, id);
  }
  const agentBalances = await client.getAllBalances({ owner: DEPLOYMENT.agent.address });
  assert(
    'agent account readable on Testnet',
    Array.isArray(agentBalances),
    DEPLOYMENT.agent.address
  );

  const ticker = await checkJson(`${INDEXER}/ticker`);
  assert(
    'DeepBook Testnet indexer reachable',
    ticker.status === 200 && !!ticker.json?.SUI_DBUSDC,
    'ticker includes SUI_DBUSDC'
  );
  const market = ticker.json?.SUI_DBUSDC;
  console.log(
    `INFO SUI_DBUSDC last_price=${market?.last_price ?? 'n/a'} base_volume=${market?.base_volume ?? 'n/a'}`
  );

  const [dbusdcBalance, deepBalance] = await Promise.all([
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.dbusdc_coin_type),
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.deep_coin_type),
  ]);
  console.log(
    `INFO BalanceManager DBUSDC_raw=${dbusdcBalance.toString()} DEEP_raw=${deepBalance.toString()}`
  );

  const gateDecision = decideTick({
    wrapper: {
      mandate_id: '0x1',
      pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
      budget_ceiling: '1000000',
      spent_amount: '0',
      max_slippage_bps: 100,
    },
    mandate: { id: '0x1', revoked: false, expires_at_ms: Date.now() + 3600_000 },
    triggerMet: true,
    proposed: {
      pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
      amount: '200000',
      estimated_slippage_bps: 80,
    },
    nowMs: Date.now(),
    executionEnabled: false,
  });
  assert(
    'execution-disabled gate blocks live execution',
    gateDecision.action === 'blocked' && gateDecision.code === 'EXECUTION_DISABLED',
    gateDecision.code
  );
  assert(
    'unfunded BalanceManager is not execution-ready',
    dbusdcBalance === 0n || deepBalance === 0n,
    'funding blocker remains explicit; no execution tx submitted'
  );

  if (failures > 0) {
    console.log(`Baseline smoke failed: ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('Baseline smoke passed with secret-safe evidence only.');
}

main().catch((e) => {
  console.error(`Baseline smoke error: ${e?.message || e}`);
  process.exit(1);
});
