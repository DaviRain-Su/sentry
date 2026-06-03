/* Sentry — PoolDrawer + AgentRuntimeDrawer (ported from design detail.jsx) */
import { useState, Fragment } from 'react';
import { RG } from '../data.js';
import { Icon, ProtoGlyph, Sparkline, fmtTvlM } from './Primitives.jsx';

export function PoolDrawer({ pool, onClose, onDeploy }) {
  const [copied, setCopied] = useState(false);
  const pm = RG.protocols[pool.proto] || { name: pool.proto, kind: '', c: '#5C6A78' };
  const chain = RG.chains.find((c) => c.id === pool.chain) || { name: 'Sui', c: '#5AA6FF' };
  const apy = pool.base + pool.reward;
  const basePct = apy > 0 ? (pool.base / apy) * 100 : 0;
  const TYPE_C = {
    Lending: 'var(--sui)',
    LP: 'var(--accent)',
    LST: 'var(--safe)',
    Vault: 'var(--warn)',
    CLOB: 'var(--accent)',
  };
  const SCEN = { LP: 'lp', Vault: 'lp', CLOB: 'lp', Lending: 'lend', LST: 'lend' };

  // deterministic synthesized history + on-chain facts from a stable seed
  const seed = (pool.proto + pool.market).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rnd = (i) => {
    const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const apyHist = Array.from({ length: 30 }, (_, i) => +(apy * (0.82 + 0.34 * rnd(i))).toFixed(2));
  apyHist[29] = +apy.toFixed(2);
  const tvlHist = Array.from(
    { length: 30 },
    (_, i) => +(pool.tvl * (0.74 + 0.42 * rnd(i + 60))).toFixed(2)
  );
  tvlHist[29] = pool.tvl;
  const vol24 = pool.tvl * (0.16 + 0.55 * rnd(9));
  const hx = (n) =>
    Math.floor(rnd(n) * 65535)
      .toString(16)
      .padStart(4, '0');
  const addr = '0x' + hx(1) + hx(2) + '…' + hx(3) + hx(4);
  const util = Math.round(58 + 34 * rnd(11));

  const copy = () => {
    try {
      navigator.clipboard && navigator.clipboard.writeText(addr);
    } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const typeFacts =
    pool.type === 'Lending'
      ? [
          ['Utilization', util + '%'],
          ['Reserve factor', '10%'],
        ]
      : pool.type === 'LST'
        ? [
            ['Unstake', 'instant via pool'],
            ['Validators', 'top 20'],
          ]
        : pool.type === 'CLOB'
          ? [
              ['Maker rebate', 'enabled'],
              ['24h volume', fmtTvlM(vol24)],
            ]
          : [
              ['Fee tier', '0.25%'],
              ['24h volume', fmtTvlM(vol24)],
            ];

  const riskRows =
    pool.risk === 'low'
      ? [
          ['Volatility', 'low', 'safe'],
          ['Liquidity depth', 'deep', 'safe'],
          ['Smart-contract', 'audited', 'safe'],
        ]
      : pool.risk === 'med'
        ? [
            ['Volatility', 'moderate', 'warn'],
            ['Liquidity depth', 'healthy', 'safe'],
            ['Impermanent loss', 'possible', 'warn'],
          ]
        : [
            ['Volatility', 'high', 'danger'],
            ['Liquidity depth', 'thin', 'warn'],
            ['Impermanent loss', 'elevated', 'danger'],
          ];

  const stat = (label, value, sub, color) => (
    <div
      style={{
        background: 'var(--glass)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-md)',
        padding: '12px 14px',
      }}
    >
      <div className="eyebrow" style={{ fontSize: 9 }}>
        {label}
      </div>
      <div
        className="mono display"
        style={{ fontSize: 19, fontWeight: 600, marginTop: 5, color: color || 'var(--t0)' }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const factRow = (k, v, mono) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderTop: '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
      <span
        className={mono ? 'mono' : ''}
        style={{ fontSize: 12.5, color: 'var(--t0)', textAlign: 'right', fontWeight: 500 }}
      >
        {v}
      </span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--overlay-backdrop)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeUp .25s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          maxWidth: '94vw',
          height: '100%',
          background: 'var(--bg-2)',
          borderLeft: '1px solid var(--border-hi)',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxShadow: 'var(--drawer-shadow)',
        }}
      >
        {/* header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            padding: '20px 24px',
          }}
        >
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
          >
            <div style={{ display: 'flex', gap: 13 }}>
              <ProtoGlyph proto={pool.proto} size={44} />
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>
                  {pm.kind} · pool
                </div>
                <h2 className="display" style={{ fontSize: 18, fontWeight: 600 }}>
                  {pm.name} <span style={{ color: 'var(--t2)' }}>·</span> {pool.market}
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: 7,
                      color: TYPE_C[pool.type],
                      background: `color-mix(in srgb, ${TYPE_C[pool.type]} 13%, transparent)`,
                    }}
                  >
                    {pool.type}
                  </span>
                  <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                    <span
                      style={{ width: 7, height: 7, borderRadius: '50%', background: chain.c }}
                    />
                    {chain.name}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ padding: 8 }}>
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* stat grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {stat(
              'APY',
              apy.toFixed(1) + '%',
              pool.reward > 0
                ? `${pool.base.toFixed(1)} + ${pool.reward.toFixed(1)} rwd`
                : 'base only',
              'var(--accent)'
            )}
            {stat('TVL', fmtTvlM(pool.tvl), 'value locked')}
            {stat('24h vol', fmtTvlM(vol24), 'traded')}
          </div>

          {/* APY history */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>
              APY · last 30d
            </div>
            <div
              style={{
                background: 'var(--bg-0)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: '14px 16px',
              }}
            >
              <Sparkline data={apyHist} w={448} h={70} color="var(--accent)" />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
                  −30d
                </span>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
                  today · {apy.toFixed(1)}%
                </span>
              </div>
            </div>
          </div>

          {/* TVL history */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>
              TVL · last 30d
            </div>
            <div
              style={{
                background: 'var(--bg-0)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: '14px 16px',
              }}
            >
              <Sparkline data={tvlHist} w={448} h={52} color="var(--sui)" />
            </div>
          </div>

          {/* yield composition */}
          {pool.reward > 0 && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 9 }}>
                Yield composition
              </div>
              <div
                style={{
                  height: 10,
                  background: 'var(--bg-0)',
                  borderRadius: 100,
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <div style={{ width: `${basePct}%`, background: 'var(--sui)' }} />
                <div style={{ width: `${100 - basePct}%`, background: 'var(--accent)' }} />
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 10 }}>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--t1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <span
                    style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--sui)' }}
                  />
                  Base {pool.base.toFixed(1)}%
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--t1)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <span
                    style={{ width: 9, height: 9, borderRadius: 3, background: 'var(--accent)' }}
                  />
                  Rewards {pool.reward.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          {/* on-chain facts */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              On-chain
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 16,
                  padding: '10px 0',
                }}
              >
                <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>Pool object</span>
                <button
                  onClick={copy}
                  className="mono"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '5px 9px',
                    borderRadius: 'var(--r-sm)',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-0)',
                    cursor: 'pointer',
                    color: copied ? 'var(--accent)' : 'var(--sui)',
                    fontSize: 11.5,
                    fontWeight: 600,
                  }}
                >
                  {copied ? 'copied' : addr}
                  <Icon name={copied ? 'check' : 'copy'} size={12} stroke={copied ? 2.6 : 1.8} />
                </button>
              </div>
              {factRow('Protocol', pm.name)}
              {factRow('Network', chain.name)}
              {typeFacts.map(([k, v]) => (
                <Fragment key={k}>{factRow(k, v, true)}</Fragment>
              ))}
              {factRow('Price oracle', 'Pyth')}
              {factRow(
                'Last update',
                '3s ago · checkpoint 84,209,' + (100 + Math.round(rnd(20) * 800))
              )}
            </div>
          </div>

          {/* risk */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Risk profile
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {riskRows.map(([k, v, lv]) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: 12.5,
                  }}
                >
                  <span style={{ color: 'var(--t1)' }}>{k}</span>
                  <span className={`badge badge-${lv}`}>
                    <span className="dot"></span>
                    {v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer */}
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            background: 'var(--bg-2)',
            borderTop: '1px solid var(--border)',
            padding: '16px 24px',
            display: 'flex',
            gap: 10,
          }}
        >
          <button
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'center' }}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1.5, justifyContent: 'center' }}
            onClick={() => {
              onDeploy && onDeploy({ scenario: SCEN[pool.type] || 'lend' });
              onClose();
            }}
          >
            <Icon name="bolt" size={15} /> Deploy agent to this pool
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgentRuntimeDrawer({ mode, onClose, onToast }) {
  const [tab, setTab] = useState(mode || 'cloud');
  const r = RG.runtimes[tab];
  const ST = { online: ['var(--safe)', 'online'], offline: ['var(--t2)', 'offline'] };
  const st = ST[r.status] || ST.offline;

  const row = (k, v, mono) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 16,
        padding: '10px 0',
        borderTop: '1px solid var(--border)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
      <span
        className={mono ? 'mono' : ''}
        style={{ fontSize: 12.5, color: 'var(--t0)', textAlign: 'right', fontWeight: 500 }}
      >
        {v}
      </span>
    </div>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'var(--overlay-backdrop)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        justifyContent: 'flex-end',
        animation: 'fadeUp .25s ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: '94vw',
          height: '100%',
          background: 'var(--bg-2)',
          borderLeft: '1px solid var(--border-hi)',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxShadow: 'var(--drawer-shadow)',
        }}
      >
        {/* header */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            padding: '20px 24px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: 16,
            }}
          >
            <div>
              <div className="eyebrow" style={{ marginBottom: 4 }}>
                Agent runtime
              </div>
              <h2 className="display" style={{ fontSize: 18, fontWeight: 600 }}>
                Where & how your agent runs
              </h2>
            </div>
            <button onClick={onClose} className="btn btn-sm btn-ghost" style={{ padding: 8 }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          {/* mode switch */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              background: 'var(--bg-0)',
              borderRadius: 'var(--r-sm)',
              padding: 4,
            }}
          >
            {['cloud', 'local'].map((m) => (
              <button
                key={m}
                onClick={() => setTab(m)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 7,
                  padding: '8px 0',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--f-body)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: tab === m ? 'var(--glass-hi)' : 'transparent',
                  color: tab === m ? 'var(--accent)' : 'var(--t2)',
                }}
              >
                <Icon name={RG.runtimes[m].icon} size={14} /> {RG.runtimes[m].label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* status hero */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '16px 18px',
              borderRadius: 'var(--r-md)',
              background: r.status === 'online' ? 'var(--safe-dim)' : 'var(--glass)',
              border: `1px solid ${r.status === 'online' ? 'color-mix(in srgb, var(--safe) 30%, var(--border))' : 'var(--border)'}`,
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: r.status === 'online' ? 'var(--safe)' : 'var(--glass-hi)',
                color: r.status === 'online' ? '#06231f' : 'var(--t2)',
              }}
            >
              <Icon name={r.icon} size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{r.label}</span>
                <span
                  className="badge"
                  style={{
                    fontSize: 9.5,
                    background: `color-mix(in srgb, ${st[0]} 16%, transparent)`,
                    color: st[0],
                  }}
                >
                  <span className={`dot ${r.status === 'online' ? 'pulse' : ''}`}></span>
                  {st[1]}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 3 }}>{r.host}</div>
            </div>
            {r.status === 'online' ? (
              <div style={{ textAlign: 'right' }}>
                <div className="mono display" style={{ fontSize: 16, fontWeight: 600 }}>
                  {r.watching}
                </div>
                <div style={{ fontSize: 10, color: 'var(--t2)' }}>policies live</div>
              </div>
            ) : (
              <button
                className="btn btn-sm btn-primary"
                onClick={() =>
                  onToast && onToast('Copy: npx sentry-agent --local', 'var(--accent)')
                }
              >
                <Icon name="cpu" size={13} /> Start
              </button>
            )}
          </div>

          {/* live loop metric (cloud) */}
          {r.status === 'online' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
              {[
                ['Heartbeat', r.heartbeat],
                ['Loop latency', r.loopMs + 'ms'],
                ['Tick', r.tick],
              ].map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    background: 'var(--glass)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '11px 13px',
                  }}
                >
                  <div className="eyebrow" style={{ fontSize: 8.5 }}>
                    {k}
                  </div>
                  <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                    {v}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* config */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Configuration
            </div>
            <div>
              {row('Runtime', r.host)}
              {row('Region', r.region, true)}
              {row('LLM', r.llm)}
              {row('Loop cadence', r.tick)}
              {row('Uptime', r.uptime, true)}
            </div>
          </div>

          {/* health checks */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Health checks
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {r.health.map((h, i) => {
                const c =
                  h.ok === true ? 'var(--safe)' : h.ok === false ? 'var(--danger)' : 'var(--t2)';
                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '10px 12px',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--glass)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ color: c, flexShrink: 0 }}>
                      <Icon
                        name={h.ok === true ? 'check' : h.ok === false ? 'x' : 'clock'}
                        size={14}
                        stroke={2.4}
                      />
                    </span>
                    <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{h.k}</span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>
                      {h.v}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* gas */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '13px 15px',
              borderRadius: 'var(--r-md)',
              background: 'var(--glass)',
              border: '1px solid var(--border)',
            }}
          >
            <span style={{ color: 'var(--warn)', flexShrink: 0 }}>
              <Icon name="bolt" size={18} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{r.gas.station}</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>
                Sponsors gas — agent holds no SUI of its own
              </div>
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>
              {r.gas.bal} {r.gas.unit}
            </div>
          </div>

          {/* loop log */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Recent loop activity
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderLeft: '2px solid var(--border)',
                paddingLeft: 16,
                marginLeft: 4,
              }}
            >
              {r.log.map((l, i) => (
                <div
                  key={i}
                  style={{ position: 'relative', paddingBottom: i < r.log.length - 1 ? 14 : 0 }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: -23,
                      top: 3,
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      background: r.status === 'online' ? 'var(--accent)' : 'var(--t3)',
                      border: '2px solid var(--bg-2)',
                    }}
                  />
                  <div
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: r.status === 'online' ? 'var(--accent)' : 'var(--t3)',
                      fontWeight: 600,
                    }}
                  >
                    {l.t}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t1)', marginTop: 1 }}>{l.d}</div>
                </div>
              ))}
            </div>
          </div>

          {/* privacy note */}
          <div
            style={{
              display: 'flex',
              gap: 9,
              padding: '11px 13px',
              borderRadius: 'var(--r-sm)',
              background: 'var(--glass)',
            }}
          >
            <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}>
              <Icon name="shield" size={14} />
            </span>
            <div style={{ fontSize: 11, color: 'var(--t1)', lineHeight: 1.5 }}>
              {r.privacy} Both modes enforce the{' '}
              <strong style={{ color: 'var(--t0)' }}>same on-chain policy</strong> — switching where
              logic runs never widens the agent's authority.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
