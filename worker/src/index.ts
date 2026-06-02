// RescueGrid API Worker (Cloudflare Workers + Hono).
// E2 (/api/intents/parse) is live; E3/E4/E7 are wired as typed stubs and filled
// in next. The Durable Object agent runtime (E5) is exported as a stub binding.
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bodyLimit } from 'hono/body-limit'
import { parseIntent } from './parse.js'
import { strategyHash } from './strategy-core.js'
import { buildCreatePolicyTx, buildRevokeTx } from './sui-tx.js'
import { getActivity, listPoliciesByOwner, listActivityByOwner, getOwnerSummary, getMarket, getBalances, readWrapper, readBalanceManagerBalance } from './chain.js'
import { getClient, DEPLOYMENT } from './sui-tx.js'
import { runTick, validateExecutionPlan } from './tick.js'
import { validateForceTrigger, validateTickAuthorization } from './tick-auth.js'
import { buildFundingReadiness, parseIntentWithStability } from './read-surfaces.js'
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
  EXECUTION_ENABLED?: string
}

const app = new Hono<{ Bindings: Env }>()
const PARSE_CACHE_MAX_ENTRIES = 200
const parseCache = new Map<string, Record<string, unknown>>()
function setParseCache(key: string, value: Record<string, unknown>) {
  if (parseCache.size >= PARSE_CACHE_MAX_ENTRIES) {
    const firstKey = parseCache.keys().next().value
    if (firstKey !== undefined) parseCache.delete(firstKey)
  }
  parseCache.set(key, value)
}

function positiveIntegerQuery(value: string | undefined, fallback: string): string {
  if (!value) return fallback
  return /^\d+$/.test(value) ? value : fallback
}

app.use('/api/*', cors())
app.use('/api/*', bodyLimit({ maxSize: 50 * 1024 }))

app.get('/', (c) => c.json({ service: 'rescuegrid-worker', agent: AGENT_ADDRESS, status: 'ok' }))

// ── E2: parse natural-language intent into a structured strategy ──────────
app.post('/api/intents/parse', async (c) => {
  let body: { owner?: string; text?: string; defaults?: ParseDefaults }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body || typeof body !== 'object') {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'JSON body must be an object.' }, 400)
  }
  if (!body.owner || !/^0x[0-9a-fA-F]+$/.test(body.owner) || !body.text || typeof body.text !== 'string') {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner and text are required.' }, 400)
  }
  const boundedCache = {
    get: (k: string) => parseCache.get(k),
    set: (k: string, v: Record<string, unknown>) => setParseCache(k, v),
  }
  const result = parseIntentWithStability(parseIntent, boundedCache, body)
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
    sign_with: 'owner signer (frontend wallet or scripted Testnet validation key); read PolicyCreated for wrapper_id',
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

