import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  LOCAL_POLICY_ETHEREUM_ACCOUNT,
  LOCAL_POLICY_SOLANA_OWNER,
  buildLocalPolicyMetadata,
} from '../src/local-policy-metadata.js';
import { signDaemonRelayRefreshProof } from '../agent/src/daemon-identity-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORKER_DIR = path.join(ROOT, 'worker');
const AGENT_DIR = path.join(ROOT, 'agent');
const PORT = Number(process.env.SENTRY_BRIDGE_SMOKE_PORT || 8797);
const WORKER_URL = `http://localhost:${PORT}`;
const AGENT_ID = process.env.SENTRY_BRIDGE_SMOKE_AGENT_ID || 'default';
const SECRET_FIELD_NAMES = new Set([
  'secret',
  'api_secret',
  'apiSecret',
  'private_key',
  'privateKey',
  'passphrase',
  'password',
  'seed',
  'mnemonic',
  'token',
  'api_token',
  'apiToken',
  'ows_token',
  'owsToken',
  'wallet_token',
  'walletToken',
]);
const SECRET_VALUE_RE = /smoke-secret|smoke-passphrase/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      reject(
        new Error(
          `Port ${port} is already in use. Stop the existing process or set SENTRY_BRIDGE_SMOKE_PORT. ${error.message}`
        )
      );
    });
    server.once('listening', () => {
      server.close(resolve);
    });
    server.listen(port, '127.0.0.1');
  });
}

function spawnManaged(command, args, options = {}) {
  const logs = [];
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (stream, label) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const text = String(chunk);
      logs.push(
        ...text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => `${label}: ${line}`)
      );
      while (logs.length > 120) logs.shift();
    });
  };
  capture(child.stdout, command);
  capture(child.stderr, command);
  return { child, logs };
}

