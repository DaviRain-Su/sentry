#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  getAuthorizationRegistrySnapshot,
  validateTaskAuthorization,
} from '../../core/authorization.js';
import { buildLocalInventorySnapshot, getInventoryAdapterRegistry } from '../../core/inventory.js';
import { getVenueById, getVenueCatalogSnapshot } from '../../core/venues.js';
import { dispatchAgentTask, parseCommandLine } from './agent-dispatcher.mjs';
import {
  loadAgentRegistry,
  parseCapabilityList,
  resolveAgentDispatchCommand,
  removeRegisteredAgent,
  upsertRegisteredAgent,
} from './local-agent-registry.mjs';
import { probeAgentRegistry } from './local-agent-capability-probe.mjs';
import { verifyDispatchReceipt } from './dispatch-receipt-verifier.mjs';
import { getLocalDispatchReadiness } from './local-dispatch-readiness.mjs';
import {
  loadLocalSecretStore,
  parseBoolean,
  parsePermissionList,
  removeVenueKeyMetadata,
  upsertVenueKeyMetadata,
} from './local-venue-store.mjs';
import {
  loadLocalPolicyStore,
  loadLocalPolicyTickSnapshot,
  markLocalPolicyTick,
  parsePolicyVenueList,
  resolveLocalPolicyStorePath,
  updateLocalPolicyStatus,
  upsertLocalPolicy,
} from './local-policy-store.mjs';
import { buildDuePolicyTaskPlan } from './local-policy-task-planner.mjs';
import { runDuePolicyTasks } from './local-policy-runner.mjs';
import { createLocalPolicyLoop, DEFAULT_POLICY_LOOP_INTERVAL_MS } from './local-policy-loop.mjs';
import {
  redactCredentialResolution,
  resolveOkxCredentialsFromEnv,
} from './local-credential-resolver.mjs';
import { buildLiveInventorySnapshot } from './live-inventory-sync.mjs';
import {
  OKX_KEYCHAIN_FIELDS,
  checkOkxKeychainStatus,
  storeOkxCredentialsInteractively,
} from './os-keychain.mjs';
import {
  DEFAULT_HYPERLIQUID_NONCE_STORE_PATH,
  resolveHyperliquidNonceStorePath,
} from './hyperliquid-nonce-store.mjs';
import {
  appendLocalActivityEvent,
  buildLocalActivityEvent,
  readLocalActivityLog,
  resolveLocalActivityLogPath,
} from './local-activity-log.mjs';
import { buildLocalSignerProbeSnapshot } from './local-signer-probe.mjs';

const VERSION = '0.1.0';
const DEFAULT_WORKER_URL = 'http://localhost:8787';
const DEFAULT_AGENT_ID = 'default';
const HEARTBEAT_MS = 30_000;
const DAEMON_CAPABILITIES = [
  'agent.status',
  'agent.start',
  'agent.stop',
  'agent.dispatch',
  'agent.registry',
  'agent.probe',
  'stdio.output',
  'venue.catalog',
  'authorization.registry',
  'authorization.validate',
  'secret.store',
  'inventory.adapters',
  'inventory.sync',
  'signer.probe',
  'activity.tail',
  'policy.local',
  'policy.tick',
  'policy.plan',
  'policy.run_once',
  'policy.loop',
];

function readArg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(`Sentry local daemon ${VERSION}

Usage:
  sentry-daemon --pairing-code <pair_xxx> [options]

Options:
  --worker-url <url>    Worker API base URL. Default: ${DEFAULT_WORKER_URL}
  --agent-id <id>       Local agent id. Default: ${DEFAULT_AGENT_ID}
  --pairing-code <code> One-time pairing code from the Dashboard.
  --relay-token <token> Short-lived relay token for an already paired daemon.
  --agent-cmd <cmd>     External agent command to start on agent.start.
  --agent-registry <p>  Local external Agent registry path. Default: ~/.sentry/agents.json
  --venue-config <path> Local venue key metadata path. Default: ~/.sentry/venues.json
  --policy-store <path> Local policy metadata path. Default: ~/.sentry/policies.json
  --activity-log <path> Local activity JSONL path. Default: ~/.sentry/activity.jsonl
  --hyperliquid-nonce-store <p>
                        Local Hyperliquid signed-submit nonce store path. Default: ${DEFAULT_HYPERLIQUID_NONCE_STORE_PATH}
  --policy-loop         Start the local policy loop after daemon startup. Default: off.
  --policy-loop-interval-ms <ms>
                        Local policy loop interval. Default: ${DEFAULT_POLICY_LOOP_INTERVAL_MS}
  --policy-loop-check-readiness
                        Loop checks local dispatch readiness but does not dispatch.
  --policy-loop-dispatch
                        Loop may dispatch to registered external Agents. Off unless explicit.
  --policy-loop-no-mark Do not advance due policy tick timestamps after loop runs.
  --no-reconnect        Exit instead of reconnecting when the WebSocket closes.
  --print-config        Print redacted runtime config and exit.
  --help                Show this help.

Agent registry:
  sentry-daemon agent list [--json] [--agent-registry <path>]
  sentry-daemon agent register codex --command "codex" --capabilities read_context,return_evidence
  sentry-daemon agent probe [codex] [--timeout-ms 3000] [--json]
  sentry-daemon agent remove codex

Venue key metadata:
  sentry-daemon venue list [--json] [--venue-config <path>]
  sentry-daemon venue add --venue okx --key-handle okx_key_xxxx --account-ref okx:subaccount:name --permissions read,place_order,cancel_order --ip-allowlist true
  sentry-daemon venue add --venue hyperliquid --key-handle hl_agent_xxxx --read-account-address 0x... --agent-wallet-address 0x... --permissions read,place_order,cancel_order,set_leverage
  sentry-daemon venue remove --venue okx --key-handle okx_key_xxxx
  sentry-daemon venue credentials status --venue okx --key-handle okx_key_xxxx
  sentry-daemon venue credentials store --venue okx --key-handle okx_key_xxxx [--field apiKey]
  sentry-daemon signer probe [--scope solana-mainnet,ethereum-mainnet] [--json]
  sentry-daemon activity tail [--limit 50] [--json]
  sentry-daemon policy list [--json] [--policy-store <path>]
  sentry-daemon policy add --policy-id funding-arb-1 --target-venues hyperliquid,okx --target-agent codex
  sentry-daemon policy tick [--limit 50] [--mark] [--json]
  sentry-daemon policy plan [--limit 50] [--json]
  sentry-daemon policy run-once [--check-readiness] [--dispatch] [--mark] [--json]
  sentry-daemon policy pause|resume|revoke <policy-id>

Examples:
  npx @sentry/daemon --pairing-code pair_xxxx --worker-url https://sentry.example.workers.dev
  sentry-daemon --pairing-code pair_xxxx --agent-cmd "codex"
  sentry-daemon agent register codex --command "codex"
  sentry-daemon venue add --venue hyperliquid --key-handle hl_agent_xxxx --read-account-address 0x... --agent-wallet-address 0x... --permissions read,place_order,cancel_order,set_leverage
  sentry-daemon venue credentials store --venue okx --key-handle okx_key_xxxx
`);
}

