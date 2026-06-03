// Sentry API Worker (Cloudflare Workers + Hono).
// E2/E3/E4/E5/E7 are wired for the Sui-first MVP: parse, build policy tx,
// chain-authoritative reads, Durable Object runtime, and gated agent ticks.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { parseIntent } from './parse.js';
import { strategyHash } from './strategy-core.js';
import { buildCreatePolicyTx, buildRevokeTx } from './sui-tx.js';
import {
  getActivity,
  listPoliciesByOwner,
  listActivityByOwner,
  getOwnerSummary,
  getMarket,
  getBalances,
  readWrapper,
  readBalanceManagerBalance,
} from './chain.js';
import { getClient, DEPLOYMENT } from './sui-tx.js';
import { runTick, validateExecutionPlan } from './tick.js';
import { validateForceTrigger, validateTickAuthorization } from './tick-auth.js';
import {
  authErrorResponse,
  checkToken,
  randomToken,
  sha256Hex,
  tokenFromRequest,
} from './daemon-auth.js';
import {
  buildFundingReadiness,
  parseIntentWithStability,
  resolveFundingThresholds,
} from './read-surfaces.js';
import {
  appendRuntimeActivity,
  runtimeErrorEvent,
  runtimeEventFromTickResult,
  runtimeEventToFeedItem,
  shortWrapperId,
  sortActivityItems,
} from './runtime-activity.js';
import { AGENT_ADDRESS } from './config.js';
import { DEFAULT_TICK_INTERVAL_SECONDS } from './config.js';
import type { ParseDefaults, Strategy } from './types.js';
import { getAuthorizationRegistrySnapshot } from '../../core/authorization.js';
import { getVenueCatalogSnapshot } from '../../core/venues.js';
import {
  applyCommandResult,
  commandIdFromPath,
  commandRecordFromMessage,
  type AgentCommandRecord,
  rememberCommandRecord,
} from './agent-session-command-records.js';
import { isAllowedLocalAgentCommand } from './local-agent-commands.js';

export interface Env {
  AGENT_RUNTIME: DurableObjectNamespace;
  AGENT_SESSIONS: DurableObjectNamespace;
  // secrets (wrangler secret / .dev.vars): OWNER_KEY, AGENT_KEY, INTERNAL_AGENT_TICK_TOKEN
  OWNER_KEY?: string;
  AGENT_KEY?: string;
  INTERNAL_AGENT_TICK_TOKEN?: string;
  SENTRY_DEMO_MODE?: string;
  EXECUTION_ENABLED?: string;
  REQUIRED_DBUSDC_BALANCE?: string;
  REQUIRED_DEEP_BALANCE?: string;
  REQUIRED_AGENT_SUI_GAS_MIST?: string;
}

const app = new Hono<{ Bindings: Env }>();
const PARSE_CACHE_MAX_ENTRIES = 200;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const RELAY_TOKEN_TTL_MS = 30 * 60 * 1000;
const OWNER_CONTROL_TOKEN_TTL_MS = 30 * 60 * 1000;
const parseCache = new Map<string, Record<string, unknown>>();
function setParseCache(key: string, value: Record<string, unknown>) {
  if (parseCache.size >= PARSE_CACHE_MAX_ENTRIES) {
    const firstKey = parseCache.keys().next().value;
    if (firstKey !== undefined) parseCache.delete(firstKey);
  }
  parseCache.set(key, value);
}

async function fetchRuntimeJson(
  env: Env,
  wrapperId: string,
  path: string
): Promise<Record<string, any> | null> {
  try {
    const stub = env.AGENT_RUNTIME.get(env.AGENT_RUNTIME.idFromName(wrapperId));
    const res = await stub.fetch(`https://do${path}`);
    if (!res.ok) return null;
    return await res.json<Record<string, any>>();
  } catch {
    return null;
  }
}

async function readRuntimeState(env: Env, wrapperId: string): Promise<Record<string, any> | null> {
  return fetchRuntimeJson(env, wrapperId, '/state');
}

async function readRuntimeActivity(env: Env, wrapperId: string): Promise<Record<string, any>[]> {
  const body = await fetchRuntimeJson(env, wrapperId, '/activity');
  const activity = body?.runtime_activity;
  return Array.isArray(activity) ? activity : [];
}

async function runtimeFeedForWrappers(
  env: Env,
  wrapperIds: string[]
): Promise<Record<string, any>[]> {
  const perPolicy = await Promise.all(
    wrapperIds.map(async (wrapperId) => {
      const activity = await readRuntimeActivity(env, wrapperId);
      const label = shortWrapperId(wrapperId);
      return activity.map((event) => runtimeEventToFeedItem(event, label));
    })
  );
  return perPolicy.flat();
}

app.use('/api/*', cors());
app.use('/api/*', bodyLimit({ maxSize: 50 * 1024 }));

app.get('/', (c) => c.json({ service: 'sentry-worker', agent: AGENT_ADDRESS, status: 'ok' }));

app.get('/api/venues/catalog', (c) => c.json(getVenueCatalogSnapshot()));

app.get('/api/authorization/registry', (c) => c.json(getAuthorizationRegistrySnapshot()));

