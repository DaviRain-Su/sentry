/* ===========================================================
   RescueGrid — Dashboard screen
   =========================================================== */
import { RG } from '../data.js'
import { Icon, Sparkline, RiskGauge, Token, PairGlyph, useAnimatedNumber, fmtUsd } from './primitives.jsx'

function StatCard({ label, value, sub, accent, icon, spark, sparkColor }) {
  return (
    <div className="card" style={{ padding: '16px 18px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="eyebrow">{label}</div>
        <div style={{ color: accent || 'var(--t2)', opacity: .9 }}><Icon name={icon} size={16} /></div>
      </div>
      <div className="mono display" style={{ fontSize: 26, fontWeight: 600, marginTop: 10, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
        <div style={{ fontSize: 12, color: sub.color || 'var(--t1)', fontFamily: 'var(--f-mono)', fontWeight: 500 }}>{sub.text}</div>
        {spark && <Sparkline data={spark} w={64} h={22} color={sparkColor || 'var(--accent)'} fill={false} strokeW={1.5} />}
      </div>
    </div>
  )
}

function PriceChart({ data, crashState }) {
  const w = 600, h = 200
  const pad = { l: 8, r: 8, t: 16, b: 8 }
  const min = Math.min(...data) * 0.995, max = Math.max(...data) * 1.002
  const rng = max - min || 1
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b
  const pts = data.map((v, i) => {
    const x = pad.l + (i / (data.length - 1)) * iw
    const y = pad.t + ih - ((v - min) / rng) * ih
    return [x, y]
  })
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = line + ` L${pts[pts.length-1][0]} ${h-pad.b} L${pad.l} ${h-pad.b} Z`
  const last = pts[pts.length - 1]
  const crashing = crashState === 'crashing' || crashState === 'rescuing'
  const col = crashing ? 'var(--danger)' : 'var(--accent)'
  // rescue rung lines (only when rescuing/rescued)
  const rungs = (crashState === 'rescuing' || crashState === 'rescued')
    ? [3.85, 3.74].map(px => pad.t + ih - ((px - min) / rng) * ih) : []
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="pcg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.22" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={pad.l} x2={w - pad.r} y1={pad.t + ih * f} y2={pad.t + ih * f} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
      ))}
      {rungs.map((y, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--accent)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
          <rect x={w - pad.r - 86} y={y - 9} width="80" height="16" rx="4" fill="var(--accent-dim)" />
          <text x={w - pad.r - 46} y={y + 3} fontSize="10" fontFamily="var(--f-mono)" fill="var(--accent)" textAnchor="middle">rung {i+1}</text>
        </g>
      ))}
      <path d={area} fill="url(#pcg)" />
      <path d={line} fill="none" stroke={col} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"
        style={{ transition: 'stroke .3s', filter: `drop-shadow(0 0 6px ${crashing ? 'var(--danger-glow)' : 'transparent'})` }} />
      <circle cx={last[0]} cy={last[1]} r="4" fill={col} />
      <circle cx={last[0]} cy={last[1]} r="4" fill="none" stroke={col} strokeWidth="1.5">
        <animate attributeName="r" from="4" to="11" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.7" to="0" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </svg>
  )
}

