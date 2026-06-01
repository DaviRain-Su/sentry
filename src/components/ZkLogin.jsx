/* ===========================================================
   RescueGrid — zkLogin entry screen
   =========================================================== */
import { useState } from 'react'
import { Icon, Logo } from './primitives.jsx'

export function ZkLogin({ onAuth, onBackToLanding }) {
  const [loading, setLoading] = useState(null)
  const go = (provider) => {
    setLoading(provider)
    setTimeout(() => onAuth(), 1500)
  }
  const providers = [
    { id: 'google', label: 'Continue with Google', glyph: 'G', bg: '#fff', fg: '#1a1a1a' },
    { id: 'twitch', label: 'Continue with Twitch', glyph: 'T', bg: '#9146FF', fg: '#fff' },
    { id: 'apple', label: 'Continue with Apple', glyph: '', fg: '#fff', bg: '#000' },
  ]
  return (
    <div style={{ position: 'relative', zIndex: 1, height: '100vh', display: 'grid', gridTemplateColumns: '1.1fr 0.9fr' }}>
      {/* left — brand / value */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '56px 60px',
        borderRight: '1px solid var(--border)', background: 'rgba(8,11,17,0.4)' }}>
        <a onClick={(e) => { e.preventDefault(); onBackToLanding && onBackToLanding() }} href="#"
          style={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', alignSelf: 'flex-start' }}><Logo size={34} /></a>
        <div style={{ maxWidth: 520 }}>
          <div className="badge badge-accent" style={{ marginBottom: 22 }}><span className="dot pulse"></span>Sui Overflow 2026 · Agentic Web</div>
          <h1 className="display" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em' }}>
            The AI agent that <span style={{ color: 'var(--accent)' }}>trades for you</span> — and can't go rogue.
          </h1>
          <p style={{ fontSize: 16, color: 'var(--t1)', marginTop: 20, lineHeight: 1.6, maxWidth: 460 }}>
            Authorize once with a Move Policy Object. RescueGrid then monitors, decides and executes real trades on Deepbook — strictly inside the budget and scope you set on-chain.
          </p>
          <div style={{ display: 'flex', gap: 26, marginTop: 36 }}>
            {[
              { k: 'Self-enforced', v: 'budget ceiling' },
              { k: 'On-chain', v: 'activity log' },
              { k: 'Revocable', v: 'any time' },
            ].map(x => (
              <div key={x.k}>
                <div className="display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>{x.k}</div>
                <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--f-mono)' }}>zkLogin · Move Policy Object · PTB · Deepbook v3</div>
      </div>

      {/* right — auth */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 56px' }}>
        <div style={{ maxWidth: 360, margin: '0 auto', width: '100%' }}>
          <h2 className="display" style={{ fontSize: 24, fontWeight: 600 }}>Sign in</h2>
          <p style={{ fontSize: 13.5, color: 'var(--t1)', marginTop: 8, marginBottom: 28 }}>
            No seed phrase. No browser extension. zkLogin derives your Sui address from your existing account with a zero-knowledge proof.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {providers.map(p => (
              <button key={p.id} onClick={() => go(p.id)} disabled={loading}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 'var(--r-md)',
                  border: '1px solid var(--border-hi)', background: 'var(--glass-2)', color: 'var(--t0)', cursor: loading ? 'wait' : 'pointer',
                  fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, transition: 'all .14s', opacity: loading && loading !== p.id ? 0.4 : 1 }}>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: p.bg, color: p.fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontFamily: 'var(--f-display)', fontSize: 14, flexShrink: 0 }}>
                  {p.id === 'apple' ? '' : p.glyph}
                </span>
                {loading === p.id ? <><Icon name="refresh" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Generating zk proof…</> : p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="eyebrow">how it works</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { n: '1', t: 'Prove, don’t expose', s: 'A ZK proof links your login to a Sui address — your provider never sees the chain, the chain never sees your provider.' },
              { n: '2', t: 'You hold the keys to revoke', s: 'The agent only ever gets a scoped Policy Object, never your account.' },
            ].map(s => (
              <div key={s.n} style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--sui-dim)', color: 'var(--sui)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-mono)', fontSize: 12, fontWeight: 700 }}>{s.n}</div>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.t}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.5 }}>{s.s}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