// ── E2: parse natural-language intent into a structured strategy ──────────
app.post('/api/intents/parse', async (c) => {
  let body: { owner?: string; text?: string; defaults?: ParseDefaults };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'JSON body must be an object.' },
      400
    );
  }
  if (
    !body.owner ||
    !/^0x[0-9a-fA-F]+$/.test(body.owner) ||
    !body.text ||
    typeof body.text !== 'string'
  ) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner and text are required.' },
      400
    );
  }
  const boundedCache = {
    get: (k: string) => parseCache.get(k),
    set: (k: string, v: Record<string, unknown>) => setParseCache(k, v),
  };
  const result = parseIntentWithStability(parseIntent, boundedCache, body);
  return c.json(result, result.status === 'ok' ? 200 : 422);
});

// ── E3: build the create_policy PTB for the frontend (zkLogin) to sign ────
// Returns the serialized unsigned transaction; the owner's zkLogin signer adds
// gas and signs + executes. The Worker never holds the owner key.
app.post('/api/policies', async (c) => {
  let body: { owner?: string; strategy?: Strategy; strategy_hash?: string; confirmed?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  const { owner, strategy, strategy_hash, confirmed } = body;
  if (!confirmed)
    return c.json(
      { status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' },
      400
    );
  if (!owner || !strategy)
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner and strategy required.' },
      400
    );
  if (strategy.owner !== owner)
    return c.json(
      { status: 'error', code: 'OWNER_MISMATCH', message: 'strategy.owner != owner.' },
      422
    );
  if (strategy.agent !== AGENT_ADDRESS)
    return c.json(
      { status: 'error', code: 'AGENT_MISMATCH', message: 'strategy.agent != deployment agent.' },
      422
    );

  // recompute hash from the canonical strategy (no strategy_hash field inside)
  const recomputed = strategyHash(strategy);
  if (strategy_hash && strategy_hash !== recomputed) {
    return c.json(
      {
        status: 'error',
        code: 'HASH_MISMATCH',
        message: 'strategy_hash does not match server recomputation.',
      },
      422
    );
  }

  const tx = buildCreatePolicyTx({
    strategy: { ...strategy, strategy_hash: recomputed },
    ownerAddress: owner,
  });
  return c.json({
    status: 'ok',
    tx_json: tx.serialize(),
    strategy_hash: recomputed,
    agent_address: AGENT_ADDRESS,
    sign_with:
      'owner signer (frontend wallet or scripted Testnet validation key); read PolicyCreated for wrapper_id',
  });
});

// ── E4: aggregated activity (chain-authoritative) ─────────────────────────
app.get('/api/policies/:wrapper_id/activity', async (c) => {
  const wrapperId = c.req.param('wrapper_id');
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400);
  }
  try {
    const result = await getActivity(wrapperId);
    if (result.status !== 'ok') return c.json(result, 404);

    // E8: reconcile Durable Object runtime state with chain. Chain wins.
    const runtimeState = await readRuntimeState(c.env, wrapperId);
    const runtimeActivity = await readRuntimeActivity(c.env, wrapperId);
    const doState = runtimeState?.runtime_state ?? null;

    const p = result.policy as Record<string, any>;
    const chainTerminal = p.revoked ? 'Revoked' : p.runtime_state === 'Expired' ? 'Expired' : null;
    if (doState && doState !== 'Inactive') {
      if (chainTerminal && doState !== chainTerminal) {
        p.runtime_state = chainTerminal; // chain wins
        p.runtime_state_stale = true;
      } else {
        p.runtime_state = doState;
        p.runtime_state_stale = false;
      }
    }
    return c.json(
      {
        ...result,
        runtime: runtimeState,
        runtime_activity: runtimeActivity,
        activity: sortActivityItems(
          runtimeActivity.map((event) => runtimeEventToFeedItem(event, shortWrapperId(wrapperId)))
        ),
      },
      200
    );
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

// ── list policies for an owner (from PolicyCreated events) ────────────────
app.get('/api/policies', async (c) => {
  const owner = c.req.query('owner');
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' },
      400
    );
  }
  try {
    return c.json({ status: 'ok', policies: await listPoliciesByOwner(owner) });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

// ── live dashboard: real portfolio summary + market snapshot ──────────────
app.get('/api/summary', async (c) => {
  const owner = c.req.query('owner');
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' },
      400
    );
  }
  try {
    return c.json({ status: 'ok', summary: await getOwnerSummary(owner) });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

app.get('/api/market', async (c) => {
  try {
    return c.json({ status: 'ok', market: await getMarket() });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'MARKET_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

app.get('/api/balances', async (c) => {
  const owner = c.req.query('owner');
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' },
      400
    );
  }
  try {
    const client = getClient();
    const [holdings, dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
      getBalances(owner),
      readBalanceManagerBalance(client, DEPLOYMENT.deepbook.dbusdc_coin_type),
      readBalanceManagerBalance(client, DEPLOYMENT.deepbook.deep_coin_type),
      client.getBalance({ owner: DEPLOYMENT.agent.address, coinType: '0x2::sui::SUI' }),
    ]);
    const thresholds = resolveFundingThresholds({
      configured: {
        DBUSDC: c.env.REQUIRED_DBUSDC_BALANCE,
        DEEP: c.env.REQUIRED_DEEP_BALANCE,
        SUI_MIST: c.env.REQUIRED_AGENT_SUI_GAS_MIST,
      },
      requested: {
        DBUSDC: c.req.query('dbusdc_threshold'),
        DEEP: c.req.query('deep_threshold'),
        SUI_MIST: c.req.query('sui_gas_threshold'),
      },
    }) as Record<
      string,
      { required: string; configured: string; requested: string | null; source: string }
    >;
    const funding = buildFundingReadiness({
      agentAddress: DEPLOYMENT.agent.address,
      balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
      dbusdcBalance: dbusdcBalance.toString(),
      deepBalance: deepBalance.toString(),
      suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
      executionEnabled: c.env.EXECUTION_ENABLED === 'true',
      requiredDbusdcBalance: thresholds.DBUSDC.required,
      requiredDeepBalance: thresholds.DEEP.required,
      requiredSuiGasMist: thresholds.SUI_MIST.required,
      thresholdMetadata: thresholds,
    });
    return c.json({
      status: 'ok',
      owner,
      holdings,
      agent: {
        address: DEPLOYMENT.agent.address,
        balance_manager_id: DEPLOYMENT.agent.balance_manager_id,
      },
      balance_manager: {
        id: DEPLOYMENT.agent.balance_manager_id,
        holder: 'agent_balance_manager',
        balances: { DBUSDC: funding.balances.DBUSDC, DEEP: funding.balances.DEEP },
      },
      sui_gas: { holder: DEPLOYMENT.agent.address, balance_mist: funding.balances.SUI_MIST },
      funding,
      readiness_state: funding.readiness_state,
      ready: funding.ready,
      blockers: funding.blockers,
      blocker_labels: funding.blocker_labels,
      blocker_codes: funding.blocker_codes,
    });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

// ── D4: owner activity feed (merged on-chain policy events) ───────────────
app.get('/api/activity', async (c) => {
  const owner = c.req.query('owner');
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' },
      400
    );
  }
  try {
    const chainActivity = await listActivityByOwner(owner);
    const policies = await listPoliciesByOwner(owner);
    const runtimeActivity = await runtimeFeedForWrappers(
      c.env,
      policies.map((p: any) => p.wrapper_id).filter(Boolean)
    );
    return c.json({
      status: 'ok',
      activity: sortActivityItems([...runtimeActivity, ...chainActivity]).slice(0, 100),
      sources: {
        chain_events: chainActivity.length,
        runtime_events: runtimeActivity.length,
      },
    });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

// ── Local Agent bridge: daemon status, WebSocket and command relay ─────────
app.post('/api/local-agents/pairing', async (c) => {
  let body: { owner?: string; device_label?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    /* body is optional for local dev */
  }
  const pairingCode = randomToken('pair');
  const ownerControlToken = randomToken('oct');
  const expiresAtMs = Date.now() + PAIRING_CODE_TTL_MS;
  const ownerControlTokenExpiresAtMs = Date.now() + OWNER_CONTROL_TOKEN_TTL_MS;
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(`pairing:${pairingCode}`));
  const res = await stub.fetch('https://agent-session/pairing/init', {
    method: 'POST',
    body: JSON.stringify({
      pairing_code: pairingCode,
      owner: body.owner || 'dev-owner',
      device_label: body.device_label || null,
      expires_at_ms: expiresAtMs,
      owner_control_token_hash: await sha256Hex(ownerControlToken),
      owner_control_token_expires_at_ms: ownerControlTokenExpiresAtMs,
    }),
  });
  if (!res.ok) return c.json(await res.json(), res.status as 500);
  return c.json({
    status: 'ok',
    pairing_code: pairingCode,
    expires_at: new Date(expiresAtMs).toISOString(),
    owner_control_token: ownerControlToken,
    owner_control_token_expires_at: new Date(ownerControlTokenExpiresAtMs).toISOString(),
    pair_url: '/api/local-agents/pair',
  });
});

app.post('/api/local-agents/pair', async (c) => {
  let body: {
    pairing_code?: string;
    agent_id?: string;
    device_name?: string;
    supported_capabilities?: string[];
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  const pairingCode = body.pairing_code?.trim();
  if (!pairingCode) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'pairing_code required.' }, 400);
  }
  const pairingStub = c.env.AGENT_SESSIONS.get(
    c.env.AGENT_SESSIONS.idFromName(`pairing:${pairingCode}`)
  );
  const consumed = await pairingStub.fetch('https://agent-session/pairing/consume', {
    method: 'POST',
    body: JSON.stringify({ pairing_code: pairingCode }),
  });
  const consumedBody = await consumed.json<Record<string, any>>();
  if (!consumed.ok) return c.json(consumedBody, consumed.status as 400);

  const agentId = body.agent_id?.trim() || randomToken('agent');
  const relayToken = randomToken('rt');
  const relayTokenExpiresAtMs = Date.now() + RELAY_TOKEN_TTL_MS;
  const sessionStub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  const paired = await sessionStub.fetch('https://agent-session/pair', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: agentId,
      owner: consumedBody.owner,
      device_name: body.device_name || consumedBody.device_label || 'local-daemon',
      supported_capabilities: Array.isArray(body.supported_capabilities)
        ? body.supported_capabilities
        : [],
      relay_token_hash: await sha256Hex(relayToken),
      relay_token_expires_at_ms: relayTokenExpiresAtMs,
      owner_control_token_hash: consumedBody.owner_control_token_hash,
      owner_control_token_expires_at_ms: consumedBody.owner_control_token_expires_at_ms,
    }),
  });
  if (!paired.ok) return c.json(await paired.json(), paired.status as 500);
  return c.json({
    status: 'ok',
    agent_id: agentId,
    websocket_url: `/api/local-agents/${encodeURIComponent(agentId)}/connect`,
    relay_token: relayToken,
    relay_token_expires_at: new Date(relayTokenExpiresAtMs).toISOString(),
  });
});

app.get('/api/local-agents/:agent_id', async (c) => {
  const agentId = c.req.param('agent_id');
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  const res = await stub.fetch(`https://agent-session/${encodeURIComponent(agentId)}/state`);
  return c.json(await res.json(), res.status as 200);
});

app.get('/api/local-agents/:agent_id/connect', async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json(
      { status: 'error', code: 'WEBSOCKET_REQUIRED', message: 'WebSocket upgrade required.' },
      426
    );
  }
  const agentId = c.req.param('agent_id');
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  return stub.fetch(c.req.raw);
});

