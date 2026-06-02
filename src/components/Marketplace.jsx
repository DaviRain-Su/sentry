import { useState } from 'react'
import { RG } from '../data.js'
import { Icon, TimeChart } from './primitives.jsx'

const STATUS_META = {
  available: { cls: 'badge-safe',    label: 'available' },
  testnet:   { cls: 'badge-warn',    label: 'testnet' },
  soon:      { cls: 'badge-neutral', label: 'coming soon' },
};
const CAT_C = {
  'Risk Response': 'var(--danger)',
  'Arbitrage':     'var(--accent)',
  'Lending':       'var(--safe)',
  'LP':            'var(--sui)',
  'Rebalance':     'var(--warn)',
  'Automation':    '#A78BFA',
  'Watchtower':    'var(--t1)',
};

function adapterColor(name) {
  const m = {};
  Object.values(RG.protocols).forEach(p => { m[p.name] = p.c; });
  Object.assign(m, {
    Hyperliquid: '#7CF5D0', Aevo: '#7B8BFF', Drift: '#9945FF',
    Binance: '#F0B90B', OKX: '#AEB7C2', Bybit: '#F7A600',
    deBridge: '#2EE6CE', Wormhole: '#5AA6FF', RescueGrid: '#2EE6CE', 'all venues': 'var(--t3)',
  });
  return m[name] || 'var(--t2)';
}

