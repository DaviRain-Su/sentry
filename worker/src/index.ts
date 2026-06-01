// RescueGrid API Worker (Cloudflare Workers + Hono).
// E2 (/api/intents/parse) is live; E3/E4/E7 are wired as typed stubs and filled
// in next. The Durable Object agent runtime (E5) is exported as a stub binding.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { parseIntent } from './parse.js'
import { strategyHash } from './strategy-core.js'
import { buildCreatePolicyTx, buildRevokeTx } from './sui-tx.js'
import { getActivity, listPoliciesByOwner, listActivityByOwner, getOwnerSummary, getMarket, readWrapper } from './chain.js'
import { getClient } from './sui-tx.js'
import { runTick } from './tick.js'
import { AGENT_ADDRESS } from './config.js'
import { DEFAULT_TICK_INTERVAL_SECONDS } from './config.js'
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
    if (result.status !== 'ok') return c.json(result, 404)

    // E8: reconcile Durable Object runtime state with chain. Chain wins.
    let doState: string | null = null
    try {
      const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
      const sres = await stub.fetch('https://do/state')
      doState = ((await sres.json()) as { runtime_state?: string }).runtime_state ?? null
    } catch { /* DO may not be activated yet */ }

    const p = result.policy as Record<string, any>
    const chainTerminal = p.revoked ? 'Revoked' : p.runtime_state === 'Expired' ? 'Expired' : null
    if (doState && doState !== 'Inactive') {
      if (chainTerminal && doState !== chainTerminal) {
        p.runtime_state = chainTerminal // chain wins
        p.runtime_state_stale = true
      } else {
        p.runtime_state = doState
        p.runtime_state_stale = false
      }
    }
    return c.json(result, 200)
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── list policies for an owner (from PolicyCreated events) ────────────────
app.get('/api/policies', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    return c.json({ status: 'ok', policies: await listPoliciesByOwner(owner) })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── live dashboard: real portfolio summary + market snapshot ──────────────
app.get('/api/summary', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    return c.json({ status: 'ok', summary: await getOwnerSummary(owner) })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

app.get('/api/market', async (c) => {
  try {
    return c.json({ status: 'ok', market: await getMarket() })
  } catch (e) {
    return c.json({ status: 'error', code: 'MARKET_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── D4: owner activity feed (merged on-chain policy events) ───────────────
app.get('/api/activity', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    return c.json({ status: 'ok', activity: await listActivityByOwner(owner) })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── D5: build the owner-signed revoke tx (frontend zkLogin signs) ─────────
app.post('/api/policies/:wrapper_id/revoke', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  let body: { owner?: string; confirmed?: boolean }
  try { body = await c.req.json() } catch { return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON.' }, 400) }
  if (!body.confirmed) return c.json({ status: 'error', code: 'CONFIRM_REQUIRED', message: 'confirmed must be true.' }, 400)
  try {
    const wrapper = await readWrapper(getClient(), wrapperId)
    if (!wrapper) return c.json({ status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found.' }, 404)
    if (body.owner && wrapper.owner !== body.owner) {
      return c.json({ status: 'error', code: 'OWNER_MISMATCH', message: 'Only the policy owner can revoke.' }, 403)
    }
    const tx = buildRevokeTx({ wrapperId, mandateId: wrapper.mandate_id, ownerAddress: wrapper.owner })
    return c.json({ status: 'ok', tx_json: tx.serialize(), wrapper_id: wrapperId, mandate_id: wrapper.mandate_id, sign_with: 'frontend zkLogin' })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
  }
})

// ── activate a policy's Durable Object runtime (called after the frontend
//    executes the create_policy tx) ────────────────────────────────────────
app.post('/api/policies/:wrapper_id/activate', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
  const res = await stub.fetch('https://do/activate', {
    method: 'POST',
    body: JSON.stringify({ wrapperId }),
  })
  return c.json(await res.json(), res.status as 200)
})

// ── E7: internal agent tick (token-gated; force_trigger only in demo mode) ─
app.post('/api/agent/tick', async (c) => {
  const auth = c.req.header('Authorization')
  const expected = c.env.INTERNAL_AGENT_TICK_TOKEN
  if (!expected || auth !== `Bearer ${expected}`) {
    return c.json({ status: 'error', code: 'UNAUTHORIZED', message: 'Invalid internal token.' }, 401)
  }
  let body: { wrapper_id?: string; force_trigger?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.wrapper_id) return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'wrapper_id required.' }, 400)
  const forceTrigger = body.force_trigger === true && c.env.RESCUEGRID_DEMO_MODE === 'true'
  const result = await runTick(c.env, { wrapperId: body.wrapper_id, forceTrigger })
  return c.json({ status: 'ok', ...result })
})

export default app

// ── E5: Durable Object agent runtime — one instance per policy (idFromName =
//    wrapper_id). Persists runtime state and self-schedules ticks via alarms.
//    Chain state stays authoritative (E8): stopped_* halts the loop. ────────
export class AgentRuntime {
  state: DurableObjectState
  env: Env
  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/activate' && req.method === 'POST') {
      const { wrapperId } = await req.json<{ wrapperId: string }>()
      await this.state.storage.put('wrapperId', wrapperId)
      await this.state.storage.put('runtime_state', 'Monitoring')
      await this.state.storage.put('errorCount', 0)
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
      return this.json({ status: 'ok', wrapper_id: wrapperId, runtime_state: 'Monitoring' })
    }
    if (url.pathname === '/state') {
      return this.json({
        status: 'ok',
        wrapper_id: (await this.state.storage.get('wrapperId')) ?? null,
        runtime_state: (await this.state.storage.get('runtime_state')) ?? 'Inactive',
        last_tick_ms: (await this.state.storage.get('lastTickMs')) ?? null,
        last_action: (await this.state.storage.get('lastAction')) ?? null,
        error_count: (await this.state.storage.get('errorCount')) ?? 0,
      })
    }
    if (url.pathname === '/tick' && req.method === 'POST') {
      return this.json(await this.tickOnce())
    }
    return this.json({ status: 'error', code: 'NOT_FOUND' }, 404)
  }

  async alarm(): Promise<void> {
    const result = await this.tickOnce()
    // Halt the loop on terminal chain states; otherwise keep monitoring.
    const terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired'
    if (!terminal) {
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
    }
  }

  async tickOnce(): Promise<Record<string, unknown>> {
    const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null
    if (!wrapperId) return { status: 'error', action: 'error', detail: 'No wrapper registered.' }
    const result = await runTick(this.env, { wrapperId })
    const rsMap: Record<string, string> = {
      stopped_revoked: 'Revoked',
      stopped_expired: 'Expired',
      blocked: 'Monitoring',
      executed: 'Monitoring',
      no_op: 'Monitoring',
      error: 'Monitoring',
    }
    await this.state.storage.put('runtime_state', rsMap[result.action] ?? 'Monitoring')
    await this.state.storage.put('lastTickMs', Date.now())
    await this.state.storage.put('lastAction', result.action)
    if (result.action === 'error') {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1
      await this.state.storage.put('errorCount', n)
    }
    return { status: 'ok', ...result }
  }
}