app.get('/api/local-agents/:agent_id/commands', async (c) => {
  const agentId = c.req.param('agent_id');
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  const res = await stub.fetch(`https://agent-session/${encodeURIComponent(agentId)}/commands`, {
    headers: { Authorization: c.req.header('Authorization') || '' },
  });
  return c.json(await res.json(), res.status as 200);
});

app.get('/api/local-agents/:agent_id/commands/:command_id', async (c) => {
  const agentId = c.req.param('agent_id');
  const commandId = c.req.param('command_id');
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  const res = await stub.fetch(
    `https://agent-session/${encodeURIComponent(agentId)}/commands/${encodeURIComponent(commandId)}`,
    { headers: { Authorization: c.req.header('Authorization') || '' } }
  );
  return c.json(await res.json(), res.status as 200);
});

app.post('/api/local-agents/:agent_id/commands', async (c) => {
  let body: { type?: string; payload?: Record<string, unknown>; idempotency_key?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  const agentId = c.req.param('agent_id');
  const stub = c.env.AGENT_SESSIONS.get(c.env.AGENT_SESSIONS.idFromName(agentId));
  const res = await stub.fetch(`https://agent-session/${encodeURIComponent(agentId)}/commands`, {
    method: 'POST',
    headers: { Authorization: c.req.header('Authorization') || '' },
    body: JSON.stringify(body),
  });
  return c.json(await res.json(), res.status as 200);
});

// ── D5: build the owner-signed revoke tx (frontend zkLogin signs) ─────────
app.post('/api/policies/:wrapper_id/revoke', async (c) => {
  const wrapperId = c.req.param('wrapper_id');
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400);
  }
  let body: { owner?: string; confirmed?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON.' }, 400);
  }
  if (!body.confirmed)
    return c.json(
      { status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' },
      400
    );
  try {
    const wrapper = await readWrapper(getClient(), wrapperId);
    if (!wrapper)
      return c.json({ status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found.' }, 404);
    if (body.owner && wrapper.owner !== body.owner) {
      return c.json(
        { status: 'error', code: 'OWNER_MISMATCH', message: 'Only the policy owner can revoke.' },
        403
      );
    }
    const tx = buildRevokeTx({
      wrapperId,
      mandateId: wrapper.mandate_id,
      ownerAddress: wrapper.owner,
    });
    return c.json({
      status: 'ok',
      tx_json: tx.serialize(),
      wrapper_id: wrapperId,
      mandate_id: wrapper.mandate_id,
      sign_with: 'owner signer (frontend wallet or scripted Testnet validation key)',
    });
  } catch (e) {
    return c.json(
      { status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) },
      502
    );
  }
});

// ── activate a policy's Durable Object runtime (called after the frontend
//    executes the create_policy tx) ────────────────────────────────────────
app.post('/api/policies/:wrapper_id/activate', async (c) => {
  const wrapperId = c.req.param('wrapper_id');
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400);
  }
  // Optional strategy lets the runtime evaluate the real price-drop trigger
  // (threshold_pct + asset). It is not on-chain — only its hash is — so the
  // owner hands it to the runtime here.
  let body: { strategy?: Strategy } = {};
  try {
    body = await c.req.json();
  } catch {
    /* activate may carry no body */
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId));
  const res = await stub.fetch('https://do/activate', {
    method: 'POST',
    body: JSON.stringify({ wrapperId, strategy: body.strategy ?? null }),
  });
  return c.json(await res.json(), res.status as 200);
});

