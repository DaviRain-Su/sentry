#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import {
  buildAuthorizationStateSnapshot,
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
  markVenueKeyMetadataRevoked,
  markVenueKeyMetadataRotated,
  parseBoolean,
  parsePermissionList,
  removeVenueKeyMetadata,
  upsertVenueKeyMetadata,
} from './local-venue-store.mjs';
import {
  loadLocalWalletStore,
  markWalletReferenceRevoked,
  removeWalletReference,
  resolveWalletConfigPath,
  upsertWalletReference,
} from './local-wallet-store.mjs';
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
  isRevokedCloseEvent,
  isSessionRevokedMessage,
  shouldReconnectBridge,
} from './daemon-bridge-lifecycle.mjs';
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
import {
  findLocalCommandResult,
  rememberLocalCommandResult,
  resolveLocalCommandResultStorePath,
} from './local-command-result-store.mjs';
import { buildLocalSignerProbeSnapshot } from './local-signer-probe.mjs';
import { buildLocalMarketSnapshot, parseMarketList } from './local-market-snapshot.mjs';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import {
  ethereumUniswapErrorResult,
  prepareEthereumUniswapSwap,
} from './ethereum-uniswap-calldata-builder.mjs';
import {
  prepareSolanaJupiterSwap,
  solanaJupiterErrorResult,
} from './solana-jupiter-swap-builder.mjs';
import {
  relayTokenProtocol,
  sha256Hex,
  signDaemonBridgeEnvelope,
  validateBridgeEnvelopeSequence,
  validateBridgeEnvelopeTiming,
  verifyDaemonBridgeEnvelope,
  verifyWorkerBridgeEnvelope,
} from './bridge-envelope.mjs';
import {
  loadBridgeSequenceState,
  resolveBridgeSequenceStorePath,
  saveBridgeSequenceState,
} from './bridge-sequence-store.mjs';
import {
  loadOrCreateDaemonIdentity,
  readDaemonIdentity,
  resolveDaemonIdentityStorePath,
  signDaemonPairingProof,
  signDaemonRelayRefreshProof,
} from './daemon-identity-store.mjs';

const VERSION = '0.1.0';
const DEFAULT_WORKER_URL = 'http://localhost:8787';
const DEFAULT_AGENT_ID = 'default';
const HEARTBEAT_MS = 30_000;
const DEFAULT_RELAY_REFRESH_MARGIN_MS = 2 * 60_000;
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
  'authorization.revoke',
  'authorization.rotate',
  'authorization.state',
  'authorization.validate',
  'secret.store',
  'wallet.refs',
  'inventory.adapters',
  'inventory.sync',
  'signer.probe',
  'activity.tail',
  'policy.local',
  'policy.tick',
  'policy.plan',
  'policy.run_once',
  'policy.loop',
  'solana.prepare_swap',
  'ethereum.prepare_swap',
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
  --relay-token-expires-at <iso>
                        Expiry timestamp for --relay-token so the daemon can refresh it.
  --relay-refresh-margin-ms <ms>
                        Refresh relay token before expiry. Default: ${DEFAULT_RELAY_REFRESH_MARGIN_MS}
  --agent-cmd <cmd>     External agent command to start on agent.start.
  --agent-registry <p>  Local external Agent registry path. Default: ~/.sentry/agents.json
  --venue-config <path> Local venue key metadata path. Default: ~/.sentry/venues.json
  --wallet-config <p>  Local OWS wallet reference metadata path. Default: ~/.sentry/wallets.json
  --policy-store <path> Local policy metadata path. Default: ~/.sentry/policies.json
  --activity-log <path> Local activity JSONL path. Default: ~/.sentry/activity.jsonl
  --command-result-store <p>
                        Local command result resume cache. Default: ~/.sentry/command-results.json
  --identity-store <p> Local daemon Ed25519 identity path. Default: ~/.sentry/identity.json
  --bridge-sequence-store <p>
                        Local relay-session sequence state path. Default: ~/.sentry/bridge-sequences.json
  --market-snapshot <p>
                        JSON market snapshot for local policy trigger checks.
  --live-market         Fetch public OKX/Hyperliquid market data for local trigger checks.
  --market-venues <ids> Market venues to read. Default: okx,hyperliquid
  --market-symbols <s>  Market symbols to read. Default: BTC,ETH,SOL
  --hyperliquid-nonce-store <p>
                        Local Hyperliquid signed-submit nonce store path. Default: ${DEFAULT_HYPERLIQUID_NONCE_STORE_PATH}
  --solana-signer-cmd <cmd>
                        Local command that signs/submits prepared Solana transactions.
  --ethereum-signer-cmd <cmd>
                        Local command that signs/submits prepared Ethereum transactions.
  --signer-timeout-ms <ms>
                        Local signer command timeout. Default: 30000.
  --policy-loop         Start the local policy loop after daemon startup. Default: off.
  --policy-loop-interval-ms <ms>
                        Local policy loop interval. Default: ${DEFAULT_POLICY_LOOP_INTERVAL_MS}
  --policy-loop-check-readiness
                        Loop checks local dispatch readiness but does not dispatch.
  --policy-loop-check-inventory
                        Loop runs configured local inventory/risk guards before readiness.
  --policy-loop-live-inventory
                        Loop may perform live local inventory reads when policy risk checks need it.
  --policy-loop-live-market
                        Loop may fetch public OKX/Hyperliquid market data for trigger checks.
  --policy-loop-dispatch
                        Loop may dispatch to registered external Agents. Off unless explicit.
  --policy-loop-no-mark Do not advance due policy tick timestamps after loop runs.
  --no-verify-okx-live-read
                        Skip OKX signed live-read proof before dispatch. For offline tests only.
  --no-reconnect        Exit instead of reconnecting when the WebSocket closes.
  --print-config        Print redacted runtime config and exit.
  --help                Show this help.

Agent registry:
  sentry-daemon agent list [--json] [--agent-registry <path>]
  sentry-daemon agent register codex --command "codex" --capabilities read_context,return_evidence --task-capabilities okx:place_order,hyperliquid:place_order,solana-mainnet:submit_tx,ethereum-mainnet:submit_tx
  sentry-daemon agent probe [codex] [--timeout-ms 3000] [--json]
  sentry-daemon agent remove codex

Venue key metadata:
  sentry-daemon venue list [--json] [--venue-config <path>]
  sentry-daemon venue add --venue okx --key-handle okx_key_xxxx --account-ref okx:subaccount:name --permissions read,place_order,cancel_order --ip-allowlist true
  sentry-daemon venue add --venue hyperliquid --key-handle hl_agent_xxxx --read-account-address 0x... --agent-wallet-address 0x... --permissions read,place_order,cancel_order,set_leverage
  sentry-daemon venue rotate --venue hyperliquid --key-handle hl_agent_xxxx --confirm
  sentry-daemon venue remove --venue okx --key-handle okx_key_xxxx
  sentry-daemon venue credentials status --venue okx --key-handle okx_key_xxxx
  sentry-daemon venue credentials store --venue okx --key-handle okx_key_xxxx [--field apiKey]
  sentry-daemon wallet list [--json] [--wallet-config <path>]
  sentry-daemon wallet link --wallet-id ows_main --accounts solana:mainnet:...,eip155:1:0x...
  sentry-daemon wallet remove ows_main
  sentry-daemon authorization revoke --venue okx --key-handle okx_key_xxxx --confirm
  sentry-daemon authorization rotate --venue hyperliquid --key-handle hl_agent_xxxx --confirm
  sentry-daemon authorization revoke --wallet-id ows_main --confirm
  sentry-daemon solana prepare-swap --task-file solana-task.json
  sentry-daemon ethereum prepare-swap --task-file ethereum-task.json --rpc-url https://...
  echo '{"task_id":"..."}' | sentry-daemon solana prepare-swap
  echo '{"task_id":"..."}' | sentry-daemon ethereum prepare-swap --simulated
  sentry-daemon policy run-once --dispatch --solana-signer-cmd "ows-solana submit"
  sentry-daemon policy run-once --dispatch --ethereum-signer-cmd "safe-cli send-json"
  sentry-daemon signer probe [--scope solana-mainnet,ethereum-mainnet] [--json]
  sentry-daemon activity tail [--limit 50] [--json]
  sentry-daemon market snapshot [--market-venues okx,hyperliquid] [--market-symbols BTC,ETH]
  sentry-daemon policy list [--json] [--policy-store <path>]
  sentry-daemon policy add --policy-id funding-arb-1 --target-venues hyperliquid,okx --target-agent codex
  sentry-daemon policy tick [--limit 50] [--mark] [--json]
  sentry-daemon policy plan [--limit 50] [--json]
  sentry-daemon policy run-once [--check-readiness] [--check-inventory] [--live-inventory] [--live-market] [--dispatch] [--mark] [--json]
  sentry-daemon policy pause|resume|revoke <policy-id>

