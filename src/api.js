// Frontend client for the Sentry Worker API.
// Configure VITE_WORKER_URL to point at the deployed/dev Worker. Reads are
// Worker-first and fall back to direct chain reads when the Worker is absent or
// temporarily unavailable; writes require the Worker contract.
import * as chainRead from './chain-read.js';

const BASE = import.meta.env.VITE_WORKER_URL || '';

export const WORKER_BASE_URL = BASE;
export const WORKER_CONFIGURED = !!BASE;
export const ENOKI_CONFIGURED =
  !!import.meta.env.VITE_ENOKI_API_KEY && !!import.meta.env.VITE_GOOGLE_CLIENT_ID;

function workerMissing() {
  return {
    status: 'error',
    code: 'WORKER_NOT_CONFIGURED',
    message: 'Set VITE_WORKER_URL to use the Sentry Worker.',
  };
}

async function parseJson(res) {
  const json = await res.json().catch(() => ({
    status: 'error',
    code: 'BAD_RESPONSE',
    message: `Worker returned HTTP ${res.status}.`,
  }));
  if (!res.ok && json.status !== 'error') {
    return {
      status: 'error',
      code: `HTTP_${res.status}`,
      message: `Worker returned HTTP ${res.status}.`,
    };
  }
  return json;
}

async function post(path, body) {
  if (!WORKER_CONFIGURED) return workerMissing();
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJson(res);
}

async function authed(path, { method = 'GET', token, body } = {}) {
  if (!WORKER_CONFIGURED) return workerMissing();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parseJson(res);
}

async function workerGet(path) {
  if (!WORKER_CONFIGURED) throw new Error('Worker not configured.');
  const res = await fetch(BASE + path);
  const json = await parseJson(res);
  if (json.status === 'error') throw new Error(json.message || json.code || 'Worker read failed.');
  return json;
}

async function read(path, fallback) {
  if (!WORKER_CONFIGURED) {
    const result = await fallback();
    return { ...result, source: 'chain_fallback', worker_error: 'WORKER_NOT_CONFIGURED' };
  }
  try {
    const result = await workerGet(path);
    return { ...result, source: 'worker' };
  } catch (e) {
    const result = await fallback();
    return { ...result, source: 'chain_fallback', worker_error: String(e?.message || e) };
  }
}

/** POST /api/intents/parse — NL -> structured strategy + hash + preview. */
export function parseIntent(owner, text, defaults = {}) {
  return post('/api/intents/parse', { owner, text, defaults });
}

/** POST /api/policies — returns { tx_json } unsigned tx for zkLogin signing. */
export function buildPolicyTx(owner, strategy, strategy_hash) {
  return post('/api/policies', { owner, strategy, strategy_hash, confirmed: true });
}

/** POST /api/policies/:id/activate — register the Durable Object runtime. */
export function activatePolicy(wrapperId) {
  return post(`/api/policies/${wrapperId}/activate`, {});
}

/** GET /api/policies/:id/activity — chain-authoritative policy + events. */
export function getActivity(wrapperId) {
  return workerGet(`/api/policies/${wrapperId}/activity`).catch((e) => ({
    status: 'error',
    code: WORKER_CONFIGURED ? 'WORKER_READ_FAILED' : 'WORKER_NOT_CONFIGURED',
    message: String(e?.message || e),
  }));
}

/** GET /api/policies?owner= — policies owned by an address (PolicyCreated events). */
export function listPolicies(owner) {
  return read(`/api/policies?owner=${owner}`, () => chainRead.listPolicies(owner));
}

/** GET /api/activity?owner= — merged on-chain activity feed for an owner. */
export function listActivity(owner) {
  return read(`/api/activity?owner=${owner}`, () => chainRead.getActivity(owner));
}

/** GET /api/summary?owner= — real portfolio aggregates + positions. */
export function getSummary(owner) {
  return read(`/api/summary?owner=${owner}`, () => chainRead.getSummary(owner));
}

/** GET /api/market — live SUI/DBUSDC price from the DeepBook indexer. */
export function getMarket() {
  return read('/api/market', () => chainRead.getMarket());
}

/** GET /api/balances?owner= — real wallet token holdings valued via market. */
export function getBalances(owner) {
  return read(`/api/balances?owner=${owner}`, () => chainRead.getBalances(owner));
}

/** POST /api/policies/:id/revoke — returns { tx_json } unsigned revoke tx. */
export function buildRevokeTx(owner, wrapperId) {
  return post(`/api/policies/${wrapperId}/revoke`, { owner, confirmed: true });
}

/** Single tx detail — chain-authoritative, read directly from the fullnode
 *  (no Worker aggregation needed for a single object). */
export function getTransaction(digest) {
  return chainRead.getTransaction(digest);
}

/** Real SUI/USD price history for backtests (public market data, direct). */
export function getSuiPriceHistory(days = 30) {
  return chainRead.getSuiPriceHistory(days);
}

/** POST /api/local-agents/pairing — create a short-lived daemon pairing code. */
export function createLocalAgentPairing({ owner = 'dashboard', device_label } = {}) {
  return post('/api/local-agents/pairing', { owner, device_label });
}

/** GET /api/local-agents — list known daemon sessions from the Worker directory. */
export function listLocalAgentSessions({ includeRevoked = true } = {}) {
  if (!WORKER_CONFIGURED) return Promise.resolve(workerMissing());
  return authed(`/api/local-agents?include_revoked=${includeRevoked ? 'true' : 'false'}`);
}

/** GET /api/local-agents/:agent_id — read AgentSession status. */
export function getLocalAgentStatus(agentId = 'default') {
  if (!WORKER_CONFIGURED) return Promise.resolve(workerMissing());
  return authed(`/api/local-agents/${encodeURIComponent(agentId)}`);
}

/** POST /api/local-agents/:agent_id/revoke — revoke bridge control for a daemon session. */
export function revokeLocalAgent(agentId = 'default', token) {
  return authed(`/api/local-agents/${encodeURIComponent(agentId)}/revoke`, {
    method: 'POST',
    token,
  });
}

/** GET /api/local-agents/:agent_id/activity — queue a bounded activity.tail command. */
export function tailLocalAgentActivity(agentId = 'default', token, { limit = 25 } = {}) {
  return authed(
    `/api/local-agents/${encodeURIComponent(agentId)}/activity?limit=${encodeURIComponent(limit)}`,
    { token }
  );
}

/** POST /api/local-agents/:agent_id/commands — submit a typed remote command. */
export function submitLocalAgentCommand(agentId = 'default', token, type, payload = {}) {
  return authed(`/api/local-agents/${encodeURIComponent(agentId)}/commands`, {
    method: 'POST',
    token,
    body: {
      type,
      payload,
      idempotency_key: `ui_${type.replace(/[^a-z0-9_.:-]+/gi, '_')}_${Date.now()}`,
    },
  });
}

/** GET /api/local-agents/:agent_id/commands — list bounded command records. */
export function listLocalAgentCommands(agentId = 'default', token) {
  return authed(`/api/local-agents/${encodeURIComponent(agentId)}/commands`, { token });
}

/** GET /api/local-agents/:agent_id/commands/:command_id — poll a command result. */
export function getLocalAgentCommand(agentId = 'default', token, commandId) {
  return authed(
    `/api/local-agents/${encodeURIComponent(agentId)}/commands/${encodeURIComponent(commandId)}`,
    { token }
  );
}