function redact(value) {
  if (!value) return null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function workerToWebSocketUrl(workerUrl, agentId, token) {
  const base = workerUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/api/local-agents/${encodeURIComponent(agentId)}/connect`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('token', token);
  return url.toString();
}

async function pairWithWorker({ workerUrl, pairingCode, agentId }) {
  const url = `${workerUrl.replace(/\/+$/, '')}/api/local-agents/pair`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pairing_code: pairingCode,
      agent_id: agentId,
      device_name: process.env.SENTRY_DEVICE_NAME || `${process.platform}-${process.pid}`,
      supported_capabilities: DAEMON_CAPABILITIES,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.code || `Pairing failed with ${response.status}`);
  }
  return body;
}

function truncate(value, max = 4000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function makeEnvelope(kind, payload = {}, extra = {}) {
  return {
    kind,
    message_id: `${kind}_${crypto.randomUUID()}`,
    issued_at: new Date().toISOString(),
    payload,
    ...extra,
  };
}

function defaultPermissionsForVenue(venueId) {
  const venue = getVenueById(venueId);
  return (venue?.capabilities || []).filter((capability) => capability !== 'withdraw');
}

function venueCliInput() {
  const venueId = readArg('--venue', readArg('--venue-id'));
  const permissions = parsePermissionList(
    readArg('--permissions', defaultPermissionsForVenue(venueId).join(','))
  );
  const agentWalletPermissions = parsePermissionList(
    readArg('--agent-wallet-permissions', permissions.join(','))
  );
  return {
    venue_id: venueId,
    key_handle: readArg('--key-handle'),
    display_handle: readArg('--display-handle'),
    account_ref: readArg('--account-ref'),
    read_account_address: readArg('--read-account-address'),
    agent_wallet_address: readArg('--agent-wallet-address'),
    agent_wallet_grant: {
      status: readArg('--agent-wallet-status', readArg('--grant-status', 'active')),
      source: readArg(
        '--agent-wallet-proof-source',
        readArg('--grant-source', 'metadata_attestation')
      ),
      verified_at: readArg('--agent-wallet-verified-at', readArg('--grant-verified-at')),
      permissions: agentWalletPermissions,
      revoked_at: readArg('--agent-wallet-revoked-at', readArg('--grant-revoked-at')),
      expires_at: readArg('--agent-wallet-expires-at', readArg('--grant-expires-at')),
    },
    storage: readArg('--storage', 'os_keychain'),
    permissions,
    ip_allowlist: parseBoolean(readArg('--ip-allowlist'), false),
    rotation_days: Number(readArg('--rotation-days', 30)),
    status: readArg('--status', 'linked'),
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function agentCliInput() {
  const positionalId =
    process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
  return {
    agent_id: readArg('--agent-id', readArg('--id', positionalId)),
    display_name: readArg('--display-name', readArg('--name')),
    command: readArg('--command', readArg('--agent-cmd')),
    capabilities: parseCapabilityList(readArg('--capabilities')),
    enabled: !hasArg('--disabled'),
  };
}

async function handleAgentCli() {
  const action = process.argv[3] || 'list';
  const configPath = readArg('--agent-registry', process.env.SENTRY_AGENT_REGISTRY);
  const options = { configPath };
  const json = hasArg('--json');

  if (action === 'list') {
    printJson(await loadAgentRegistry(options));
    return;
  }

  if (action === 'probe') {
    const positionalId =
      process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
    const registry = await loadAgentRegistry(options);
    const result = await probeAgentRegistry(registry, {
      agent_id: readArg('--agent-id', readArg('--id', positionalId)),
      timeout_ms: Number(readArg('--timeout-ms', 3000)),
    });
    printJson(result);
    process.exitCode = result.status === 'blocked' ? 1 : 0;
    return;
  }

  if (action === 'register') {
    const result = await upsertRegisteredAgent(agentCliInput(), options);
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`Registered ${result.agent.agent_id} at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (action === 'remove') {
    const positionalId =
      process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
    const result = await removeRegisteredAgent(
      {
        agent_id: readArg('--agent-id', readArg('--id', positionalId)),
      },
      options
    );
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`${result.removed ? 'Removed' : 'No matching'} agent at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  console.error(`Unsupported agent command: ${action}`);
  process.exitCode = 1;
}

function normalizeCredentialField(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/[-_ ]+/g, '')
    .toLowerCase();
  if (normalized === 'apikey') return 'apiKey';
  if (normalized === 'secretkey') return 'secretKey';
  if (normalized === 'passphrase') return 'passphrase';
  return null;
}

function parseCredentialFields() {
  const raw = readArg('--field', readArg('--fields'));
  if (!raw) return { fields: [], invalid: [] };
  const requested = String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const normalized = requested.map(normalizeCredentialField);
  return {
    fields: normalized.filter(Boolean),
    invalid: requested.filter((_item, index) => !normalized[index]),
  };
}

async function findLocalVenueKey(options) {
  const venueId = readArg('--venue', readArg('--venue-id'));
  const keyHandle = readArg('--key-handle');
  const secretStore = await loadLocalSecretStore(options);
  const key = (secretStore.keys || []).find(
    (candidate) => candidate.venue_id === venueId && candidate.key_handle === keyHandle
  );
  if (!venueId || !keyHandle) {
    return {
      status: 'error',
      code: 'VENUE_AND_KEY_REQUIRED',
      message: 'Pass --venue okx --key-handle <handle>.',
      secretStore,
    };
  }
  if (!key || key.key_handle !== keyHandle) {
    return {
      status: 'error',
      code: 'VENUE_KEY_MISSING',
      message: `No local metadata found for ${venueId}:${keyHandle}. Add it with sentry-daemon venue add first.`,
      secretStore,
    };
  }
  return { status: 'ok', key, secretStore };
}

async function handleVenueCredentialsCli(action, options, json) {
  const found = await findLocalVenueKey(options);
  if (found.status !== 'ok') {
    printJson(found);
    process.exitCode = 1;
    return;
  }
  if (found.key.venue_id !== 'okx') {
    printJson({
      status: 'error',
      code: 'VENUE_CREDENTIALS_UNSUPPORTED',
      message: 'Only OKX local credential checks are implemented in this daemon build.',
    });
    process.exitCode = 1;
    return;
  }

  if (action === 'status') {
    const envResolution = resolveOkxCredentialsFromEnv(found.key, process.env);
    const keychain = await checkOkxKeychainStatus(found.key);
    const env =
      envResolution.status === 'ok'
        ? redactCredentialResolution({ ...envResolution, source: 'env' })
        : {
            status: envResolution.status,
            code: envResolution.code,
            missing: envResolution.missing,
          };
    printJson({
      status: env.status === 'ok' || keychain.status === 'ok' ? 'ok' : 'blocked',
      venue_id: found.key.venue_id,
      key_handle: found.key.key_handle,
      env,
      keychain,
      raw_secret_policy: found.secretStore.raw_secret_policy,
    });
    return;
  }

  if (action === 'store') {
    const { fields, invalid } = parseCredentialFields();
    if (invalid.length) {
      printJson({
        status: 'error',
        code: 'BAD_CREDENTIAL_FIELD',
        message: `Unsupported fields: ${invalid.join(', ')}. Supported fields: ${OKX_KEYCHAIN_FIELDS.map((field) => field.field).join(', ')}`,
      });
      process.exitCode = 1;
      return;
    }
    if (!json) {
      const labels = (
        fields.length
          ? OKX_KEYCHAIN_FIELDS.filter((field) => fields.includes(field.field))
          : OKX_KEYCHAIN_FIELDS
      ).map((field) => field.label);
      console.error(`macOS Keychain will prompt for: ${labels.join(', ')}`);
    }
    const result = storeOkxCredentialsInteractively(found.key, { fields });
    printJson(result);
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  printJson({
    status: 'error',
    code: 'UNSUPPORTED_CREDENTIALS_COMMAND',
    message: `Unsupported venue credentials command: ${action}`,
  });
  process.exitCode = 1;
}

async function handleVenueCli() {
  const action = process.argv[3] || 'list';
  const configPath = readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG);
  const options = { configPath };
  const json = hasArg('--json');

  if (action === 'credentials') {
    await handleVenueCredentialsCli(process.argv[4] || 'status', options, json);
    return;
  }

  if (action === 'list') {
    const snapshot = await loadLocalSecretStore(options);
    printJson(snapshot);
    return;
  }

  if (action === 'add') {
    const result = await upsertVenueKeyMetadata(venueCliInput(), options);
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(
        `Linked ${result.key.venue_id} key metadata ${result.key.display_handle} at ${result.path}`
      );
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (action === 'remove') {
    const result = await removeVenueKeyMetadata(
      {
        venue_id: readArg('--venue', readArg('--venue-id')),
        key_handle: readArg('--key-handle'),
      },
      options
    );
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`${result.removed ? 'Removed' : 'No matching'} key metadata at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  console.error(`Unsupported venue command: ${action}`);
  process.exitCode = 1;
}

function parseScopeList(value) {
  if (!value) return null;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function handleSignerCli() {
  const action = process.argv[3] || 'probe';
  if (action !== 'probe') {
    console.error(`Unsupported signer command: ${action}`);
    process.exitCode = 1;
    return;
  }
  const snapshot = await buildLocalSignerProbeSnapshot({
    scope: parseScopeList(readArg('--scope', readArg('--venues'))),
  });
  printJson(snapshot);
  process.exitCode = snapshot.status === 'blocked' ? 1 : 0;
}

async function handleActivityCli() {
  const action = process.argv[3] || 'tail';
  if (action !== 'tail') {
    console.error(`Unsupported activity command: ${action}`);
    process.exitCode = 1;
    return;
  }
  printJson(
    await readLocalActivityLog({
      logPath: readArg('--activity-log', process.env.SENTRY_ACTIVITY_LOG),
      limit: Number(readArg('--limit', 50)),
    })
  );
}

async function readJsonFileArg(flag) {
  const filePath = readArg(flag);
  if (!filePath) return {};
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function policyCliInput(fileInput = {}) {
  const positionalId =
    process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
  const tickIntervalMs = readArg('--tick-interval-ms', fileInput.tick_interval_ms);
  return {
    ...fileInput,
    policy_id: readArg('--policy-id', readArg('--id', fileInput.policy_id || positionalId)),
    display_name: readArg('--display-name', readArg('--name', fileInput.display_name)),
    target_agent: readArg('--target-agent', readArg('--agent-id', fileInput.target_agent)),
    target_venue_ids:
      parsePolicyVenueList(
        readArg(
          '--target-venues',
          readArg('--venues', readArg('--venue', fileInput.target_venue_ids))
        )
      ) || fileInput.target_venue_ids,
    strategy_hash: readArg('--strategy-hash', fileInput.strategy_hash),
    tick_interval_ms: tickIntervalMs === undefined ? undefined : Number(tickIntervalMs),
    next_tick_after: readArg('--next-tick-after', fileInput.next_tick_after),
  };
}

async function handlePolicyCli() {
  const action = process.argv[3] || 'list';
  const configPath = readArg('--policy-store', process.env.SENTRY_POLICY_STORE);
  const options = { configPath };
  const json = hasArg('--json');

  if (action === 'list') {
    printJson(await loadLocalPolicyStore(options));
    return;
  }

  if (action === 'add') {
    const fileInput = await readJsonFileArg('--file');
    const result = await upsertLocalPolicy(policyCliInput(fileInput), options);
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`Registered local policy ${result.policy.policy_id} at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (['pause', 'resume', 'revoke'].includes(action)) {
    const positionalId =
      process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
    const result = await updateLocalPolicyStatus(
      {
        policy_id: readArg('--policy-id', readArg('--id', positionalId)),
        status: action === 'resume' ? 'active' : action === 'pause' ? 'paused' : 'revoked',
      },
      options
    );
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`Updated local policy ${result.policy.policy_id} to ${result.policy.status}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (action === 'tick') {
    const now = readArg('--now', process.env.SENTRY_POLICY_TICK_NOW);
    const snapshot = await loadLocalPolicyTickSnapshot({
      ...options,
      now: now ? new Date(now) : new Date(),
      limit: Number(readArg('--limit', 50)),
    });
    if (hasArg('--mark')) {
      const marked = [];
      for (const policy of snapshot.due_policies) {
        marked.push(
          await markLocalPolicyTick(
            { policy_id: policy.policy_id, status: 'observed_by_cli_tick' },
            { ...options, now: snapshot.observed_at }
          )
        );
      }
      printJson({ ...snapshot, marked });
      return;
    }
    printJson(snapshot);
    return;
  }

  if (action === 'plan') {
    const now = readArg('--now', process.env.SENTRY_POLICY_TICK_NOW);
    const [policyStore, secretStore] = await Promise.all([
      loadLocalPolicyStore({ ...options, now: now ? new Date(now) : new Date() }),
      loadLocalSecretStore({
        configPath: readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG),
      }),
    ]);
    printJson(
      buildDuePolicyTaskPlan({
        policyStore,
        secretStore,
        now: now ? new Date(now) : new Date(),
        limit: Number(readArg('--limit', 50)),
        simulated: !hasArg('--live'),
      })
    );
    return;
  }

  if (action === 'run-once') {
    const now = readArg('--now', process.env.SENTRY_POLICY_TICK_NOW);
    const effectiveNow = now ? new Date(now) : new Date();
    const [policyStore, secretStore, agentRegistry] = await Promise.all([
      loadLocalPolicyStore({ ...options, now: effectiveNow }),
      loadLocalSecretStore({
        configPath: readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG),
      }),
      loadAgentRegistry({
        configPath: readArg('--agent-registry', process.env.SENTRY_AGENT_REGISTRY),
      }),
    ]);
    printJson(
      await runDuePolicyTasks({
        policyStore,
        policyStorePath: configPath,
        secretStore,
        agentRegistry,
        now: effectiveNow,
        limit: Number(readArg('--limit', 50)),
        checkReadiness: hasArg('--check-readiness') || hasArg('--dispatch'),
        dispatch: hasArg('--dispatch'),
        markTicks: hasArg('--mark'),
        defaultAgentCommand: readArg('--agent-cmd', process.env.SENTRY_AGENT_COMMAND || ''),
        timeoutMs: Number(readArg('--timeout-ms', 30_000)),
        verifyReceipt: !hasArg('--no-verify-receipt'),
        verifyHyperliquidLiveGrant: hasArg('--dispatch') && !hasArg('--no-verify-live-grant'),
        requireSignerProbe: hasArg('--require-signer-probe'),
        signerProbeTimeoutMs: Number(readArg('--signer-probe-timeout-ms', 3000)),
        simulated: !hasArg('--live'),
        hyperliquidNonceStorePath: resolveHyperliquidNonceStorePath(
          readArg('--hyperliquid-nonce-store', process.env.SENTRY_HYPERLIQUID_NONCE_STORE)
        ),
      })
    );
    return;
  }

  console.error(`Unsupported policy command: ${action}`);
  process.exitCode = 1;
}

async function main() {
  if (hasArg('--help') || hasArg('-h')) {
    usage();
    return;
  }
  if (process.argv[2] === 'venue') {
    await handleVenueCli();
    return;
  }
  if (process.argv[2] === 'agent') {
    await handleAgentCli();
    return;
  }
  if (process.argv[2] === 'signer') {
    await handleSignerCli();
    return;
  }
  if (process.argv[2] === 'activity') {
    await handleActivityCli();
    return;
  }
  if (process.argv[2] === 'policy') {
    await handlePolicyCli();
    return;
  }
  if (typeof WebSocket !== 'function') {
    console.error(
      'Node.js >=22 is required because this daemon uses the built-in WebSocket client.'
    );
    process.exitCode = 1;
    return;
  }

  const pairingCode = readArg('--pairing-code', process.env.SENTRY_PAIRING_CODE);
  const relayTokenArg = readArg('--relay-token', process.env.SENTRY_RELAY_TOKEN);
  const workerUrl = readArg('--worker-url', process.env.SENTRY_WORKER_URL || DEFAULT_WORKER_URL);
  let agentId = readArg('--agent-id', process.env.SENTRY_AGENT_ID || DEFAULT_AGENT_ID);
  const defaultAgentCommand = readArg('--agent-cmd', process.env.SENTRY_AGENT_COMMAND || '');
  const agentRegistryPath = readArg('--agent-registry', process.env.SENTRY_AGENT_REGISTRY);
  const venueConfigPath = readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG);
  const policyStorePath = resolveLocalPolicyStorePath(
    readArg('--policy-store', process.env.SENTRY_POLICY_STORE)
  );
  const activityLogPath = resolveLocalActivityLogPath(
    readArg('--activity-log', process.env.SENTRY_ACTIVITY_LOG)
  );
  const hyperliquidNonceStorePath = resolveHyperliquidNonceStorePath(
    readArg('--hyperliquid-nonce-store', process.env.SENTRY_HYPERLIQUID_NONCE_STORE)
  );
  const policyLoopConfig = {
    enabled: hasArg('--policy-loop') || parseBoolean(process.env.SENTRY_POLICY_LOOP, false),
    intervalMs: Number(
      readArg(
        '--policy-loop-interval-ms',
        process.env.SENTRY_POLICY_LOOP_INTERVAL_MS || DEFAULT_POLICY_LOOP_INTERVAL_MS
      )
    ),
    checkReadiness:
      hasArg('--policy-loop-check-readiness') ||
      hasArg('--policy-loop-dispatch') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_CHECK_READINESS, false),
    dispatch:
      hasArg('--policy-loop-dispatch') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_DISPATCH, false),
    markTicks:
      !hasArg('--policy-loop-no-mark') &&
      parseBoolean(process.env.SENTRY_POLICY_LOOP_MARK_TICKS, true),
    runImmediately:
      hasArg('--policy-loop-run-immediately') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_RUN_IMMEDIATELY, false),
  };
  const noReconnect = hasArg('--no-reconnect');

  const config = {
    workerUrl,
    agentId,
    pairingCode: redact(pairingCode),
    relayToken: redact(relayTokenArg),
    defaultAgentCommand: defaultAgentCommand || null,
    agentRegistryPath: agentRegistryPath || '~/.sentry/agents.json',
    venueConfigPath: venueConfigPath || '~/.sentry/venues.json',
    policyStorePath,
    activityLogPath,
    hyperliquidNonceStorePath,
    policyLoop: {
      enabled: policyLoopConfig.enabled,
      intervalMs: policyLoopConfig.intervalMs,
      checkReadiness: policyLoopConfig.checkReadiness,
      dispatch: policyLoopConfig.dispatch,
      markTicks: policyLoopConfig.markTicks,
      runImmediately: policyLoopConfig.runImmediately,
    },
    noReconnect,
  };

  if (hasArg('--print-config')) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (!pairingCode && !relayTokenArg) {
    console.error(
      'Missing pairing credentials. Pass --pairing-code <pair_xxx>, or --relay-token for an already paired daemon.'
    );
    process.exitCode = 1;
    return;
  }

  let relayToken = relayTokenArg;

  let ws = null;
  let reconnectAttempt = 0;
  let heartbeatTimer = null;
  let child = null;
  let childCommand = null;
  let childStartedAt = null;

  function log(event, detail = {}) {
    console.log(JSON.stringify({ t: new Date().toISOString(), event, ...detail }));
  }

  async function recordActivity(input = {}) {
    const event = buildLocalActivityEvent(input);
    const result = await appendLocalActivityEvent(event, { logPath: activityLogPath }).catch(
      (error) => ({
        status: 'error',
        code: 'ACTIVITY_LOG_WRITE_FAILED',
        message: error?.message || String(error),
      })
    );
    if (result.status !== 'ok') log('activity.write_failed', result);
    return result;
  }

  async function loadPolicyRunContext() {
    const [policyStore, secretStore, agentRegistry] = await Promise.all([
      loadLocalPolicyStore({ configPath: policyStorePath }),
      loadLocalSecretStore({ configPath: venueConfigPath }),
      loadAgentRegistry({ configPath: agentRegistryPath }),
    ]);
    return {
      policyStore,
      policyStorePath,
      secretStore,
      agentRegistry,
      defaultAgentCommand,
      hyperliquidNonceStorePath,
      recordActivity,
    };
  }

  const policyLoop = createLocalPolicyLoop({
    loadContext: loadPolicyRunContext,
    runOnce: runDuePolicyTasks,
  });

  function activeProcess() {
    if (!child) return null;
    return {
      pid: child.pid,
      command: childCommand,
      started_at: childStartedAt,
    };
  }

  async function statusPayload() {
    const secretStore = await loadLocalSecretStore({ configPath: venueConfigPath });
    const agentRegistry = await loadAgentRegistry({ configPath: agentRegistryPath });
    const policyStore = await loadLocalPolicyStore({ configPath: policyStorePath });
    const policyTick = await loadLocalPolicyTickSnapshot({ configPath: policyStorePath });
    const inventory = buildLocalInventorySnapshot({ secretStore });
    return {
      daemon_version: VERSION,
      pid: process.pid,
      uptime_seconds: Math.round(process.uptime()),
      active_process: activeProcess(),
      capabilities: DAEMON_CAPABILITIES,
      agent_registry: {
        status: agentRegistry.status,
        agent_count: agentRegistry.agent_count,
        enabled_count: agentRegistry.enabled_count,
        metadata_path: agentRegistry.metadata_path,
        config_status: agentRegistry.config_status,
      },
      venues: getVenueCatalogSnapshot().readiness,
      secret_store: {
        status: secretStore.status,
        key_count: secretStore.key_count,
        metadata_path: secretStore.metadata_path,
        config_status: secretStore.config_status,
      },
      hyperliquid_nonce_store: {
        status: 'enabled',
        path: hyperliquidNonceStorePath,
      },
      local_activity: {
        status: 'enabled',
        log_path: activityLogPath,
      },
      policy_manager: {
        status: policyStore.status,
        policy_count: policyStore.policy_count,
        active_count: policyStore.active_count,
        due_count: policyTick.due_count,
        metadata_path: policyStore.metadata_path,
        config_status: policyStore.config_status,
      },
      policy_loop: policyLoop.status(),
      inventory: {
        status: inventory.status,
        source_count: inventory.source_count,
        access_issue_count: inventory.access_issues.length,
      },
      authorization: {
        ready_for_dispatch: getAuthorizationRegistrySnapshot().ready_for_dispatch,
      },
      target_venue_ids: getVenueCatalogSnapshot().target_venue_ids,
    };
  }

  function send(kind, payload = {}, extra = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(makeEnvelope(kind, payload, extra)));
    return true;
  }

  function sendResult(original, payload) {
    send('command_result', payload, {
      idempotency_key: original.idempotency_key,
      payload: {
        command_message_id: original.message_id ?? null,
        ...payload,
      },
    });
  }

  function startExternalAgent(commandLine) {
    if (child) {
      return { status: 'ok', already_running: true, active_process: activeProcess() };
    }
    const parts = parseCommandLine(commandLine || defaultAgentCommand);
    if (!parts.length) {
      return {
        status: 'error',
        code: 'AGENT_COMMAND_REQUIRED',
        message: 'agent.start requires payload.command or --agent-cmd.',
      };
    }
    const [cmd, ...args] = parts;
    childCommand = [cmd, ...args].join(' ');
    childStartedAt = new Date().toISOString();
    child = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    child.stdout.on('data', (chunk) => {
      send('agent.output', {
        stream: 'stdout',
        pid: child?.pid ?? null,
        text: truncate(chunk.toString()),
      });
    });
    child.stderr.on('data', (chunk) => {
      send('agent.output', {
        stream: 'stderr',
        pid: child?.pid ?? null,
        text: truncate(chunk.toString()),
      });
    });
    child.on('exit', (code, signal) => {
      send('agent.output', {
        stream: 'system',
        pid: child?.pid ?? null,
        text: `process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`,
      });
      child = null;
      childCommand = null;
      childStartedAt = null;
    });
    return { status: 'ok', active_process: activeProcess() };
  }

  function stopExternalAgent() {
    if (!child) return { status: 'ok', already_stopped: true };
    const stopped = child.kill('SIGTERM');
    return { status: 'ok', stopping: stopped, active_process: activeProcess() };
  }

  async function handleCommand(message) {
    const payload = message.payload || {};
    const type = payload.type;
    send('command_ack', {
      command_message_id: message.message_id ?? null,
      type,
      accepted: true,
    });
    if (type === 'agent.status') {
      sendResult(message, { status: 'ok', agent: await statusPayload() });
      return;
    }
    if (type === 'agent.start') {
      sendResult(message, startExternalAgent(payload.command));
      return;
    }
    if (type === 'agent.stop') {
      sendResult(message, stopExternalAgent());
      return;
    }
    if (type === 'agent.registry') {
      sendResult(message, await loadAgentRegistry({ configPath: agentRegistryPath }));
      return;
    }
    if (type === 'agent.probe') {
      const registry = await loadAgentRegistry({ configPath: agentRegistryPath });
      sendResult(
        message,
        await probeAgentRegistry(registry, {
          agent_id: payload.agent_id || payload.id,
          timeout_ms: Number(payload.timeout_ms || 3000),
        })
      );
      return;
    }
    if (type === 'agent.dispatch') {
      const registry = await loadAgentRegistry({ configPath: agentRegistryPath });
      const commandResolution = resolveAgentDispatchCommand({
        payload,
        registry,
        defaultAgentCommand,
      });
      if (commandResolution.status !== 'ok') {
        const blocked = {
          status: 'error',
          code: commandResolution.code,
          message: commandResolution.message,
          local_decision: 'blocked_before_dispatch',
        };
        await recordActivity({
          type: 'agent.dispatch.blocked',
          task: payload.task,
          commandMessageId: message.message_id ?? null,
          ...blocked,
        });
        sendResult(message, blocked);
        return;
      }
      const secretStore = await loadLocalSecretStore({ configPath: venueConfigPath });
      const allowPlannedDispatch = Boolean(payload.allow_planned_dispatch);
      const verifyHyperliquidLiveGrant = payload.verify_live_grant !== false;
      const requireSignerProbe = Boolean(payload.require_signer_probe);
      const localDispatchReadiness = allowPlannedDispatch
        ? {
            status: 'skipped',
            reason: 'allow_planned_dispatch',
            ready_venue_ids: [],
          }
        : await getLocalDispatchReadiness({
            task: payload.task,
            secretStore,
            verifyHyperliquidLiveGrant,
            requireSignerProbe,
            signerProbeTimeoutMs: Number(payload.signer_probe_timeout_ms || 3000),
          });
      if (localDispatchReadiness.status === 'error') {
        await recordActivity({
          type: 'agent.dispatch.blocked',
          task: payload.task,
          commandMessageId: message.message_id ?? null,
          dispatch: localDispatchReadiness,
          localDispatchReadiness,
        });
        sendResult(message, localDispatchReadiness);
        return;
      }
      const dispatch = await dispatchAgentTask({
        task: payload.task,
        commandLine: commandResolution.command,
        timeoutMs: Number(payload.timeout_ms || 30_000),
        allowPlanned: allowPlannedDispatch,
        localDispatchReadyVenues: localDispatchReadiness.ready_venue_ids || [],
      });
      const verified =
        payload.verify_receipt === false
          ? {
              status: 'ok',
              dispatch,
              receipt_verification: { status: 'skipped', reason: 'disabled_by_command' },
            }
          : await verifyDispatchReceipt({
              task: payload.task,
              dispatch,
              secretStore,
              simulated: Boolean(payload.simulated),
              hyperliquidNonceStorePath,
              verifyHyperliquidLiveGrant,
            });
      const finalDispatch =
        verified.status === 'ok'
          ? {
              ...verified.dispatch,
              receipt_verification: verified.receipt_verification,
              local_dispatch_readiness: localDispatchReadiness,
            }
          : {
              ...verified.dispatch,
              status: 'error',
              code: verified.code,
              message: verified.message,
              local_decision: verified.local_decision,
              receipt_verification: verified.receipt_verification,
              local_dispatch_readiness: localDispatchReadiness,
            };
      await recordActivity({
        type: 'agent.dispatch',
        task: payload.task,
        commandMessageId: message.message_id ?? null,
        dispatch: finalDispatch,
        localDispatchReadiness,
        receiptVerification: finalDispatch.receipt_verification,
        registeredAgent: commandResolution.agent_id
          ? {
              agent_id: commandResolution.agent_id,
              capabilities: commandResolution.capabilities,
            }
          : null,
      });
      sendResult(
        message,
        commandResolution.agent_id
          ? {
              ...finalDispatch,
              registered_agent: {
                agent_id: commandResolution.agent_id,
                capabilities: commandResolution.capabilities,
              },
            }
          : {
              ...finalDispatch,
              unregistered_command: true,
            }
      );
      return;
    }
    if (type === 'venue.catalog') {
      sendResult(message, getVenueCatalogSnapshot());
      return;
    }
    if (type === 'authorization.registry') {
      sendResult(message, getAuthorizationRegistrySnapshot());
      return;
    }
    if (type === 'authorization.validate') {
      sendResult(
        message,
        validateTaskAuthorization(payload.task || payload, { allow_planned: false })
      );
      return;
    }
    if (type === 'secret.store') {
      sendResult(message, await loadLocalSecretStore({ configPath: venueConfigPath }));
      return;
    }
    if (type === 'inventory.adapters') {
      sendResult(message, getInventoryAdapterRegistry());
      return;
    }
    if (type === 'inventory.sync') {
      const secretStore = await loadLocalSecretStore({ configPath: venueConfigPath });
      const scope = Array.isArray(payload.scope) ? payload.scope : null;
      const snapshot = payload.live
        ? await buildLiveInventorySnapshot({
            secretStore,
            scope,
            okxCcy: payload.okx_ccy,
            simulated: Boolean(payload.simulated),
          })
        : buildLocalInventorySnapshot({
            secretStore,
            scope,
          });
      sendResult(message, snapshot);
      return;
    }
    if (type === 'signer.probe') {
      sendResult(
        message,
        await buildLocalSignerProbeSnapshot({
          scope: Array.isArray(payload.scope) ? payload.scope : null,
          timeoutMs: Number(payload.timeout_ms || 3000),
        })
      );
      return;
    }
    if (type === 'activity.tail') {
      sendResult(
        message,
        await readLocalActivityLog({
          logPath: activityLogPath,
          limit: Number(payload.limit || 50),
        })
      );
      return;
    }
    if (type === 'policy.local.list') {
      sendResult(message, await loadLocalPolicyStore({ configPath: policyStorePath }));
      return;
    }
    if (type === 'policy.local.tick') {
      const snapshot = await loadLocalPolicyTickSnapshot({
        configPath: policyStorePath,
        limit: Number(payload.limit || 50),
      });
      if (payload.mark === true) {
        const marked = [];
        for (const policy of snapshot.due_policies) {
          marked.push(
            await markLocalPolicyTick(
              { policy_id: policy.policy_id, status: 'observed_by_remote_tick' },
              { configPath: policyStorePath, now: snapshot.observed_at }
            )
          );
        }
        sendResult(message, { ...snapshot, marked });
        return;
      }
      sendResult(message, snapshot);
      return;
    }
    if (type === 'policy.local.plan') {
      const [policyStore, secretStore] = await Promise.all([
        loadLocalPolicyStore({ configPath: policyStorePath }),
        loadLocalSecretStore({ configPath: venueConfigPath }),
      ]);
      sendResult(
        message,
        buildDuePolicyTaskPlan({
          policyStore,
          secretStore,
          limit: Number(payload.limit || 50),
          simulated: payload.simulated !== false,
        })
      );
      return;
    }
    if (type === 'policy.local.run_once') {
      const [policyStore, secretStore, agentRegistry] = await Promise.all([
        loadLocalPolicyStore({ configPath: policyStorePath }),
        loadLocalSecretStore({ configPath: venueConfigPath }),
        loadAgentRegistry({ configPath: agentRegistryPath }),
      ]);
      sendResult(
        message,
        await runDuePolicyTasks({
          policyStore,
          policyStorePath,
          secretStore,
          agentRegistry,
          limit: Number(payload.limit || 50),
          checkReadiness: Boolean(payload.check_readiness || payload.dispatch),
          dispatch: Boolean(payload.dispatch),
          markTicks: payload.mark === true,
          defaultAgentCommand,
          timeoutMs: Number(payload.timeout_ms || 30_000),
          verifyReceipt: payload.verify_receipt !== false,
          verifyHyperliquidLiveGrant:
            Boolean(payload.dispatch) && payload.verify_live_grant !== false,
          requireSignerProbe: Boolean(payload.require_signer_probe),
          signerProbeTimeoutMs: Number(payload.signer_probe_timeout_ms || 3000),
          simulated: payload.simulated !== false,
          hyperliquidNonceStorePath,
          recordActivity: (input) =>
            recordActivity({
              commandMessageId: message.message_id ?? null,
              ...input,
            }),
        })
      );
      return;
    }
    if (type === 'policy.local.loop.status') {
      sendResult(message, {
        status: 'ok',
        policy_loop: policyLoop.status(),
      });
      return;
    }
    if (type === 'policy.local.loop.start') {
      sendResult(
        message,
        policyLoop.start({
          interval_ms: payload.interval_ms,
          limit: payload.limit,
          check_readiness: payload.check_readiness,
          dispatch: payload.dispatch,
          mark: payload.mark,
          verify_receipt: payload.verify_receipt,
          verify_live_grant: payload.verify_live_grant,
          require_signer_probe: payload.require_signer_probe,
          signer_probe_timeout_ms: payload.signer_probe_timeout_ms,
          timeout_ms: payload.timeout_ms,
          simulated: payload.simulated,
          run_immediately: payload.run_immediately,
        })
      );
      return;
    }
    if (type === 'policy.local.loop.stop') {
      sendResult(
        message,
        policyLoop.stop({
          reason: payload.reason || 'remote_command',
        })
      );
      return;
    }
    if (type === 'policy.local.loop.run_now') {
      sendResult(
        message,
        await policyLoop.runNow({
          reason: 'remote_command',
          limit: payload.limit,
          check_readiness: payload.check_readiness,
          dispatch: payload.dispatch,
          mark: payload.mark,
          verify_receipt: payload.verify_receipt,
          verify_live_grant: payload.verify_live_grant,
          require_signer_probe: payload.require_signer_probe,
          signer_probe_timeout_ms: payload.signer_probe_timeout_ms,
          timeout_ms: payload.timeout_ms,
          simulated: payload.simulated,
        })
      );
      return;
    }
    if (['policy.pause', 'policy.resume', 'policy.revoke'].includes(type)) {
      const status =
        type === 'policy.resume' ? 'active' : type === 'policy.pause' ? 'paused' : 'revoked';
      const result = await updateLocalPolicyStatus(
        { policy_id: payload.policy_id || payload.id, status },
        { configPath: policyStorePath }
      );
      await recordActivity({
        type,
        task: { policy_id: payload.policy_id || payload.id },
        commandMessageId: message.message_id ?? null,
        status: result.status,
        code: result.code || null,
        message:
          result.status === 'ok'
            ? `Local policy ${result.policy.policy_id} set to ${result.policy.status}`
            : result.message,
        local_decision:
          result.status === 'ok' ? 'policy_state_updated' : 'blocked_before_policy_update',
      });
      sendResult(message, result);
      return;
    }
    sendResult(message, {
      status: 'error',
      code: 'UNSUPPORTED_REMOTE_COMMAND',
      message: `Unsupported command: ${type}`,
    });
  }

  function connect() {
    const wsUrl = workerToWebSocketUrl(workerUrl, agentId, relayToken);
    log('bridge.connecting', { workerUrl, agentId, relayToken: redact(relayToken) });
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      log('bridge.connected', { agentId });
      void statusPayload().then((payload) => send('hello', payload));
      heartbeatTimer = setInterval(() => {
        void statusPayload().then((payload) => send('heartbeat', payload));
      }, HEARTBEAT_MS);
    });
    ws.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        log('bridge.bad_json');
        return;
      }
      if (message.kind === 'command') {
        void handleCommand(message).catch((error) => {
          log('command.error', { message: error?.message || String(error) });
          sendResult(message, {
            status: 'error',
            code: 'COMMAND_FAILED',
            message: error?.message || String(error),
          });
        });
      }
      if (message.kind === 'session_accepted')
        log('bridge.session_accepted', message.payload || {});
    });
    ws.addEventListener('close', (event) => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      log('bridge.closed', { code: event.code, reason: event.reason || null });
      if (noReconnect) return;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => {
      log('bridge.error');
    });
  }

  if (pairingCode) {
    log('bridge.pairing', { workerUrl, pairingCode: redact(pairingCode) });
    const paired = await pairWithWorker({ workerUrl, pairingCode, agentId });
    agentId = paired.agent_id || agentId;
    relayToken = paired.relay_token;
    log('bridge.paired', {
      agentId,
      relayToken: redact(relayToken),
      relayTokenExpiresAt: paired.relay_token_expires_at,
    });
  }

  if (policyLoopConfig.enabled) {
    const started = policyLoop.start({
      intervalMs: policyLoopConfig.intervalMs,
      checkReadiness: policyLoopConfig.checkReadiness,
      dispatch: policyLoopConfig.dispatch,
      markTicks: policyLoopConfig.markTicks,
      runImmediately: policyLoopConfig.runImmediately,
    });
    log('policy.loop.started', started.policy_loop);
  }

  connect();
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