Examples:
  npx @sentry/daemon --pairing-code pair_xxxx --worker-url https://sentry.example.workers.dev
  sentry-daemon --pairing-code pair_xxxx --agent-cmd "codex"
  sentry-daemon agent register codex --command "codex" --task-capabilities okx:place_order,hyperliquid:place_order,solana-mainnet:submit_tx,ethereum-mainnet:submit_tx
  sentry-daemon venue add --venue hyperliquid --key-handle hl_agent_xxxx --read-account-address 0x... --agent-wallet-address 0x... --permissions read,place_order,cancel_order,set_leverage
  sentry-daemon venue rotate --venue hyperliquid --key-handle hl_agent_xxxx --confirm
  sentry-daemon venue credentials store --venue okx --key-handle okx_key_xxxx
  sentry-daemon wallet link --wallet-id ows_main --accounts solana:mainnet:...,eip155:1:0x...
  sentry-daemon agent register jupiter --command "sentry-daemon solana prepare-swap" --task-capabilities solana-mainnet:submit_tx
  sentry-daemon agent register uniswap --command "sentry-daemon ethereum prepare-swap" --task-capabilities ethereum-mainnet:submit_tx
`);
}

function redact(value) {
  if (!value) return null;
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function workerToWebSocketUrl(workerUrl, agentId) {
  const base = workerUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/api/local-agents/${encodeURIComponent(agentId)}/connect`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function postJson(url, payload = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.code || `Request failed with ${response.status}`);
  }
  return body;
}

async function pairWithWorker({ workerUrl, pairingCode, agentId, identityStorePath }) {
  const url = `${workerUrl.replace(/\/+$/, '')}/api/local-agents/pair`;
  const deviceName = process.env.SENTRY_DEVICE_NAME || `${process.platform}-${process.pid}`;
  const identity = await loadOrCreateDaemonIdentity({ storePath: identityStorePath });
  if (identity.status === 'error') {
    throw new Error(identity.message || identity.code || 'Daemon identity failed.');
  }
  const proof = signDaemonPairingProof({
    identity: identity.identity,
    pairingCode,
    agentId,
    deviceName,
    supportedCapabilities: DAEMON_CAPABILITIES,
  });
  const paired = await postJson(url, {
    pairing_code: pairingCode,
    agent_id: agentId,
    device_name: deviceName,
    supported_capabilities: DAEMON_CAPABILITIES,
    ...proof,
  });
  return { ...paired, daemon_identity: identity.identity };
}

