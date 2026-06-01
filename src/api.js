// Frontend client for the RescueGrid Worker API.
// Configure VITE_WORKER_URL to point at the deployed/dev Worker; when unset the
// app runs in self-contained demo mode (mock data, no backend calls).
const BASE = import.meta.env.VITE_WORKER_URL || ''

export const WORKER_CONFIGURED = !!BASE
export const ENOKI_CONFIGURED =
  !!import.meta.env.VITE_ENOKI_API_KEY && !!import.meta.env.VITE_GOOGLE_CLIENT_ID

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}
async function get(path) {
  const res = await fetch(BASE + path)
  return res.json()
}

/** POST /api/intents/parse — NL -> structured strategy + hash + preview. */
export function parseIntent(owner, text, defaults = {}) {
  return post('/api/intents/parse', { owner, text, defaults })
}

/** POST /api/policies — returns { tx_json } unsigned tx for zkLogin signing. */
export function buildPolicyTx(owner, strategy, strategy_hash) {
  return post('/api/policies', { owner, strategy, strategy_hash, confirmed: true })
}

/** POST /api/policies/:id/activate — register the Durable Object runtime. */
export function activatePolicy(wrapperId) {
  return post(`/api/policies/${wrapperId}/activate`, {})
}

/** GET /api/policies/:id/activity — chain-authoritative policy + events. */
export function getActivity(wrapperId) {
  return get(`/api/policies/${wrapperId}/activity`)
}

/** GET /api/policies?owner= — policies owned by an address (PolicyCreated events). */
export function listPolicies(owner) {
  return get(`/api/policies?owner=${owner}`)
}

/** GET /api/activity?owner= — merged on-chain activity feed for an owner. */
export function listActivity(owner) {
  return get(`/api/activity?owner=${owner}`)
}

/** POST /api/policies/:id/revoke — returns { tx_json } unsigned revoke tx. */
export function buildRevokeTx(owner, wrapperId) {
  return post(`/api/policies/${wrapperId}/revoke`, { owner, confirmed: true })
}
