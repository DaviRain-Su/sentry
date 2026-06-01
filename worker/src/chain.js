// E4 — read on-chain state and aggregate policy activity.
// Chain (MoveGate Mandate + RescuePolicyWrapper + events) is the final source
// of truth (docs §7 GET .../activity, §8 chain-wins). runtime_state is derived
// from chain here; once the Durable Object (E5) runs it supplies the live state
// and runtime_state_stale flips when it disagrees with chain.
import { getClient, DEPLOYMENT } from './sui-tx.js'

const RG = DEPLOYMENT.rescuegrid

function fields(obj) {
  return obj?.data?.content?.dataType === 'moveObject' ? obj.data.content.fields : null
}

export async function readWrapper(client, wrapperId) {
  const obj = await client.getObject({ id: wrapperId, options: { showContent: true } })
  const f = fields(obj)
  if (!f) return null
  return {
    wrapper_id: wrapperId,
    owner: f.owner,
    mandate_id: f.mandate_id,
    agent: f.agent,
    pool_id: f.pool_id,
    budget_coin_type: f.budget_coin_type,
    budget_ceiling: String(f.budget_ceiling),
    spent_amount: String(f.spent_amount),
    max_slippage_bps: Number(f.max_slippage_bps),
  }
}

export async function readMandate(client, mandateId) {
  const obj = await client.getObject({ id: mandateId, options: { showContent: true } })
  const f = fields(obj)
  if (!f) return null
  return {
    id: mandateId,
    owner: f.owner,
    agent: f.agent,
    revoked: Boolean(f.revoked),
    expires_at_ms: String(f.expires_at_ms),
  }
}

export async function queryPolicyEvents(client, wrapperId, max = 100) {
  const out = []
  let cursor = null
  for (let page = 0; page < 5; page++) {
    const res = await client.queryEvents({
      query: { MoveEventModule: { package: RG.package_id, module: 'policy' } },
      cursor,
      limit: 50,
      order: 'descending',
    })
    for (const e of res.data) {
      const pj = e.parsedJson || {}
      if (pj.wrapper_id && pj.wrapper_id !== wrapperId) continue
      out.push({
        type: String(e.type).split('::').pop(),
        tx: e.id?.txDigest,
        timestamp_ms: e.timestampMs ? Number(e.timestampMs) : null,
        data: pj,
      })
      if (out.length >= max) return out
    }
    if (!res.hasNextPage) break
    cursor = res.nextCursor
  }
  return out
}

/** List policies owned by an address, from PolicyCreated events (newest first). */
export async function listPoliciesByOwner(owner) {
  const client = getClient()
  const out = []
  let cursor = null
  for (let page = 0; page < 5; page++) {
    const res = await client.queryEvents({
      query: { MoveEventModule: { package: RG.package_id, module: 'policy' } },
      cursor, limit: 50, order: 'descending',
    })
    for (const e of res.data) {
      if (!String(e.type).endsWith('::policy::PolicyCreated')) continue
      const pj = e.parsedJson || {}
      if (pj.owner !== owner) continue
      out.push({
        wrapper_id: pj.wrapper_id, mandate_id: pj.mandate_id, owner: pj.owner, agent: pj.agent,
        pool_id: pj.pool_id, budget_ceiling: String(pj.budget_ceiling), max_slippage_bps: Number(pj.max_slippage_bps),
        expires_at_ms: String(pj.expires_at_ms), created_tx: e.id?.txDigest,
      })
    }
    if (!res.hasNextPage) break
    cursor = res.nextCursor
  }
  return out
}

/** Owner-scoped activity feed merged from all policy-module events. */
export async function listActivityByOwner(owner) {
  const client = getClient()
  // 1) collect raw policy-module events (newest first)
  const raw = []
  let cursor = null
  for (let page = 0; page < 6; page++) {
    const res = await client.queryEvents({
      query: { MoveEventModule: { package: RG.package_id, module: 'policy' } },
      cursor, limit: 50, order: 'descending',
    })
    raw.push(...res.data)
    if (!res.hasNextPage) break
    cursor = res.nextCursor
  }
  // 2) the owner's wrapper ids (from PolicyCreated)
  const ownedWrappers = new Set(
    raw.filter(e => String(e.type).endsWith('::PolicyCreated') && e.parsedJson?.owner === owner)
      .map(e => e.parsedJson.wrapper_id),
  )
  // 3) map matching events to feed items
  const items = []
  for (const e of raw) {
    const pj = e.parsedJson || {}
    if (!pj.wrapper_id || !ownedWrappers.has(pj.wrapper_id)) continue
    const ts = e.timestampMs ? Number(e.timestampMs) : null
    const d = ts ? new Date(ts) : null
    const t = d ? d.toISOString().slice(11, 19) : ''
    const date = d ? d.toISOString().slice(0, 10) : 'recent'
    const short = pj.wrapper_id.slice(0, 6) + '…' + pj.wrapper_id.slice(-4)
    const type = String(e.type).split('::').pop()
    if (type === 'PolicyCreated') {
      items.push({ t, date, kind: 'policy', policy: short, title: 'Policy Object created',
        detail: `Budget ${Number(pj.budget_ceiling) / 1e6} USDC · max slip ${Number(pj.max_slippage_bps) / 100}%`,
        amount: 0, tx: e.id?.txDigest, risk: null, mode: 'cloud' })
    } else if (type === 'AgentTradeExecuted') {
      items.push({ t, date, kind: 'exec', policy: short, title: `Agent trade · ${pj.base_amount_received} base`,
        detail: `Spent ${Number(pj.quote_amount_spent) / 1e6} USDC · slippage ${pj.slippage_bps}bps · spent ${Number(pj.spent_amount_after) / 1e6}/${Number(pj.budget_ceiling) / 1e6}`,
        amount: -(Number(pj.quote_amount_spent) / 1e6), tx: e.id?.txDigest, risk: null, mode: 'cloud' })
    } else if (type === 'PolicyRevoked') {
      items.push({ t, date, kind: 'guardian', policy: short, title: 'Policy revoked by owner',
        detail: 'Agent authority deleted on-chain', amount: 0, tx: e.id?.txDigest, risk: null, mode: 'cloud' })
    }
  }
  return items
}

export async function getActivity(wrapperId, nowMs = Date.now()) {
  const client = getClient()
  const wrapper = await readWrapper(client, wrapperId)
  if (!wrapper) return { status: 'error', code: 'NOT_FOUND', message: 'Wrapper not found on-chain.' }
  const mandate = await readMandate(client, wrapper.mandate_id)
  const revoked = mandate ? mandate.revoked : false
  const expires_at_ms = mandate ? mandate.expires_at_ms : '0'
  const expired = mandate ? nowMs >= Number(mandate.expires_at_ms) : false

  const runtime_state = revoked ? 'Revoked' : expired ? 'Expired' : 'Monitoring'
  const events = await queryPolicyEvents(client, wrapperId)

  return {
    status: 'ok',
    policy: {
      policy_id: wrapperId,
      mandate_id: wrapper.mandate_id,
      wrapper_id: wrapperId,
      runtime_state,
      runtime_state_stale: false, // chain-derived in MVP until DO supplies live state
      budget_ceiling: wrapper.budget_ceiling,
      spent_amount: wrapper.spent_amount,
      pool_id: wrapper.pool_id,
      max_slippage_bps: wrapper.max_slippage_bps,
      revoked,
      expires_at_ms,
    },
    events,
  }
}