function truncate(value, max = 4000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function makeEnvelope(
  kind,
  payload = {},
  extra = {},
  relayTokenHash = null,
  daemonIdentity = null
) {
  return signDaemonBridgeEnvelope(
    {
      kind,
      message_id: `${kind}_${crypto.randomUUID()}`,
      issued_at: new Date().toISOString(),
      payload,
      ...extra,
    },
    relayTokenHash,
    daemonIdentity
  );
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
    created_at: readArg('--created-at'),
    rotated_at: readArg('--rotated-at'),
    status: readArg('--status', 'linked'),
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function printAgentJson(value) {
  console.log(JSON.stringify(value));
}

function agentCliInput() {
  const positionalId =
    process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
  return {
    agent_id: readArg('--agent-id', readArg('--id', positionalId)),
    display_name: readArg('--display-name', readArg('--name')),
    command: readArg('--command', readArg('--agent-cmd')),
    capabilities: parseCapabilityList(readArg('--capabilities')),
    task_capabilities: parseCapabilityList(readArg('--task-capabilities', readArg('--tasks'))),
    enabled: !hasArg('--disabled'),
  };
}

function walletCliInput() {
  const positionalId =
    process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
  return {
    wallet_id: readArg('--wallet-id', readArg('--id', readArg('--ows', positionalId))),
    display_name: readArg('--display-name', readArg('--name')),
    vault_path: readArg('--vault-path', readArg('--ows-vault-path', '~/.ows')),
    accounts: readArg('--accounts', readArg('--caip-accounts')),
    policy_ids: parsePermissionList(readArg('--policy-ids', readArg('--policies'))),
    capabilities: parsePermissionList(readArg('--capabilities', 'read,sign,submit_tx')),
    status: readArg('--status', 'linked'),
  };
}

async function handleWalletCli() {
  const action = process.argv[3] || 'list';
  const configPath = readArg('--wallet-config', process.env.SENTRY_WALLET_CONFIG);
  const options = { configPath };
  const json = hasArg('--json');

  if (action === 'list' || action === 'refs') {
    printJson(await loadLocalWalletStore(options));
    return;
  }

  if (action === 'link' || action === 'add') {
    const result = await upsertWalletReference(walletCliInput(), options);
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`Linked OWS wallet ${result.wallet.wallet_id} at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  if (action === 'remove' || action === 'unlink') {
    const positionalId =
      process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
    const result = await removeWalletReference(
      {
        wallet_id: readArg('--wallet-id', readArg('--id', readArg('--ows', positionalId))),
      },
      options
    );
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`${result.removed ? 'Removed' : 'No matching'} OWS wallet at ${result.path}`);
    }
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }

  console.error(`Unsupported wallet command: ${action}`);
  process.exitCode = 1;
}

function parseAuthorizationRef(value) {
  const ref = String(value || '').trim();
  if (!ref) return {};
  const [venueId, second] = ref.split(':');
  const venue = getVenueById(venueId);
  if (!venue) return { authorization_ref: ref };
  if (venue.authorization_model === 'venue_api_key') {
    return { authorization_ref: ref, venue_id: venueId, key_handle: second || null };
  }
  return { authorization_ref: ref, venue_id: venueId, wallet_id: second || null };
}

function authorizationRevokeInput(input = {}) {
  const refInput =
    input.authorization_ref ||
    input.authorizationRef ||
    input.ref ||
    readArg('--authorization-ref', readArg('--ref'));
  const parsedRef = parseAuthorizationRef(refInput);
  return {
    ...parsedRef,
    venue_id:
      input.venue_id ||
      input.venueId ||
      readArg('--venue', readArg('--venue-id')) ||
      parsedRef.venue_id,
    key_handle:
      input.key_handle || input.keyHandle || readArg('--key-handle') || parsedRef.key_handle,
    wallet_id:
      input.wallet_id ||
      input.walletId ||
      input.ows_wallet_id ||
      readArg('--wallet-id', readArg('--id', readArg('--ows'))) ||
      parsedRef.wallet_id,
    reason: input.reason || readArg('--reason', 'local_authorization_revoke'),
    confirm: input.confirm === true || hasArg('--confirm'),
  };
}

async function revokeLocalAuthorization(input = {}, options = {}) {
  const revoke = authorizationRevokeInput(input);
  if (!revoke.confirm) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_REVOKE_CONFIRM_REQUIRED',
      message:
        'Local authorization revoke requires confirm=true or --confirm. This only disables local metadata; live venue/chain revoke remains manual.',
    };
  }
  if (revoke.wallet_id && revoke.key_handle) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_REVOKE_TARGET_AMBIGUOUS',
      message: 'Revoke exactly one local authorization target: wallet_id or venue_id + key_handle.',
    };
  }
  if (revoke.wallet_id) {
    const result = await markWalletReferenceRevoked(
      {
        wallet_id: revoke.wallet_id,
        reason: revoke.reason,
      },
      {
        configPath: options.walletConfigPath,
      }
    );
    return {
      ...result,
      revoke_target: 'wallet_ref',
      authorization_ref:
        result.status === 'ok' ? `${revoke.venue_id || 'local-wallet'}:${revoke.wallet_id}` : null,
    };
  }
  if (!revoke.venue_id || !revoke.key_handle) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_REVOKE_TARGET_REQUIRED',
      message:
        'Local authorization revoke requires either wallet_id or venue_id + key_handle / authorization_ref.',
    };
  }
  const venue = getVenueById(revoke.venue_id);
  if (!venue) {
    return {
      status: 'error',
      code: 'UNKNOWN_VENUE',
      message: `Unknown venue: ${revoke.venue_id}`,
      venue_id: revoke.venue_id,
    };
  }
  if (venue.authorization_model !== 'venue_api_key') {
    return {
      status: 'error',
      code: 'WALLET_REF_REQUIRED_FOR_CHAIN_AUTHORIZATION',
      message: `${venue.name} authorization is wallet/delegation based; pass --wallet-id instead of --key-handle.`,
      venue_id: venue.id,
    };
  }
  const result = await markVenueKeyMetadataRevoked(
    {
      venue_id: venue.id,
      key_handle: revoke.key_handle,
      reason: revoke.reason,
    },
    {
      configPath: options.venueConfigPath,
    }
  );
  return {
    ...result,
    revoke_target: 'venue_key',
    authorization_ref: result.status === 'ok' ? `${venue.id}:${revoke.key_handle}` : null,
  };
}

function authorizationRotateInput(input = {}) {
  const refInput =
    input.authorization_ref ||
    input.authorizationRef ||
    input.ref ||
    readArg('--authorization-ref', readArg('--ref'));
  const parsedRef = parseAuthorizationRef(refInput);
  return {
    ...parsedRef,
    venue_id:
      input.venue_id ||
      input.venueId ||
      readArg('--venue', readArg('--venue-id')) ||
      parsedRef.venue_id,
    key_handle:
      input.key_handle || input.keyHandle || readArg('--key-handle') || parsedRef.key_handle,
    rotated_at: input.rotated_at || input.rotatedAt || readArg('--rotated-at'),
    reason: input.reason || readArg('--reason', 'dashboard_local_key_rotation'),
    confirm: input.confirm === true || hasArg('--confirm'),
  };
}

async function rotateLocalAuthorization(input = {}, options = {}) {
  const rotate = authorizationRotateInput(input);
  if (!rotate.confirm) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_ROTATE_CONFIRM_REQUIRED',
      message:
        'Local authorization rotate requires confirm=true or --confirm. This only records local metadata after live venue key material was rotated outside Sentry.',
    };
  }
  if (!rotate.venue_id || !rotate.key_handle) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_ROTATE_TARGET_REQUIRED',
      message: 'Local authorization rotate requires venue_id + key_handle / authorization_ref.',
    };
  }
  const venue = getVenueById(rotate.venue_id);
  if (!venue) {
    return {
      status: 'error',
      code: 'UNKNOWN_VENUE',
      message: `Unknown venue: ${rotate.venue_id}`,
      venue_id: rotate.venue_id,
    };
  }
  if (venue.authorization_model !== 'venue_api_key') {
    return {
      status: 'error',
      code: 'VENUE_KEY_REQUIRED_FOR_ROTATION',
      message: `${venue.name} authorization is wallet/delegation based; rotate the underlying wallet or grant outside venue key metadata.`,
      venue_id: venue.id,
    };
  }
  const result = await markVenueKeyMetadataRotated(
    {
      venue_id: venue.id,
      key_handle: rotate.key_handle,
      rotated_at: rotate.rotated_at,
      reason: rotate.reason,
    },
    {
      configPath: options.venueConfigPath,
    }
  );
  return {
    ...result,
    rotate_target: 'venue_key',
    authorization_ref: result.status === 'ok' ? `${venue.id}:${rotate.key_handle}` : null,
  };
}

async function handleAuthorizationCli() {
  const action = process.argv[3] || 'state';
  const venueConfigPath = readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG);
  const walletConfigPath = readArg('--wallet-config', process.env.SENTRY_WALLET_CONFIG);
  if (action === 'state' || action === 'list') {
    const [secretStore, walletStore] = await Promise.all([
      loadLocalSecretStore({ configPath: venueConfigPath }),
      loadLocalWalletStore({ configPath: walletConfigPath }),
    ]);
    const scope = parsePermissionList(readArg('--scope'));
    printJson(
      buildAuthorizationStateSnapshot({
        secretStore,
        walletStore,
        scope: scope.length ? scope : null,
      })
    );
    return;
  }
  if (action === 'revoke') {
    const result = await revokeLocalAuthorization(
      {},
      {
        venueConfigPath,
        walletConfigPath,
      }
    );
    printJson(result);
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }
  if (action === 'rotate') {
    const result = await rotateLocalAuthorization(
      {},
      {
        venueConfigPath,
      }
    );
    printJson(result);
    process.exitCode = result.status === 'ok' ? 0 : 1;
    return;
  }
  console.error(`Unsupported authorization command: ${action}`);
  process.exitCode = 1;
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

  if (action === 'rotate') {
    if (!hasArg('--confirm')) {
      const result = {
        status: 'error',
        code: 'VENUE_KEY_ROTATE_CONFIRM_REQUIRED',
        message:
          'Pass --confirm after rotating the venue key material outside Sentry; this only updates local rotation metadata.',
      };
      printJson(result);
      process.exitCode = 1;
      return;
    }
    const result = await markVenueKeyMetadataRotated(
      {
        venue_id: readArg('--venue', readArg('--venue-id')),
        key_handle: readArg('--key-handle'),
        rotated_at: readArg('--rotated-at'),
        reason: readArg('--reason', 'local_key_rotation'),
      },
      options
    );
    if (json || result.status !== 'ok') {
      printJson(result);
    } else {
      console.log(`Marked ${result.venue_id}:${result.key_handle} rotated at ${result.rotated_at}`);
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

function marketCliOptions(input = {}) {
  return {
    venues: parseMarketList(
      input.venues ||
        input.market_venues ||
        readArg('--market-venues', readArg('--venues', process.env.SENTRY_MARKET_VENUES))
    ),
    symbols: parseMarketList(
      input.symbols ||
        input.market_symbols ||
        readArg('--market-symbols', readArg('--symbols', process.env.SENTRY_MARKET_SYMBOLS))
    ),
  };
}

function buildMarketSnapshotReader(defaults = {}) {
  return ({ scope, now: snapshotNow, venues, symbols } = {}) =>
    buildLocalMarketSnapshot({
      venues: parseMarketList(venues || defaults.venues || scope, ['okx', 'hyperliquid']),
      symbols: parseMarketList(symbols || defaults.symbols, ['BTC', 'ETH', 'SOL']),
      now: snapshotNow instanceof Date ? snapshotNow : new Date(snapshotNow || Date.now()),
    });
}

async function handleMarketCli() {
  const action = process.argv[3] || 'snapshot';
  if (action !== 'snapshot') {
    console.error(`Unsupported market command: ${action}`);
    process.exitCode = 1;
    return;
  }
  printJson(
    await buildLocalMarketSnapshot({
      ...marketCliOptions(),
      now: new Date(readArg('--now', process.env.SENTRY_POLICY_TICK_NOW) || Date.now()),
      simulated: !hasArg('--live'),
    })
  );
}

async function readJsonFileArg(flag) {
  const filePath = readArg(flag);
  if (!filePath) return {};
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalJsonFileArg(flag) {
  const filePath = readArg(flag);
  if (!filePath) return null;
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readStdinJsonIfAvailable() {
  if (process.stdin.isTTY) return null;
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk.toString();
  }
  const trimmed = text.trim();
  return trimmed ? JSON.parse(trimmed) : null;
}

function unwrapTaskEnvelope(value) {
  if (!value || typeof value !== 'object') return null;
  return value.task && typeof value.task === 'object' ? value.task : value;
}

function solanaSwapCliInput(fileInput = {}) {
  return {
    ...fileInput,
    taskId: readArg('--task-id', readArg('--id', fileInput.task_id || fileInput.taskId)),
    policyId: readArg('--policy-id', fileInput.policy_id || fileInput.policyId),
    targetAgent: readArg('--target-agent', fileInput.target_agent || fileInput.targetAgent),
    account: {
      ...(fileInput.account || fileInput.accountMetadata || fileInput.account_metadata || {}),
      owner: readArg(
        '--owner',
        readArg(
          '--wallet-address',
          fileInput.owner ||
            fileInput.wallet_address ||
            process.env.SENTRY_SOLANA_WALLET_ADDRESS ||
            process.env.SENTRY_SOLANA_OWNER
        )
      ),
      capabilities: parsePermissionList(
        readArg('--capabilities', fileInput.capabilities || 'read,sign,submit_tx')
      ),
    },
    adapter: readArg('--adapter', fileInput.adapter || 'jupiter'),
    inputMint: readArg(
      '--input-mint',
      readArg('--inputMint', fileInput.inputMint || fileInput.input_mint)
    ),
    outputMint: readArg(
      '--output-mint',
      readArg('--outputMint', fileInput.outputMint || fileInput.output_mint)
    ),
    amount: readArg('--amount', readArg('--raw-amount', fileInput.amount || fileInput.raw_amount)),
    slippageBps: Number(
      readArg('--slippage-bps', fileInput.slippageBps ?? fileInput.slippage_bps ?? 50)
    ),
    quoteId: readArg('--quote-id', fileInput.quoteId || fileInput.quote_id),
    maxNotionalUsd: readArg(
      '--max-notional-usd',
      fileInput.maxNotionalUsd || fileInput.max_notional_usd
    ),
    maxInputAmount: readArg(
      '--max-input-amount',
      fileInput.maxInputAmount || fileInput.max_input_amount
    ),
    minOutputAmount: readArg(
      '--min-output-amount',
      fileInput.minOutputAmount || fileInput.min_output_amount
    ),
  };
}

function ethereumSwapCliInput(fileInput = {}) {
  return {
    ...fileInput,
    taskId: readArg('--task-id', readArg('--id', fileInput.task_id || fileInput.taskId)),
    policyId: readArg('--policy-id', fileInput.policy_id || fileInput.policyId),
    targetAgent: readArg('--target-agent', fileInput.target_agent || fileInput.targetAgent),
    account: {
      ...(fileInput.account || fileInput.accountMetadata || fileInput.account_metadata || {}),
      account: readArg(
        '--account',
        readArg(
          '--wallet-address',
          fileInput.account ||
            fileInput.wallet_address ||
            process.env.SENTRY_ETHEREUM_WALLET_ADDRESS ||
            process.env.SENTRY_ETHEREUM_OWNER
        )
      ),
      capabilities: parsePermissionList(
        readArg('--capabilities', fileInput.capabilities || 'read,sign,submit_tx')
      ),
    },
    adapter: readArg('--adapter', fileInput.adapter || 'uniswap'),
    inputToken: readArg(
      '--input-token',
      readArg('--inputToken', fileInput.inputToken || fileInput.input_token)
    ),
    outputToken: readArg(
      '--output-token',
      readArg('--outputToken', fileInput.outputToken || fileInput.output_token)
    ),
    amount: readArg('--amount', readArg('--raw-amount', fileInput.amount || fileInput.raw_amount)),
    slippageBps: Number(
      readArg('--slippage-bps', fileInput.slippageBps ?? fileInput.slippage_bps ?? 50)
    ),
    quoteId: readArg('--quote-id', fileInput.quoteId || fileInput.quote_id),
    maxNotionalUsd: readArg(
      '--max-notional-usd',
      fileInput.maxNotionalUsd || fileInput.max_notional_usd
    ),
    maxInputAmount: readArg(
      '--max-input-amount',
      fileInput.maxInputAmount || fileInput.max_input_amount
    ),
    minOutputAmount: readArg(
      '--min-output-amount',
      fileInput.minOutputAmount || fileInput.min_output_amount
    ),
  };
}

async function readSolanaTaskForCli() {
  const fileInput =
    (await readOptionalJsonFileArg('--task-file')) || (await readOptionalJsonFileArg('--file'));
  if (fileInput) return { status: 'ok', task: unwrapTaskEnvelope(fileInput) };
  const stdinInput = await readStdinJsonIfAvailable();
  if (stdinInput) return { status: 'ok', task: unwrapTaskEnvelope(stdinInput) };
  const built = buildSolanaSwapTask(solanaSwapCliInput());
  if (built.status !== 'ok') return built;
  return { status: 'ok', task: built.task };
}

async function readEthereumTaskForCli() {
  const fileInput =
    (await readOptionalJsonFileArg('--task-file')) || (await readOptionalJsonFileArg('--file'));
  if (fileInput) return { status: 'ok', task: unwrapTaskEnvelope(fileInput) };
  const stdinInput = await readStdinJsonIfAvailable();
  if (stdinInput) return { status: 'ok', task: unwrapTaskEnvelope(stdinInput) };
  const built = buildEthereumSwapTask(ethereumSwapCliInput());
  if (built.status !== 'ok') return built;
  return { status: 'ok', task: built.task };
}

async function handleSolanaCli() {
  const action = process.argv[3] || 'prepare-swap';
  if (!['prepare-swap', 'jupiter'].includes(action)) {
    console.error(`Unsupported solana command: ${action}`);
    process.exitCode = 1;
    return;
  }
  const taskRead = await readSolanaTaskForCli();
  if (taskRead.status !== 'ok') {
    printAgentJson(solanaJupiterErrorResult({}, taskRead));
    return;
  }
  const prepared = await prepareSolanaJupiterSwap({
    task: taskRead.task,
    quoteUrl: readArg('--jupiter-quote-url', readArg('--quote-url')),
    swapUrl: readArg('--jupiter-swap-url', readArg('--swap-url')),
    onlyDirectRoutes: hasArg('--only-direct-routes') ? true : undefined,
    maxAccounts: readArg('--max-accounts'),
    asLegacyTransaction: hasArg('--legacy-transaction'),
    prioritizationFeeLamports: readArg('--priority-fee-lamports'),
    now: new Date(readArg('--now', Date.now())),
  });
  printAgentJson(
    prepared.status === 'ok' ? prepared.result : solanaJupiterErrorResult(taskRead.task, prepared)
  );
}

async function handleEthereumCli() {
  const action = process.argv[3] || 'prepare-swap';
  if (!['prepare-swap', 'uniswap'].includes(action)) {
    console.error(`Unsupported ethereum command: ${action}`);
    process.exitCode = 1;
    return;
  }
  const taskRead = await readEthereumTaskForCli();
  if (taskRead.status !== 'ok') {
    printAgentJson(ethereumUniswapErrorResult({}, taskRead));
    return;
  }
  const prepared = await prepareEthereumUniswapSwap({
    task: taskRead.task,
    rpcUrl: readArg('--rpc-url', readArg('--ethereum-rpc-url')),
    router: readArg('--router', readArg('--router-address')),
    fee: readArg('--fee', readArg('--pool-fee')),
    minOutputAmount: readArg('--min-output-amount'),
    deadline: readArg('--deadline'),
    ttlSeconds: readArg('--ttl-seconds'),
    sqrtPriceLimitX96: readArg('--sqrt-price-limit-x96'),
    simulated: hasArg('--simulated') || hasArg('--skip-rpc-simulation'),
    now: new Date(readArg('--now', Date.now())),
  });
  printAgentJson(
    prepared.status === 'ok' ? prepared.result : ethereumUniswapErrorResult(taskRead.task, prepared)
  );
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
    const marketSnapshot = await readOptionalJsonFileArg('--market-snapshot');
    const liveMarket = hasArg('--live-market');
    const marketReader = liveMarket ? buildMarketSnapshotReader(marketCliOptions()) : null;
    const [policyStore, secretStore, walletStore, agentRegistry] = await Promise.all([
      loadLocalPolicyStore({ ...options, now: effectiveNow }),
      loadLocalSecretStore({
        configPath: readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG),
      }),
      loadLocalWalletStore({
        configPath: readArg('--wallet-config', process.env.SENTRY_WALLET_CONFIG),
      }),
      loadAgentRegistry({
        configPath: readArg('--agent-registry', process.env.SENTRY_AGENT_REGISTRY),
      }),
    ]);
    const checkInventory = hasArg('--check-inventory') || hasArg('--live-inventory');
    const liveInventory = hasArg('--live-inventory');
    printJson(
      await runDuePolicyTasks({
        policyStore,
        policyStorePath: configPath,
        secretStore,
        walletStore,
        agentRegistry,
        now: effectiveNow,
        limit: Number(readArg('--limit', 50)),
        checkReadiness: hasArg('--check-readiness') || hasArg('--dispatch'),
        checkInventory,
        liveInventory,
        marketSnapshot,
        getMarketSnapshot: !marketSnapshot && marketReader ? marketReader : undefined,
        dispatch: hasArg('--dispatch'),
        markTicks: hasArg('--mark'),
        defaultAgentCommand: readArg('--agent-cmd', process.env.SENTRY_AGENT_COMMAND || ''),
        timeoutMs: Number(readArg('--timeout-ms', 30_000)),
        signerTimeoutMs: Number(
          readArg('--signer-timeout-ms', process.env.SENTRY_SIGNER_TIMEOUT_MS || 30_000)
        ),
        solanaSignerCommand: readArg(
          '--solana-signer-cmd',
          process.env.SENTRY_SOLANA_SIGNER_COMMAND
        ),
        ethereumSignerCommand: readArg(
          '--ethereum-signer-cmd',
          process.env.SENTRY_ETHEREUM_SIGNER_COMMAND
        ),
        verifyReceipt: !hasArg('--no-verify-receipt'),
        verifyHyperliquidLiveGrant: hasArg('--dispatch') && !hasArg('--no-verify-live-grant'),
        verifyOkxLiveRead: hasArg('--dispatch') && !hasArg('--no-verify-okx-live-read'),
        requireSignerProbe: hasArg('--require-signer-probe'),
        signerProbeTimeoutMs: Number(readArg('--signer-probe-timeout-ms', 3000)),
        simulated: !hasArg('--live'),
        hyperliquidNonceStorePath: resolveHyperliquidNonceStorePath(
          readArg('--hyperliquid-nonce-store', process.env.SENTRY_HYPERLIQUID_NONCE_STORE)
        ),
        getInventorySnapshot: checkInventory
          ? ({ scope, now: snapshotNow, live }) =>
              live
                ? buildLiveInventorySnapshot({
                    secretStore,
                    scope,
                    now:
                      snapshotNow instanceof Date
                        ? snapshotNow
                        : new Date(snapshotNow || Date.now()),
                    simulated: !hasArg('--live'),
                  })
                : buildLocalInventorySnapshot({
                    secretStore,
                    scope,
                    now:
                      snapshotNow instanceof Date
                        ? snapshotNow.toISOString()
                        : new Date(snapshotNow || Date.now()).toISOString(),
                  })
          : undefined,
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
  if (process.argv[2] === 'wallet') {
    await handleWalletCli();
    return;
  }
  if (process.argv[2] === 'authorization') {
    await handleAuthorizationCli();
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
  if (process.argv[2] === 'market') {
    await handleMarketCli();
    return;
  }
  if (process.argv[2] === 'solana') {
    await handleSolanaCli();
    return;
  }
  if (process.argv[2] === 'ethereum') {
    await handleEthereumCli();
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
  const relayTokenExpiresAtArg = readArg(
    '--relay-token-expires-at',
    process.env.SENTRY_RELAY_TOKEN_EXPIRES_AT
  );
  const workerUrl = readArg('--worker-url', process.env.SENTRY_WORKER_URL || DEFAULT_WORKER_URL);
  let agentId = readArg('--agent-id', process.env.SENTRY_AGENT_ID || DEFAULT_AGENT_ID);
  const defaultAgentCommand = readArg('--agent-cmd', process.env.SENTRY_AGENT_COMMAND || '');
  const agentRegistryPath = readArg('--agent-registry', process.env.SENTRY_AGENT_REGISTRY);
  const venueConfigPath = readArg('--venue-config', process.env.SENTRY_VENUE_CONFIG);
  const walletConfigPath = resolveWalletConfigPath(
    readArg('--wallet-config', process.env.SENTRY_WALLET_CONFIG)
  );
  const policyStorePath = resolveLocalPolicyStorePath(
    readArg('--policy-store', process.env.SENTRY_POLICY_STORE)
  );
  const activityLogPath = resolveLocalActivityLogPath(
    readArg('--activity-log', process.env.SENTRY_ACTIVITY_LOG)
  );
  const commandResultStorePath = resolveLocalCommandResultStorePath(
    readArg('--command-result-store', process.env.SENTRY_COMMAND_RESULT_STORE)
  );
  const identityStorePath = resolveDaemonIdentityStorePath(
    readArg('--identity-store', process.env.SENTRY_IDENTITY_STORE)
  );
  const bridgeSequenceStorePath = resolveBridgeSequenceStorePath(
    readArg('--bridge-sequence-store', process.env.SENTRY_BRIDGE_SEQUENCE_STORE)
  );
  const marketSnapshotPath = readArg('--market-snapshot', process.env.SENTRY_MARKET_SNAPSHOT);
  const hyperliquidNonceStorePath = resolveHyperliquidNonceStorePath(
    readArg('--hyperliquid-nonce-store', process.env.SENTRY_HYPERLIQUID_NONCE_STORE)
  );
  const solanaSignerCommand = readArg(
    '--solana-signer-cmd',
    process.env.SENTRY_SOLANA_SIGNER_COMMAND
  );
  const ethereumSignerCommand = readArg(
    '--ethereum-signer-cmd',
    process.env.SENTRY_ETHEREUM_SIGNER_COMMAND
  );
  const signerTimeoutMs = Number(
    readArg('--signer-timeout-ms', process.env.SENTRY_SIGNER_TIMEOUT_MS || 30_000)
  );
  const relayRefreshMarginMs = Number(
    readArg(
      '--relay-refresh-margin-ms',
      process.env.SENTRY_RELAY_REFRESH_MARGIN_MS || DEFAULT_RELAY_REFRESH_MARGIN_MS
    )
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
    checkInventory:
      hasArg('--policy-loop-check-inventory') ||
      hasArg('--policy-loop-live-inventory') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_CHECK_INVENTORY, false),
    liveInventory:
      hasArg('--policy-loop-live-inventory') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_LIVE_INVENTORY, false),
    liveMarket:
      hasArg('--policy-loop-live-market') ||
      hasArg('--live-market') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_LIVE_MARKET, false),
    market: marketCliOptions(),
    dispatch:
      hasArg('--policy-loop-dispatch') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_DISPATCH, false),
    verifyOkxLiveRead:
      (hasArg('--policy-loop-dispatch') ||
        parseBoolean(process.env.SENTRY_POLICY_LOOP_DISPATCH, false)) &&
      !hasArg('--no-verify-okx-live-read') &&
      parseBoolean(process.env.SENTRY_POLICY_LOOP_VERIFY_OKX_LIVE_READ, true),
    markTicks:
      !hasArg('--policy-loop-no-mark') &&
      parseBoolean(process.env.SENTRY_POLICY_LOOP_MARK_TICKS, true),
    runImmediately:
      hasArg('--policy-loop-run-immediately') ||
      parseBoolean(process.env.SENTRY_POLICY_LOOP_RUN_IMMEDIATELY, false),
    solanaSignerCommand,
    ethereumSignerCommand,
    signerTimeoutMs,
  };
  const noReconnect = hasArg('--no-reconnect');

  const config = {
    workerUrl,
    agentId,
    pairingCode: redact(pairingCode),
    relayToken: redact(relayTokenArg),
    relayTokenExpiresAt: relayTokenExpiresAtArg || null,
    relayRefreshMarginMs,
    defaultAgentCommand: defaultAgentCommand || null,
    agentRegistryPath: agentRegistryPath || '~/.sentry/agents.json',
    venueConfigPath: venueConfigPath || '~/.sentry/venues.json',
    walletConfigPath,
    policyStorePath,
    activityLogPath,
    commandResultStorePath,
    identityStorePath,
    bridgeSequenceStorePath,
    marketSnapshotPath: marketSnapshotPath || null,
    hyperliquidNonceStorePath,
    signerCommands: {
      solana: solanaSignerCommand ? 'configured' : null,
      ethereum: ethereumSignerCommand ? 'configured' : null,
      timeoutMs: signerTimeoutMs,
    },
    policyLoop: {
      enabled: policyLoopConfig.enabled,
      intervalMs: policyLoopConfig.intervalMs,
      checkReadiness: policyLoopConfig.checkReadiness,
      checkInventory: policyLoopConfig.checkInventory,
      liveInventory: policyLoopConfig.liveInventory,
      liveMarket: policyLoopConfig.liveMarket,
      market: policyLoopConfig.market,
      dispatch: policyLoopConfig.dispatch,
      verifyOkxLiveRead: policyLoopConfig.verifyOkxLiveRead,
      markTicks: policyLoopConfig.markTicks,
      runImmediately: policyLoopConfig.runImmediately,
      signerCommands: {
        solana: policyLoopConfig.solanaSignerCommand ? 'configured' : null,
        ethereum: policyLoopConfig.ethereumSignerCommand ? 'configured' : null,
        timeoutMs: policyLoopConfig.signerTimeoutMs,
      },
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
  let relayTokenExpiresAt = relayTokenExpiresAtArg || null;
  let relayTokenHash = relayToken ? sha256Hex(relayToken) : null;
  let daemonIdentity = null;
  let workerBridgePublicKey = null;
  let workerBridgePublicKeyId = null;

  let ws = null;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let bridgeRevoked = false;
  let heartbeatTimer = null;
  let relayRefreshTimer = null;
  let relayRefreshInFlight = false;
  let suppressNextReconnect = false;
  let outboundBridgeSeq = 0;
  let lastWorkerBridgeSeq = 0;
  let child = null;
  let childCommand = null;
  let childStartedAt = null;
  const inFlightCommands = new Map();
  let commandResultPersist = Promise.resolve();

  function log(event, detail = {}) {
    console.log(JSON.stringify({ t: new Date().toISOString(), event, ...detail }));
  }

  async function ensureDaemonIdentity({ allowCreate = false } = {}) {
    if (daemonIdentity) return daemonIdentity;
    const loaded = allowCreate
      ? await loadOrCreateDaemonIdentity({ storePath: identityStorePath })
      : await readDaemonIdentity({ storePath: identityStorePath });
    if (loaded.status === 'ok' || loaded.status === 'created') {
      daemonIdentity = loaded.identity;
      return daemonIdentity;
    }
    if (loaded.status === 'missing') {
      throw new Error(
        `Daemon identity is missing at ${loaded.path}. Re-pair with --pairing-code or pass the --identity-store used during pairing.`
      );
    }
    throw new Error(loaded.message || loaded.code || 'Daemon identity failed.');
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

  function snapshotNowIso(value) {
    return value instanceof Date
      ? value.toISOString()
      : new Date(value || Date.now()).toISOString();
  }

  function buildInventorySnapshotReader(secretStore, defaults = {}) {
    return ({ scope, now: snapshotNow, live, simulated } = {}) =>
      live
        ? buildLiveInventorySnapshot({
            secretStore,
            scope,
            now: snapshotNow instanceof Date ? snapshotNow : new Date(snapshotNow || Date.now()),
            simulated: simulated ?? defaults.simulated ?? true,
          })
        : buildLocalInventorySnapshot({
            secretStore,
            scope,
            now: snapshotNowIso(snapshotNow),
          });
  }

  async function loadPolicyRunContext() {
    const [policyStore, secretStore, walletStore, agentRegistry, marketSnapshot] =
      await Promise.all([
        loadLocalPolicyStore({ configPath: policyStorePath }),
        loadLocalSecretStore({ configPath: venueConfigPath }),
        loadLocalWalletStore({ configPath: walletConfigPath }),
        loadAgentRegistry({ configPath: agentRegistryPath }),
        marketSnapshotPath ? JSON.parse(await readFile(marketSnapshotPath, 'utf8')) : null,
      ]);
    return {
      policyStore,
      policyStorePath,
      secretStore,
      walletStore,
      agentRegistry,
      defaultAgentCommand,
      hyperliquidNonceStorePath,
      solanaSignerCommand,
      ethereumSignerCommand,
      signerTimeoutMs,
      marketSnapshot,
      liveMarketSnapshotReader: buildMarketSnapshotReader(policyLoopConfig.market),
      recordActivity,
      getInventorySnapshot: buildInventorySnapshotReader(secretStore),
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
    const walletStore = await loadLocalWalletStore({ configPath: walletConfigPath });
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
      wallet_store: {
        status: walletStore.status,
        wallet_count: walletStore.wallet_count,
        account_count: walletStore.account_count,
        metadata_path: walletStore.metadata_path,
        config_status: walletStore.config_status,
      },
      hyperliquid_nonce_store: {
        status: 'enabled',
        path: hyperliquidNonceStorePath,
      },
      local_activity: {
        status: 'enabled',
        log_path: activityLogPath,
      },
      command_result_store: {
        status: 'enabled',
        path: commandResultStorePath,
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

  function nextOutboundBridgeSeq() {
    outboundBridgeSeq += 1;
    return outboundBridgeSeq;
  }

  let sequencePersist = Promise.resolve();

  function persistBridgeSequences() {
    if (!relayTokenHash) return sequencePersist;
    const snapshot = {
      relayTokenHash,
      outboundSeq: outboundBridgeSeq,
      inboundSeq: lastWorkerBridgeSeq,
    };
    sequencePersist = sequencePersist
      .catch(() => {})
      .then(() =>
        saveBridgeSequenceState(snapshot, {
          storePath: bridgeSequenceStorePath,
        })
      )
      .catch((error) => {
        log('bridge.sequence_store_failed', { message: error?.message || String(error) });
      });
    return sequencePersist;
  }

  async function restoreBridgeSequences() {
    if (!relayTokenHash) return;
    const state = await loadBridgeSequenceState({
      storePath: bridgeSequenceStorePath,
      relayTokenHash,
    });
    if (state.status === 'error') {
      log('bridge.sequence_store_failed', { message: state.message || state.code });
      return;
    }
    outboundBridgeSeq = Math.max(outboundBridgeSeq, Number(state.outbound_seq || 0));
    lastWorkerBridgeSeq = Math.max(lastWorkerBridgeSeq, Number(state.inbound_seq || 0));
    if (outboundBridgeSeq || lastWorkerBridgeSeq) {
      log('bridge.sequence_restored', {
        outboundSeq: outboundBridgeSeq,
        inboundSeq: lastWorkerBridgeSeq,
      });
    }
  }

  function send(kind, payload = {}, extra = {}) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(
      JSON.stringify(
        makeEnvelope(
          kind,
          payload,
          { ...extra, seq: nextOutboundBridgeSeq() },
          relayTokenHash,
          daemonIdentity
        )
      )
    );
    void persistBridgeSequences();
    return true;
  }

  function queueLocalCommandResultRecord({
    commandMessageId,
    idempotencyKey,
    type,
    resultPayload,
    persist = true,
  }) {
    if (!persist || (!commandMessageId && !idempotencyKey)) return commandResultPersist;
    commandResultPersist = commandResultPersist
      .catch(() => {})
      .then(() =>
        rememberLocalCommandResult(
          {
            command_message_id: commandMessageId ?? null,
            idempotency_key: idempotencyKey ?? null,
            type,
            result_payload: resultPayload,
          },
          { storePath: commandResultStorePath }
        )
      )
      .then((result) => {
        if (result.status !== 'ok') log('command_result_store.write_failed', result);
      })
      .catch((error) => {
        log('command_result_store.write_failed', { message: error?.message || String(error) });
      });
    return commandResultPersist;
  }

  function sendCommandResultFor({
    commandMessageId,
    idempotencyKey,
    type,
    payload,
    persist = true,
  }) {
    const resultPayload = {
      command_message_id: commandMessageId ?? null,
      ...payload,
    };
    queueLocalCommandResultRecord({
      commandMessageId,
      idempotencyKey,
      type,
      resultPayload,
      persist,
    });
    return send('command_result', resultPayload, {
      idempotency_key: idempotencyKey,
    });
  }

  function sendResult(original, payload) {
    return sendCommandResultFor({
      commandMessageId: original.message_id ?? null,
      idempotencyKey: original.idempotency_key,
      type: original.payload?.type,
      payload,
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

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function clearHeartbeatTimer() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function clearRelayRefreshTimer() {
    if (!relayRefreshTimer) return;
    clearTimeout(relayRefreshTimer);
    relayRefreshTimer = null;
  }

  function scheduleRelayRefresh(expiresAt = relayTokenExpiresAt) {
    clearRelayRefreshTimer();
    if (noReconnect || bridgeRevoked || !relayToken || !relayTokenHash || !expiresAt) return;
    const expiresAtMs = Date.parse(String(expiresAt));
    if (!Number.isFinite(expiresAtMs)) return;
    const marginMs = Number.isFinite(relayRefreshMarginMs)
      ? Math.max(10_000, relayRefreshMarginMs)
      : DEFAULT_RELAY_REFRESH_MARGIN_MS;
    const delayMs = Math.max(1000, expiresAtMs - Date.now() - marginMs);
    relayRefreshTimer = setTimeout(() => {
      void refreshRelayToken().catch((error) => {
        log('bridge.relay_refresh_failed', { message: error?.message || String(error) });
        scheduleRelayRefresh(relayTokenExpiresAt);
      });
    }, delayMs);
  }

  async function refreshRelayToken() {
    if (relayRefreshInFlight || bridgeRevoked) return null;
    relayRefreshInFlight = true;
    const oldSocket = ws;
    let refreshedOk = false;
    suppressNextReconnect = Boolean(oldSocket && oldSocket.readyState !== WebSocket.CLOSED);
    try {
      const identity = await ensureDaemonIdentity({ allowCreate: false });
      const base = workerUrl.replace(/\/+$/, '');
      const challenge = await postJson(
        `${base}/api/local-agents/${encodeURIComponent(agentId)}/relay-token/challenge`,
        {}
      );
      const proof = signDaemonRelayRefreshProof({
        identity,
        agentId,
        challengeId: challenge.challenge_id,
        challenge: challenge.challenge,
      });
      const refreshed = await postJson(
        `${base}/api/local-agents/${encodeURIComponent(agentId)}/relay-token/refresh`,
        {
          challenge_id: challenge.challenge_id,
          challenge: challenge.challenge,
          ...proof,
        }
      );
      refreshedOk = true;
      relayToken = refreshed.relay_token;
      relayTokenHash = relayToken ? sha256Hex(relayToken) : null;
      relayTokenExpiresAt = refreshed.relay_token_expires_at || null;
      outboundBridgeSeq = 0;
      lastWorkerBridgeSeq = 0;
      clearHeartbeatTimer();
      try {
        oldSocket?.close(1012, 'relay token refreshed');
      } catch {
        /* socket may already be closing */
      }
      log('bridge.relay_refreshed', {
        agentId,
        relayToken: redact(relayToken),
        relayTokenExpiresAt,
      });
      scheduleRelayRefresh(relayTokenExpiresAt);
      if (!noReconnect && !bridgeRevoked && relayToken) {
        reconnectAttempt = 0;
        connect();
      }
      return refreshed;
    } finally {
      relayRefreshInFlight = false;
      if (!refreshedOk || !oldSocket || oldSocket.readyState === WebSocket.CLOSED) {
        suppressNextReconnect = false;
      }
    }
  }

  function handleBridgeRevoked(payload = {}) {
    bridgeRevoked = true;
    clearReconnectTimer();
    clearHeartbeatTimer();
    clearRelayRefreshTimer();
    const stoppedAgent = stopExternalAgent();
    const stoppedLoop = policyLoop.stop({ reason: 'bridge_revoked' });
    log('bridge.revoked', {
      reason: payload.reason || 'remote_revoke',
      stoppedAgent,
      stoppedPolicyLoop: stoppedLoop.policy_loop,
    });
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.close(1008, 'session revoked');
      } catch {
        /* socket may already be closing */
      }
    }
  }

  async function handleCommandResume(message, payload = {}) {
    const originalCommandMessageId = String(payload.command_message_id || '').trim();
    const originalIdempotencyKey = String(payload.idempotency_key || '').trim();
    const originalType = String(payload.original_type || '').trim() || null;
    if (!originalCommandMessageId && !originalIdempotencyKey) {
      sendResult(message, {
        status: 'error',
        code: 'COMMAND_RESUME_ID_REQUIRED',
        message: 'command.resume requires command_message_id or idempotency_key.',
      });
      return;
    }

    const inFlight = [...inFlightCommands.values()].find(
      (item) =>
        (originalCommandMessageId && item.command_message_id === originalCommandMessageId) ||
        (originalIdempotencyKey && item.idempotency_key === originalIdempotencyKey)
    );
    if (inFlight) {
      sendResult(message, {
        status: 'pending',
        code: 'COMMAND_RESUME_IN_FLIGHT',
        message: 'Original command is still executing in the local daemon.',
        original_command_message_id: inFlight.command_message_id,
        original_type: inFlight.type,
        started_at: inFlight.started_at,
      });
      return;
    }

    const found = await findLocalCommandResult(
      {
        commandMessageId: originalCommandMessageId,
        idempotencyKey: originalIdempotencyKey,
      },
      { storePath: commandResultStorePath }
    );
    if (found.status !== 'ok') {
      sendResult(message, {
        status: 'error',
        code: found.code || 'COMMAND_RESUME_STORE_FAILED',
        message: found.message || 'Local command result store could not be read.',
      });
      return;
    }

    if (found.found && found.result) {
      const storedPayload = found.result.result_payload || {};
      sendCommandResultFor({
        commandMessageId: found.result.command_message_id || originalCommandMessageId,
        idempotencyKey: found.result.idempotency_key || originalIdempotencyKey,
        type: found.result.type || originalType,
        payload: {
          ...storedPayload,
          resumed: true,
          resume_command_message_id: message.message_id ?? null,
          resumed_at: new Date().toISOString(),
        },
        persist: false,
      });
      sendResult(message, {
        status: 'ok',
        resumed: true,
        original_command_message_id: found.result.command_message_id || originalCommandMessageId,
        original_idempotency_key: found.result.idempotency_key || originalIdempotencyKey || null,
        original_type: found.result.type || originalType,
        original_result_status:
          typeof storedPayload.status === 'string' ? storedPayload.status : null,
      });
      return;
    }

    const notFound = {
      status: 'error',
      code: 'COMMAND_RESUME_NOT_FOUND',
      message:
        'No stored daemon result was found for the acknowledged command. The command was not replayed.',
      resume_command_message_id: message.message_id ?? null,
      resumed_at: new Date().toISOString(),
    };
    sendCommandResultFor({
      commandMessageId: originalCommandMessageId || null,
      idempotencyKey: originalIdempotencyKey || null,
      type: originalType,
      payload: notFound,
    });
    sendResult(message, {
      ...notFound,
      original_command_message_id: originalCommandMessageId || null,
      original_idempotency_key: originalIdempotencyKey || null,
      original_type: originalType,
    });
  }

  async function handleCommand(message) {
    const payload = message.payload || {};
    const type = payload.type;
    send('command_ack', {
      command_message_id: message.message_id ?? null,
      type,
      accepted: true,
    });
    if (type === 'command.resume') {
      await handleCommandResume(message, payload);
      return;
    }
    const commandMessageId = message.message_id ? String(message.message_id) : '';
    if (commandMessageId) {
      inFlightCommands.set(commandMessageId, {
        command_message_id: commandMessageId,
        idempotency_key: String(message.idempotency_key || ''),
        type,
        started_at: new Date().toISOString(),
      });
    }
    try {
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
            task_capability: commandResolution.task_capability || null,
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
        const [secretStore, walletStore] = await Promise.all([
          loadLocalSecretStore({ configPath: venueConfigPath }),
          loadLocalWalletStore({ configPath: walletConfigPath }),
        ]);
        const allowPlannedDispatch = Boolean(payload.allow_planned_dispatch);
        const verifyHyperliquidLiveGrant = payload.verify_live_grant !== false;
        const verifyOkxLiveRead = payload.verify_okx_live_read !== false;
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
              walletStore,
              verifyHyperliquidLiveGrant,
              verifyOkxLiveRead,
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
                solanaSignerCommand: payload.solana_signer_command || solanaSignerCommand,
                ethereumSignerCommand: payload.ethereum_signer_command || ethereumSignerCommand,
                signerTimeoutMs: Number(payload.signer_timeout_ms || signerTimeoutMs),
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
                task_capabilities: commandResolution.task_capabilities,
                task_capability: commandResolution.task_capability,
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
                  task_capabilities: commandResolution.task_capabilities,
                  task_capability: commandResolution.task_capability,
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
      if (type === 'authorization.revoke') {
        const result = await revokeLocalAuthorization(
          {
            ...payload,
            confirm: payload.confirm === true,
          },
          {
            venueConfigPath,
            walletConfigPath,
          }
        );
        await recordActivity({
          type,
          task: {
            venue_id: payload.venue_id || payload.venueId || null,
            key_handle: payload.key_handle || payload.keyHandle || null,
            wallet_id: payload.wallet_id || payload.walletId || payload.ows_wallet_id || null,
            authorization_ref:
              payload.authorization_ref || payload.authorizationRef || payload.ref || null,
          },
          commandMessageId: message.message_id ?? null,
          status: result.status,
          code: result.code || null,
          message:
            result.status === 'ok'
              ? `Local authorization metadata revoked for ${result.authorization_ref || result.wallet_id || result.key_handle}`
              : result.message,
          local_decision:
            result.status === 'ok'
              ? 'local_authorization_metadata_revoked'
              : 'blocked_before_authorization_revoke',
        });
        sendResult(message, result);
        return;
      }
      if (type === 'authorization.rotate') {
        const result = await rotateLocalAuthorization(
          {
            ...payload,
            confirm: payload.confirm === true,
          },
          {
            venueConfigPath,
          }
        );
        await recordActivity({
          type,
          task: {
            venue_id: payload.venue_id || payload.venueId || null,
            key_handle: payload.key_handle || payload.keyHandle || null,
            authorization_ref:
              payload.authorization_ref || payload.authorizationRef || payload.ref || null,
          },
          commandMessageId: message.message_id ?? null,
          status: result.status,
          code: result.code || null,
          message:
            result.status === 'ok'
              ? `Local authorization rotation metadata updated for ${result.authorization_ref || result.key_handle}`
              : result.message,
          local_decision:
            result.status === 'ok'
              ? 'local_authorization_rotation_metadata_updated'
              : 'blocked_before_authorization_rotate',
        });
        sendResult(message, result);
        return;
      }
      if (type === 'authorization.state') {
        const [secretStore, walletStore] = await Promise.all([
          loadLocalSecretStore({ configPath: venueConfigPath }),
          loadLocalWalletStore({ configPath: walletConfigPath }),
        ]);
        sendResult(
          message,
          buildAuthorizationStateSnapshot({
            secretStore,
            walletStore,
            scope: Array.isArray(payload.scope) ? payload.scope : null,
          })
        );
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
      if (type === 'wallet.refs') {
        sendResult(message, await loadLocalWalletStore({ configPath: walletConfigPath }));
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
      if (type === 'policy.local.add') {
        const policyInput =
          payload.policy && typeof payload.policy === 'object' && !Array.isArray(payload.policy)
            ? payload.policy
            : payload;
        const result = await upsertLocalPolicy(policyInput, { configPath: policyStorePath });
        await recordActivity({
          type,
          task: { policy_id: result.policy?.policy_id || policyInput.policy_id || policyInput.id },
          commandMessageId: message.message_id ?? null,
          status: result.status,
          code: result.code || null,
          message:
            result.status === 'ok'
              ? `Local policy ${result.policy.policy_id} registered`
              : result.message,
          local_decision:
            result.status === 'ok' ? 'policy_metadata_upserted' : 'blocked_before_policy_write',
        });
        sendResult(message, result);
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
        const [policyStore, secretStore, walletStore, agentRegistry] = await Promise.all([
          loadLocalPolicyStore({ configPath: policyStorePath }),
          loadLocalSecretStore({ configPath: venueConfigPath }),
          loadLocalWalletStore({ configPath: walletConfigPath }),
          loadAgentRegistry({ configPath: agentRegistryPath }),
        ]);
        sendResult(
          message,
          await runDuePolicyTasks({
            policyStore,
            policyStorePath,
            secretStore,
            walletStore,
            agentRegistry,
            limit: Number(payload.limit || 50),
            checkReadiness: Boolean(payload.check_readiness || payload.dispatch),
            checkInventory: Boolean(payload.check_inventory || payload.live_inventory),
            liveInventory: Boolean(payload.live_inventory),
            marketSnapshot: payload.market_snapshot || payload.marketSnapshot || null,
            getMarketSnapshot:
              payload.live_market && !payload.market_snapshot && !payload.marketSnapshot
                ? buildMarketSnapshotReader(marketCliOptions(payload))
                : undefined,
            dispatch: Boolean(payload.dispatch),
            markTicks: payload.mark === true,
            defaultAgentCommand,
            timeoutMs: Number(payload.timeout_ms || 30_000),
            verifyReceipt: payload.verify_receipt !== false,
            verifyHyperliquidLiveGrant:
              Boolean(payload.dispatch) && payload.verify_live_grant !== false,
            verifyOkxLiveRead: Boolean(payload.dispatch) && payload.verify_okx_live_read !== false,
            requireSignerProbe: Boolean(payload.require_signer_probe),
            signerProbeTimeoutMs: Number(payload.signer_probe_timeout_ms || 3000),
            signerTimeoutMs: Number(payload.signer_timeout_ms || signerTimeoutMs),
            solanaSignerCommand: payload.solana_signer_command || solanaSignerCommand,
            ethereumSignerCommand: payload.ethereum_signer_command || ethereumSignerCommand,
            simulated: payload.simulated !== false,
            hyperliquidNonceStorePath,
            getInventorySnapshot:
              payload.check_inventory || payload.live_inventory
                ? buildInventorySnapshotReader(secretStore, {
                    simulated: payload.simulated !== false,
                  })
                : undefined,
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
            check_inventory: payload.check_inventory,
            live_inventory: payload.live_inventory,
            live_market: payload.live_market,
            market_venues: payload.market_venues || payload.marketVenues,
            market_symbols: payload.market_symbols || payload.marketSymbols,
            dispatch: payload.dispatch,
            mark: payload.mark,
            verify_receipt: payload.verify_receipt,
            verify_live_grant: payload.verify_live_grant,
            verify_okx_live_read:
              Boolean(payload.dispatch) && payload.verify_okx_live_read !== false,
            require_signer_probe: payload.require_signer_probe,
            signer_probe_timeout_ms: payload.signer_probe_timeout_ms,
            signer_timeout_ms: payload.signer_timeout_ms,
            solana_signer_command: payload.solana_signer_command || solanaSignerCommand,
            ethereum_signer_command: payload.ethereum_signer_command || ethereumSignerCommand,
            timeout_ms: payload.timeout_ms,
            simulated: payload.simulated,
            market_snapshot: payload.market_snapshot || payload.marketSnapshot || null,
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
            check_inventory: payload.check_inventory,
            live_inventory: payload.live_inventory,
            live_market: payload.live_market,
            market_venues: payload.market_venues || payload.marketVenues,
            market_symbols: payload.market_symbols || payload.marketSymbols,
            dispatch: payload.dispatch,
            mark: payload.mark,
            verify_receipt: payload.verify_receipt,
            verify_live_grant: payload.verify_live_grant,
            verify_okx_live_read:
              Boolean(payload.dispatch) && payload.verify_okx_live_read !== false,
            require_signer_probe: payload.require_signer_probe,
            signer_probe_timeout_ms: payload.signer_probe_timeout_ms,
            signer_timeout_ms: payload.signer_timeout_ms,
            solana_signer_command: payload.solana_signer_command || solanaSignerCommand,
            ethereum_signer_command: payload.ethereum_signer_command || ethereumSignerCommand,
            timeout_ms: payload.timeout_ms,
            simulated: payload.simulated,
            market_snapshot: payload.market_snapshot || payload.marketSnapshot || null,
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
    } finally {
      if (commandMessageId) inFlightCommands.delete(commandMessageId);
    }
  }

  function connect() {
    const wsUrl = workerToWebSocketUrl(workerUrl, agentId);
    const wsProtocol = relayTokenProtocol(relayToken);
    log('bridge.connecting', { workerUrl, agentId, relayToken: redact(relayToken) });
    const socket = wsProtocol ? new WebSocket(wsUrl, wsProtocol) : new WebSocket(wsUrl);
    ws = socket;
    socket.addEventListener('open', () => {
      if (ws !== socket) {
        try {
          socket.close(1000, 'stale socket');
        } catch {
          /* socket may already be closing */
        }
        return;
      }
      reconnectAttempt = 0;
      log('bridge.connected', { agentId });
      void statusPayload().then((payload) => send('hello', payload));
      heartbeatTimer = setInterval(() => {
        void statusPayload().then((payload) => send('heartbeat', payload));
      }, HEARTBEAT_MS);
    });
    socket.addEventListener('message', (event) => {
      if (ws !== socket) return;
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        log('bridge.bad_json');
        return;
      }
      const signatureCheck = verifyDaemonBridgeEnvelope(message, relayTokenHash);
      if (!signatureCheck.ok) {
        log('bridge.signature_failed', {
          code: signatureCheck.code,
          messageId: message.message_id || null,
          kind: message.kind || null,
        });
        return;
      }
      const workerSignatureCheck = verifyWorkerBridgeEnvelope(message, {
        workerPublicKey:
          workerBridgePublicKey ||
          (message.kind === 'session_accepted' ? message.payload?.worker_public_key : null),
        workerPublicKeyId:
          workerBridgePublicKeyId ||
          (message.kind === 'session_accepted' ? message.payload?.worker_public_key_id : null),
      });
      if (!workerSignatureCheck.ok) {
        log('bridge.worker_signature_failed', {
          code: workerSignatureCheck.code,
          messageId: message.message_id || null,
          kind: message.kind || null,
        });
        return;
      }
      const timingCheck = validateBridgeEnvelopeTiming(message, {
        requireExpiresAt: message.kind === 'command',
      });
      if (!timingCheck.ok) {
        log('bridge.timing_failed', {
          code: timingCheck.code,
          messageId: message.message_id || null,
          kind: message.kind || null,
          issuedAt: message.issued_at || null,
          expiresAt: message.expires_at || null,
        });
        if (message.kind === 'command') {
          sendResult(message, {
            status: 'error',
            code: timingCheck.code,
            message: timingCheck.message,
            local_decision: 'blocked_before_dispatch',
          });
        }
        return;
      }
      const sequenceCheck = validateBridgeEnvelopeSequence(message, lastWorkerBridgeSeq);
      if (!sequenceCheck.ok) {
        log('bridge.sequence_failed', {
          code: sequenceCheck.code,
          messageId: message.message_id || null,
          kind: message.kind || null,
          seq: message.seq || null,
          lastSeq: sequenceCheck.last_seq || null,
        });
        return;
      }
      lastWorkerBridgeSeq = sequenceCheck.seq;
      void persistBridgeSequences();
      if (isSessionRevokedMessage(message)) {
        handleBridgeRevoked(message.payload || {});
        return;
      }
      if (message.kind === 'session_accepted') {
        workerBridgePublicKey = workerSignatureCheck.worker_public_key;
        workerBridgePublicKeyId = workerSignatureCheck.worker_public_key_id;
        log('bridge.session_accepted', {
          ...(message.payload || {}),
          worker_public_key: workerBridgePublicKey ? 'configured' : null,
        });
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
    });
    socket.addEventListener('close', (event) => {
      if (ws === socket) {
        clearHeartbeatTimer();
        ws = null;
      }
      log('bridge.closed', { code: event.code, reason: event.reason || null });
      if (suppressNextReconnect) {
        suppressNextReconnect = false;
        return;
      }
      if (isRevokedCloseEvent(event)) bridgeRevoked = true;
      if (!shouldReconnectBridge({ noReconnect, bridgeRevoked, closeEvent: event })) return;
      const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
    socket.addEventListener('error', () => {
      log('bridge.error');
    });
  }

  if (pairingCode) {
    log('bridge.pairing', { workerUrl, pairingCode: redact(pairingCode) });
    const paired = await pairWithWorker({ workerUrl, pairingCode, agentId, identityStorePath });
    daemonIdentity = paired.daemon_identity || daemonIdentity;
    agentId = paired.agent_id || agentId;
    relayToken = paired.relay_token;
    relayTokenExpiresAt = paired.relay_token_expires_at || null;
    relayTokenHash = relayToken ? sha256Hex(relayToken) : null;
    outboundBridgeSeq = 0;
    lastWorkerBridgeSeq = 0;
    log('bridge.paired', {
      agentId,
      relayToken: redact(relayToken),
      relayTokenExpiresAt: paired.relay_token_expires_at,
    });
  }

  await ensureDaemonIdentity({ allowCreate: Boolean(pairingCode) });
  await restoreBridgeSequences();
  scheduleRelayRefresh(relayTokenExpiresAt);

  if (policyLoopConfig.enabled) {
    const started = policyLoop.start({
      intervalMs: policyLoopConfig.intervalMs,
      checkReadiness: policyLoopConfig.checkReadiness,
      checkInventory: policyLoopConfig.checkInventory,
      liveInventory: policyLoopConfig.liveInventory,
      liveMarket: policyLoopConfig.liveMarket,
      marketVenues: policyLoopConfig.market.venues,
      marketSymbols: policyLoopConfig.market.symbols,
      dispatch: policyLoopConfig.dispatch,
      verifyOkxLiveRead: policyLoopConfig.verifyOkxLiveRead,
      markTicks: policyLoopConfig.markTicks,
      signerTimeoutMs: policyLoopConfig.signerTimeoutMs,
      solanaSignerCommand: policyLoopConfig.solanaSignerCommand,
      ethereumSignerCommand: policyLoopConfig.ethereumSignerCommand,
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