function StrategyCard({ s, onDeploy, onToast, onOpen }) {
  const st = STATUS_META[s.status];
  const cc = CAT_C[s.cat] || 'var(--accent)';
  const deployable = s.status !== 'soon' && s.scenario;

  const action = (e) => {
    if (e) e.stopPropagation();
    if (s.status === 'soon') { onToast && onToast('Coming soon — we’ll flag it the moment the adapter ships', 'var(--sui)'); return; }
    if (s.watch) { onToast && onToast('Watchtower armed — monitoring only, zero execution authority', 'var(--safe)'); return; }
    if (s.scenario) { onDeploy && onDeploy({ scenario: s.scenario }); return; }
    onToast && onToast('On testnet — request early access to preview this policy', 'var(--warn)');
  };
  const btnLabel = s.status === 'soon' ? 'Coming soon'
    : s.watch ? 'Start monitoring'
    : s.scenario ? (s.status === 'testnet' ? 'Preview (testnet)' : 'Preview policy')
    : 'Notify me';

  return (
    <div className="card mkt-row" onClick={() => onOpen && onOpen(s.id)} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 13, cursor: 'pointer', opacity: s.status === 'soon' ? 0.82 : 1 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${cc} 16%, transparent)`, color: cc }}>
          <Icon name={s.icon} size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, fontFamily: 'var(--f-display)', lineHeight: 1.2 }}>{s.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: cc }}>{s.cat}</span>
            <span className={`badge ${st.cls}`} style={{ fontSize: 9 }}><span className="dot"></span>{st.label}</span>
          </div>
        </div>
      </div>

      {/* blurb */}
      <div style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.5, minHeight: 56 }}>{s.blurb}</div>

      {/* metric + capital */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>{s.metric.l}</div>
          <div className="mono display" style={{ fontSize: 18, fontWeight: 600, color: deployable ? 'var(--accent)' : 'var(--t0)', marginTop: 2 }}>{s.metric.v}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="eyebrow" style={{ fontSize: 8.5 }}>Capital</div>
          <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, marginTop: 4 }}>{s.capital}</div>
        </div>
      </div>

      {/* adapters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {s.adapters.map(a => (
          <span key={a} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 600,
            padding: '3px 8px', borderRadius: 6, background: 'var(--glass-2)', border: '1px solid var(--border)', color: 'var(--t1)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: adapterColor(a) }} />{a}
          </span>
        ))}
      </div>

      {/* risk taxonomy */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {s.risks.length === 0
          ? <span style={{ fontSize: 10, color: 'var(--safe)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="check" size={11} stroke={2.6} />no execution risk</span>
          : s.risks.map(r => {
              const rt = RG.riskTax[r];
              return (
                <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--t2)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 2, background: rt.c }} />{rt.label}
                </span>
              );
            })}
      </div>

      <div style={{ flex: 1 }} />

      {/* action */}
      <button onClick={action} className={`btn btn-sm ${deployable && !s.watch ? 'btn-primary' : ''}`}
        disabled={s.status === 'soon'}
        style={{ justifyContent: 'center', width: '100%',
          ...(s.status === 'soon' ? { background: 'var(--glass-2)', borderColor: 'var(--border)', color: 'var(--t2)', cursor: 'not-allowed' } : {}),
          ...(s.watch ? { borderColor: 'var(--border-hi)' } : {}) }}>
        {deployable && !s.watch && <Icon name="bolt" size={13} />}
        {s.watch && <Icon name="eye" size={13} />}
        {btnLabel}
      </button>
    </div>
  );
}

export function StrategyMarketplace({ onDeploy, onToast, onOpen }) {
  const [cat, setCat] = useState('All');
  const cats = ['All', 'Risk Response', 'Arbitrage', 'Lending', 'LP', 'Rebalance', 'Automation', 'Watchtower'];
  const list = RG.catalog.filter(s => cat === 'All' || s.cat === cat);
  const counts = {
    available: RG.catalog.filter(s => s.status === 'available').length,
    testnet: RG.catalog.filter(s => s.status === 'testnet').length,
    soon: RG.catalog.filter(s => s.status === 'soon').length,
  };

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* intro */}
      <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>Policy-constrained strategy templates</div>
          <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}>
            Every template deploys as a Move Policy Object with its own Guardian rules and venue scope — the agent can act, but never beyond what you authorize.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          {[['available', counts.available, 'var(--safe)'], ['testnet', counts.testnet, 'var(--warn)'], ['coming soon', counts.soon, 'var(--t2)']].map(([k, v, c]) => (
            <div key={k}>
              <div className="mono display" style={{ fontSize: 22, fontWeight: 600, color: c }}>{v}</div>
              <div style={{ fontSize: 11, color: 'var(--t2)' }}>{k}</div>
            </div>
          ))}
        </div>
      </div>

      {/* category tabs */}
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {cats.map(c => (
          <button key={c} onClick={() => setCat(c)} className="btn btn-sm"
            style={{ background: cat === c ? 'var(--accent-dim)' : 'var(--glass-2)', borderColor: cat === c ? 'var(--accent)' : 'var(--border)',
              color: cat === c ? 'var(--accent)' : 'var(--t1)' }}>{c}</button>
        ))}
      </div>

      {/* grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {list.map(s => <StrategyCard key={s.id} s={s} onDeploy={onDeploy} onToast={onToast} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

/* ---------------- Strategy detail page ---------------- */
const DETAIL_PARSED = {
  safe: 'parsed', dca: 'parsedDCA', hedge: 'parsedHedge', 'funding-arb': 'parsedFundingArb',
  lp: 'parsedLP', lend: 'parsedLendYield', spot: 'parsedSpotArb',
};

export function StrategyDetail({ id, onBack, onDeploy, onToast }) {
  const s = RG.catalog.find(c => c.id === id);
  if (!s) return null;
  const d = (RG.detail && RG.detail[id]) || {};
  const cc = CAT_C[s.cat] || 'var(--accent)';
  const st = STATUS_META[s.status];
  const parsed = s.scenario && DETAIL_PARSED[s.scenario] ? RG[DETAIL_PARSED[s.scenario]] : null;
  const deployable = s.status !== 'soon' && s.scenario;

  // derive sane fallbacks for non-authored strategies
  const thesis = d.thesis || s.blurb;
  const legs = d.legs || [{ venue: s.adapters[0] || '—', asset: s.metric.l, side: '—', size: s.capital, collateral: '—', exp: s.metric.v, expC: 'var(--accent)' }];
  const yieldParts = d.yield || [{ label: s.metric.l, v: s.metric.v, c: 'var(--accent)' }];
  const net = d.net || null;
  const riskParts = d.risk || s.risks.map(k => ({ key: k, level: 'warn', note: (RG.riskTax[k] ? RG.riskTax[k].label : k) + ' exposure applies — sized and capped by policy.' }));
  const permissions = d.permissions || ['Act only on scoped venues', 'Read price + rate feeds', 'Never withdraw or transfer funds off-app'];
  const timeline = d.timeline || [{ t: 'trigger', d: 'Condition met' }, { t: 't0', d: 'Agent executes within policy' }, { t: 'ongoing', d: 'Monitor, rebalance, log on-chain' }];
  const guardian = (parsed && parsed.guardian) || [];
  const hist = (parsed && parsed.backtest && parsed.backtest.curve) || null;
  const stats = (parsed && parsed.backtest && parsed.backtest.stats) || null;

  const sideC = (side) => /short|sell/i.test(side) ? 'var(--danger)' : /long|buy|supply|lp/i.test(side) ? 'var(--safe)' : 'var(--t1)';
  const GLV = { pass: ['var(--safe)', 'var(--safe-dim)', 'check'], warn: ['var(--warn)', 'var(--warn-dim)', 'alert'], fail: ['var(--danger)', 'var(--danger-dim)', 'x'] };

  const Card = ({ title, icon, children, pad = 18 }) => (
    <div className="card" style={{ padding: pad }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {icon && <span style={{ color: cc }}><Icon name={icon} size={16} /></span>}
        <div className="card-title">{title}</div>
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn btn-sm btn-ghost" style={{ padding: 9 }}><Icon name="chevL" size={16} /></button>
        <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `color-mix(in srgb, ${cc} 16%, transparent)`, color: cc }}>
          <Icon name={s.icon} size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>{s.name}</h2>
            <span className={`badge ${st.cls}`} style={{ fontSize: 9.5 }}><span className="dot"></span>{st.label}</span>
          </div>
          <div style={{ fontSize: 12, color: cc, fontWeight: 600, marginTop: 4 }}>{s.cat}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-sm" onClick={() => onToast && onToast('Dry-run scheduled — simulating against your wallet & live books', 'var(--sui)')}>
            <Icon name="eye" size={14} /> Simulate with my wallet
          </button>
          {deployable
            ? <button className="btn btn-primary btn-sm" onClick={() => onDeploy && onDeploy({ scenario: s.scenario })}><Icon name="bolt" size={14} /> Preview policy</button>
            : <button className="btn btn-sm" disabled style={{ opacity: .5 }}>{s.status === 'soon' ? 'Coming soon' : 'Watch-only'}</button>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, alignItems: 'start' }}>
        {/* left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card title="Strategy thesis" icon="sparkles">
            <div style={{ fontSize: 13.5, color: 'var(--t1)', lineHeight: 1.6 }}>{thesis}</div>
          </Card>

          {/* capital flow */}
          <Card title="Capital flow" icon="swap">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--glass-hi)', border: '1px solid var(--border)', textAlign: 'center', minWidth: 96 }}>
                <Icon name="wallet" size={18} style={{ color: 'var(--sui)' }} />
                <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 5 }}>Your wallet</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>{s.capital}</div>
              </div>
              <Icon name="chevR" size={18} style={{ color: 'var(--t3)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {legs.map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', borderRadius: 'var(--r-md)',
                    background: 'var(--glass)', border: `1px solid ${sideC(l.side)}55` }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: sideC(l.side), minWidth: 64 }}>{l.side.toUpperCase()}</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.venue}</div>
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>{l.asset} · {l.size}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* legs table */}
          <Card title="Position legs" icon="layers" pad={0}>
            <div style={{ padding: '0 0 4px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr 1fr 1.4fr', padding: '0 18px 10px' }}>
                {['Venue', 'Asset', 'Side', 'Size', 'Expected'].map((h, i) => (
                  <div key={h} className="eyebrow" style={{ fontSize: 9, textAlign: i === 4 ? 'right' : 'left' }}>{h}</div>
                ))}
              </div>
              {legs.map((l, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr 1fr 1.4fr', alignItems: 'center', padding: '11px 18px', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.venue}</div>
                  <div className="mono" style={{ fontSize: 12, color: 'var(--t1)' }}>{l.asset}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: sideC(l.side) }}>{l.side}</div>
                  <div className="mono" style={{ fontSize: 12 }}>{l.size}</div>
                  <div className="mono" style={{ fontSize: 11.5, textAlign: 'right', color: l.expC || 'var(--t1)' }}>{l.exp}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* execution timeline */}
          <Card title="Execution timeline" icon="clock">
            <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '2px solid var(--border)', paddingLeft: 16, marginLeft: 4 }}>
              {timeline.map((tl, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: i < timeline.length - 1 ? 16 : 0 }}>
                  <div style={{ position: 'absolute', left: -23, top: 2, width: 10, height: 10, borderRadius: '50%', background: cc, border: '2px solid var(--bg-2)' }} />
                  <div className="mono" style={{ fontSize: 10.5, color: cc, fontWeight: 600 }}>{tl.t}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 2 }}>{tl.d}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* yield decomposition */}
          <Card title="Yield decomposition" icon="percent">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {yieldParts.map((y, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5 }}>
                  <span style={{ color: 'var(--t1)' }}>{y.label}</span>
                  <span className="mono" style={{ fontWeight: 600, color: y.c }}>{y.v}</span>
                </div>
              ))}
              {net && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, paddingTop: 11, borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{net.label}</span>
                  <span className="mono display" style={{ fontSize: 17, fontWeight: 600, color: 'var(--accent)' }}>{net.v}</span>
                </div>
              )}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 12, lineHeight: 1.45 }}>Every number is annualized and net of the cost lines above — no single headline APY.</div>
          </Card>

          {/* risk decomposition */}
          <Card title="Risk decomposition" icon="shield">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {riskParts.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--safe)' }}>No execution authority — monitoring only.</div>}
              {riskParts.map((r, i) => {
                const rt = RG.riskTax[r.key] || { label: r.key, c: 'var(--t2)' };
                const lv = GLV[r.level] || GLV.warn;
                return (
                  <div key={i} style={{ display: 'flex', gap: 10 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: rt.c, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{rt.label}</span>
                        <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: lv[0] }}>{r.level === 'pass' ? 'MITIGATED' : r.level === 'fail' ? 'HIGH' : 'MANAGED'}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2, lineHeight: 1.45 }}>{r.note}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* historical */}
          {hist && (
            <Card title="Backtest · 30d" icon="spark">
              <TimeChart data={hist} w={300} height={86} color="var(--safe)" fmt={(v) => v.toFixed(1)} xLabels={['−30d', 'today']} baseline={100} />
              {stats && (
                <div style={{ display: 'flex', gap: 18, marginTop: 12 }}>
                  {stats.map(x => (
                    <div key={x.k}>
                      <div className="mono display" style={{ fontSize: 15, fontWeight: 600, color: x.v.startsWith('+') ? 'var(--safe)' : 'var(--t0)' }}>{x.v}</div>
                      <div style={{ fontSize: 10, color: 'var(--t2)', marginTop: 1 }}>{x.k}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* permissions */}
          <Card title="Required permissions" icon="key">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {permissions.map((p, i) => (
                <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, color: 'var(--t1)' }}>
                  <span style={{ color: /never|no /i.test(p) ? 'var(--danger)' : 'var(--safe)', flexShrink: 0, marginTop: 1 }}>
                    <Icon name={/never|no /i.test(p) ? 'x' : 'check'} size={13} stroke={2.4} /></span>
                  {p}
                </div>
              ))}
            </div>
          </Card>

          {/* guardian rules */}
          {guardian.length > 0 && (
            <Card title="Guardian rules" icon="shield">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {guardian.map((g, i) => {
                  const lv = GLV[g.level] || GLV.warn;
                  return (
                    <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                      <span style={{ width: 24, height: 24, borderRadius: 7, background: lv[1], color: lv[0], display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={lv[2]} size={13} stroke={2.2} /></span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{g.label}</div>
                        <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 1, lineHeight: 1.4 }}>{g.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

