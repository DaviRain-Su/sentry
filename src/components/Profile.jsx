/* ===========================================================
   RescueGrid — Profile / Wallet screen
   Identity, balances, holdings, session & gas.
   Demo mode shows the zkLogin persona; live mode (wallet connected)
   shows the real address, real balances and a wallet-session card.
   =========================================================== */
import { useState } from 'react'
import { RG } from '../data.js'
import { Icon, Token, useAnimatedNumber, fmtUsd } from './primitives.jsx'

function CopyChip({ text, label, full }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const v = full || text
    try { navigator.clipboard && navigator.clipboard.writeText(v) } catch { /* ignore */ }
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <button onClick={copy} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 10px',
      borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-0)', cursor: 'pointer',
      color: copied ? 'var(--accent)' : 'var(--t1)', fontSize: 12, fontWeight: 600, transition: 'all .14s' }}>
      <span>{copied ? 'copied' : (label || text)}</span>
      <Icon name={copied ? 'check' : 'copy'} size={13} stroke={copied ? 2.6 : 1.8} />
    </button>
  )
}

function MetaRow({ icon, iconColor, label, children, last }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderTop: last ? 'none' : '1px solid var(--border)' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--glass-hi)', color: iconColor || 'var(--t1)' }}>
        <Icon name={icon} size={15} />
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--t1)' }}>{label}</span>
      <div style={{ flex: 1 }} />
      <div style={{ textAlign: 'right' }}>{children}</div>
    </div>
  )
}