// ── agent runtime state (observability): the Durable Object's live view —
//    runtime_state, last action/tick, and the price-drop monitor (last price,
//    running peak, drawdown, trigger). Does not touch chain. ────────────────
app.get('/api/policies/:wrapper_id/runtime', async (c) => {
  const wrapperId = c.req.param('wrapper_id');
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400);
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId));
  const res = await stub.fetch('https://do/state');
  return c.json(await res.json(), res.status as 200);
});

// ── E7 safety preflight: non-mutating, chain-backed execution-plan validation ─
app.post('/api/execution/validate-plan', async (c) => {
  let body: {
    wrapper_id?: string;
    mandate_id?: string;
    proposed?: {
      pool_id?: string;
      amount?: string | number;
      estimated_slippage_bps?: number;
      agent_id?: string;
    };
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  if (!body.wrapper_id || !/^0x[0-9a-fA-F]+$/.test(body.wrapper_id)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'Valid wrapper_id required.' },
      400
    );
  }
  if (body.mandate_id && !/^0x[0-9a-fA-F]+$/.test(body.mandate_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid mandate_id.' }, 400);
  }
  const proposed = body.proposed ?? {};
  if (!proposed.pool_id || !/^0x[0-9a-fA-F]+$/.test(proposed.pool_id)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.pool_id required.' },
      400
    );
  }
  const amount = String(proposed.amount ?? '');
  if (!/^\d+$/.test(amount)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.amount required.' },
      400
    );
  }
  const slippage = Number(proposed.estimated_slippage_bps);
  if (!Number.isSafeInteger(slippage) || slippage < 0) {
    return c.json(
      {
        status: 'error',
        code: 'BAD_REQUEST',
        message: 'Valid proposed.estimated_slippage_bps required.',
      },
      400
    );
  }
  if (proposed.agent_id && !/^0x[0-9a-fA-F]+$/.test(proposed.agent_id)) {
    return c.json(
      { status: 'error', code: 'BAD_REQUEST', message: 'Invalid proposed.agent_id.' },
      400
    );
  }

  const result = await validateExecutionPlan(getClient(), {
    wrapperId: body.wrapper_id,
    mandateId: body.mandate_id,
    proposed: {
      pool_id: proposed.pool_id,
      amount,
      estimated_slippage_bps: slippage,
      agent_id: proposed.agent_id,
    },
    expectedAgentId: DEPLOYMENT.agent.address,
    expectedPoolId: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  });
  return c.json({ status: 'ok', ...result });
});