async function stopManaged(proc) {
  if (!proc?.child?.pid || proc.child.killed) return;
  try {
    process.kill(-proc.child.pid, 'SIGTERM');
  } catch {
    try {
      proc.child.kill('SIGTERM');
    } catch {
      return;
    }
  }
  await Promise.race([new Promise((resolve) => proc.child.once('exit', resolve)), sleep(1500)]);
  if (!proc.child.killed && proc.child.exitCode === null) {
    try {
      process.kill(-proc.child.pid, 'SIGKILL');
    } catch {
      try {
        proc.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${WORKER_URL}${pathname}`, options);
  const body = await response.json().catch(() => ({
    status: 'error',
    code: `HTTP_${response.status}`,
    message: `HTTP ${response.status}`,
  }));
  if (!response.ok) {
    const error = new Error(body.message || body.code || `HTTP ${response.status}`);
    error.body = body;
    throw error;
  }
  return body;
}

async function waitFor(label, fn, { timeoutMs = 30_000, intervalMs = 300 } = {}) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  const detail = lastError?.message ? ` Last error: ${lastError.message}` : '';
  throw new Error(`${label} did not become ready within ${timeoutMs}ms.${detail}`);
}

async function submitCommand({ token, type, payload }) {
  const queued = await fetchJson(`/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      type,
      payload,
      idempotency_key: `smoke_${type.replace(/[^a-z0-9_.:-]+/gi, '_')}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    }),
  });
  const commandId = queued.command?.message_id || queued.command_record?.command_id;
  if (!commandId) throw new Error(`Worker did not return a command id for ${type}`);
  return waitFor(`command ${type}`, async () => {
    const polled = await fetchJson(
      `/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands/${encodeURIComponent(commandId)}`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    return polled.command?.command_status === 'result' ? polled.command : null;
  });
}

function smokePolicy() {
  return {
    ...buildLocalPolicyMetadata({
      values: {
        scenario: 'funding-arb',
        budget: 25,
        slip: 0.5,
        expiry: 14,
        requireApproval: false,
        leverage: 1,
        liqBuffer: 12,
        legs: [
          { venue: 'OKX', side: 'short', pct: 50 },
          { venue: 'Hyperliquid', side: 'long', pct: 50 },
        ],
      },
      meta: { name: 'Smoke Hyperliquid OKX Policy', budget: 25, slip: 0.5 },
      text: 'Smoke-test Hyperliquid and OKX local daemon policy registration.',
      targetAgent: 'codex',
    }),
    policy_id: 'smoke-hyperliquid-okx-policy',
    next_tick_after: new Date(Date.now() - 1000).toISOString(),
  };
}

function smokeChainPolicy() {
  return {
    ...buildLocalPolicyMetadata({
      values: {
        scenario: 'spot',
        budget: 25,
        slip: 0.5,
        expiry: 14,
        requireApproval: false,
        leverage: 1,
        liqBuffer: 12,
        legs: [
          { venue: 'Raydium', side: 'long', pct: 50 },
          { venue: 'Uniswap', side: 'short', pct: 50 },
        ],
      },
      meta: { name: 'Smoke Solana Ethereum Policy', budget: 25, slip: 0.5 },
      text: 'Smoke-test Solana and Ethereum local daemon wallet handoff policy registration.',
      targetAgent: 'codex',
    }),
    policy_id: 'smoke-solana-ethereum-policy',
    next_tick_after: new Date(Date.now() - 1000).toISOString(),
  };
}

function smokeVenueConfig() {
  return {
    version: 1,
    venues: [
      {
        venue_id: 'okx',
        key_handle: 'smoke_okx_key',
        display_handle: 'okx_....smoke',
        account_ref: 'okx:subaccount:smoke',
        storage: 'os_keychain',
        permissions: ['read', 'place_order', 'cancel_order'],
        ip_allowlist: true,
        status: 'linked',
      },
      {
        venue_id: 'hyperliquid',
        key_handle: 'smoke_hl_key',
        display_handle: 'hl_....smoke',
        account_ref: 'hyperliquid:subaccount:smoke',
        read_account_address: '0x0000000000000000000000000000000000000001',
        agent_wallet_address: '0x0000000000000000000000000000000000000042',
        agent_wallet_grant: {
          status: 'active',
          source: 'metadata_attestation',
          verified_at: '2026-06-03T00:00:00.000Z',
          permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
        },
        storage: 'os_keychain',
        permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
        status: 'linked',
      },
    ],
  };
}

function smokeWalletConfig() {
  return {
    version: 1,
    wallets: [
      {
        wallet_id: 'smoke-ows',
        provider: 'ows',
        display_name: 'Smoke OWS Wallet',
        vault_path: '~/.ows-smoke',
        status: 'linked',
        accounts: [
          {
            chain_id: 'solana:mainnet',
            address: LOCAL_POLICY_SOLANA_OWNER,
            capabilities: ['read', 'sign', 'submit_tx'],
          },
          {
            chain_id: 'eip155:1',
            address: LOCAL_POLICY_ETHEREUM_ACCOUNT,
            capabilities: ['read', 'sign', 'submit_tx'],
          },
        ],
      },
    ],
  };
}

function smokeMarketSnapshot() {
  return {
    markets: [
      {
        venue_id: 'hyperliquid',
        symbol: 'BTC',
        funding_rate: 0.0002,
        price: '90000',
        health: 'ok',
      },
      {
        venue_id: 'solana-mainnet',
        symbol: 'BTC',
        price: '1',
        health: 'ok',
      },
    ],
  };
}

function rawSecretFieldPath(value, prefix = '') {
  if (!value || typeof value !== 'object') return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && SECRET_FIELD_NAMES.has(key)) return path;
    const nested = rawSecretFieldPath(child, path);
    if (nested) return nested;
  }
  return null;
}

function parseJsonOrJsonl(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    return [JSON.parse(trimmed)];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

async function assertNoSecretMaterial(filePath, label) {
  const text = await readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const records = parseJsonOrJsonl(text);
  const secretFieldPath = rawSecretFieldPath(records);
  if (secretFieldPath) {
    throw new Error(`${label} contains a raw secret-shaped field: ${secretFieldPath}.`);
  }
  if (SECRET_VALUE_RE.test(text)) {
    throw new Error(`${label} contains smoke secret material.`);
  }
}

async function assertNoSmokeSecretValues(filePath, label) {
  const text = await readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  if (SECRET_VALUE_RE.test(text)) {
    throw new Error(`${label} contains smoke secret material.`);
  }
}

async function main() {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sentry-local-bridge-smoke-'));
  const paths = {
    policies: path.join(tempDir, 'policies.json'),
    activity: path.join(tempDir, 'activity.jsonl'),
    agents: path.join(tempDir, 'agents.json'),
    venues: path.join(tempDir, 'venues.json'),
    wallets: path.join(tempDir, 'wallets.json'),
    identity: path.join(tempDir, 'identity.json'),
    bridgeSequences: path.join(tempDir, 'bridge-sequences.json'),
    commandResults: path.join(tempDir, 'command-results.json'),
  };
  let worker;
  let daemon;

  try {
    await assertPortFree(PORT);
    await writeFile(paths.venues, `${JSON.stringify(smokeVenueConfig(), null, 2)}\n`, {
      mode: 0o600,
    });
    await writeFile(paths.wallets, `${JSON.stringify(smokeWalletConfig(), null, 2)}\n`, {
      mode: 0o600,
    });
    worker = spawnManaged('npm', ['run', 'dev', '--', '--port', String(PORT)], { cwd: WORKER_DIR });
    await waitFor('worker', async () => {
      const response = await fetch(WORKER_URL).catch(() => null);
      if (!response?.ok) return false;
      const body = await response.json().catch(() => null);
      return body?.service === 'sentry-worker';
    });

    const pairing = await fetchJson('/api/local-agents/pairing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner: 'smoke-owner', device_label: 'smoke-local-daemon' }),
    });
    if (pairing.status !== 'ok' || !pairing.pairing_code || !pairing.owner_control_token) {
      throw new Error('Worker did not return pairing credentials.');
    }

    daemon = spawnManaged(
      process.execPath,
      [
        'src/index.mjs',
        '--pairing-code',
        pairing.pairing_code,
        '--worker-url',
        WORKER_URL,
        '--agent-id',
        AGENT_ID,
        '--policy-store',
        paths.policies,
        '--activity-log',
        paths.activity,
        '--command-result-store',
        paths.commandResults,
        '--identity-store',
        paths.identity,
        '--agent-registry',
        paths.agents,
        '--venue-config',
        paths.venues,
        '--wallet-config',
        paths.wallets,
        '--bridge-sequence-store',
        paths.bridgeSequences,
        '--no-reconnect',
      ],
      {
        cwd: AGENT_DIR,
        env: {
          ...process.env,
          SENTRY_OKX_SMOKE_OKX_KEY_API_KEY: 'smoke-key',
          SENTRY_OKX_SMOKE_OKX_KEY_SECRET_KEY: 'smoke-secret',
          SENTRY_OKX_SMOKE_OKX_KEY_PASSPHRASE: 'smoke-passphrase',
        },
      }
    );

    await waitFor('daemon session', async () => {
      const body = await fetchJson(`/api/local-agents/${encodeURIComponent(AGENT_ID)}`);
      return body.session_status === 'online' ? body : null;
    });

    const secretStoreRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'secret.store',
      payload: {},
    });
    if (secretStoreRecord.result_status !== 'ok' || secretStoreRecord.result?.key_count !== 2) {
      throw new Error(
        `secret.store did not load smoke venue metadata: ${JSON.stringify(secretStoreRecord.result)}`
      );
    }

    const authorizationStateRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.state',
      payload: {},
    });
    if (
      authorizationStateRecord.result_status !== 'partial' ||
      authorizationStateRecord.result?.state_count !== 5 ||
      authorizationStateRecord.result?.target_states?.length !== 4
    ) {
      throw new Error(
        `authorization.state did not return the expected target snapshot: ${JSON.stringify(
          authorizationStateRecord.result
        )}`
      );
    }
    const authorizationStates = new Map(
      (authorizationStateRecord.result.states || []).map((state) => [state.venue_id, state])
    );
    for (const [venueId, expectedStatus] of [
      ['okx', 'metadata_ready'],
      ['hyperliquid', 'metadata_ready'],
      ['solana-mainnet', 'partial'],
      ['ethereum-mainnet', 'partial'],
    ]) {
      const state = authorizationStates.get(venueId);
      if (state?.status !== expectedStatus) {
        throw new Error(
          `authorization.state returned unexpected ${venueId} state: ${JSON.stringify(state)}`
        );
      }
    }
    if (
      !authorizationStateRecord.result.access_issues?.some(
        (issue) => issue.code === 'NATIVE_DELEGATION_GRANT_NOT_INSTALLED'
      ) ||
      !authorizationStateRecord.result.access_issues?.some(
        (issue) => issue.code === 'SMART_ACCOUNT_GRANT_NOT_INSTALLED'
      )
    ) {
      throw new Error(
        `authorization.state did not expose the planned chain grant gaps: ${JSON.stringify(
          authorizationStateRecord.result.access_issues
        )}`
      );
    }

    const rotateHyperliquidRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.rotate',
      payload: {
        venue_id: 'hyperliquid',
        key_handle: 'smoke_hl_key',
        rotated_at: '2026-06-04T00:00:00.000Z',
        reason: 'smoke_local_key_rotation',
        confirm: true,
      },
    });
    if (
      rotateHyperliquidRecord.result_status !== 'ok' ||
      rotateHyperliquidRecord.result?.rotate_target !== 'venue_key' ||
      rotateHyperliquidRecord.result?.manual_rotation_required !== true ||
      rotateHyperliquidRecord.result?.live_authority_rotated !== false
    ) {
      throw new Error(
        `authorization.rotate did not locally mark Hyperliquid metadata rotated: ${JSON.stringify(
          rotateHyperliquidRecord.result
        )}`
      );
    }
    const postRotateAuthorizationStateRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.state',
      payload: {
        scope: ['hyperliquid'],
      },
    });
    const hyperliquidPostRotateState = postRotateAuthorizationStateRecord.result?.states?.find(
      (state) => state.venue_id === 'hyperliquid'
    );
    if (
      postRotateAuthorizationStateRecord.result_status !== 'ok' ||
      hyperliquidPostRotateState?.rotation_state?.status !== 'fresh' ||
      hyperliquidPostRotateState?.rotation_state?.rotated_at !== '2026-06-04T00:00:00.000Z'
    ) {
      throw new Error(
        `authorization.state did not reflect local rotation: ${JSON.stringify(
          postRotateAuthorizationStateRecord.result
        )}`
      );
    }

    const addRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.add',
      payload: { policy: smokePolicy() },
    });
    if (
      addRecord.result_status !== 'ok' ||
      addRecord.result?.policy?.policy_id !== 'smoke-hyperliquid-okx-policy'
    ) {
      throw new Error(`policy.local.add failed: ${JSON.stringify(addRecord.result)}`);
    }
    const addChainRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.add',
      payload: { policy: smokeChainPolicy() },
    });
    if (
      addChainRecord.result_status !== 'ok' ||
      addChainRecord.result?.policy?.policy_id !== 'smoke-solana-ethereum-policy'
    ) {
      throw new Error(
        `policy.local.add chain policy failed: ${JSON.stringify(addChainRecord.result)}`
      );
    }

    const listRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.list',
      payload: {},
    });
    if (listRecord.result?.policy_count !== 2 || listRecord.result?.active_count !== 2) {
      throw new Error(
        `policy.local.list did not return two active policies: ${JSON.stringify(listRecord.result)}`
      );
    }
    const policies = Array.isArray(listRecord.result?.policies) ? listRecord.result.policies : [];
    const listedPolicy = policies.find(
      (policy) => policy.policy_id === 'smoke-hyperliquid-okx-policy'
    );
    const listedChainPolicy = policies.find(
      (policy) => policy.policy_id === 'smoke-solana-ethereum-policy'
    );
    if (!listedPolicy) {
      throw new Error(
        `policy.local.list did not return smoke policy: ${JSON.stringify(listRecord.result)}`
      );
    }
    if (!listedChainPolicy) {
      throw new Error(
        `policy.local.list did not return chain smoke policy: ${JSON.stringify(listRecord.result)}`
      );
    }
    if (listedPolicy.status !== 'active') {
      throw new Error(`Smoke policy is not active: ${listedPolicy.status}`);
    }
    if (listedChainPolicy.status !== 'active') {
      throw new Error(`Chain smoke policy is not active: ${listedChainPolicy.status}`);
    }

    const planRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.plan',
      payload: {},
    });
    if (
      planRecord.result_status !== 'ok' ||
      planRecord.result?.planned_task_count !== 4 ||
      planRecord.result?.blocked_task_count !== 0
    ) {
      throw new Error(
        `policy.local.plan did not produce four planned tasks: ${JSON.stringify(planRecord.result)}`
      );
    }

    const runOnceRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.run_once',
      payload: {
        check_readiness: true,
        dispatch: false,
        simulated: true,
        market_snapshot: smokeMarketSnapshot(),
      },
    });
    if (
      runOnceRecord.result_status !== 'ok' ||
      runOnceRecord.result?.status !== 'ok' ||
      runOnceRecord.result?.mode !== 'readiness' ||
      runOnceRecord.result?.ready_task_count !== 4 ||
      runOnceRecord.result?.dispatched_task_count !== 0
    ) {
      throw new Error(
        `policy.local.run_once preflight failed: ${JSON.stringify(runOnceRecord.result)}`
      );
    }
    for (const result of runOnceRecord.result.results || []) {
      if (result.status !== 'ready') {
        throw new Error(
          `policy.local.run_once returned a non-ready task: ${JSON.stringify(result)}`
        );
      }
      if (result.market_trigger?.status !== 'ok') {
        throw new Error(
          `policy.local.run_once did not satisfy market trigger: ${JSON.stringify(result)}`
        );
      }
    }

    const revokeOkxRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.revoke',
      payload: {
        venue_id: 'okx',
        key_handle: 'smoke_okx_key',
        reason: 'smoke_local_authorization_revoke',
        confirm: true,
      },
    });
    if (
      revokeOkxRecord.result_status !== 'ok' ||
      revokeOkxRecord.result?.revoke_target !== 'venue_key' ||
      revokeOkxRecord.result?.manual_revoke_required !== true ||
      revokeOkxRecord.result?.live_authority_revoked !== false
    ) {
      throw new Error(
        `authorization.revoke did not locally revoke OKX metadata: ${JSON.stringify(
          revokeOkxRecord.result
        )}`
      );
    }
    const revokeWalletRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.revoke',
      payload: {
        wallet_id: 'smoke-ows',
        reason: 'smoke_local_authorization_revoke',
        confirm: true,
      },
    });
    if (
      revokeWalletRecord.result_status !== 'ok' ||
      revokeWalletRecord.result?.revoke_target !== 'wallet_ref' ||
      revokeWalletRecord.result?.chain_revoke_required !== true ||
      revokeWalletRecord.result?.live_authority_revoked !== false
    ) {
      throw new Error(
        `authorization.revoke did not locally revoke OWS wallet metadata: ${JSON.stringify(
          revokeWalletRecord.result
        )}`
      );
    }
    const postRevokeAuthorizationStateRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'authorization.state',
      payload: {
        scope: ['okx', 'solana-mainnet', 'ethereum-mainnet'],
      },
    });
    if (
      postRevokeAuthorizationStateRecord.result_status !== 'blocked' ||
      !postRevokeAuthorizationStateRecord.result?.access_issues?.some(
        (issue) => issue.code === 'VENUE_KEY_REVOKED_LOCALLY'
      ) ||
      !postRevokeAuthorizationStateRecord.result?.access_issues?.some(
        (issue) => issue.code === 'WALLET_REF_REVOKED_LOCALLY'
      )
    ) {
      throw new Error(
        `authorization.state did not reflect local revoke: ${JSON.stringify(
          postRevokeAuthorizationStateRecord.result
        )}`
      );
    }

    const postRevokeRunOnceRecord = await submitCommand({
      token: pairing.owner_control_token,
      type: 'policy.local.run_once',
      payload: {
        check_readiness: true,
        dispatch: false,
        simulated: true,
        market_snapshot: smokeMarketSnapshot(),
      },
    });
    if (
      postRevokeRunOnceRecord.result_status !== 'partial' ||
      postRevokeRunOnceRecord.result?.status !== 'partial' ||
      postRevokeRunOnceRecord.result?.mode !== 'readiness' ||
      postRevokeRunOnceRecord.result?.ready_task_count !== 1 ||
      postRevokeRunOnceRecord.result?.blocked_task_count !== 3 ||
      postRevokeRunOnceRecord.result?.dispatched_task_count !== 0
    ) {
      throw new Error(
        `policy.local.run_once did not enforce local authorization revoke: ${JSON.stringify(
          postRevokeRunOnceRecord.result
        )}`
      );
    }
    const postRevokeResults = postRevokeRunOnceRecord.result.results || [];
    const postRevokeCodes = new Set(postRevokeResults.map((result) => result.code).filter(Boolean));
    if (
      !postRevokeResults.some(
        (result) => result.venue_id === 'hyperliquid' && result.status === 'ready'
      ) ||
      (!postRevokeCodes.has('KEY_NOT_LINKED') &&
        !postRevokeCodes.has('OKX_TRADE_PERMISSION_REQUIRED')) ||
      !postRevokeCodes.has('SOLANA_OWS_WALLET_NOT_LINKED') ||
      !postRevokeCodes.has('ETHEREUM_OWS_WALLET_NOT_LINKED')
    ) {
      throw new Error(
        `post-revoke readiness did not return expected blocked venues/codes: ${JSON.stringify(
          postRevokeResults
        )}`
      );
    }

    const identity = JSON.parse(await readFile(paths.identity, 'utf8'));
    const challenge = await fetchJson(
      `/api/local-agents/${encodeURIComponent(AGENT_ID)}/relay-token/challenge`,
      { method: 'POST' }
    );
    if (challenge.status !== 'ok' || !challenge.challenge_id || !challenge.challenge) {
      throw new Error(`relay-token challenge failed: ${JSON.stringify(challenge)}`);
    }
    const refreshProof = signDaemonRelayRefreshProof({
      identity,
      agentId: AGENT_ID,
      challengeId: challenge.challenge_id,
      challenge: challenge.challenge,
    });
    const refresh = await fetchJson(
      `/api/local-agents/${encodeURIComponent(AGENT_ID)}/relay-token/refresh`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challenge.challenge_id,
          challenge: challenge.challenge,
          ...refreshProof,
        }),
      }
    );
    if (refresh.status !== 'ok' || !String(refresh.relay_token || '').startsWith('rt_')) {
      throw new Error(`relay-token refresh failed: ${JSON.stringify(refresh)}`);
    }
    await stopManaged(daemon);
    daemon = null;
    const offlineIdempotencyKey = `smoke_offline_activity_tail_${Date.now()}_${Math.random()
      .toString(16)
      .slice(2)}`;
    const offlineQueued = await fetchJson(
      `/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pairing.owner_control_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'activity.tail',
          payload: { limit: 1 },
          idempotency_key: offlineIdempotencyKey,
        }),
      }
    );
    if (offlineQueued.status !== 'ok' || offlineQueued.deferred !== true) {
      throw new Error(
        `offline replayable command was not deferred: ${JSON.stringify(offlineQueued)}`
      );
    }
    const duplicateOfflineQueued = await fetchJson(
      `/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pairing.owner_control_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'activity.tail',
          payload: { limit: 1 },
          idempotency_key: offlineIdempotencyKey,
        }),
      }
    );
    if (
      duplicateOfflineQueued.status !== 'ok' ||
      duplicateOfflineQueued.duplicate !== true ||
      duplicateOfflineQueued.command_record?.command_id !== offlineQueued.command_record?.command_id
    ) {
      throw new Error(
        `duplicate offline command did not return existing record: ${JSON.stringify(
          duplicateOfflineQueued
        )}`
      );
    }
    let idempotencyConflict = null;
    try {
      await fetchJson(`/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${pairing.owner_control_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          type: 'agent.status',
          payload: {},
          idempotency_key: offlineIdempotencyKey,
        }),
      });
    } catch (error) {
      idempotencyConflict = error.body;
    }
    if (idempotencyConflict?.code !== 'IDEMPOTENCY_KEY_CONFLICT') {
      throw new Error(
        `idempotency conflict did not fail safely: ${JSON.stringify(idempotencyConflict)}`
      );
    }
    const offlineCommandId =
      offlineQueued.command?.message_id || offlineQueued.command_record?.command_id;
    if (!offlineCommandId) throw new Error('Deferred offline command did not return a command id.');

    daemon = spawnManaged(
      process.execPath,
      [
        'src/index.mjs',
        '--relay-token',
        refresh.relay_token,
        '--relay-token-expires-at',
        refresh.relay_token_expires_at,
        '--worker-url',
        WORKER_URL,
        '--agent-id',
        AGENT_ID,
        '--policy-store',
        paths.policies,
        '--activity-log',
        paths.activity,
        '--command-result-store',
        paths.commandResults,
        '--identity-store',
        paths.identity,
        '--agent-registry',
        paths.agents,
        '--venue-config',
        paths.venues,
        '--wallet-config',
        paths.wallets,
        '--bridge-sequence-store',
        paths.bridgeSequences,
        '--no-reconnect',
      ],
      {
        cwd: AGENT_DIR,
        env: {
          ...process.env,
          SENTRY_OKX_SMOKE_OKX_KEY_API_KEY: 'smoke-key',
          SENTRY_OKX_SMOKE_OKX_KEY_SECRET_KEY: 'smoke-secret',
          SENTRY_OKX_SMOKE_OKX_KEY_PASSPHRASE: 'smoke-passphrase',
        },
      }
    );
    await waitFor('daemon replay session', async () => {
      const body = await fetchJson(`/api/local-agents/${encodeURIComponent(AGENT_ID)}`);
      return body.session_status === 'online' ? body : null;
    });
    const replayedOfflineRecord = await waitFor('offline replayed command', async () => {
      const polled = await fetchJson(
        `/api/local-agents/${encodeURIComponent(AGENT_ID)}/commands/${encodeURIComponent(offlineCommandId)}`,
        { headers: { authorization: `Bearer ${pairing.owner_control_token}` } }
      );
      return polled.command?.command_status === 'result' ? polled.command : null;
    });
    if (
      replayedOfflineRecord.result_status !== 'ok' ||
      replayedOfflineRecord.result?.status !== 'ok'
    ) {
      throw new Error(
        `offline replayed command did not complete: ${JSON.stringify(replayedOfflineRecord)}`
      );
    }

    await assertNoSecretMaterial(paths.policies, 'Temporary policy store');
    await assertNoSecretMaterial(paths.venues, 'Temporary venue metadata store');
    await assertNoSecretMaterial(paths.wallets, 'Temporary wallet metadata store');
    await assertNoSmokeSecretValues(paths.identity, 'Temporary daemon identity store');
    await assertNoSecretMaterial(paths.bridgeSequences, 'Temporary bridge sequence store');
    await assertNoSecretMaterial(paths.commandResults, 'Temporary command result store');
    await assertNoSecretMaterial(paths.activity, 'Temporary activity log');

    console.log(
      JSON.stringify(
        {
          status: 'ok',
          worker_url: WORKER_URL,
          agent_id: AGENT_ID,
          temp_state: tempDir,
          add: [
            {
              status: addRecord.result_status,
              policy_id: addRecord.result.policy.policy_id,
              target_venue_ids: addRecord.result.policy.target_venue_ids,
            },
            {
              status: addChainRecord.result_status,
              policy_id: addChainRecord.result.policy.policy_id,
              target_venue_ids: addChainRecord.result.policy.target_venue_ids,
            },
          ],
          secret_store: {
            status: secretStoreRecord.result_status,
            key_count: secretStoreRecord.result.key_count,
          },
          authorization_state: {
            status: authorizationStateRecord.result_status,
            state_count: authorizationStateRecord.result.state_count,
            access_issue_count: authorizationStateRecord.result.access_issues.length,
          },
          authorization_rotate: {
            hyperliquid: rotateHyperliquidRecord.result_status,
            post_rotate_state: postRotateAuthorizationStateRecord.result_status,
            rotation_status: hyperliquidPostRotateState.rotation_state.status,
          },
          authorization_revoke: {
            okx: revokeOkxRecord.result_status,
            wallet: revokeWalletRecord.result_status,
            post_revoke_state: postRevokeAuthorizationStateRecord.result_status,
            post_revoke_ready: postRevokeRunOnceRecord.result.ready_task_count,
            post_revoke_blocked: postRevokeRunOnceRecord.result.blocked_task_count,
          },
          offline_queue: {
            status: replayedOfflineRecord.result_status,
            deferred: offlineQueued.deferred,
            duplicate: duplicateOfflineQueued.duplicate,
            conflict_code: idempotencyConflict.code,
            type: replayedOfflineRecord.type,
          },
          list: {
            status: listRecord.result_status,
            policy_count: listRecord.result.policy_count,
            active_count: listRecord.result.active_count,
            policy_ids: policies.map((policy) => policy.policy_id),
          },
          plan: {
            status: planRecord.result_status,
            planned_task_count: planRecord.result.planned_task_count,
            blocked_task_count: planRecord.result.blocked_task_count,
          },
          run_once: {
            status: runOnceRecord.result.status,
            mode: runOnceRecord.result.mode,
            ready_task_count: runOnceRecord.result.ready_task_count,
            dispatched_task_count: runOnceRecord.result.dispatched_task_count,
          },
          relay_refresh: {
            status: refresh.status,
            agent_id: refresh.agent_id,
            relay_token_expires_at: refresh.relay_token_expires_at,
          },
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(`Local bridge smoke failed: ${error?.message || error}`);
    if (worker?.logs?.length) console.error(`\nWorker log tail:\n${worker.logs.join('\n')}`);
    if (daemon?.logs?.length) console.error(`\nDaemon log tail:\n${daemon.logs.join('\n')}`);
    process.exitCode = 1;
  } finally {
    await stopManaged(daemon);
    await stopManaged(worker);
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`Local bridge smoke error: ${error?.message || error}`);
  process.exitCode = 1;
});