export function Profile({ account, holdings, policies, live = false, readOnly = false, loading = false, onNav, onToast }) {
  const a = account
  const total = holdings.reduce((s, h) => s + h.value, 0)
  const free = holdings.filter(h => h.state === 'free').reduce((s, h) => s + h.value, 0)
  const deployed = total - free
  const freePct = total > 0 ? (free / total) * 100 : 0
  const animTotal = useAnimatedNumber(total, 700)
  const suiBal = holdings.find(h => h.sym === 'SUI')?.amount

  const activePol = policies.filter(p => p.status === 'active').length
  const totalCap = policies.reduce((s, p) => s + p.budgetCap, 0)
  const usedCap = policies.reduce((s, p) => s + p.budgetUsed, 0)

  const tokenColor = { SUI: 'var(--sui)', USDC: '#3fa0ff', DEEP: 'var(--safe)', WAL: '#7d8bff' }
  const advisory = <span className="badge badge-neutral" style={{ fontSize: 9, marginLeft: 6 }}>advisory</span>

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ---------- identity header ---------- */}
      <div className="card" style={{ padding: 24, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(420px 200px at 88% -40%, var(--accent-dim), transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: 'linear-gradient(135deg,#2EE6CE,#5AA6FF)', color: '#06231f',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 22, fontFamily: 'var(--f-mono)',
              boxShadow: '0 8px 28px -8px var(--accent-glow)' }}>{a.avatar}</div>
            <div style={{ position: 'absolute', bottom: -4, right: -4, width: 24, height: 24, borderRadius: 8, background: 'var(--bg-2)',
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--sui)' }}>
              <Icon name={live ? 'wallet' : 'mail'} size={13} />
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h2 className="display mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.01em' }}>{a.handle}</h2>
              <span className="badge badge-sui" style={{ fontSize: 10 }}><Icon name="shield" size={11} /> {readOnly ? 'read-only Worker' : live ? 'wallet connected' : 'zkLogin verified'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 7, color: 'var(--t2)', fontSize: 12.5, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={live ? 'wallet' : 'mail'} size={13} /> {readOnly ? `${a.provider} · Testnet read surfaces` : live ? `${a.provider} · testnet` : `${a.provider} · ${a.email}`}
              </span>
              {a.memberSince && <><span style={{ color: 'var(--t3)' }}>•</span><span>Member since {a.memberSince}</span></>}
            </div>
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <div className="badge badge-safe"><span className="dot pulse"></span>{a.network}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CopyChip text={a.addr} full={a.fullAddr} />
              <button onClick={() => onToast && onToast('Opening SuiScan explorer…', 'var(--sui)')} className="btn btn-sm btn-ghost" style={{ color: 'var(--sui)' }}>
                <Icon name="link" size={13} /> SuiScan
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- balance hero ---------- */}
      <div className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
          <div>
            <div className="eyebrow">Total balance{live && advisory}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
              <span className="mono display" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>
                ${fmtUsd(animTotal)}
              </span>
              {!live && (
                <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: RG.portfolio.chg24h < 0 ? 'var(--danger)' : 'var(--safe)' }}>
                  <Icon name={RG.portfolio.chg24h < 0 ? 'arrowDown' : 'arrowUp'} size={14} style={{ verticalAlign: -2 }} />
                  {RG.portfolio.chg24h}% · 24h
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => onToast && onToast('Deposit address copied — send USDC or SUI on Sui', 'var(--accent)')}>
              <Icon name="arrowDown" size={14} stroke={2.2} /> Deposit
            </button>
            <button className="btn btn-sm" onClick={() => onToast && onToast(live ? 'Withdrawals are signed in your wallet' : 'Withdrawals require your zkLogin signature', 'var(--sui)')}>
              <Icon name="arrowUp" size={14} stroke={2.2} /> Withdraw
            </button>
          </div>
        </div>

        {/* free vs deployed split */}
        <div style={{ marginTop: 22 }}>
          <div style={{ height: 10, borderRadius: 100, overflow: 'hidden', display: 'flex', background: 'var(--bg-0)' }}>
            <div style={{ width: `${freePct}%`, background: 'linear-gradient(90deg,var(--accent),#1fc7b1)', boxShadow: '0 0 12px var(--accent-glow)' }} />
            <div style={{ width: `${100 - freePct}%`, background: 'var(--sui)', opacity: 0.85 }} />
          </div>
          <div style={{ display: 'flex', gap: 28, marginTop: 14, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--accent)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>Free budget</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>${fmtUsd(free, 0)}</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--sui)', flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>Deployed by agent</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600 }}>${fmtUsd(deployed, 0)}</div>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ maxWidth: 280, fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5, alignSelf: 'center' }}>
              Funds stay in your wallet. The agent can only trade what your policies authorize — never withdraw.
            </div>
          </div>
        </div>
      </div>

      {/* ---------- holdings + side ---------- */}
      <div className="rg-dashgrid">

        {/* holdings table */}
        <div className="card">
          <div className="card-hd" style={{ paddingBottom: 12 }}>
            <div className="card-title">Assets{live && advisory}</div>
            <div className="badge badge-neutral">{holdings.length} tokens</div>
          </div>
          <div style={{ padding: '0 6px 10px' }}>
            {loading && <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--t2)' }}>Loading balances…</div>}
            {!loading && holdings.length === 0 && <div style={{ padding: '14px 12px', fontSize: 12.5, color: 'var(--t2)' }}>No token balances in this wallet.</div>}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--t2)' }}>
                  {['Asset', 'Balance', 'Price', 'Value', 'Allocation'].map((h) => (
                    <th key={h} style={{ textAlign: h === 'Asset' ? 'left' : 'right', padding: '8px 12px', fontSize: 10.5,
                      fontFamily: 'var(--f-mono)', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => {
                  const pr = RG.prices[h.sym] || { usd: h.price ?? 0, chg: 0 }
                  const price = h.price != null ? h.price : pr.usd
                  const alloc = total > 0 ? (h.value / total) * 100 : 0
                  return (
                    <tr key={h.sym} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '13px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                          <Token sym={h.sym} size={30} />
                          <div>
                            <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>{h.sym}</div>
                            <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{h.role}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtUsd(h.amount, h.sym === 'DEEP' || h.sym === 'WAL' ? 0 : 2)}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{h.sym}</div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 12.5 }}>${price < 1 ? price.toFixed(4) : price.toFixed(3)}</div>
                        {!live && <div style={{ fontSize: 10.5, fontWeight: 600, color: pr.chg < 0 ? 'var(--danger)' : pr.chg > 0 ? 'var(--safe)' : 'var(--t2)' }}>
                          {pr.chg > 0 ? '+' : ''}{pr.chg}%</div>}
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right' }} className="mono">
                        <div style={{ fontSize: 13, fontWeight: 600 }}>${fmtUsd(h.value)}</div>
                      </td>
                      <td style={{ padding: '13px 12px', textAlign: 'right', minWidth: 110 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                          <div style={{ width: 56, height: 6, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
                            <div style={{ width: `${alloc}%`, height: '100%', borderRadius: 100, background: tokenColor[h.sym] || 'var(--accent)' }} />
                          </div>
                          <span className="mono" style={{ fontSize: 11, color: 'var(--t1)', width: 30, textAlign: 'right' }}>{alloc.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* side column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* session card — wallet (live) or zkLogin (demo) */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--sui)' }}><Icon name={live ? 'wallet' : 'fingerprint'} size={16} /></span>
            <div className="card-title">{readOnly ? 'Worker read-only session' : live ? 'Wallet session' : 'zkLogin session'}</div>
              </div>
              <span className="badge badge-safe" style={{ fontSize: 9.5 }}><span className="dot pulse"></span>active</span>
            </div>
            {live ? (
              <>
                <MetaRow icon="wallet" iconColor="var(--sui)" label="Wallet">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.provider}</span>
                </MetaRow>
                <MetaRow icon="key" iconColor="var(--accent)" label={readOnly ? 'Read owner' : 'Sui address'}>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--sui)', fontWeight: 600 }}>{a.addr}</span>
                </MetaRow>
                <MetaRow icon="shield" label="Network" last>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>Sui Testnet</span>
                </MetaRow>
                <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--glass)' }}>
                  <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}><Icon name="eye" size={14} /></span>
                  <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                    {readOnly
                      ? <>Loaded through the <strong style={{ color: 'var(--t0)' }}>live local Worker</strong> without wallet signing. Any direct-chain fallback is read-only and explicitly labeled in the app shell.</>
                      : <>Connected via the <strong style={{ color: 'var(--t0)' }}>Sui wallet standard</strong>. Your keys never leave the wallet; the agent only gets a scoped Policy Object.</>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <MetaRow icon="mail" iconColor="var(--sui)" label="Provider">
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.provider}</span>
                </MetaRow>
                <MetaRow icon="wallet" label="Sui address">
                  <span className="mono" style={{ fontSize: 12, color: 'var(--sui)', fontWeight: 600 }}>{a.addr}</span>
                </MetaRow>
                <MetaRow icon="key" iconColor="var(--accent)" label="Ephemeral key">
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>{a.ephemeralKey}</span>
                </MetaRow>
                <MetaRow icon="clock" iconColor="var(--warn)" label="Session expires">
                  <div>
                    <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{a.sessionExpires}</span>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>epoch {a.currentEpoch} / {a.maxEpoch}</div>
                  </div>
                </MetaRow>
                <MetaRow icon="shield" label="Address salt" last>
                  <span className="mono" style={{ fontSize: 12, color: 'var(--t1)' }}>{a.salt}</span>
                </MetaRow>
                <div style={{ display: 'flex', gap: 9, marginTop: 12, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--glass)' }}>
                  <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}><Icon name="eye" size={14} /></span>
                  <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                    Your key is derived from your <strong style={{ color: 'var(--t0)' }}>Google</strong> login + salt via a zero-knowledge proof. No seed phrase, nothing custodial.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* agent authority */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="card-hd" style={{ padding: 0, marginBottom: 14 }}>
              <div className="card-title">Agent authority</div>
              <span style={{ color: 'var(--accent)' }}><Icon name="shield" size={16} /></span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {[
                { k: 'Active policies', v: activePol, c: 'var(--t0)' },
                { k: 'Authorized', v: '$' + fmtUsd(totalCap, 0), c: 'var(--t0)' },
                { k: 'Deployed', v: '$' + fmtUsd(usedCap, 0), c: 'var(--accent)' },
                { k: 'Free budget', v: '$' + fmtUsd(free, 0), c: 'var(--t0)' },
              ].map(x => (
                <div key={x.k} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                  <div className="eyebrow" style={{ fontSize: 9 }}>{x.k}</div>
                  <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: x.c }}>{x.v}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onNav && onNav('policies')}>
              <Icon name="settings" size={14} /> Manage policies
            </button>
          </div>

          {/* gas: live = real self-paid posture; demo = sponsored persona */}
          <div className="card" style={{ padding: '16px 18px' }}>
            <div className="card-hd" style={{ padding: 0, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--warn)' }}><Icon name="bolt" size={16} /></span>
                <div className="card-title">{live ? 'Gas & fees' : 'Gas station'}{live && advisory}</div>
              </div>
              <span className="badge badge-warn" style={{ fontSize: 9.5 }}>{readOnly ? 'read-only' : live ? 'self-paid' : 'sponsored'}</span>
            </div>
            {live ? (
              <>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>{suiBal != null ? suiBal.toFixed(3) : '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>{readOnly ? 'SUI at read owner · gas evidence' : 'SUI in wallet · your gas'}</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>{activePol}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>agent-run policies</div>
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 12, lineHeight: 1.45 }}>
                  {readOnly
                    ? 'No wallet is connected in this validation mode. Gas and balance panels are Worker-backed Testnet reads only; signing or deployment stays unavailable until a wallet connects.'
                    : 'You sign and pay gas from your own wallet. The autonomous agent pays its execution gas from a dedicated key, only within what your policies authorize — no custodial gas station.'}
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>{a.gas?.sponsored ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>txns sponsored</div>
                  </div>
                  <div style={{ width: 1, background: 'var(--border)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>{a.gas?.saved ?? '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>SUI gas saved</div>
                  </div>
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 12, lineHeight: 1.45 }}>
                  The agent pays fees from the {a.gas?.station || 'RescueGrid Gas Station'} — you hold no SUI for gas and never sign a fee.
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