export function Dashboard({ state, live }) {
  const { risk, suiPrice, suiSpark, crashState, mode, agentOn, activity } = state
  const p = RG.portfolio
  const animPrice = useAnimatedNumber(suiPrice, 500)
  const animTotal = useAnimatedNumber(p.total, 700)

  // ── live mode: real on-chain data (summary/market/activity) ───────────
  const liveOn = !!live
  const sum = live?.summary
  const usd6 = (u) => fmtUsd(Number(u || 0) / 1e6, 0)
  const livePrice = liveOn ? Number(live?.market?.SUI_DBUSDC?.last_price ?? suiPrice) : animPrice
  const feed = liveOn ? (live?.activity || []) : activity
  const advisory = liveOn ? <span className="badge badge-neutral" style={{ fontSize: 9, marginLeft: 6 }}>advisory</span> : null
  // live advisory risk score, derived from real budget utilisation + concentration
  const activePos = (sum?.positions || []).filter(po => po.status === 'active')
  const util = sum && sum.total_authorized > 0 ? sum.total_deployed / sum.total_authorized : 0
  const conc = activePos.length > 0 ? 1 / activePos.length : 0
  const shownRisk = liveOn ? Math.min(95, Math.round(15 + util * 50 + conc * 30)) : risk

  const banner = crashState === 'crashing'
    ? { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'alert', t: 'Flash crash detected · SUI −8.4% in 6 min', s: 'Risk score spiking — agent evaluating rescue conditions…' }
    : crashState === 'rescuing'
    ? { c: 'var(--accent)', bg: 'var(--accent-dim)', icon: 'bolt', t: 'Agent autonomously executing rescue grid', s: 'Placing limit orders on Deepbook within policy budget — no signature required.' }
    : crashState === 'rescued'
    ? { c: 'var(--safe)', bg: 'var(--safe-dim)', icon: 'check', t: 'Rescue complete · 2 rungs filled, budget intact', s: 'Agent bought the dip inside policy limits and logged every action on-chain.' }
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {banner && (
        <div className="fade-up" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 'var(--r-lg)',
          background: banner.bg, border: `1px solid ${banner.c}55` }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, background: banner.c, color: '#06120f',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={banner.icon} size={20} stroke={2.2} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="display" style={{ fontWeight: 600, fontSize: 14.5, color: banner.c }}>{banner.t}</div>
            <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 1 }}>{banner.s}</div>
          </div>
          {crashState === 'rescuing' && <div className="badge badge-accent"><span className="dot pulse"></span>LIVE</div>}
        </div>
      )}

      {/* KPI row */}
      <div className="rg-kpi">
        {liveOn ? (
          <StatCard label="Authorized budget" value={`$${usd6(sum?.total_authorized)}`} icon="wallet"
            sub={{ text: `${sum?.active_policies ?? 0} active polic${(sum?.active_policies ?? 0) === 1 ? 'y' : 'ies'}`, color: 'var(--t1)' }} />
        ) : (
          <StatCard label="Portfolio value" value={`$${fmtUsd(animTotal)}`} icon="wallet"
            sub={{ text: `${p.chg24h > 0 ? '+' : ''}${p.chg24h}% · 24h`, color: p.chg24h < 0 ? 'var(--danger)' : 'var(--safe)' }} />
        )}
        {liveOn ? (
          <StatCard label="Deployed" value={`$${usd6(sum?.total_deployed)}`} icon="coin" accent="var(--accent)"
            sub={{ text: `of $${usd6(sum?.total_authorized)} authorized`, color: 'var(--t1)' }} />
        ) : (
          <StatCard label="Free budget" value={`$${fmtUsd(p.available, 0)}`} icon="coin" accent="var(--accent)"
            sub={{ text: `$${fmtUsd(p.deployed, 0)} deployed`, color: 'var(--t1)' }} />
        )}
        <StatCard label="Agent status" value={agentOn ? 'Autonomous' : 'Paused'} icon="bolt"
          accent={agentOn ? 'var(--accent)' : 'var(--t2)'}
          sub={{ text: liveOn ? (mode === 'cloud' ? 'Cloud · on-chain' : 'Local · on-chain') : (mode === 'cloud' ? 'Cloud · Worker' : 'Local · Ollama'), color: 'var(--t1)' }} />
        <StatCard label={liveOn ? 'Risk score · advisory' : 'Risk score'} value={Math.round(shownRisk)} icon="shield"
          accent={shownRisk >= 70 ? 'var(--danger)' : shownRisk >= 45 ? 'var(--warn)' : 'var(--safe)'}
          spark={RG.riskHistory} sparkColor={shownRisk >= 70 ? 'var(--danger)' : shownRisk >= 45 ? 'var(--warn)' : 'var(--safe)'}
          sub={{ text: shownRisk >= 70 ? 'critical' : shownRisk >= 45 ? 'elevated' : 'stable', color: shownRisk >= 70 ? 'var(--danger)' : shownRisk >= 45 ? 'var(--warn)' : 'var(--safe)' }} />
      </div>

      {/* main grid */}
      <div className="rg-dashgrid">
        {/* left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card" style={{ paddingBottom: 8 }}>
            <div className="card-hd">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <PairGlyph pair="SUI/USDC" />
                <div>
                  <div className="card-title">SUI / USDC</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>{liveOn ? 'Deepbook v3 · live indexer' : 'Deepbook v3 · price via Pyth'}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 22, fontWeight: 600, color: crashState === 'crashing' ? 'var(--danger)' : 'var(--t0)' }}>
                  ${(liveOn ? livePrice : animPrice).toFixed(3)}
                </div>
                <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: RG.prices.SUI.chg < 0 ? 'var(--danger)' : 'var(--safe)' }}>
                  {crashState === 'crashing' || crashState === 'rescuing' || crashState === 'rescued' ? '−8.42%' : `${RG.prices.SUI.chg}%`}
                </div>
              </div>
            </div>
            <div style={{ padding: '12px 6px 0' }}>
              <PriceChart data={suiSpark} crashState={crashState} />
            </div>
          </div>

          {/* positions */}
          <div className="card">
            <div className="card-hd" style={{ paddingBottom: 12 }}>
              <div className="card-title">{liveOn ? 'Active policies' : 'Open positions'}</div>
              <div className="badge badge-neutral">{liveOn ? `${sum?.positions?.length ?? 0} on-chain` : `${RG.positions.length} active`}</div>
            </div>
            {liveOn ? (
              <div style={{ padding: '0 6px 8px' }}>
                {(sum?.positions?.length ?? 0) === 0 && <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--t2)' }}>No policies yet — create a strategy.</div>}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(sum?.positions ?? []).map((po, i) => {
                      const used = Math.round((Number(po.spent_amount) / Number(po.budget_ceiling || 1)) * 100)
                      return (
                        <tr key={po.wrapper_id} style={{ borderTop: i ? '1px solid var(--border)' : 'none' }}>
                          <td style={{ padding: '11px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <PairGlyph pair="SUI/USDC" />
                              <span className="mono" style={{ fontSize: 11.5, color: 'var(--sui)' }}>{po.wrapper_id.slice(0, 6)}…{po.wrapper_id.slice(-4)}</span>
                            </div>
                          </td>
                          <td style={{ padding: '11px 12px', textAlign: 'right' }} className="mono">{fmtUsd(Number(po.spent_amount) / 1e6, 0)} / {fmtUsd(Number(po.budget_ceiling) / 1e6, 0)} USDC</td>
                          <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                            <span className={`badge ${po.status === 'active' ? 'badge-safe' : 'badge-warn'}`}><span className={`dot ${po.status === 'active' ? 'pulse' : ''}`}></span>{po.status} · {used}%</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
            <div style={{ padding: '0 6px 8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--t2)' }}>
                    {['Pair', 'Strategy', 'Size', 'PnL', 'Risk'].map((h, i) => (
                      <th key={h} style={{ textAlign: i > 1 ? 'right' : 'left', padding: '8px 12px', fontSize: 10.5,
                        fontFamily: 'var(--f-mono)', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RG.positions.map((po, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '11px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <PairGlyph pair={po.pair} />
                          <span className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{po.pair}</span>
                        </div>
                      </td>
                      <td style={{ padding: '11px 12px', color: 'var(--t1)', fontSize: 12.5 }}>{po.side}</td>
                      <td style={{ padding: '11px 12px', textAlign: 'right' }} className="mono">${fmtUsd(po.size, 0)}</td>
                      <td style={{ padding: '11px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ color: po.pnl < 0 ? 'var(--danger)' : 'var(--safe)', fontWeight: 600 }}>
                          {po.pnl < 0 ? '−' : '+'}${fmtUsd(Math.abs(po.pnl))}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t2)' }}>{po.pnlPct > 0 ? '+' : ''}{po.pnlPct}%</div>
                      </td>
                      <td style={{ padding: '11px 12px', textAlign: 'right' }}>
                        <span className={`badge ${po.risk === 'low' ? 'badge-safe' : po.risk === 'med' ? 'badge-warn' : 'badge-danger'}`}>
                          {po.risk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        </div>

        {/* right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 18px',
            ...(crashState === 'crashing' ? { animation: 'flash-pulse 1.1s ease infinite' } : {}) }}>
            <div style={{ alignSelf: 'flex-start', display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 6 }}>
              <div className="card-title">Risk monitor{advisory}</div>
              <div className="badge badge-accent"><span className="dot pulse"></span>LIVE</div>
            </div>
            <RiskGauge score={shownRisk} />
            <div style={{ width: '100%', marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { k: 'Volatility (1h)', v: crashState === 'crashing' ? 'extreme' : 'moderate', lv: crashState === 'crashing' ? 'danger' : 'warn' },
                { k: 'Slippage headroom', v: 'within cap', lv: 'safe' },
                { k: 'Pool liquidity', v: crashState === 'crashing' ? 'thinning' : 'healthy', lv: crashState === 'crashing' ? 'warn' : 'safe' },
              ].map(r => (
                <div key={r.k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--t1)' }}>{r.k}</span>
                  <span className={`badge badge-${r.lv}`}><span className="dot"></span>{r.v}</span>
                </div>
              ))}
            </div>
          </div>

          <ReasoningPanel crashState={crashState} mode={mode} live={liveOn} />

          <div className="card">
            <div className="card-hd" style={{ paddingBottom: 10 }}>
              <div className="card-title">Agent live feed</div>
              <span style={{ color: 'var(--accent)' }}><Icon name="bolt" size={16} /></span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 230, overflowY: 'auto' }}>
              {liveOn && feed.length === 0 && (
                <div style={{ padding: '18px', fontSize: 12, color: 'var(--t2)' }}>No on-chain activity yet.</div>
              )}
              {feed.slice(0, 6).map((a, i) => (
                <div key={a.t + i} className={i === 0 && crashState === 'rescuing' ? 'fade-up' : ''}
                  style={{ display: 'flex', gap: 11, padding: '10px 18px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: a.kind === 'exec' ? 'var(--accent-dim)' : a.kind === 'guardian' ? 'var(--danger-dim)' : a.kind === 'policy' ? 'var(--sui-dim)' : 'var(--glass-hi)',
                    color: a.kind === 'exec' ? 'var(--accent)' : a.kind === 'guardian' ? 'var(--danger)' : a.kind === 'policy' ? 'var(--sui)' : 'var(--t1)' }}>
                    <Icon name={a.kind === 'exec' ? 'bolt' : a.kind === 'guardian' ? 'shield' : a.kind === 'policy' ? 'grid' : 'eye'} size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--t0)' }}>{a.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)' }}>{a.t} · {a.policy}</div>
                  </div>
                  {a.amount !== 0 && <div className="mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)' }}>−${fmtUsd(Math.abs(a.amount))}</div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReasoningPanel({ crashState, mode, live }) {
  const key = crashState === 'idle' ? 'idle' : (crashState === 'rescued' ? 'rescued' : 'crashing')
  const R = RG.riskFactors[key]
  const maxW = 45
  const lvCol = { safe: 'var(--safe)', warn: 'var(--warn)', danger: 'var(--danger)' }
  return (
    <div className="card">
      <div className="card-hd" style={{ paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}><Icon name="sparkles" size={16} /></span>
          <div className="card-title">Agent reasoning{live && <span className="badge badge-neutral" style={{ fontSize: 9, marginLeft: 6 }}>advisory</span>}</div>
        </div>
        <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
          <Icon name={mode === 'local' ? 'cpu' : 'cloud'} size={10} />{mode === 'local' ? 'on-device' : 'cloud'}</span>
      </div>
      <div style={{ padding: '4px 18px 18px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.55, marginBottom: 14 }}>
          <span style={{ color: 'var(--t2)' }}>“</span>{R.rationale}<span style={{ color: 'var(--t2)' }}>”</span>
        </div>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Score contributors</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {R.factors.map(f => (
            <div key={f.k}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, marginBottom: 4 }}>
                <span style={{ color: 'var(--t1)' }}>{f.k}</span>
                <span className="mono" style={{ color: lvCol[f.lv], fontWeight: 600 }}>+{f.w}</span>
              </div>
              <div style={{ height: 5, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ width: `${(f.w / maxW) * 100}%`, height: '100%', borderRadius: 100, background: lvCol[f.lv],
                  transition: 'width .5s ease', boxShadow: `0 0 8px ${lvCol[f.lv]}` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
