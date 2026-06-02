// Client-side chain reads (raw JSON-RPC, no SDK) so the dashboard shows REAL
// data the moment a wallet is connected — no Worker required for reads.
// (The Worker is still used for the write path: parse + build create_policy.)
import deployment from '../worker/src/deployment.js'

const RPC = deployment.rpc || 'https://fullnode.testnet.sui.io:443'
const INDEXER = 'https://deepbook-indexer.testnet.mystenlabs.com'
const RG = deployment.rescuegrid
const DB = deployment.deepbook

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json()
  if (j.error) throw new Error(j.error.message)
  return j.result
}

function fields(obj) {
  return obj?.data?.content?.dataType === 'moveObject' ? obj.data.content.fields : null
}

async function readWrapper(id) {
  const f = fields(await rpc('sui_getObject', [id, { showContent: true }]))
  if (!f) return null
  return { wrapper_id: id, owner: f.owner, mandate_id: f.mandate_id, agent: f.agent, pool_id: f.pool_id,
    budget_ceiling: String(f.budget_ceiling), spent_amount: String(f.spent_amount), max_slippage_bps: Number(f.max_slippage_bps) }
}
async function readMandate(id) {
  const f = fields(await rpc('sui_getObject', [id, { showContent: true }]))
  if (!f) return null
  return { id, revoked: Boolean(f.revoked), expires_at_ms: String(f.expires_at_ms) }
}

async function policyEvents() {
  const out = []
  let cursor = null
  for (let i = 0; i < 5; i++) {
    const res = await rpc('suix_queryEvents', [{ MoveEventModule: { package: RG.package_id, module: 'policy' } }, cursor, 50, true])
    out.push(...res.data)
    if (!res.hasNextPage) break
    cursor = res.nextCursor
  }
  return out
}

export async function getMarket() {
  try {
    const t = await (await fetch(`${INDEXER}/ticker`)).json()
    const pick = (k) => (t[k] ? { last_price: t[k].last_price, base_volume: t[k].base_volume } : null)
    let sui_spark = [], sui_change = null
    try {
      const trades = await (await fetch(`${INDEXER}/trades/SUI_DBUSDC?limit=40`)).json()
      const prices = (trades || []).map((x) => Number(x.price)).filter((n) => n > 0).reverse()
      sui_spark = prices
      if (prices.length >= 2) sui_change = +(((prices[prices.length - 1] - prices[0]) / prices[0]) * 100).toFixed(2)
    } catch { /* spark optional */ }
    return { status: 'ok', market: { SUI_DBUSDC: pick('SUI_DBUSDC'), DEEP_DBUSDC: pick('DEEP_DBUSDC'), WAL_DBUSDC: pick('WAL_DBUSDC'), sui_spark, sui_change } }
  } catch (e) {
    return { status: 'error', message: String(e?.message || e) }
  }
}

export async function getBalances(owner) {
  const [bals, m] = await Promise.all([rpc('suix_getAllBalances', [owner]), getMarket()])
  const mk = m.status === 'ok' ? m.market : {}
  const price = { SUI: Number(mk.SUI_DBUSDC?.last_price) || 0, USDC: 1, DEEP: Number(mk.DEEP_DBUSDC?.last_price) || 0, WAL: Number(mk.WAL_DBUSDC?.last_price) || 0 }
  const sym = (ct) => ct.endsWith('::sui::SUI') ? ['SUI', 9]
    : ct.includes('::DBUSDC::DBUSDC') ? ['USDC', 6]
    : ct.endsWith('::deep::DEEP') ? ['DEEP', 6]
    : ct.endsWith('::wal::WAL') ? ['WAL', 9] : null
  const holdings = []
  for (const b of bals) {
    const s = sym(b.coinType)
    if (!s) continue
    const amount = Number(b.totalBalance) / 10 ** s[1]
    if (amount <= 0) continue
    holdings.push({ sym: s[0], amount, price: price[s[0]], value: amount * price[s[0]], role: 'Wallet', state: 'free' })
  }
  return { status: 'ok', holdings }
}

export async function listPolicies(owner) {
  const ev = await policyEvents()
  const policies = ev
    .filter((e) => String(e.type).endsWith('::PolicyCreated') && e.parsedJson?.owner === owner)
    .map((e) => ({ wrapper_id: e.parsedJson.wrapper_id, mandate_id: e.parsedJson.mandate_id, owner: e.parsedJson.owner,
      pool_id: e.parsedJson.pool_id, budget_ceiling: String(e.parsedJson.budget_ceiling), max_slippage_bps: Number(e.parsedJson.max_slippage_bps),
      expires_at_ms: String(e.parsedJson.expires_at_ms) }))
  return { status: 'ok', policies }
}

export async function getActivity(owner) {
  const ev = await policyEvents()
  const owned = new Set(ev.filter((e) => String(e.type).endsWith('::PolicyCreated') && e.parsedJson?.owner === owner).map((e) => e.parsedJson.wrapper_id))
  const activity = []
  for (const e of ev) {
    const pj = e.parsedJson || {}
    if (!pj.wrapper_id || !owned.has(pj.wrapper_id)) continue
    const ts = e.timestampMs ? Number(e.timestampMs) : null
    const d = ts ? new Date(ts) : null
    const t = d ? d.toISOString().slice(11, 19) : ''
    const date = d ? d.toISOString().slice(0, 10) : 'recent'
    const short = pj.wrapper_id.slice(0, 6) + '…' + pj.wrapper_id.slice(-4)
    const type = String(e.type).split('::').pop()
    if (type === 'PolicyCreated') activity.push({ t, date, kind: 'policy', policy: short, title: 'Policy Object created', detail: `Budget ${Number(pj.budget_ceiling) / 1e6} USDC · max slip ${Number(pj.max_slippage_bps) / 100}%`, amount: 0, tx: e.id?.txDigest, risk: null, mode: 'cloud' })
    else if (type === 'AgentTradeExecuted') activity.push({ t, date, kind: 'exec', policy: short, title: `Agent trade · ${pj.base_amount_received} base`, detail: `Spent ${Number(pj.quote_amount_spent) / 1e6} USDC · slippage ${pj.slippage_bps}bps`, amount: -(Number(pj.quote_amount_spent) / 1e6), tx: e.id?.txDigest, risk: null, mode: 'cloud' })
    else if (type === 'PolicyRevoked') activity.push({ t, date, kind: 'guardian', policy: short, title: 'Policy revoked by owner', detail: 'Agent authority deleted on-chain', amount: 0, tx: e.id?.txDigest, risk: null, mode: 'cloud' })
  }
  return { status: 'ok', activity }
}

export async function getSummary(owner) {
  const { policies } = await listPolicies(owner)
  const positions = []
  for (const p of policies) {
    const w = await readWrapper(p.wrapper_id)
    if (!w) continue
    const m = await readMandate(w.mandate_id)
    const status = m?.revoked ? 'revoked' : (m && Date.now() >= Number(m.expires_at_ms)) ? 'expired' : 'active'
    positions.push({ wrapper_id: p.wrapper_id, pool_id: w.pool_id, budget_ceiling: w.budget_ceiling, spent_amount: w.spent_amount, max_slippage_bps: w.max_slippage_bps, status })
  }
  const active = positions.filter((p) => p.status === 'active')
  const sum = (arr, k) => arr.reduce((s, p) => s + Number(p[k]), 0)
  return { status: 'ok', summary: { active_policies: active.length, total_policies: positions.length, total_authorized: sum(active, 'budget_ceiling'), total_deployed: sum(active, 'spent_amount'), positions } }
}
