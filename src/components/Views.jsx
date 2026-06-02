/* ===========================================================
   RescueGrid — Activity log + Policy management
   =========================================================== */
import { useState, Fragment } from 'react'
import { RG } from '../data.js'
import { Icon, fmtUsd, ModeBadge } from './primitives.jsx'
import { Button, ProgressBar } from '@heroui/react'
import { PortfolioSummary } from './Active.jsx'

function LoadingCard({ label }) {
  return (
    <div className="card" style={{ padding: 44, textAlign: 'center', color: 'var(--t2)' }}>
      <Icon name="refresh" size={20} style={{ animation: 'spin 1s linear infinite' }} />
      <div style={{ marginTop: 10, fontSize: 13 }}>{label}</div>
    </div>
  )
}

function EmptyCard({ icon, title, detail }) {
  return (
    <div className="card" style={{ padding: '48px 40px', textAlign: 'center' }}>
      <div style={{ display: 'inline-flex', width: 48, height: 48, borderRadius: 12, background: 'var(--glass-hi)',
        color: 'var(--t2)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
        <Icon name={icon} size={22} />
      </div>
      <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--t2)', maxWidth: 380, margin: '6px auto 0', lineHeight: 1.5 }}>{detail}</div>
    </div>
  )
}

export function ActivityView({ activity, onTx, live = false, loading = false }) {
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(null)
  const kinds = [
    { id: 'all', label: 'All events' },
    { id: 'executed', label: 'Executed' },
    { id: 'blocked', label: 'Blocked' },
    { id: 'planned', label: 'Planned / no-op' },
    { id: 'exec', label: 'Trades', sep: true },
    { id: 'rebalance', label: 'Rebalance' },
    { id: 'bridge', label: 'Bridge' },
    { id: 'guardian', label: 'Guardian' },
    { id: 'policy', label: 'Policy' },
  ]
  const meta = {
    exec: { c: 'var(--accent)', bg: 'var(--accent-dim)', icon: 'bolt', label: 'EXECUTION' },
    rebalance: { c: 'var(--sui)', bg: 'var(--sui-dim)', icon: 'swap', label: 'REBALANCE' },
    bridge: { c: 'var(--accent)', bg: 'var(--accent-dim)', icon: 'globe', label: 'BRIDGE' },
    guardian: { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'shield', label: 'GUARDIAN' },
    fail: { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'x', label: 'FAILED' },
    retry: { c: 'var(--warn)', bg: 'var(--warn-dim)', icon: 'refresh', label: 'RETRY' },
    monitor: { c: 'var(--t1)', bg: 'var(--glass-hi)', icon: 'eye', label: 'MONITOR' },
    policy: { c: 'var(--sui)', bg: 'var(--sui-dim)', icon: 'grid', label: 'POLICY' },
  }
  const outcomeOf = (a) => {
    if (a.kind === 'guardian' || a.kind === 'fail') return 'blocked'
    if (a.kind === 'monitor') return 'planned'
    return 'executed'
  }
  const OUTCOME = {
    executed: { label: 'Executed', c: 'var(--safe)' },
    blocked: { label: 'Blocked', c: 'var(--danger)' },
    planned: { label: 'No action', c: 'var(--t2)' },
  }
  const filtered = activity.filter(a =>
    filter === 'all' ? true
    : ['executed', 'blocked', 'planned'].includes(filter) ? outcomeOf(a) === filter
    : filter === 'retry' ? (a.kind === 'retry' || a.kind === 'fail')
    : a.kind === filter)
  const dates = [...new Set(filtered.map(a => a.date))]

  // synthesize the planned-vs-executed detail for an event
  const expand = (a) => {
    const oc = outcomeOf(a)
    const px = RG.prices[(a.policy.match(/SUI|DEEP|WAL|BTC|ETH/) || ['SUI'])[0]] || RG.prices.SUI
    const reason = {
      exec: 'A trigger condition in the policy was met, so the agent placed the order within its budget and slippage limits.',
      rebalance: 'Net exposure drifted past the policy threshold; the agent restored the target position.',
      bridge: 'A leg needed collateral on another chain; the agent bridged funds to keep both sides funded.',
      guardian: 'A pre-execution Guardian check failed, so the agent declined to act and logged the reason.',
      fail: 'The order was submitted but the book moved past the limit before settlement; no funds were spent.',
      retry: 'A prior attempt failed; the agent re-quoted and resubmitted within the same limits.',
      monitor: 'A scheduled risk evaluation ran. Conditions stayed inside policy, so no action was taken.',
      policy: 'You authorized a new on-chain Policy Object granting the agent scoped, capped authority.',
    }[a.kind] || 'Agent evaluated the policy and acted within limits.'
    const plan = {
      exec: ['assert_within_budget(cap, spent)', 'deepbook::place_limit_order(...)', 'log_activity(action="exec")'],
      rebalance: ['read_net_delta()', 'adjust_legs(target≈0)', 'log_activity(action="rebalance")'],
      bridge: ['assert_within_budget(cap, spent)', 'debridge::send(to, asset, amt)', 'await_settlement()'],
      guardian: ['assert_pool_liquidity(min)', '→ FAILED · abort()', 'log_activity(action="blocked")'],
      fail: ['place_limit_order(...)', '→ book moved · revert()', 'queue_retry()'],
      retry: ['re_quote()', 'place_limit_order(...)', 'log_activity(action="retry")'],
      monitor: ['read_oracle(price, vol)', 'recompute_risk()', '→ within policy · no-op'],
      policy: ['publish_policy_object(budget, scope)', 'grant_capability(agent)'],
    }[a.kind] || ['evaluate()', 'act_within_policy()']
    return { oc, px, reason, plan }
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {kinds.map(k => (
            <Fragment key={k.id}>
              {k.sep && <span style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 2px' }} />}
              <Button onPress={() => setFilter(k.id)} size="sm"
                className={filter === k.id ? 'bg-accent text-accent-foreground font-semibold' : 'rg-btn-2'}>{k.label}</Button>
            </Fragment>
          ))}
        </div>
        <div className="badge badge-neutral"><Icon name="link" size={12} /> verified on-chain</div>
      </div>

      {loading && <LoadingCard label="Loading on-chain activity…" />}
      {!loading && activity.length === 0 && (
        <EmptyCard icon="activity" title="No agent activity yet"
          detail={live ? 'Autonomous executions, policy creations and revocations will appear here once your agent acts on-chain.' : 'Nothing to show.'} />
      )}

      {!loading && dates.map(date => (
        <div key={date}>
          <div className="eyebrow" style={{ marginBottom: 10, marginLeft: 2 }}>{date}</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {filtered.filter(a => a.date === date).map((a, i) => {
              const m = meta[a.kind] || meta.monitor
              const key = a.t + a.title
              const isOpen = open === key
              const ex = expand(a)
              const oc = OUTCOME[ex.oc]
              return (
                <div key={key} style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <div onClick={() => setOpen(isOpen ? null : key)} style={{ display: 'flex', gap: 14, padding: '15px 18px', alignItems: 'flex-start', cursor: 'pointer', background: isOpen ? 'var(--glass)' : 'transparent', transition: 'background .12s' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: m.bg, color: m.c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon name={m.icon} size={17} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                        <span className="badge" style={{ fontSize: 9, background: `color-mix(in srgb, ${oc.c} 14%, transparent)`, color: oc.c }}><span className="dot"></span>{oc.label}</span>
                        {a.mode && <ModeBadge mode={a.mode} />}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 3 }}>{a.detail}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}><Icon name="clock" size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{a.t}</span>
                        <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>{a.policy}</span>
                        {a.tx && <a href="#" onClick={e => { e.preventDefault(); e.stopPropagation(); onTx && onTx(a.tx) }} className="mono" style={{ fontSize: 11, color: 'var(--sui)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Icon name="link" size={11} />{a.tx}</a>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div>
                        {a.amount !== 0 && <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: a.amount > 0 ? 'var(--safe)' : 'var(--danger)' }}>{a.amount > 0 ? '+' : '−'}${fmtUsd(Math.abs(a.amount))}</div>}
                        {a.risk != null && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: a.amount !== 0 ? 4 : 0 }}>
                          risk <span className="mono" style={{ color: a.risk >= 60 ? 'var(--danger)' : a.risk >= 45 ? 'var(--warn)' : 'var(--safe)', fontWeight: 600 }}>{a.risk}</span></div>}
                      </div>
                      <Icon name="chevR" size={15} style={{ color: 'var(--t3)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                    </div>
                  </div>

                  {/* expanded detail — planned vs executed */}
                  {isOpen && (
                    <div className="fade-up" style={{ padding: '4px 18px 18px 66px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.55, padding: '12px 14px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                        <span className="eyebrow" style={{ fontSize: 8.5, display: 'block', marginBottom: 5 }}>Why the agent did this</span>
                        {ex.reason}
                      </div>
                      <div>
                        <span className="eyebrow" style={{ fontSize: 8.5, display: 'block', marginBottom: 8 }}>Input snapshot</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                          {[['Price', '$' + (ex.px.usd < 1 ? ex.px.usd.toFixed(4) : ex.px.usd.toFixed(3))], ['24h', ex.px.chg + '%'], ['Risk score', a.risk != null ? a.risk : '—'], ['Mode', a.mode || '—']].map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                              <span style={{ color: 'var(--t2)' }}>{k}</span>
                              <span className="mono" style={{ color: 'var(--t0)' }}>{v}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="eyebrow" style={{ fontSize: 8.5, display: 'block', marginBottom: 8 }}>Execution plan (PTB)</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          {ex.plan.map((stepp, j) => (
                            <div key={j} className="mono" style={{ fontSize: 10.5, color: /FAILED|moved|abort|revert/.test(stepp) ? 'var(--danger)' : /no-op|within policy/.test(stepp) ? 'var(--t2)' : 'var(--t1)',
                              padding: '5px 9px', borderRadius: 6, background: 'var(--bg-0)', display: 'flex', gap: 8 }}>
                              <span style={{ color: 'var(--t3)' }}>{j + 1}</span>{stepp}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 9, padding: '11px 13px', borderRadius: 'var(--r-sm)',
                          background: ex.oc === 'blocked' ? 'var(--danger-dim)' : 'var(--safe-dim)', border: `1px solid color-mix(in srgb, ${oc.c} 30%, var(--border))` }}>
                          <span style={{ color: oc.c, flexShrink: 0 }}><Icon name={ex.oc === 'blocked' ? 'shield' : 'check'} size={15} stroke={2.2} /></span>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>Guardian: {ex.oc === 'blocked' ? 'blocked execution' : ex.oc === 'planned' ? 'no action needed' : 'all checks passed'}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{ex.oc === 'blocked' ? 'Order rejected before any funds moved' : 'Budget, slippage and scope verified on-chain'}</div>
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 160, display: 'flex', alignItems: 'center', gap: 14, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                          <div>
                            <div className="eyebrow" style={{ fontSize: 8 }}>PnL impact</div>
                            <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: a.amount > 0 ? 'var(--safe)' : a.amount < 0 ? 'var(--t0)' : 'var(--t2)' }}>{a.amount !== 0 ? (a.amount > 0 ? '+' : '−') + '$' + fmtUsd(Math.abs(a.amount)) : 'none'}</div>
                          </div>
                          <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
                          <div>
                            <div className="eyebrow" style={{ fontSize: 8 }}>Budget impact</div>
                            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{a.amount < 0 ? '−$' + fmtUsd(Math.abs(a.amount)) : '$0'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function PolicyCard({ p, onRevoke, onInspect, onLive, readOnly = false }) {
  const pct = Math.round((p.budgetUsed / p.budgetCap) * 100)
  const stratMeta = {
    'rescue-grid': { icon: 'grid', label: 'Rescue Grid', c: 'var(--accent)' },
    'dca': { icon: 'target', label: 'DCA Ladder', c: 'var(--sui)' },
    'hedge': { icon: 'shield', label: 'Hedge', c: 'var(--warn)' },
    'funding-arb': { icon: 'swap', label: 'Funding Arb', c: 'var(--accent)' },
    'lp-manage': { icon: 'droplet', label: 'LP Manager', c: 'var(--accent)' },
    'lending': { icon: 'percent', label: 'Yield Router', c: 'var(--safe)' },
    'spot-arb': { icon: 'scale', label: 'Spot Arb', c: 'var(--safe)' },
  }[p.strategy] || { icon: 'grid', label: p.strategy || 'Strategy', c: 'var(--accent)' }
  const days = Math.max(0, Math.ceil((new Date(p.expires) - new Date('2026-06-01')) / 86400000))
  const active = p.status === 'active'
  const statusMeta = {
    active: { cls: 'badge-safe', label: 'active', pulse: true },
    revoked: { cls: 'badge-danger', label: 'revoked', pulse: false },
    expired: { cls: 'badge-warn', label: 'expired', pulse: false },
    paused: { cls: 'badge-neutral', label: 'paused', pulse: false },
  }[p.status] || { cls: 'badge-neutral', label: p.status || 'unknown', pulse: false }
  return (
    <div className="card" style={{ padding: 20, opacity: active ? 1 : 0.72 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--glass-hi)', color: stratMeta.c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={stratMeta.icon} size={20} />
          </div>
          <div>
            <div className="display" style={{ fontWeight: 600, fontSize: 15 }}>{p.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--sui)' }}>{p.id}</span>
              <span className="badge badge-neutral" style={{ fontSize: 9.5, padding: '2px 7px' }}>
                <Icon name={p.mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />{p.mode}</span>
            </div>
          </div>
        </div>
        <span className={`badge ${statusMeta.cls}`}>
          <span className={`dot ${statusMeta.pulse ? 'pulse' : ''}`}></span>{statusMeta.label}</span>
      </div>

      {/* budget bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: 'var(--t1)' }}>Budget used</span>
          <span className="mono"><span style={{ color: 'var(--t0)', fontWeight: 600 }}>{p.budgetUsed}</span> <span style={{ color: 'var(--t2)' }}>/ {p.budgetCap} USDC</span></span>
        </div>
        <ProgressBar value={pct} minValue={0} maxValue={100} className="w-full">
          <ProgressBar.Track className="h-[7px] overflow-hidden rounded-full bg-[color:var(--bg-0)]">
            <ProgressBar.Fill className={pct > 80 ? 'bg-danger' : 'bg-accent'} />
          </ProgressBar.Track>
        </ProgressBar>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { k: 'Scope', v: p.scope.join(', ') },
          { k: 'Max slip', v: p.maxSlippage + '%' },
          { k: 'Executions', v: p.execs },
        ].map(x => (
          <div key={x.k} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 11px' }}>
            <div className="eyebrow" style={{ fontSize: 9 }}>{x.k}</div>
            <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{x.v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 11.5, color: days < 5 ? 'var(--warn)' : 'var(--t2)' }}>
          <Icon name="clock" size={12} style={{ verticalAlign: -2, marginRight: 4 }} />expires in {days}d</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {onLive && p.status !== 'revoked' && <Button size="sm" className="rg-btn-2" onPress={() => onLive(p)} startContent={<Icon name="activity" size={13} />}>Live</Button>}
          <Button size="sm" className="rg-btn-2" onPress={() => onInspect(p)} startContent={<Icon name="eye" size={13} />}>Inspect</Button>
          <Button size="sm" isDisabled={readOnly || p.status === 'revoked'} onPress={() => onRevoke(p.id)} className="bg-danger text-white">
            <Icon name="x" size={13} stroke={2.4} /> {readOnly ? 'Read-only' : p.status === 'revoked' ? 'Revoked' : 'Revoke'}</Button>
        </div>
      </div>
    </div>
  )
}

export function PoliciesView({ policies, onRevoke, onInspect, onLive, live = false, readOnly = false, loading = false }) {
  const totalCap = policies.reduce((s, p) => s + p.budgetCap, 0)
  const totalUsed = policies.reduce((s, p) => s + p.budgetUsed, 0)
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PortfolioSummary policies={policies} onLive={onLive} />
      <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Active policies</div>
          <div className="mono display" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>{policies.filter(p => p.status === 'active').length}</div>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
        <div>
          <div className="eyebrow">Total authorized</div>
          <div className="mono display" style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}>${fmtUsd(totalCap, 0)}</div>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
        <div>
          <div className="eyebrow">Deployed</div>
          <div className="mono display" style={{ fontSize: 24, fontWeight: 600, marginTop: 4, color: 'var(--accent)' }}>${fmtUsd(totalUsed, 0)}</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ maxWidth: 260, fontSize: 12, color: 'var(--t2)', lineHeight: 1.5 }}>
          Every policy is a Move object you own. Revoking deletes the agent's authority instantly, on-chain.
        </div>
      </div>

      {loading && <LoadingCard label="Loading on-chain policies…" />}
      {!loading && policies.length === 0 && (
        <EmptyCard icon="shield" title="No policies yet"
          detail={live ? 'Create a strategy to mint your first Move Policy Object — the agent gets no authority until you do.' : 'Create a strategy to get started.'} />
      )}
      {!loading && policies.length > 0 && (
        <div className="rg-2col">
          {policies.map(p => <PolicyCard key={p.id} p={p} onRevoke={onRevoke} onInspect={onInspect} onLive={onLive} readOnly={readOnly} />)}
        </div>
      )}
    </div>
  )
}
