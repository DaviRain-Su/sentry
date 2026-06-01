// RescueGrid API Worker (Cloudflare Workers + Hono).
// E2 (/api/intents/parse) is live; E3/E4/E7 are wired as typed stubs and filled
// in next. The Durable Object agent runtime (E5) is exported as a stub binding.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseIntent } from './parse.js'
import { strategyHash } from './strategy-core.js'
import { buildCreatePolicyTx } from './sui-tx.js'
import { getActivity } from './chain.js'
import { AGENT_ADDRESS } from './config.js'
import type { ParseDefaults, Strategy } from './types.js'

export interface Env {
  AGENT_RUNTIME: DurableObjectNamespace
  // secrets (wrangler secret / .dev.vars): OWNER_KEY, AGENT_KEY, INTERNAL_AGENT_TICK_TOKEN
  OWNER_KEY?: string
  AGENT_KEY?: string
  INTERNAL_AGENT_TICK_TOKEN?: string
  RESCUEGRID_DEMO_MODE?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('/api/*', cors())

app.get('/', (c) => c.json({ service: 'rescuegrid-worker', agent: AGENT_ADDRESS, status: 'ok' }))

// ── E2: parse natural-language intent into a structured strategy ──────────
app.post('/api/intents/parse', async (c) => {
  let body: { owner?: string; text?: string; defaults?: ParseDefaults }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.owner || !body.text) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and text are required.' }, 400)
  }
  const result = parseIntent(body.text, body.owner, body.defaults ?? {})
  return c.json(result, result.status === 'ok' ? 200 : 422)
})

// ── E3: build the create_policy PTB for the frontend (zkLogin) to sign ────
// Returns the serialized unsigned transaction; the owner's zkLogin signer adds
// gas and signs + executes. The Worker never holds the owner key.
app.post('/api/policies', async (c) => {
  let body: { owner?: string; strategy?: Strategy; strategy_hash?: string; confirmed?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  const { owner, strategy, strategy_hash, confirmed } = body
  if (!confirmed) return c.json({ status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' }, 400)
  if (!owner || !strategy) return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and strategy required.' }, 400)
  if (strategy.owner !== owner) return c.json({ status: 'error', code: 'OWNER_MISMATCH', message: 'strategy.owner != owner.' }, 422)
  if (strategy.agent !== AGENT_ADDRESS) return c.json({ status: 'error', code: 'AGENT_MISMATCH', message: 'strategy.agent != deployment agent.' }, 422)

  // recompute hash from the canonical strategy (no strategy_hash field inside)
  const recomputed = strategyHash(strategy)
  if (strategy_hash && strategy_hash !== recomputed) {
    return c.json({ status: 'error', code: 'HASH_MISMATCH', message: 'strategy_hash does not match server recomputation.' }, 422)
  }

  const tx = buildCreatePolicyTx({ strategy: { ...strategy, strategy_hash: recomputed }, ownerAddress: owner })
  return c.json({
    status: 'ok',
    tx_json: tx.serialize(),
    strategy_hash: recomputed,
    agent_address: AGENT_ADDRESS,
    sign_with: 'frontend zkLogin (signAndExecuteTransaction); read PolicyCreated for wrapper_id',
  })
})

// ── E4: aggregated activity (chain-authoritative) ─────────────────────────
app.get('/api/policies/:wrapper_id/activity', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  try {
    const result = await getActivity(wrapperId)
    return c.json(result, result.status === 'ok' ? 200 : 404)
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── revoke ────────────────────────────────────────────────────────────────
app.post('/api/policies/:wrapper_id/revoke', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'revoke pending.' }, 501))

// ── E7: internal agent tick ─────────────────────────────────────────────--
app.post('/api/agent/tick', (c) =>
  c.json({ status: 'error', code: 'NOT_IMPLEMENTED', message: 'E7 pending.' }, 501))

export default app

// ── E5: Durable Object agent runtime (stub; alarm/tick filled in next) ────
export class AgentRuntime {
  state: DurableObjectState
  env: Env
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }
  async fetch(_req: Request): Promise<Response> {
    return new Response(JSON.stringify({ status: 'ok', note: 'AgentRuntime stub' }), {
      headers: { 'content-type': 'application/json' },
    })
  }
}