app.get('/api/balances', async (c) => {
  const owner = c.req.query('owner')
  if (!owner || !/^0x[0-9a-fA-F]+$/.test(owner)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'owner query param required.' }, 400)
  }
  try {
    const client = getClient()
    const [holdings, dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
      getBalances(owner),
      readBalanceManagerBalance(client, DEPLOYMENT.deepbook.dbusdc_coin_type),
      readBalanceManagerBalance(client, DEPLOYMENT.deepbook.deep_coin_type),
      client.getBalance({ owner: DEPLOYMENT.agent.address, coinType: '0x2::sui::SUI' }),
    ])
    const funding = buildFundingReadiness({
      agentAddress: DEPLOYMENT.agent.address,
      balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
      dbusdcBalance: dbusdcBalance.toString(),
      deepBalance: deepBalance.toString(),
      suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
      executionEnabled: c.env.EXECUTION_ENABLED === 'true',
      requiredDbusdcBalance: positiveIntegerQuery(c.req.query('dbusdc_threshold'), '1'),
      requiredDeepBalance: positiveIntegerQuery(c.req.query('deep_threshold'), '1'),
      requiredSuiGasMist: positiveIntegerQuery(c.req.query('sui_gas_threshold'), '1'),
    })
    return c.json({
      status: 'ok',
      owner,
      holdings,
      agent: { address: DEPLOYMENT.agent.address, balance_manager_id: DEPLOYMENT.agent.balance_manager_id },
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
    })
  } catch (e) {
    return c.json({ status: 'error', code: 'CHAIN_READ_FAILED', message: String((e as Error).message) }, 502)
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
    return c.json({ status: 'ok', tx_json: tx.serialize(), wrapper_id: wrapperId, mandate_id: wrapper.mandate_id, sign_with: 'owner signer (frontend wallet or scripted Testnet validation key)' })
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
  // Optional strategy lets the runtime evaluate the real price-drop trigger
  // (threshold_pct + asset). It is not on-chain — only its hash is — so the
  // owner hands it to the runtime here.
  let body: { strategy?: Strategy } = {}
  try { body = await c.req.json() } catch { /* activate may carry no body */ }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
  const res = await stub.fetch('https://do/activate', {
    method: 'POST',
    body: JSON.stringify({ wrapperId, strategy: body.strategy ?? null }),
  })
  return c.json(await res.json(), res.status as 200)
})

// ── agent runtime state (observability): the Durable Object's live view —
//    runtime_state, last action/tick, and the price-drop monitor (last price,
//    running peak, drawdown, trigger). Does not touch chain. ────────────────
app.get('/api/policies/:wrapper_id/runtime', async (c) => {
  const wrapperId = c.req.param('wrapper_id')
  if (!/^0x[0-9a-fA-F]+$/.test(wrapperId)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid wrapper id.' }, 400)
  }
  const stub = c.env.AGENT_RUNTIME.get(c.env.AGENT_RUNTIME.idFromName(wrapperId))
  const res = await stub.fetch('https://do/state')
  return c.json(await res.json(), res.status as 200)
})

// ── E7 safety preflight: non-mutating, chain-backed execution-plan validation ─
app.post('/api/execution/validate-plan', async (c) => {
  let body: {
    wrapper_id?: string
    mandate_id?: string
    proposed?: {
      pool_id?: string
      amount?: string | number
      estimated_slippage_bps?: number
      agent_id?: string
    }
  }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.wrapper_id || !/^0x[0-9a-fA-F]+$/.test(body.wrapper_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid wrapper_id required.' }, 400)
  }
  if (body.mandate_id && !/^0x[0-9a-fA-F]+$/.test(body.mandate_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid mandate_id.' }, 400)
  }
  const proposed = body.proposed ?? {}
  if (!proposed.pool_id || !/^0x[0-9a-fA-F]+$/.test(proposed.pool_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.pool_id required.' }, 400)
  }
  const amount = String(proposed.amount ?? '')
  if (!/^\d+$/.test(amount)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.amount required.' }, 400)
  }
  const slippage = Number(proposed.estimated_slippage_bps)
  if (!Number.isSafeInteger(slippage) || slippage < 0) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Valid proposed.estimated_slippage_bps required.' }, 400)
  }
  if (proposed.agent_id && !/^0x[0-9a-fA-F]+$/.test(proposed.agent_id)) {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid proposed.agent_id.' }, 400)
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
  })
  return c.json({ status: 'ok', ...result })
})