// ── E7: internal agent tick (token-gated; force_trigger only in demo mode) ─
app.post('/api/agent/tick', async (c) => {
  const auth = c.req.header('Authorization');
  const expected = c.env.INTERNAL_AGENT_TICK_TOKEN;
  const authResult = validateTickAuthorization({
    authorizationHeader: auth,
    expectedToken: expected,
  });
  if (!authResult.ok) return c.json(authResult.body, authResult.status as 401);
  let body: { wrapper_id?: string; force_trigger?: boolean };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400);
  }
  if (!body.wrapper_id)
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'wrapper_id required.' }, 400);
  const forceResult = validateForceTrigger({
    forceTriggerRequested: body.force_trigger === true,
    demoMode: c.env.SENTRY_DEMO_MODE,
  });
  if (!forceResult.ok) return c.json(forceResult.body, forceResult.status as 403);
  const result = await runTick(c.env, {
    wrapperId: body.wrapper_id,
    forceTrigger: forceResult.forceTrigger,
  });
  return c.json({ status: 'ok', ...result });
});

export default app;

// ── E5: Durable Object agent runtime — one instance per policy (idFromName =
//    wrapper_id). Persists runtime state and self-schedules ticks via alarms.
//    Chain state stays authoritative (E8): stopped_* halts the loop. ────────
export class AgentRuntime {
  state: DurableObjectState;
  env: Env;
  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/activate' && req.method === 'POST') {
      const { wrapperId, strategy } = await req.json<{ wrapperId: string; strategy?: any }>();
      await this.state.storage.put('wrapperId', wrapperId);
      await this.state.storage.put('runtime_state', 'Monitoring');
      await this.state.storage.put('errorCount', 0);
      if (strategy?.trigger) {
        await this.state.storage.put('monitor', {
          threshold_pct: Number(strategy.trigger.threshold_pct) || 0,
          asset: strategy.trigger.asset || 'SUI',
        });
      }
      const activity =
        (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? [];
      await this.state.storage.put(
        'runtimeActivity',
        appendRuntimeActivity(
          activity,
          runtimeEventFromTickResult(
            {
              action: 'activated',
              detail: 'Durable Object runtime activated and alarm tick scheduled.',
              execution_claimed: false,
            },
            { wrapperId }
          )
        )
      );
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000);
      return this.json({ status: 'ok', wrapper_id: wrapperId, runtime_state: 'Monitoring' });
    }
    if (url.pathname === '/state') {
      return this.json({
        status: 'ok',
        wrapper_id: (await this.state.storage.get('wrapperId')) ?? null,
        runtime_state: (await this.state.storage.get('runtime_state')) ?? 'Inactive',
        last_tick_ms: (await this.state.storage.get('lastTickMs')) ?? null,
        last_action: (await this.state.storage.get('lastAction')) ?? null,
        error_count: (await this.state.storage.get('errorCount')) ?? 0,
        monitor: (await this.state.storage.get('monitor')) ?? null,
        last_price: (await this.state.storage.get('lastPrice')) ?? null,
        peak_price: (await this.state.storage.get('peakPrice')) ?? null,
        drawdown_pct: (await this.state.storage.get('drawdownPct')) ?? null,
        trigger_met: (await this.state.storage.get('triggerMet')) ?? false,
        activity_count: (
          (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? []
        ).length,
        last_error: (await this.state.storage.get('lastError')) ?? null,
      });
    }
    if (url.pathname === '/activity') {
      return this.json({
        status: 'ok',
        wrapper_id: (await this.state.storage.get('wrapperId')) ?? null,
        runtime_activity:
          (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? [],
      });
    }
    if (url.pathname === '/tick' && req.method === 'POST') {
      return this.json(await this.tickOnce());
    }
    return this.json({ status: 'error', code: 'NOT_FOUND' }, 404);
  }

  async alarm(): Promise<void> {
    let terminal = false;
    try {
      const result = await this.tickOnce();
      terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired';
    } catch (e) {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1;
      await this.state.storage.put('errorCount', n);
      await this.state.storage.put('lastAction', 'error');
      await this.state.storage.put('lastError', String((e as Error).message || e));
      await this.state.storage.put('lastTickMs', Date.now());
      const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null;
      const activity =
        (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? [];
      await this.state.storage.put(
        'runtimeActivity',
        appendRuntimeActivity(activity, runtimeErrorEvent(e, { wrapperId }))
      );
      // Non-terminal error: keep monitoring. Consider exponential backoff after consecutive errors.
    }
    if (!terminal) {
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000);
    }
  }

  async monitorPrice(asset: string): Promise<number> {
    const pool = asset === 'SUI' ? 'SUI_DBUSDC' : null;
    if (!pool) return 0;
    const r = await fetch('https://deepbook-indexer.testnet.mystenlabs.com/ticker');
    if (!r.ok) return 0;
    const j = (await r.json()) as Record<string, { last_price?: number }>;
    return Number(j[pool]?.last_price) || 0;
  }

  async tickOnce(): Promise<Record<string, unknown>> {
    const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null;
    if (!wrapperId) return { status: 'error', action: 'error', detail: 'No wrapper registered.' };

    // Real price-drop trigger: monitor the live mainnet SUI/USDC market signal,
    // track the running peak, fire when drawdown >= the policy threshold. The
    // threshold came from the strategy handed in at activate (not on-chain).
    let market: { triggerMet: boolean; price: string } | undefined;
    const monitor =
      (await this.state.storage.get<{ threshold_pct: number; asset: string }>('monitor')) ?? null;
    if (monitor && monitor.threshold_pct > 0) {
      try {
        const price = await this.monitorPrice(monitor.asset);
        if (price > 0) {
          let peak = (await this.state.storage.get<number>('peakPrice')) ?? price;
          if (price > peak) peak = price;
          const drawdownPct = ((peak - price) / peak) * 100;
          const triggerMet = drawdownPct >= monitor.threshold_pct;
          await this.state.storage.put('lastPrice', price);
          await this.state.storage.put('drawdownPct', Number(drawdownPct.toFixed(3)));
          await this.state.storage.put('triggerMet', triggerMet);
          // re-arm the peak after a trigger so it doesn't fire every tick in a slump
          await this.state.storage.put('peakPrice', triggerMet ? price : peak);
          market = { triggerMet, price: String(price) };
        }
      } catch {
        /* price read is best-effort; fall through to monitoring */
      }
    }

    const result = await runTick(this.env, { wrapperId, market });
    const rsMap: Record<string, string> = {
      stopped_revoked: 'Revoked',
      stopped_expired: 'Expired',
      blocked: 'Monitoring',
      executed: 'Monitoring',
      no_op: 'Monitoring',
      error: 'Monitoring',
    };
    await this.state.storage.put('runtime_state', rsMap[result.action] ?? 'Monitoring');
    await this.state.storage.put('lastTickMs', Date.now());
    await this.state.storage.put('lastAction', result.action);
    const activity = (await this.state.storage.get<Record<string, any>[]>('runtimeActivity')) ?? [];
    await this.state.storage.put(
      'runtimeActivity',
      appendRuntimeActivity(activity, runtimeEventFromTickResult(result, { wrapperId }))
    );
    if (result.action === 'error') {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1;
      await this.state.storage.put('errorCount', n);
    }
    return { status: 'ok', ...result };
  }
}

