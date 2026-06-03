/* ===========================================================
   Sentry — landing / pitch page
   =========================================================== */
import { useEffect, useRef } from 'react';

function Check({ size = 12, sw = 2.6 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}
function Cross({ size = 12 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const FEATURES = [
  {
    p: <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9z" />,
    t: 'Natural-language intent',
    s: 'Describe a venue strategy in a sentence; get a readable action plan before any agent acts.',
  },
  {
    p: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    t: 'Guardian risk engine',
    s: 'Catches slippage, leverage, funding flips, stale markets and budget breaches before dispatch.',
  },
  {
    p: <path d="M13 2L4 14h6l-1 8 9-12h-6z" />,
    t: 'Hyperliquid + OKX target',
    s: 'Uses agent wallets, trade-only keys, subaccounts and venue-side controls, never withdrawal keys.',
  },
  {
    p: <path d="M3 12h4l2 6 4-14 2 8h6" />,
    t: 'Activity evidence',
    s: 'Records local command, venue order id, Guardian result and Worker bridge status for audit.',
  },
  {
    p: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
      </>
    ),
    t: 'Local-first daemon',
    s: 'Run the control process on your machine; Worker relays sessions and dashboard commands.',
  },
  {
    p: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    t: 'Revoke any time',
    s: 'Stop the daemon, rotate the venue key, revoke the OWS policy or close the Worker session.',
  },
];

const STEPS = [
  {
    n: '01',
    t: 'Describe in plain language',
    s: '"Long Hyperliquid and short OKX BTC-PERP when funding spread clears 8% APR."',
  },
  {
    n: '02',
    t: 'Guardian checks the risk',
    s: 'Budget, venue scope, liquidation buffer, funding flip and withdrawal safety are checked.',
  },
  {
    n: '03',
    t: 'Pair local authorization',
    s: 'The daemon reads OWS policy refs and OS-keychain venue handles; raw secrets never go to Worker.',
  },
  {
    n: '04',
    t: 'It monitors and dispatches',
    s: 'The daemon starts external agents, sends typed tasks and records venue evidence after execution.',
  },
];

export function Landing({ onLaunch }) {
  const rootRef = useRef(null);
  // landing needs scrollable body; the dashboard uses fixed/overflow-hidden.
  useEffect(() => {
    document.documentElement.classList.add('lp-mode');
    document.body.classList.add('lp-mode');
    return () => {
      document.documentElement.classList.remove('lp-mode');
      document.body.classList.remove('lp-mode');
    };
  }, []);
  useEffect(() => {
    const els = rootRef.current ? rootRef.current.querySelectorAll('.reveal') : [];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el, i) => {
      el.style.transitionDelay = (i % 4) * 0.06 + 's';
      io.observe(el);
    });
    // hero reveals immediately
    if (rootRef.current)
      rootRef.current.querySelectorAll('.hero .reveal').forEach((el) => el.classList.add('in'));
    return () => io.disconnect();
  }, []);

  const launch = (e) => {
    e.preventDefault();
    onLaunch && onLaunch();
  };
  const logoSvg = (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="8"
        fill="#06231f"
        stroke="#2EE6CE"
        strokeOpacity="0.5"
      />
      <path
        d="M9 19 l4-5 3 3 4-6"
        stroke="#2EE6CE"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="23" cy="11" r="2.2" fill="#2EE6CE" />
      <path
        d="M9 23h14"
        stroke="#2EE6CE"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );

  return (
    <div ref={rootRef}>
      <div className="lp-bg"></div>
      <div className="lp">
        {/* NAV */}
        <nav className="lp-nav">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {logoSvg}
            <span className="display" style={{ fontWeight: 700, fontSize: 16 }}>
              Sentry
            </span>
          </div>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#why">Why local</a>
            <a href="#features">Features</a>
            <a href="#tracks">Tracks</a>
          </div>
          <a href="#" onClick={launch} className="btn btn-primary">
            Launch app →
          </a>
        </nav>

        {/* HERO */}
        <header className="hero wrap">
          <div className="hero-grid">
            <div>
              <div className="badge badge-accent reveal" style={{ marginBottom: 22 }}>
                <span className="dot pulse"></span>Local Agent · Hyperliquid + OKX
              </div>
              <h1 className="h1 reveal">
                Autonomous trading control,
                <br />
                with <span style={{ color: 'var(--accent)' }}>keys that stay local</span>.
              </h1>
              <p className="lead reveal">
                Sentry pairs a local daemon with external coding agents, OWS wallets and trade-only
                venue keys. It monitors Hyperliquid, OKX, Solana and Ethereum, then executes only
                after Guardian passes budget, venue and withdrawal-safety checks.
              </p>
              <div className="cta-row reveal">
                <a href="#" onClick={launch} className="btn btn-primary btn-lg">
                  Launch Sentry
                </a>
                <a href="#how" className="btn btn-lg">
                  See how it works
                </a>
              </div>
              <div className="kpi-strip reveal">
                <div>
                  <div className="k mono">1</div>
                  <div className="l">local daemon to pair</div>
                </div>
                <div>
                  <div className="k mono">0</div>
                  <div className="l">raw secrets in cloud</div>
                </div>
                <div>
                  <div className="k mono">100%</div>
                  <div className="l">venue evidence logged</div>
                </div>
              </div>
            </div>

            {/* hero visual: the bounded action loop */}
            <div className="reveal">
              <div className="lp-card" style={{ padding: 22 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: 'var(--danger)',
                        boxShadow: '0 0 8px var(--danger)',
                      }}
                    ></span>
                    <span className="display" style={{ fontWeight: 600, fontSize: 14 }}>
                      SUI / USDC · flash crash
                    </span>
                  </div>
                  <span className="badge badge-accent">
                    <span className="dot pulse"></span>agent active
                  </span>
                </div>
                <svg width="100%" viewBox="0 0 440 230" style={{ display: 'block' }}>
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF5470" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#FF5470" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <g stroke="#2EE6CE" strokeDasharray="4 5" strokeWidth="1" opacity="0.55">
                    <line x1="0" y1="150" x2="440" y2="150" />
                    <line x1="0" y1="178" x2="440" y2="178" />
                  </g>
                  <text
                    x="436"
                    y="146"
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#2EE6CE"
                    textAnchor="end"
                  >
                    rung 1 · buy
                  </text>
                  <text
                    x="436"
                    y="174"
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#2EE6CE"
                    textAnchor="end"
                  >
                    rung 2 · buy
                  </text>
                  <path
                    d="M0 60 L60 72 L120 70 L180 92 L240 118 L300 170 L340 196 L360 188"
                    fill="none"
                    stroke="#FF5470"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M0 60 L60 72 L120 70 L180 92 L240 118 L300 170 L340 196 L360 188 L360 230 L0 230 Z"
                    fill="url(#cg)"
                  />
                  <path
                    d="M360 188 L400 176 L440 168"
                    fill="none"
                    stroke="#2EE6CE"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="3 4"
                  />
                  <circle cx="320" cy="150" r="5" fill="#2EE6CE">
                    <animate attributeName="r" values="5;8;5" dur="2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx="345" cy="178" r="5" fill="#2EE6CE">
                    <animate
                      attributeName="r"
                      values="5;8;5"
                      dur="2s"
                      begin="0.4s"
                      repeatCount="indefinite"
                    />
                  </circle>
                </svg>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                  <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                    <span style={{ color: 'var(--accent)' }}>↳</span> bought 23.9 SUI @ 3.85
                  </span>
                  <span className="badge badge-neutral" style={{ fontSize: 10.5 }}>
                    <span style={{ color: 'var(--accent)' }}>↳</span> bought 24.6 SUI @ 3.74
                  </span>
                  <span className="badge badge-safe" style={{ fontSize: 10.5 }}>
                    <span className="dot"></span>184 / 500 USDC · budget intact
                  </span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* PROBLEM */}
        <section className="blk wrap">
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div className="eyebrow reveal">The gap</div>
            <h2 className="sec-title reveal">
              AI agents promise autonomy.
              <br />
              Then ask you to sign every time.
            </h2>
          </div>
          <div className="feat-grid reveal" style={{ marginTop: 46 }}>
            <div className="lp-card">
              <div
                className="feat-ico"
                style={{ background: 'var(--danger-dim)', color: 'var(--danger)' }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M12 3l9 16H3z" />
                  <path d="M12 10v4M12 17.5v.01" />
                </svg>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600 }}>
                Stuck at the signature
              </h3>
              <p style={{ color: 'var(--t1)', fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>
                Most "agents" can't actually act — every trade needs a human signature, so they miss
                the moment that matters.
              </p>
            </div>
            <div className="lp-card">
              <div
                className="feat-ico"
                style={{ background: 'var(--warn-dim)', color: 'var(--warn)' }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M3 12h4l2 6 4-14 2 8h6" />
                </svg>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600 }}>
                Static risk, live markets
              </h3>
              <p style={{ color: 'var(--t1)', fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>
                Fixed stop-losses and grids don't adapt to flash crashes, depegs, or thinning
                liquidity. You react too late.
              </p>
            </div>
            <div className="lp-card">
              <div
                className="feat-ico"
                style={{ background: 'var(--sui-dim)', color: 'var(--sui)' }}
              >
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
                </svg>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600 }}>
                Autonomy feels unsafe
              </h3>
              <p style={{ color: 'var(--t1)', fontSize: 13.5, marginTop: 8, lineHeight: 1.55 }}>
                Handing an AI your keys is terrifying — and rightly so. There's been no way to grant{' '}
                <em>limited</em>, revocable power.
              </p>
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="blk wrap" id="how">
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div className="eyebrow reveal">How it works</div>
            <h2 className="sec-title reveal">Pair locally. Then bound the blast radius.</h2>
            <p className="sec-sub reveal">
              The daemon keeps keys local while Worker relays dashboard commands and status.
            </p>
          </div>
          <div className="step-grid reveal" style={{ marginTop: 46 }}>
            {STEPS.map((s) => (
              <div className="lp-card" key={s.n}>
                <div className="step-n">{s.n}</div>
                <h3 className="display" style={{ fontSize: 16, fontWeight: 600, marginTop: 10 }}>
                  {s.t}
                </h3>
                <p style={{ color: 'var(--t1)', fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>
                  {s.s}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* WHY LOCAL */}
        <section className="blk wrap" id="why">
          <div
            className="lp-card reveal"
            style={{
              padding: 0,
              overflow: 'hidden',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
            }}
          >
            <div style={{ padding: 46 }}>
              <div className="badge badge-sui" style={{ marginBottom: 18 }}>
                Why local
              </div>
              <h2 className="sec-title" style={{ fontSize: 32 }}>
                The local daemon
                <br />
                is the trust boundary.
              </h2>
              <p style={{ color: 'var(--t1)', fontSize: 15, marginTop: 16, lineHeight: 1.6 }}>
                Production Sentry should not send wallet secrets or exchange API keys to cloud
                infrastructure. The daemon runs on the user's machine, stores only local key
                handles, and lets Worker relay typed commands and status.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 24 }}>
                {[
                  [
                    <strong key="s" style={{ color: 'var(--t0)' }}>
                      Self-enforced budget
                    </strong>,
                    ' — Guardian checks budget before every venue task.',
                  ],
                  [
                    <strong key="s" style={{ color: 'var(--t0)' }}>
                      Trade-only venues
                    </strong>,
                    ' — OKX and Hyperliquid keys never include withdrawal scope.',
                  ],
                  [
                    <strong key="s" style={{ color: 'var(--t0)' }}>
                      Revocable locally
                    </strong>,
                    ' — stop the daemon, rotate keys, revoke OWS policies or close Worker sessions.',
                  ],
                ].map((row, i) => (
                  <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--accent)', marginTop: 1 }}>
                      <Check size={18} sw={2.2} />
                    </span>
                    <span style={{ fontSize: 13.5, color: 'var(--t1)' }}>
                      {row[0]}
                      {row[1]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* capability card */}
            <div
              style={{
                padding: 46,
                background: 'var(--bg-0)',
                borderLeft: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <div className="eyebrow" style={{ marginBottom: 14 }}>
                AgentPolicy · granted vs denied
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {[
                  { fn: 'place_limit_order', ok: true },
                  { fn: 'cancel_order', ok: true },
                ].map((c) => (
                  <div key={c.fn} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: 'var(--safe-dim)',
                        color: 'var(--safe)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Check />
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--t0)' }}>
                      {c.fn}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 9.5,
                        color: 'var(--safe)',
                        marginLeft: 'auto',
                        fontWeight: 700,
                      }}
                    >
                      GRANTED
                    </span>
                  </div>
                ))}
                <div className="divider" style={{ margin: '4px 0' }}></div>
                {['coin::withdraw', 'public_transfer', 'policy::set_budget'].map((fn) => (
                  <div
                    key={fn}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.85 }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        background: 'var(--danger-dim)',
                        color: 'var(--danger)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Cross />
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--t1)' }}>
                      {fn}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 9.5,
                        color: 'var(--danger)',
                        marginLeft: 'auto',
                        fontWeight: 700,
                      }}
                    >
                      DENIED
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 16, lineHeight: 1.5 }}>
                The agent literally cannot move funds out of your wallet. It can only trade, within
                scope.
              </p>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="blk wrap" id="features">
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div className="eyebrow reveal">Capabilities</div>
            <h2 className="sec-title reveal">Built natively on Sui's stack.</h2>
          </div>
          <div className="feat-grid reveal" style={{ marginTop: 46 }}>
            {FEATURES.map((f) => (
              <div className="lp-card" key={f.t}>
                <div className="feat-ico">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {f.p}
                  </svg>
                </div>
                <h3 className="display" style={{ fontSize: 16, fontWeight: 600 }}>
                  {f.t}
                </h3>
                <p style={{ color: 'var(--t1)', fontSize: 13, marginTop: 7, lineHeight: 1.55 }}>
                  {f.s}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* TRACKS */}
        <section className="blk wrap" id="tracks">
          <div
            style={{
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 14,
            }}
          >
            <div className="eyebrow reveal">Production target · local first</div>
            <h2 className="sec-title reveal">Built around three control surfaces.</h2>
          </div>
          <div className="track-grid reveal" style={{ marginTop: 46 }}>
            <div className="lp-card" style={{ borderColor: 'var(--accent)' }}>
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="badge badge-accent">Primary</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>
                  Local
                </span>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600, marginTop: 14 }}>
                Local Agent Daemon
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {[
                  'Outbound Worker bridge',
                  'External Agent lifecycle',
                  'Typed command dispatch',
                  'Status and activity sync',
                ].map((x) => (
                  <li key={x} style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                    ✓ {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-card">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="badge badge-sui">Fused</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>
                  Venues
                </span>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600, marginTop: 14 }}>
                Authorization Adapters
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {[
                  'Hyperliquid agent wallet',
                  'OKX trade-only key',
                  'OWS wallet references',
                  'No withdrawal credentials',
                ].map((x) => (
                  <li key={x} style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                    ✓ {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-card">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span className="badge badge-neutral">Touched</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>
                  Guardian
                </span>
              </div>
              <h3 className="display" style={{ fontSize: 17, fontWeight: 600, marginTop: 14 }}>
                Risk And Inventory
              </h3>
              <ul
                style={{
                  listStyle: 'none',
                  marginTop: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                {[
                  'Local inventory snapshot',
                  'Funding and liquidation checks',
                  'Budget preflight',
                ].map((x) => (
                  <li key={x} style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                    ✓ {x}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FINAL CTA */}
        <section className="blk wrap">
          <div
            className="lp-card reveal"
            style={{
              textAlign: 'center',
              padding: '60px 40px',
              background:
                'radial-gradient(600px 300px at 50% 0%, rgba(46,230,206,0.12), transparent 70%), linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))',
            }}
          >
            <h2 className="sec-title" style={{ fontSize: 36 }}>
              Run the local-agent path.
            </h2>
            <p className="sec-sub" style={{ margin: '14px auto 0' }}>
              Open the dashboard, inspect the daemon bridge, and create a Hyperliquid/OKX funding
              strategy with local credentials and venue-scoped guards.
            </p>
            <div
              style={{
                display: 'flex',
                gap: 14,
                justifyContent: 'center',
                marginTop: 30,
                flexWrap: 'wrap',
              }}
            >
              <a href="#" onClick={launch} className="btn btn-primary btn-lg">
                Launch Sentry
              </a>
              <a href="#" onClick={launch} className="btn btn-lg">
                Try the local demo
              </a>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="lp-foot">
          <div
            className="wrap"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 20,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="26" height="26" viewBox="0 0 32 32" fill="none">
                <rect
                  x="2"
                  y="2"
                  width="28"
                  height="28"
                  rx="8"
                  fill="#06231f"
                  stroke="#2EE6CE"
                  strokeOpacity="0.5"
                />
                <path
                  d="M9 19 l4-5 3 3 4-6"
                  stroke="#2EE6CE"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="23" cy="11" r="2.2" fill="#2EE6CE" />
              </svg>
              <span className="display" style={{ fontWeight: 700 }}>
                Sentry
              </span>
            </div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--t2)' }}>
              Local daemon · OWS vault · Hyperliquid · OKX · Cloudflare Workers
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
