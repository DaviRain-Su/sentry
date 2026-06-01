/* ===========================================================
   RescueGrid — Activity log + Policy management
   =========================================================== */
import { useState } from 'react'
import { Icon, fmtUsd } from './primitives.jsx'

export function ActivityView({ activity, onTx }) {
  const [filter, setFilter] = useState('all')
  const kinds = [
    { id: 'all', label: 'All events' },
    { id: 'exec', label: 'Executions' },
    { id: 'guardian', label: 'Guardian' },
    { id: 'retry', label: 'Retries' },
    { id: 'monitor', label: 'Monitoring' },
    { id: 'policy', label: 'Policy' },
  ]
  const meta = {
    exec: { c: 'var(--accent)', bg: 'var(--accent-dim)', icon: 'bolt', label: 'EXECUTION' },
    guardian: { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'shield', label: 'GUARDIAN' },
    fail: { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'x', label: 'FAILED' },
    retry: { c: 'var(--warn)', bg: 'var(--warn-dim)', icon: 'refresh', label: 'RETRY' },
    monitor: { c: 'var(--t1)', bg: 'var(--glass-hi)', icon: 'eye', label: 'MONITOR' },
    policy: { c: 'var(--sui)', bg: 'var(--sui-dim)', icon: 'grid', label: 'POLICY' },
  }
  const filtered = activity.filter(a => filter === 'all' || a.kind === filter || (filter === 'retry' && a.kind === 'fail'))
  const dates = [...new Set(filtered.map(a => a.date))]

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {kinds.map(k => (
            <button key={k.id} onClick={() => setFilter(k.id)} className="btn btn-sm"
              style={{ background: filter === k.id ? 'var(--accent-dim)' : 'var(--glass-2)',
                borderColor: filter === k.id ? 'var(--accent)' : 'var(--border)',
                color: filter === k.id ? 'var(--accent)' : 'var(--t1)' }}>{k.label}</button>
          ))}
        </div>
        <div className="badge badge-neutral"><Icon name="link" size={12} /> verified on-chain</div>
      </div>

      {dates.map(date => (
        <div key={date}>
          <div className="eyebrow" style={{ marginBottom: 10, marginLeft: 2 }}>{date}</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {filtered.filter(a => a.date === date).map((a, i) => {
              const m = meta[a.kind]
              return (
                <div key={a.t + i} style={{ display: 'flex', gap: 14, padding: '15px 18px', borderTop: i ? '1px solid var(--border)' : 'none', alignItems: 'flex-start' }}>
                  <div style={{ width: 34, height: 34, borderRadius: 9, background: m.bg, color: m.c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={m.icon} size={17} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                      <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: m.c, letterSpacing: '0.08em' }}>{m.label}</span>
                      {a.mode && <span className="badge badge-neutral" style={{ fontSize: 9.5, padding: '2px 7px' }}>
                        <Icon name={a.mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />{a.mode}</span>}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 3 }}>{a.detail}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 8 }}>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}><Icon name="clock" size={11} style={{ verticalAlign: -1, marginRight: 3 }} />{a.t}</span>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>{a.policy}</span>
                      {a.tx && <a href="#" onClick={e => { e.preventDefault(); onTx && onTx(a.tx) }} className="mono" style={{ fontSize: 11, color: 'var(--sui)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Icon name="link" size={11} />{a.tx}</a>}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {a.amount !== 0 && <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: 'var(--danger)' }}>−${fmtUsd(Math.abs(a.amount))}</div>}
                    {a.risk != null && <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: a.amount !== 0 ? 4 : 0 }}>
                      risk <span className="mono" style={{ color: a.risk >= 60 ? 'var(--danger)' : a.risk >= 45 ? 'var(--warn)' : 'var(--safe)', fontWeight: 600 }}>{a.risk}</span></div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function PolicyCard({ p, onRevoke, onInspect }) {
  const pct = Math.round((p.budgetUsed / p.budgetCap) * 100)
  const stratMeta = {
    'rescue-grid': { icon: 'grid', label: 'Rescue Grid', c: 'var(--accent)' },
    'dca': { icon: 'target', label: 'DCA Ladder', c: 'var(--sui)' },
    'hedge': { icon: 'shield', label: 'Hedge', c: 'var(--warn)' },
  }[p.strategy]
  const days = Math.max(0, Math.ceil((new Date(p.expires) - new Date('2026-06-01')) / 86400000))
  const active = p.status === 'active'
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
        <span className={`badge ${active ? 'badge-safe' : 'badge-warn'}`}>
          <span className={`dot ${active ? 'pulse' : ''}`}></span>{active ? 'active' : 'paused'}</span>
      </div>

      {/* budget bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: 'var(--t1)' }}>Budget used</span>
          <span className="mono"><span style={{ color: 'var(--t0)', fontWeight: 600 }}>{p.budgetUsed}</span> <span style={{ color: 'var(--t2)' }}>/ {p.budgetCap} USDC</span></span>
        </div>
        <div style={{ height: 7, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', borderRadius: 100,
            background: pct > 80 ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), #1fc7b1)',
            boxShadow: pct > 80 ? 'none' : '0 0 12px var(--accent-glow)' }} />
        </div>
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
          <button className="btn btn-sm btn-ghost" onClick={() => onInspect(p)}><Icon name="eye" size={13} /> Inspect</button>
          <button className="btn btn-sm btn-danger" onClick={() => onRevoke(p.id)}><Icon name="x" size={13} stroke={2.4} /> Revoke</button>
        </div>
      </div>
    </div>
  )
}

export function PoliciesView({ policies, onRevoke, onInspect }) {
  const totalCap = policies.reduce((s, p) => s + p.budgetCap, 0)
  const totalUsed = policies.reduce((s, p) => s + p.budgetUsed, 0)
  return (
    <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
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

      <div className="rg-2col">
        {policies.map(p => <PolicyCard key={p.id} p={p} onRevoke={onRevoke} onInspect={onInspect} />)}
      </div>
    </div>
  )
}
