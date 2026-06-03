/* ===========================================================
   Sentry — sign-in screen
   Sui wallet login (Slush / any standard wallet, no credentials).
   A separate "Explore the demo" entry runs the app on mock data.
   =========================================================== */
import { useState, useEffect } from 'react';
import { useWallets, useConnectWallet, useCurrentAccount } from '@mysten/dapp-kit';
import { isEnokiWallet } from '@mysten/enoki';
import { Icon, Logo } from './Primitives.jsx';
import { Button } from '@heroui/react';

export function ZkLogin({ onAuth, onBackToLanding, workerConfigured = false }) {
  const [loading, setLoading] = useState(null);
  const wallets = useWallets();
  const { mutate: connect } = useConnectWallet();
  const account = useCurrentAccount();

  // Once a Sui account is connected, we're authed (real on-chain identity).
  useEffect(() => {
    if (account) onAuth('wallet', account.address);
  }, [account, onAuth]);

  // standard Sui wallets (Slush, Sui Wallet, …) — no credentials needed
  const standardWallets = wallets.filter((w) => !isEnokiWallet(w));

  const connectWallet = (w) => {
    setLoading(w.name);
    connect({ wallet: w }, { onError: () => setLoading(null) });
  };

  return (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        height: '100vh',
        display: 'grid',
        gridTemplateColumns: '1.1fr 0.9fr',
      }}
    >
      {/* left — brand / value */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '56px 60px',
          borderRight: '1px solid var(--border)',
          background: 'var(--chrome-auth)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <a
          onClick={(e) => {
            e.preventDefault();
            onBackToLanding && onBackToLanding();
          }}
          href="#"
          style={{
            textDecoration: 'none',
            color: 'inherit',
            cursor: 'pointer',
            alignSelf: 'flex-start',
          }}
        >
          <Logo size={34} />
        </a>
        <div style={{ maxWidth: 520 }}>
          <div className="badge badge-accent" style={{ marginBottom: 22 }}>
            <span className="dot pulse"></span>Local Agent · Hyperliquid + OKX
          </div>
          <h1
            className="display"
            style={{ fontSize: 46, fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.02em' }}
          >
            The AI agent that <span style={{ color: 'var(--accent)' }}>trades for you</span> — and
            can't go rogue.
          </h1>
          <p
            style={{
              fontSize: 16,
              color: 'var(--t1)',
              marginTop: 20,
              lineHeight: 1.6,
              maxWidth: 460,
            }}
          >
            Pair a local daemon, keep venue keys in your OS keychain, and let Sentry dispatch
            bounded actions to Hyperliquid, OKX, Solana and Ethereum. Sui Testnet remains the
            verified demo path.
          </p>
          <div style={{ display: 'flex', gap: 26, marginTop: 36 }}>
            {[
              { k: 'Local', v: 'secret store' },
              { k: 'Venue', v: 'trade-only guard' },
              { k: 'Revocable', v: 'sessions + keys' },
            ].map((x) => (
              <div key={x.k}>
                <div
                  className="display"
                  style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}
                >
                  {x.k}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--t3)', fontFamily: 'var(--f-mono)' }}>
          Local daemon · OWS vault · Hyperliquid · OKX · Worker bridge
        </div>
      </div>

      {/* right — auth */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 56px',
        }}
      >
        <div style={{ maxWidth: 360, margin: '0 auto', width: '100%' }}>
          <h2 className="display" style={{ fontSize: 24, fontWeight: 600 }}>
            Sign in
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--t1)', marginTop: 8, marginBottom: 22 }}>
            Open the local-agent dashboard in demo mode, or connect a Sui wallet for the legacy
            Testnet signer flow. Production venue keys stay local and are never sent to Worker.
          </p>

          {/* Sui wallet — the real, credential-free sign-in */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {standardWallets.length > 0 ? (
              standardWallets.map((w) => (
                <Button
                  key={w.name}
                  onPress={() => connectWallet(w)}
                  isDisabled={!!loading}
                  fullWidth
                  className="gap-3 bg-accent text-accent-foreground font-semibold"
                >
                  {w.icon && (
                    <img src={w.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />
                  )}
                  {loading === w.name ? (
                    <>
                      <Icon
                        name="refresh"
                        size={15}
                        style={{ animation: 'spin 1s linear infinite' }}
                      />{' '}
                      Connecting…
                    </>
                  ) : (
                    `Connect ${w.name}`
                  )}
                </Button>
              ))
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  padding: '13px 16px',
                  borderRadius: 'var(--r-md)',
                  border: '1px dashed var(--border-hi)',
                  color: 'var(--t2)',
                  fontSize: 13,
                  lineHeight: 1.45,
                }}
              >
                <span style={{ flexShrink: 0 }}>
                  <Icon name="wallet" size={18} />
                </span>
                <span>
                  No Sui wallet detected. Install{' '}
                  <a
                    href="https://slush.app"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >
                    Slush
                  </a>
                  , switch it to <strong style={{ color: 'var(--t1)' }}>Testnet</strong>, then
                  reload.
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="eyebrow">or</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <Button
            onPress={() => onAuth('demo')}
            className="rg-btn-2 justify-center"
            fullWidth
            startContent={<Icon name="eye" size={15} />}
          >
            Explore the demo (no wallet)
          </Button>

          {workerConfigured && (
            <Button
              onPress={() => onAuth('readonly')}
              className="rg-btn-2 justify-center"
              fullWidth
              startContent={<Icon name="link" size={15} />}
              style={{ marginTop: 10 }}
            >
              Open Worker read-only
            </Button>
          )}

          <div
            style={{
              marginTop: 14,
              fontSize: 11,
              color: standardWallets.length > 0 ? 'var(--safe)' : 'var(--t2)',
              fontFamily: 'var(--f-mono)',
            }}
          >
            {standardWallets.length > 0
              ? '● Sui wallet ready · testnet — real on-chain sign-in'
              : workerConfigured
                ? '○ no wallet — choose demo mock data or Worker read-only'
                : '○ no wallet — demo runs on mock data'}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '24px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span className="eyebrow">how it works</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              {
                n: '1',
                t: 'Run the local daemon',
                s: 'The CLI pairs to Worker over an outbound WebSocket and controls local external agents.',
              },
              {
                n: '2',
                t: 'Keep keys local',
                s: 'OWS wallets and OKX/Hyperliquid trade-only keys stay in local storage or OS keychain.',
              },
            ].map((s) => (
              <div key={s.n} style={{ display: 'flex', gap: 12 }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    background: 'var(--sui-dim)',
                    color: 'var(--sui)',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {s.n}
                </div>
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
  );
}