// ── E7: internal agent tick (token-gated; force_trigger only in demo mode) ─
app.post('/api/agent/tick', async (c) => {
  const auth = c.req.header('Authorization')
  const expected = c.env.INTERNAL_AGENT_TICK_TOKEN
  const authResult = validateTickAuthorization({ authorizationHeader: auth, expectedToken: expected })
  if (!authResult.ok) return c.json(authResult.body, authResult.status as 401)
  let body: { wrapper_id?: string; force_trigger?: boolean }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'Invalid JSON body.' }, 400)
  }
  if (!body.wrapper_id) return c.json({ status: 'error', code: 'BAD_REQUEST', message: 'wrapper_id required.' }, 400)
  const forceResult = validateForceTrigger({ forceTriggerRequested: body.force_trigger === true, demoMode: c.env.RESCUEGRID_DEMO_MODE })
  if (!forceResult.ok) return c.json(forceResult.body, forceResult.status as 403)
  const result = await runTick(c.env, { wrapperId: body.wrapper_id, forceTrigger: forceResult.forceTrigger })
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
      const { wrapperId, strategy } = await req.json<{ wrapperId: string; strategy?: any }>()
      await this.state.storage.put('wrapperId', wrapperId)
      await this.state.storage.put('runtime_state', 'Monitoring')
      await this.state.storage.put('errorCount', 0)
      if (strategy?.trigger) {
        await this.state.storage.put('monitor', {
          threshold_pct: Number(strategy.trigger.threshold_pct) || 0,
          asset: strategy.trigger.asset || 'SUI',
        })
      }
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
        monitor: (await this.state.storage.get('monitor')) ?? null,
        last_price: (await this.state.storage.get('lastPrice')) ?? null,
        peak_price: (await this.state.storage.get('peakPrice')) ?? null,
        drawdown_pct: (await this.state.storage.get('drawdownPct')) ?? null,
        trigger_met: (await this.state.storage.get('triggerMet')) ?? false,
      })
    }
    if (url.pathname === '/tick' && req.method === 'POST') {
      return this.json(await this.tickOnce())
    }
    return this.json({ status: 'error', code: 'NOT_FOUND' }, 404)
  }

  async alarm(): Promise<void> {
    let terminal = false
    try {
      const result = await this.tickOnce()
      terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired'
    } catch (e) {
      const n = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1
      await this.state.storage.put('errorCount', n)
      await this.state.storage.put('lastAction', 'error')
      await this.state.storage.put('lastError', String((e as Error).message || e))
      // Non-terminal error: keep monitoring. Consider exponential backoff after consecutive errors.
    }
    if (!terminal) {
      await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
    }
  }

  async monitorPrice(asset: string): Promise<number> {
    const pool = asset === 'SUI' ? 'SUI_DBUSDC' : null
    if (!pool) return 0
    const r = await fetch('https://deepbook-indexer.testnet.mystenlabs.com/ticker')
    if (!r.ok) return 0
    const j = (await r.json()) as Record<string, { last_price?: number }>
    return Number(j[pool]?.last_price) || 0
  }

  async tickOnce(): Promise<Record<string, unknown>> {
    const wrapperId = (await this.state.storage.get<string>('wrapperId')) ?? null
    if (!wrapperId) return { status: 'error', action: 'error', detail: 'No wrapper registered.' }

    // Real price-drop trigger: monitor the live mainnet SUI/USDC market signal,
    // track the running peak, fire when drawdown >= the policy threshold. The
    // threshold came from the strategy handed in at activate (not on-chain).
    let market: { triggerMet: boolean; price: string } | undefined
    const monitor = (await this.state.storage.get<{ threshold_pct: number; asset: string }>('monitor')) ?? null
    if (monitor && monitor.threshold_pct > 0) {
      try {
        const price = await this.monitorPrice(monitor.asset)
        if (price > 0) {
          let peak = (await this.state.storage.get<number>('peakPrice')) ?? price
          if (price > peak) peak = price
          const drawdownPct = ((peak - price) / peak) * 100
          const triggerMet = drawdownPct >= monitor.threshold_pct
          await this.state.storage.put('lastPrice', price)
          await this.state.storage.put('drawdownPct', Number(drawdownPct.toFixed(3)))
          await this.state.storage.put('triggerMet', triggerMet)
          // re-arm the peak after a trigger so it doesn't fire every tick in a slump
          await this.state.storage.put('peakPrice', triggerMet ? price : peak)
          market = { triggerMet, price: String(price) }
        }
      } catch { /* price read is best-effort; fall through to monitoring */ }
    }

    const result = await runTick(this.env, { wrapperId, market })
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
