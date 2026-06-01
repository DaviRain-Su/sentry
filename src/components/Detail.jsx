/* ===========================================================
   RescueGrid — Policy Inspect slide-over + on-chain explorer
   Makes the Move Policy Object tangible: struct, capabilities,
   protocol allow-list, audit trail.
   =========================================================== */
import { RG } from '../data.js'
import { Icon } from './primitives.jsx'

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

export function PolicyInspect({ p, activity, onClose, onRevoke, onTx }) {
  const pct = Math.round((p.budgetUsed / p.budgetCap) * 100)
  const log = activity.filter(a => a.policy === p.name)
  const expiryMs = new Date(p.expires).getTime()

  const protocols = [
    { name: 'Deepbook v3', kind: 'CLOB · spot', on: p.scope.length > 0, note: 'order book — place / cancel limit orders' },
    { name: 'Cetus', kind: 'AMM · swap', on: false, note: 'roadmap' },
    { name: 'Suilend', kind: 'lending', on: false, note: 'roadmap' },
    { name: 'Navi', kind: 'lending', on: false, note: 'roadmap' },
  ]

  const structLines = [
    { t: 'public struct ', k: 'AgentPolicy', t2: ' has key {' },
    { indent: 1, key: 'id', val: 'UID' },
    { indent: 1, key: 'owner', val: `address  // ${RG.user.addr}` },
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(3,5,8,0.66)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .25s ease' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 540, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: '-30px 0 80px -20px rgba(0,0,0,0.6)' }}>
        {/* header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Move Policy Object</div>
              <h2 className="display" style={{ fontSize: 19, fontWeight: 600 }}>{p.name}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--sui)' }}>{p.id}</span>
                <span className="badge badge-neutral" style={{ fontSize: 9.5 }}><Icon name={p.mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />{p.mode}</span>
                <span className={`badge ${p.status === 'active' ? 'badge-safe' : 'badge-warn'}`} style={{ fontSize: 9.5 }}>
                  <span className={`dot ${p.status === 'active' ? 'pulse' : ''}`}></span>{p.status}</span>
              </div>
            </div>
            <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ padding: 8 }}><Icon name="x" size={16} /></button>
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
          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Close</button>
          <button className="btn btn-danger" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { onRevoke(p.id); onClose() }}>
            <Icon name="x" size={15} stroke={2.4} /> Revoke authority
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- on-chain explorer drawer ---------- */
export function TxDrawer({ tx, onClose }) {
  // synthesize a believable Sui explorer record from the digest
  const calls = [
    { fn: 'rescuegrid::policy::assert_within_budget', ok: true },
    { fn: 'deepbook::pool::place_limit_order', ok: true },
    { fn: 'rescuegrid::policy::record_spend', ok: true },
    { fn: 'rescuegrid::policy::log_activity', ok: true },
  ]
  const events = [
    { type: 'PriceChecked', data: 'oracle: Pyth · SUI/USDC · −8.4% vs 1h ref' },
    { type: 'BudgetSpent', data: 'amount: 92_000000 · remaining: 316_000000' },
    { type: 'OrderPlaced', data: 'pool: SUI/USDC · qty: 23.9 · price: 3.85' },
    { type: 'AgentActivity', data: 'agent: 0x7a3f…c91e · action: "rescue"' },
  ]
  const row = (k, v, mono) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: 12.5, color: 'var(--t0)', textAlign: 'right', fontWeight: mono ? 600 : 500 }}>{v}</span>
    </div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(3,5,8,0.7)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .22s ease' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: '-30px 0 80px -20px rgba(0,0,0,0.6)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Sui · transaction</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{tx}</span>
                <span className="badge badge-safe"><span className="dot"></span>Success</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 5 }}>Testnet · checkpoint 84,209,113</div>
            </div>
            <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ padding: 8 }}><Icon name="x" size={16} /></button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Overview</div>
            <div>
              {row('Executed by', <>agent · delegated <span className="mono" style={{ color: 'var(--sui)' }}>{RG.user.addr}</span></>)}
              {row('Authority', 'AgentPolicy 0x9c2a…41bf', true)}
              {row('Signed with', 'session key · AgentCap', false)}
              {row('Gas used', '0.00091 SUI', true)}
              {row('Gas paid by', 'gas station (sponsored)', false)}
              {row('Timestamp', '2026-06-01 14:31:05 UTC', false)}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Programmable transaction block · {calls.length} calls</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {calls.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                  <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>#{i + 1}</span>
                  <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--safe-dim)', color: 'var(--safe)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name="check" size={10} stroke={2.8} /></span>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--t0)', wordBreak: 'break-all' }}>{c.fn}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Events emitted</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {events.map((e, i) => (
                <div key={i} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{e.type}</span>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--t1)', marginTop: 4 }}>{e.data}</div>
                </div>
              ))}
            </div>
          </div>

          <button className="btn" style={{ justifyContent: 'center' }} onClick={e => e.preventDefault()}>
            <Icon name="link" size={14} /> View on SuiScan
          </button>
        </div>
      </div>
    </div>
  )
}
