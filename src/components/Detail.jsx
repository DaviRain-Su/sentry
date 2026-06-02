/* ===========================================================
   RescueGrid — Policy Inspect slide-over + on-chain explorer
   Makes the Move Policy Object tangible: struct, capabilities,
   protocol allow-list, audit trail.
   =========================================================== */
import { useState, useEffect } from 'react'
import { RG } from '../data.js'
import { getTransaction } from '../api.js'
import { Icon } from './primitives.jsx'
import { Button } from '@heroui/react'

function CapRow({ granted, label, fn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
      <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: granted ? 'var(--safe-dim)' : 'var(--danger-dim)', color: granted ? 'var(--safe)' : 'var(--danger)' }}>
        <Icon name={granted ? 'check' : 'x'} size={13} stroke={2.6} />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: granted ? 'var(--t0)' : 'var(--t1)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--t2)', marginLeft: 8 }}>{fn}</span>
      </div>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: granted ? 'var(--safe)' : 'var(--danger)' }}>
        {granted ? 'GRANTED' : 'DENIED'}
      </span>
    </div>
  )
}

export function PolicyInspect({ p, activity, onClose, onRevoke, onTx, readOnly = false }) {
  const pct = Math.round((p.budgetUsed / p.budgetCap) * 100)
  const log = activity.filter(a => a.policy === p.name || a.policy === p.id)
  const expiryMs = new Date(p.expires).getTime()
  const statusMeta = {
    active: { cls: 'badge-safe', label: 'active', pulse: true },
    revoked: { cls: 'badge-danger', label: 'revoked', pulse: false },
    expired: { cls: 'badge-warn', label: 'expired', pulse: false },
    paused: { cls: 'badge-neutral', label: 'paused', pulse: false },
  }[p.status] || { cls: 'badge-neutral', label: p.status || 'unknown', pulse: false }

  const protocols = [
    { name: 'Deepbook v3', kind: 'CLOB · spot', on: p.scope.length > 0, note: 'order book — place / cancel limit orders' },
    { name: 'Cetus', kind: 'AMM · swap', on: false, note: 'roadmap' },
    { name: 'Suilend', kind: 'lending', on: false, note: 'roadmap' },
    { name: 'Navi', kind: 'lending', on: false, note: 'roadmap' },
  ]

  const structLines = [
    { t: 'public struct ', k: 'AgentPolicy', t2: ' has key {' },
    { indent: 1, key: 'id', val: 'UID' },
    { indent: 1, key: 'owner', val: `address  // ${p.owner ? p.owner.slice(0, 10) + '…' + p.owner.slice(-6) : RG.user.addr}` },
    { indent: 1, key: 'agent_cap', val: 'ID  // session key, revocable' },
    { indent: 1, key: 'budget_cap', val: `u64  // ${p.budgetCap}_000000 (${p.budgetCap} USDC)` },
    { indent: 1, key: 'budget_spent', val: `u64  // ${p.budgetUsed}_000000` },
    { indent: 1, key: 'allowed_pools', val: `vector<ID>  // [${p.scope.join(', ')}]` },
    { indent: 1, key: 'max_slippage_bps', val: `u16  // ${Math.round(p.maxSlippage * 100)}` },
    { indent: 1, key: 'price_oracle', val: 'ID  // Pyth SUI/USDC feed' },
    { indent: 1, key: 'gas_budget', val: 'u64  // sponsored · gas station' },
    { indent: 1, key: 'expiry_ms', val: `u64  // ${expiryMs}` },
    { t: '}' },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--overlay-backdrop)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .25s ease' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 540, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: 'var(--drawer-shadow)' }}>
        {/* header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Move Policy Object</div>
              <h2 className="display" style={{ fontSize: 19, fontWeight: 600 }}>{p.name}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--sui)' }}>{p.id}</span>
                <span className="badge badge-neutral" style={{ fontSize: 9.5 }}><Icon name={p.mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />{p.mode}</span>
                <span className={`badge ${statusMeta.cls}`} style={{ fontSize: 9.5 }}>
                  <span className={`dot ${statusMeta.pulse ? 'pulse' : ''}`}></span>{statusMeta.label}</span>
              </div>
            </div>
            <Button isIconOnly variant="light" size="sm" className="rg-btn-ghost" onPress={onClose} aria-label="Close"><Icon name="x" size={16} /></Button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* budget */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 7 }}>
              <span style={{ color: 'var(--t1)', fontWeight: 600 }}>On-chain budget ceiling</span>
              <span className="mono"><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.budgetUsed}</span><span style={{ color: 'var(--t2)' }}> / {p.budgetCap} USDC · {pct}%</span></span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 100, background: pct > 80 ? 'var(--danger)' : 'linear-gradient(90deg,var(--accent),#1fc7b1)', boxShadow: pct > 80 ? 'none' : '0 0 12px var(--accent-glow)' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 7 }}>The agent calls <span className="mono" style={{ color: 'var(--t1)' }}>assert_within_budget()</span> before every order. Exceeding the cap aborts the transaction on-chain — it is impossible to overspend.</div>
          </div>

          {/* move struct */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>On-chain object · move</div>
            <div style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px', fontFamily: 'var(--f-mono)', fontSize: 11.5, lineHeight: 1.7, overflowX: 'auto' }}>
              {structLines.map((l, i) => (
                <div key={i} style={{ paddingLeft: (l.indent || 0) * 18, whiteSpace: 'pre' }}>
                  {l.t && <span style={{ color: 'var(--sui)' }}>{l.t}</span>}
                  {l.k && <span style={{ color: 'var(--accent)' }}>{l.k}</span>}
                  {l.t2 && <span style={{ color: 'var(--t1)' }}>{l.t2}</span>}
                  {l.key && <><span style={{ color: 'var(--t0)' }}>{l.key}</span><span style={{ color: 'var(--t2)' }}>: </span><span style={{ color: 'var(--t2)' }}>{l.val}</span><span style={{ color: 'var(--t3)' }}>,</span></>}
                </div>
              ))}
            </div>
          </div>

          {/* capabilities */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Delegated capabilities</div>
            <div style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '4px 16px' }}>
              <CapRow granted label="Place limit order" fn="deepbook::place_limit_order" />
              <div className="divider" />
              <CapRow granted label="Cancel own order" fn="deepbook::cancel_order" />
              <div className="divider" />
              <CapRow granted={false} label="Withdraw funds" fn="coin::withdraw" />
              <div className="divider" />
              <CapRow granted={false} label="Transfer assets out" fn="transfer::public_transfer" />
              <div className="divider" />
              <CapRow granted={false} label="Modify this policy" fn="policy::set_budget" />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 8 }}>The agent literally has no capability to move funds out of your wallet. It can only trade within scope.</div>
          </div>

          {/* protocol allow-list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
              <span className="eyebrow">Protocol allow-list</span>
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>scope is extensible per-policy</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {protocols.map(pr => (
                <div key={pr.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 'var(--r-sm)',
                  background: pr.on ? 'var(--accent-dim)' : 'var(--glass)', border: `1px solid ${pr.on ? 'var(--accent)' : 'var(--border)'}`, opacity: pr.on ? 1 : 0.55 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: pr.on ? 'var(--accent)' : 'var(--t3)', flexShrink: 0, boxShadow: pr.on ? '0 0 8px var(--accent-glow)' : 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{pr.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{pr.kind}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: pr.on ? 'var(--accent)' : 'var(--t3)', letterSpacing: '0.05em' }}>{pr.on ? 'ENABLED' : 'SOON'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* gas & signing */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>Gas &amp; signing</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--sui)', flexShrink: 0 }}><Icon name="wallet" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Signs with a session key</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>The agent uses the delegated <span className="mono" style={{ color: 'var(--t1)' }}>AgentCap</span> — never your zkLogin key. Revoke it and signing power vanishes.</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--warn)', flexShrink: 0 }}><Icon name="bolt" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Gas is sponsored</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>Fees are paid by a gas station via sponsored transactions, so the agent needs no SUI of its own to act autonomously.</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}><Icon name="target" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>Triggers read a Pyth feed</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>Price conditions are asserted on-chain against the <span className="mono" style={{ color: 'var(--t1)' }}>Pyth</span> oracle — the agent can't fake a trigger.</div>
                </div>
              </div>
            </div>
          </div>

          {/* audit trail */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>Audit trail · {log.length} on-chain events</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderLeft: '2px solid var(--border)', paddingLeft: 16, marginLeft: 4 }}>
              {log.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>No executions yet — the agent is monitoring.</div>}
              {log.map((a, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: i < log.length - 1 ? 16 : 0 }}>
                  <div style={{ position: 'absolute', left: -23, top: 3, width: 10, height: 10, borderRadius: '50%',
                    background: a.kind === 'exec' ? 'var(--accent)' : a.kind === 'guardian' ? 'var(--danger)' : 'var(--sui)', border: '2px solid var(--bg-2)' }} />
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>{a.date} {a.t}{a.tx && <> · <span className="mono" onClick={() => onTx && onTx(a.tx)} style={{ color: 'var(--sui)', cursor: 'pointer' }}>{a.tx}</span></>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer revoke */}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-2)', borderTop: '1px solid var(--border)', padding: '16px 24px', display: 'flex', gap: 10 }}>
          <Button className="rg-btn-2 justify-center" style={{ flex: 1 }} onPress={onClose}>Close</Button>
          <Button className="bg-danger text-white" style={{ flex: 1 }} isDisabled={readOnly || p.status === 'revoked'} onPress={() => { onRevoke(p.id); onClose() }} startContent={<Icon name="x" size={15} stroke={2.4} />}>
            {readOnly ? 'Read-only mode' : p.status === 'revoked' ? 'Already revoked' : 'Revoke authority'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- on-chain explorer drawer ---------- */
function coinMeta(ct) {
  if (!ct) return ['?', 0]
  if (ct.endsWith('::sui::SUI')) return ['SUI', 9]
  if (ct.includes('::DBUSDC::DBUSDC')) return ['USDC', 6]
  if (ct.endsWith('::deep::DEEP')) return ['DEEP', 6]
  if (ct.endsWith('::wal::WAL')) return ['WAL', 9]
  return [ct.split('::').pop(), 0]
}

export function TxDrawer({ tx, onClose }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null); setErr(null)
    getTransaction(tx)
      .then((r) => { if (alive) (r.status === 'ok' ? setData(r.tx) : setErr(r.message || 'Transaction not found')) })
      .catch((e) => { if (alive) setErr(String(e?.message || e)) })
    return () => { alive = false }
  }, [tx])

  const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')
  const explorer = `https://suiscan.xyz/testnet/tx/${tx}`
  const row = (k, v, mono) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: 12.5, color: 'var(--t0)', textAlign: 'right', fontWeight: mono ? 600 : 500 }}>{v}</span>
    </div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--overlay-backdrop-strong)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .22s ease' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: 'var(--drawer-shadow)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Sui · transaction</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>{tx}</span>
                {data && <span className={`badge ${data.success ? 'badge-safe' : 'badge-warn'}`}><span className="dot"></span>{data.success ? 'Success' : 'Failed'}</span>}
                {!data && !err && <span className="badge badge-neutral"><span className="dot"></span>Loading…</span>}
                {err && <span className="badge badge-warn"><span className="dot"></span>Unavailable</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 5 }}>
                Testnet{data?.checkpoint ? ` · checkpoint ${data.checkpoint.toLocaleString()}` : ''}
              </div>
            </div>
            <Button isIconOnly variant="light" size="sm" className="rg-btn-ghost" onPress={onClose} aria-label="Close"><Icon name="x" size={16} /></Button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {!data && !err && <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>Decoding transaction from chain…</div>}
          {err && (
            <div style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Could not load this transaction</div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>{err}. It may be older than the fullnode's retention window, or a demo record. You can still open it on the explorer below.</div>
            </div>
          )}
          {data && (
            <>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Overview</div>
                <div>
                  {row('Executed by', <span className="mono" style={{ color: 'var(--sui)' }}>{short(data.sender)}</span>)}
                  {row('Gas used', `${data.gasSui.toFixed(6)} SUI`, true)}
                  {row('Gas paid by', data.gasOwner === data.sender ? 'signer (self)' : short(data.gasOwner))}
                  {row('Timestamp', data.timestampMs ? new Date(data.timestampMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—')}
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Programmable transaction block · {data.calls.length} call{data.calls.length === 1 ? '' : 's'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {data.calls.length === 0 && <div style={{ fontSize: 12, color: 'var(--t2)' }}>No Move calls in this transaction.</div>}
                  {data.calls.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>#{i + 1}</span>
                      <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--safe-dim)', color: 'var(--safe)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="check" size={10} stroke={2.8} /></span>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--t0)', wordBreak: 'break-all' }}>{c.target}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Events emitted · {data.events.length}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {data.events.length === 0 && <div style={{ fontSize: 12, color: 'var(--t2)' }}>No events emitted.</div>}
                  {data.events.map((e, i) => (
                    <div key={i} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{e.type}</span>
                      {e.data && <div className="mono" style={{ fontSize: 11, color: 'var(--t1)', marginTop: 4, wordBreak: 'break-all' }}>{e.data}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {data.balanceChanges.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Balance changes</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {data.balanceChanges.map((b, i) => {
                      const [sym, dec] = coinMeta(b.coinType)
                      const amt = Number(b.amount) / 10 ** dec
                      const up = amt >= 0
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>{short(b.owner)}</span>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: up ? 'var(--safe)' : 'var(--danger)' }}>{up ? '+' : ''}{amt.toLocaleString(undefined, { maximumFractionDigits: dec })} {sym}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <Button className="rg-btn-2 justify-center" onPress={() => window.open(explorer, '_blank', 'noopener,noreferrer')} startContent={<Icon name="link" size={14} />}>
            View on SuiScan
          </Button>
        </div>
      </div>
    </div>
  )
}
