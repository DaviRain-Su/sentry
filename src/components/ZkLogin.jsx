/* ===========================================================
   RescueGrid — zkLogin entry screen
   Real Enoki zkLogin when configured (VITE_ENOKI_API_KEY +
   VITE_GOOGLE_CLIENT_ID); otherwise a self-contained demo sign-in.
   =========================================================== */
import { useState, useEffect } from 'react'
import { useWallets, useConnectWallet, useCurrentAccount } from '@mysten/dapp-kit'
import { isEnokiWallet } from '@mysten/enoki'
import { Icon, Logo } from './primitives.jsx'
import { ENOKI_CONFIGURED } from '../api.js'

export function ZkLogin({ onAuth, onBackToLanding }) {
  const [loading, setLoading] = useState(null)
  const wallets = useWallets()
  const { mutate: connect } = useConnectWallet()
  const account = useCurrentAccount()

  // Any connected Sui account (standard wallet or Enoki zkLogin) = authed.
  useEffect(() => {
    if (account) onAuth(account.address)
  }, [account, onAuth])

  const enokiByProvider = {}
  if (ENOKI_CONFIGURED) {
    for (const w of wallets) if (isEnokiWallet(w)) enokiByProvider[w.provider] = w
  }
  // standard Sui wallets (Slush, Sui Wallet, …) — no credentials needed
  const standardWallets = wallets.filter(w => !isEnokiWallet(w))

  const connectWallet = (w) => {
    setLoading(w.name)
    connect({ wallet: w }, { onError: () => setLoading(null) })
  }

  const go = (providerId) => {
    setLoading(providerId)
    if (ENOKI_CONFIGURED && enokiByProvider[providerId]) {
      // triggers the OAuth redirect; on return autoConnect sets the account
      connect({ wallet: enokiByProvider[providerId] }, { onError: () => setLoading(null) })
    } else {
      // demo mode — no real proof
      setTimeout(() => onAuth(), 1500)
    }
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
          <p style={{ fontSize: 13.5, color: 'var(--t1)', marginTop: 8, marginBottom: 22 }}>
            Connect a Sui wallet to authorize on-chain, or use zkLogin. The agent only ever gets a scoped Policy Object — never your account.
          </p>

          {/* primary: Sui wallet — no credentials needed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 18 }}>
            {standardWallets.length > 0 ? standardWallets.map(w => (
              <button key={w.name} onClick={() => connectWallet(w)} disabled={!!loading}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 'var(--r-md)',
                  border: 'none', background: 'linear-gradient(180deg, var(--accent), #1fc7b1)', color: '#032420', cursor: loading ? 'wait' : 'pointer',
                  fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 700, transition: 'all .14s', boxShadow: '0 8px 24px -8px var(--accent-glow)',
                  opacity: loading && loading !== w.name ? 0.4 : 1 }}>
                {w.icon && <img src={w.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />}
                {loading === w.name ? <><Icon name="refresh" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Connecting…</> : `Connect ${w.name}`}
              </button>
            )) : (
              <div style={{ display: 'flex', gap: 10, padding: '13px 16px', borderRadius: 'var(--r-md)', border: '1px dashed var(--border-hi)', color: 'var(--t2)', fontSize: 13 }}>
                <Icon name="wallet" size={18} />
                <span>No Sui wallet detected. Install <a href="https://slush.app" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Slush</a> (testnet) and reload.</span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 16px' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="eyebrow">or zkLogin</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {providers.map(p => {
              const live = ENOKI_CONFIGURED && !!enokiByProvider[p.id]
              const disabledLive = ENOKI_CONFIGURED && !enokiByProvider[p.id]
              return (
                <button key={p.id} onClick={() => go(p.id)} disabled={loading || disabledLive}
                  title={disabledLive ? 'Provider not enabled in Enoki project' : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 'var(--r-md)',
                    border: '1px solid var(--border-hi)', background: 'var(--glass-2)', color: 'var(--t0)', cursor: loading ? 'wait' : disabledLive ? 'not-allowed' : 'pointer',
                    fontFamily: 'var(--f-body)', fontSize: 14, fontWeight: 600, transition: 'all .14s', opacity: (loading && loading !== p.id) || disabledLive ? 0.4 : 1 }}>
                  <span style={{ width: 26, height: 26, borderRadius: 7, background: p.bg, color: p.fg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontFamily: 'var(--f-display)', fontSize: 14, flexShrink: 0 }}>
                    {p.id === 'apple' ? '' : p.glyph}
                  </span>
                  {loading === p.id ? <><Icon name="refresh" size={15} style={{ animation: 'spin 1s linear infinite' }} /> {live ? 'Redirecting to provider…' : 'Generating zk proof…'}</> : p.label}
                </button>
              )
            })}
          </div>

          <div style={{ marginTop: 14, fontSize: 11, color: (standardWallets.length > 0 || ENOKI_CONFIGURED) ? 'var(--safe)' : 'var(--t2)', fontFamily: 'var(--f-mono)' }}>
            {standardWallets.length > 0
              ? '● Sui wallet ready · testnet — real on-chain sign-in'
              : ENOKI_CONFIGURED
                ? '● live zkLogin (Enoki · testnet)'
                : '○ demo mode — connect a Sui wallet or set Enoki creds for live'}
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