type AgentSessionMessage = {
  kind?: string;
  message_id?: string;
  idempotency_key?: string;
  issued_at?: string;
  payload?: Record<string, any>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export class AgentSession {
  state: DurableObjectState;
  env: Env;
  socket: WebSocket | null = null;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const commandId = commandIdFromPath(url.pathname);
    if (url.pathname === '/pairing/init' && req.method === 'POST') {
      const body = await req.json<Record<string, any>>();
      return this.initPairing(body);
    }
    if (url.pathname === '/pairing/consume' && req.method === 'POST') {
      const body = await req.json<Record<string, any>>();
      return this.consumePairing(body);
    }
    if (url.pathname === '/pair' && req.method === 'POST') {
      const body = await req.json<Record<string, any>>();
      return this.pairAgent(body);
    }
    if (url.pathname.endsWith('/state')) return this.status();
    if (commandId && req.method === 'GET') {
      return this.getCommand(req, commandId);
    }
    if (url.pathname.endsWith('/commands') && req.method === 'GET') {
      return this.listCommands(req);
    }
    if (url.pathname.endsWith('/commands') && req.method === 'POST') {
      const body = await req.json<Record<string, any>>();
      return this.enqueueCommand(req, body);
    }
    if (req.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return this.acceptWebSocket(req);
    }
    return jsonResponse({ status: 'error', code: 'NOT_FOUND' }, 404);
  }

  async status(): Promise<Response> {
    const lastHeartbeatMs = (await this.state.storage.get<number>('lastHeartbeatMs')) ?? null;
    const relayTokenExpiresAtMs =
      (await this.state.storage.get<number>('relayTokenExpiresAtMs')) ?? null;
    const connected = Boolean(this.socket);
    const ageMs = lastHeartbeatMs ? Date.now() - lastHeartbeatMs : null;
    const sessionStatus = connected
      ? ageMs !== null && ageMs > 90_000
        ? 'stale'
        : 'online'
      : lastHeartbeatMs
        ? 'offline'
        : 'never_connected';
    return jsonResponse({
      status: 'ok',
      agent_id: (await this.state.storage.get<string>('agentId')) ?? null,
      session_status: sessionStatus,
      connected,
      last_heartbeat_ms: lastHeartbeatMs,
      last_seen_at: lastHeartbeatMs ? new Date(lastHeartbeatMs).toISOString() : null,
      last_status: (await this.state.storage.get('lastStatus')) ?? null,
      active_process: (await this.state.storage.get('activeProcess')) ?? null,
      owner: (await this.state.storage.get('owner')) ?? null,
      device_name: (await this.state.storage.get('deviceName')) ?? null,
      paired_at: (await this.state.storage.get('pairedAt')) ?? null,
      relay_token_expires_at: relayTokenExpiresAtMs
        ? new Date(relayTokenExpiresAtMs).toISOString()
        : null,
      command_count: (await this.state.storage.get<number>('commandCount')) ?? 0,
      last_command: (await this.state.storage.get('lastCommand')) ?? null,
      last_result: (await this.state.storage.get('lastResult')) ?? null,
      last_message: (await this.state.storage.get('lastMessage')) ?? null,
    });
  }

  async assertOwner(req: Request): Promise<Response | null> {
    const ownerCheck = await checkToken({
      token: tokenFromRequest(req),
      expectedHash: (await this.state.storage.get<string>('ownerControlTokenHash')) ?? null,
      expiresAtMs: (await this.state.storage.get<number>('ownerControlTokenExpiresAtMs')) ?? null,
    });
    return ownerCheck.ok ? null : authErrorResponse(ownerCheck);
  }

  async readCommandRecords(): Promise<AgentCommandRecord[]> {
    const records = (await this.state.storage.get<AgentCommandRecord[]>('commandRecords')) ?? [];
    return Array.isArray(records) ? records : [];
  }

  async writeCommandRecords(records: AgentCommandRecord[]): Promise<void> {
    await this.state.storage.put('commandRecords', records);
  }

  async rememberCommand(command: Record<string, any>): Promise<AgentCommandRecord> {
    const records = await this.readCommandRecords();
    const next = rememberCommandRecord(records, command);
    const record = commandRecordFromMessage(command);
    await this.writeCommandRecords(next);
    await this.state.storage.put('lastCommand', record);
    return record;
  }

  async rememberCommandResult(msg: AgentSessionMessage): Promise<void> {
    const records = await this.readCommandRecords();
    const next = applyCommandResult(records, msg, nowIso());
    const changed = next.some((item, index) => item !== records[index]);
    if (!changed) return;
    await this.writeCommandRecords(next);
    const commandId = String(msg.payload?.command_message_id || '');
    const idempotencyKey = String(msg.idempotency_key || '');
    const updated = next.find(
      (item) =>
        (commandId && item.command_id === commandId) ||
        (idempotencyKey && item.idempotency_key === idempotencyKey)
    );
    if (updated) await this.state.storage.put('lastCommand', updated);
  }

  async listCommands(req: Request): Promise<Response> {
    const authError = await this.assertOwner(req);
    if (authError) return authError;
    const records = await this.readCommandRecords();
    return jsonResponse({
      status: 'ok',
      command_count: records.length,
      commands: records,
    });
  }

  async getCommand(req: Request, commandId: string): Promise<Response> {
    const authError = await this.assertOwner(req);
    if (authError) return authError;
    const records = await this.readCommandRecords();
    const command =
      records.find((item) => item.command_id === commandId || item.idempotency_key === commandId) ??
      null;
    if (!command) {
      return jsonResponse(
        { status: 'error', code: 'COMMAND_NOT_FOUND', message: 'Command was not found.' },
        404
      );
    }
    return jsonResponse({ status: 'ok', command });
  }

  async initPairing(body: Record<string, any>): Promise<Response> {
    const pairingCode = String(body.pairing_code || '');
    const expiresAtMs = Number(body.expires_at_ms || 0);
    if (!pairingCode || !Number.isSafeInteger(expiresAtMs)) {
      return jsonResponse(
        { status: 'error', code: 'BAD_REQUEST', message: 'Invalid pairing payload.' },
        400
      );
    }
    await this.state.storage.put('pairing', {
      pairing_code: pairingCode,
      owner: String(body.owner || 'dev-owner'),
      device_label: body.device_label || null,
      expires_at_ms: expiresAtMs,
      owner_control_token_hash: String(body.owner_control_token_hash || ''),
      owner_control_token_expires_at_ms: Number(body.owner_control_token_expires_at_ms || 0),
      consumed_at_ms: null,
    });
    return jsonResponse({ status: 'ok' });
  }

  async consumePairing(body: Record<string, any>): Promise<Response> {
    const expected = String(body.pairing_code || '');
    const pairing = (await this.state.storage.get<Record<string, any>>('pairing')) ?? null;
    if (!pairing || pairing.pairing_code !== expected) {
      return jsonResponse(
        { status: 'error', code: 'PAIRING_NOT_FOUND', message: 'Pairing code not found.' },
        404
      );
    }
    if (pairing.consumed_at_ms) {
      return jsonResponse(
        { status: 'error', code: 'PAIRING_USED', message: 'Pairing code already used.' },
        409
      );
    }
    if (Date.now() > Number(pairing.expires_at_ms)) {
      return jsonResponse(
        { status: 'error', code: 'PAIRING_EXPIRED', message: 'Pairing code expired.' },
        410
      );
    }
    pairing.consumed_at_ms = Date.now();
    await this.state.storage.put('pairing', pairing);
    return jsonResponse({
      status: 'ok',
      owner: pairing.owner,
      device_label: pairing.device_label,
      owner_control_token_hash: pairing.owner_control_token_hash,
      owner_control_token_expires_at_ms: pairing.owner_control_token_expires_at_ms,
    });
  }

  async pairAgent(body: Record<string, any>): Promise<Response> {
    const agentId = String(body.agent_id || '');
    const relayTokenHash = String(body.relay_token_hash || '');
    const ownerControlTokenHash = String(body.owner_control_token_hash || '');
    const relayTokenExpiresAtMs = Number(body.relay_token_expires_at_ms || 0);
    const ownerControlTokenExpiresAtMs = Number(body.owner_control_token_expires_at_ms || 0);
    if (!agentId || !relayTokenHash || !ownerControlTokenHash) {
      return jsonResponse(
        { status: 'error', code: 'BAD_REQUEST', message: 'Invalid agent pairing payload.' },
        400
      );
    }
    await this.state.storage.put('agentId', agentId);
    await this.state.storage.put('owner', String(body.owner || 'dev-owner'));
    await this.state.storage.put('deviceName', String(body.device_name || 'local-daemon'));
    await this.state.storage.put(
      'supportedCapabilities',
      Array.isArray(body.supported_capabilities) ? body.supported_capabilities : []
    );
    await this.state.storage.put('relayTokenHash', relayTokenHash);
    await this.state.storage.put('relayTokenExpiresAtMs', relayTokenExpiresAtMs);
    await this.state.storage.put('ownerControlTokenHash', ownerControlTokenHash);
    await this.state.storage.put('ownerControlTokenExpiresAtMs', ownerControlTokenExpiresAtMs);
    await this.state.storage.put('pairedAt', nowIso());
    return jsonResponse({ status: 'ok', agent_id: agentId });
  }

  async acceptWebSocket(req: Request): Promise<Response> {
    const relayCheck = await checkToken({
      token: tokenFromRequest(req),
      expectedHash: (await this.state.storage.get<string>('relayTokenHash')) ?? null,
      expiresAtMs: (await this.state.storage.get<number>('relayTokenExpiresAtMs')) ?? null,
    });
    if (!relayCheck.ok) return authErrorResponse(relayCheck);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const agentIdIndex = parts.indexOf('local-agents') + 1;
    const agentId =
      agentIdIndex > 0 && parts[agentIdIndex] ? decodeURIComponent(parts[agentIdIndex]) : 'default';
    this.socket = server;
    server.accept();
    await this.state.storage.put('agentId', agentId);
    await this.state.storage.put('connectedAtMs', Date.now());
    await this.state.storage.put('lastHeartbeatMs', Date.now());
    server.addEventListener('message', (event) => {
      this.handleMessage(String(event.data)).catch((e) => {
        this.send({
          kind: 'error',
          message_id: randomId('err'),
          issued_at: nowIso(),
          payload: { code: 'MESSAGE_HANDLER_FAILED', message: String((e as Error).message) },
        });
      });
    });
    server.addEventListener('close', () => {
      this.socket = null;
      this.state.storage.put('disconnectedAtMs', Date.now());
    });
    this.send({
      kind: 'session_accepted',
      message_id: randomId('msg'),
      issued_at: nowIso(),
      payload: { agent_id: agentId },
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async handleMessage(raw: string): Promise<void> {
    let msg: AgentSessionMessage;
    try {
      msg = JSON.parse(raw) as AgentSessionMessage;
    } catch {
      this.send({
        kind: 'error',
        message_id: randomId('err'),
        issued_at: nowIso(),
        payload: { code: 'BAD_JSON', message: 'Invalid bridge JSON message.' },
      });
      return;
    }
    if (msg.kind === 'hello' || msg.kind === 'heartbeat' || msg.kind === 'agent.status') {
      await this.state.storage.put('lastHeartbeatMs', Date.now());
      await this.state.storage.put('lastStatus', msg.payload ?? {});
      if (msg.payload?.active_process) {
        await this.state.storage.put('activeProcess', msg.payload.active_process);
      }
      return;
    }
    if (msg.kind === 'command_result') {
      const result = {
        received_at: nowIso(),
        message_id: msg.message_id ?? null,
        idempotency_key: msg.idempotency_key ?? null,
        payload: msg.payload ?? {},
      };
      await this.state.storage.put('lastResult', result);
      await this.rememberCommandResult(msg);
      return;
    }
    await this.state.storage.put('lastMessage', {
      received_at: nowIso(),
      kind: msg.kind ?? 'unknown',
      payload: msg.payload ?? {},
    });
  }

  async enqueueCommand(req: Request, body: Record<string, any>): Promise<Response> {
    const authError = await this.assertOwner(req);
    if (authError) return authError;

    const type = String(body.type ?? '');
    if (!type) {
      return jsonResponse(
        { status: 'error', code: 'BAD_REQUEST', message: 'command type required.' },
        400
      );
    }
    if (!isAllowedLocalAgentCommand(type)) {
      return jsonResponse(
        { status: 'error', code: 'UNSUPPORTED_REMOTE_COMMAND', message: `Unsupported: ${type}` },
        422
      );
    }
    if (!this.socket) {
      return jsonResponse(
        { status: 'error', code: 'AGENT_OFFLINE', message: 'Local daemon is not connected.' },
        409
      );
    }
    const command = {
      kind: 'command',
      message_id: randomId('cmd'),
      issued_at: nowIso(),
      expires_at: new Date(Date.now() + 120_000).toISOString(),
      idempotency_key: String(body.idempotency_key || crypto.randomUUID()),
      payload: { type, ...(body.payload && typeof body.payload === 'object' ? body.payload : {}) },
    };
    this.send(command);
    const n = ((await this.state.storage.get<number>('commandCount')) ?? 0) + 1;
    await this.state.storage.put('commandCount', n);
    const record = await this.rememberCommand(command);
    return jsonResponse({ status: 'ok', queued: true, command, command_record: record });
  }

  send(message: Record<string, unknown>) {
    this.socket?.send(JSON.stringify(message));
  }
}
