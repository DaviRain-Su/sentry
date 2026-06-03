import { useState } from 'react';
import { RG } from '../data.js';
import { Icon, fmtUsd, adapterColor } from './Primitives.jsx';

function RiskBar({ pct, warn = 65, danger = 85 }) {
  const c = pct > danger ? 'var(--danger)' : pct > warn ? 'var(--warn)' : 'var(--accent)';
  return (
    <div style={{ height: 6, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
      <div
        style={{
          width: Math.min(100, pct) + '%',
          height: '100%',
          borderRadius: 100,
          background: c,
          transition: 'width .4s',
        }}
      />
    </div>
  );
}

function RCard({ title, icon, right, children, pad = 18 }) {
  return (
    <div className="card" style={{ padding: pad }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && (
            <span style={{ color: 'var(--accent)' }}>
              <Icon name={icon} size={16} />
            </span>
          )}
          <div className="card-title">{title}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function GuardianRules({ onToast }) {
  const [rules, setRules] = useState(RG.guardianRules.map((r) => ({ ...r })));
  const [sim, setSim] = useState(null);
  const [preset, setPreset] = useState('balanced');
  const fmtVal = (r) =>
    r.kind === 'pct'
      ? r.val + '%'
      : r.kind === 'usd'
        ? '$' + r.val / 1000 + 'k'
        : r.kind === 'x'
          ? r.val + '×'
          : r.val + 's';
  const set = (i, patch) => {
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setPreset('custom');
  };
  const applyPreset = (p) => {
    setRules(
      rules.map((r) => ({
        ...r,
        val: p.vals[r.id] != null ? p.vals[r.id] : r.val,
        on: p.on[r.id] != null ? p.on[r.id] : r.on,
      }))
    );
    setPreset(p.id);
    onToast && onToast(`Applied “${p.name}” risk preset to all Guardian rules`, 'var(--accent)');
  };
  const scn = sim ? RG.simScenarios.find((s) => s.id === sim) : null;
  const OUT = {
    pass: ['var(--safe)', 'check', 'pass'],
    trigger: ['var(--warn)', 'alert', 'adjusted'],
    block: ['var(--danger)', 'x', 'blocked'],
  };

  return (
    <RCard
      title="Guardian rule editor"
      icon="shield"
      right={
        <button
          className="btn btn-sm"
          onClick={() => {
            setRules(RG.guardianRules.map((r) => ({ ...r })));
            setSim(null);
            setPreset('balanced');
            onToast && onToast('Guardian rules reset to defaults', 'var(--sui)');
          }}
        >
          <Icon name="refresh" size={12} /> Reset
        </button>
      }
    >
      {/* preset bar */}
      <div style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ fontSize: 9, marginBottom: 8 }}>
          Risk preset
        </div>
        <div style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
          {RG.guardianPresets.map((p) => {
            const sel = preset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p)}
                style={{
                  flex: '1 1 150px',
                  minWidth: 150,
                  textAlign: 'left',
                  padding: '11px 13px',
                  borderRadius: 'var(--r-md)',
                  cursor: 'pointer',
                  border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--border)'}`,
                  background: sel ? 'var(--accent-dim)' : 'var(--glass)',
                  transition: 'all .15s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: sel ? 'var(--accent)' : 'var(--t0)',
                    }}
                  >
                    {p.name}
                  </span>
                  {sel && (
                    <Icon name="check" size={12} stroke={2.6} style={{ color: 'var(--accent)' }} />
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 3, lineHeight: 1.4 }}>
                  {p.desc}
                </div>
              </button>
            );
          })}
          {preset === 'custom' && (
            <div
              style={{
                flex: '1 1 150px',
                minWidth: 150,
                padding: '11px 13px',
                borderRadius: 'var(--r-md)',
                border: '1.5px dashed var(--border-hi)',
                background: 'var(--glass)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warn)' }}>Custom</div>
              <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 3 }}>
                Edited from a preset — tweak freely or pick a preset to reset.
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rules.map((r, i) => {
          const out = scn ? scn.hits[r.id] : null;
          const om = out && r.on ? OUT[out] : null;
          return (
            <div
              key={r.id}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--r-md)',
                background: 'var(--glass)',
                border: `1px solid ${om ? `color-mix(in srgb, ${om[0]} 40%, var(--border))` : 'var(--border)'}`,
                opacity: r.on ? 1 : 0.55,
                transition: 'all .15s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                {/* toggle */}
                <button
                  onClick={() => set(i, { on: !r.on })}
                  style={{
                    width: 36,
                    height: 21,
                    borderRadius: 100,
                    border: 'none',
                    cursor: 'pointer',
                    flexShrink: 0,
                    padding: 3,
                    background: r.on ? 'var(--accent)' : 'var(--bg-0)',
                    transition: 'background .15s',
                  }}
                >
                  <div
                    style={{
                      width: 15,
                      height: 15,
                      borderRadius: '50%',
                      background: r.on ? '#06231f' : 'var(--t2)',
                      transform: r.on ? 'translateX(15px)' : 'none',
                      transition: 'transform .15s',
                    }}
                  />
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>
                    {om && (
                      <span
                        className="badge"
                        style={{
                          fontSize: 8.5,
                          background: `color-mix(in srgb, ${om[0]} 16%, transparent)`,
                          color: om[0],
                        }}
                      >
                        <span className="dot"></span>
                        {om[2]}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 2 }}>{r.desc}</div>
                </div>
                <span
                  className="mono"
                  style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', flexShrink: 0 }}
                >
                  {fmtVal(r)}
                </span>
              </div>
              {r.on && (
                <input
                  type="range"
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  value={r.val}
                  onChange={(e) => set(i, { val: +e.target.value })}
                  className="rg-slider"
                  style={{ marginTop: 10 }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* simulator */}
      <div
        style={{
          marginTop: 16,
          padding: '14px 16px',
          borderRadius: 'var(--r-md)',
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 11 }}>
          <span style={{ color: 'var(--warn)' }}>
            <Icon name="activity" size={15} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>Simulate an event</span>
          <span style={{ fontSize: 10.5, color: 'var(--t2)' }}>— see which rules would fire</span>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {RG.simScenarios.map((s) => (
            <button
              key={s.id}
              onClick={() => setSim(s.id)}
              className="btn btn-sm"
              style={{
                background: sim === s.id ? 'var(--warn-dim)' : 'var(--glass-2)',
                borderColor: sim === s.id ? 'var(--warn)' : 'var(--border)',
                color: sim === s.id ? 'var(--warn)' : 'var(--t1)',
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        {scn && (
          <div style={{ marginTop: 13, display: 'flex', flexDirection: 'column', gap: 7 }}>
            {(() => {
              const blocked = rules.some((r) => r.on && scn.hits[r.id] === 'block');
              return (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '10px 12px',
                    borderRadius: 'var(--r-sm)',
                    background: blocked ? 'var(--danger-dim)' : 'var(--safe-dim)',
                    border: `1px solid color-mix(in srgb, ${blocked ? 'var(--danger)' : 'var(--safe)'} 30%, var(--border))`,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: blocked ? 'var(--danger)' : 'var(--safe)' }}>
                    <Icon name={blocked ? 'shield' : 'check'} size={15} stroke={2.2} />
                  </span>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    {blocked
                      ? 'Execution would be BLOCKED — agent holds and logs the reason'
                      : 'Agent would act within limits (some orders adjusted)'}
                  </div>
                </div>
              );
            })()}
            {rules
              .filter((r) => r.on)
              .map((r) => {
                const out = scn.hits[r.id];
                const om = OUT[out];
                return (
                  <div
                    key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 11.5 }}
                  >
                    <span style={{ color: om[0], flexShrink: 0 }}>
                      <Icon name={om[1]} size={13} stroke={2.2} />
                    </span>
                    <span style={{ color: 'var(--t1)', flex: 1 }}>{r.label}</span>
                    <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: om[0] }}>
                      {om[2].toUpperCase()}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </RCard>
  );
}

export function RiskCenter({ policies, onEmergencyStop, onToast, stopped }) {
  const rb = RG.riskBudget;
  const atRiskPct = (rb.atRisk / rb.authorized) * 100;
  const lossPct = (rb.dailyLossUsed / rb.dailyLossCap) * 100;
  const activeCount = policies.filter((p) => p.status === 'active').length;

  const HEALTH = {
    safe: ['var(--safe)', 'var(--safe-dim)'],
    warn: ['var(--warn)', 'var(--warn-dim)'],
    ok: ['var(--safe)', 'var(--safe-dim)'],
    stale: ['var(--warn)', 'var(--warn-dim)'],
    offline: ['var(--t2)', 'var(--glass-hi)'],
    danger: ['var(--danger)', 'var(--danger-dim)'],
  };

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* emergency banner */}
      <div
        className="card"
        style={{
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap',
          border: `1px solid ${stopped ? 'var(--danger)' : 'color-mix(in srgb, var(--danger) 30%, var(--border))'}`,
          background: stopped ? 'var(--danger-dim)' : 'var(--bg-2)',
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            background: 'var(--danger-dim)',
            color: 'var(--danger)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="alert" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="display" style={{ fontSize: 15, fontWeight: 600 }}>
            {stopped ? 'All agents halted' : 'Emergency stop'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--t2)', marginTop: 2 }}>
            {stopped
              ? 'Every policy is paused. Resume individual strategies when ready.'
              : 'Pause every policy instantly. Positions are held — nothing is force-closed.'}
          </div>
        </div>
        <button
          onClick={() => {
            onEmergencyStop && onEmergencyStop();
          }}
          className="btn btn-danger"
          style={{ fontWeight: 600 }}
          disabled={stopped}
        >
          <Icon name="x" size={15} stroke={2.4} /> {stopped ? 'Halted' : 'Stop all agents'}
        </button>
      </div>

      {/* global budget KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 14 }}>
        <RCard title="Global risk budget" icon="shield">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
            <span className="mono display" style={{ fontSize: 26, fontWeight: 600 }}>
              ${fmtUsd(rb.atRisk, 0)}
            </span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--t2)' }}>
              / ${fmtUsd(rb.authorized, 0)} authorized
            </span>
          </div>
          <RiskBar pct={atRiskPct} />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 8,
              fontSize: 11,
              color: 'var(--t2)',
            }}
          >
            <span>{atRiskPct.toFixed(0)}% of ceiling at risk</span>
            <span className="mono">${fmtUsd(rb.authorized - rb.atRisk, 0)} headroom</span>
          </div>
        </RCard>
        <RCard title="Daily loss cap" icon="activity">
          <div
            className="mono display"
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: lossPct > 65 ? 'var(--warn)' : 'var(--t0)',
            }}
          >
            ${fmtUsd(rb.dailyLossUsed, 0)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)', margin: '4px 0 10px' }}>
            of ${fmtUsd(rb.dailyLossCap, 0)} hard stop
          </div>
          <RiskBar pct={lossPct} />
          <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 8 }}>
            All agents pause if the cap is hit.
          </div>
        </RCard>
        <RCard title="Active policies" icon="grid">
          <div className="mono display" style={{ fontSize: 22, fontWeight: 600 }}>
            {activeCount}
            <span style={{ fontSize: 14, color: 'var(--t2)' }}> / {policies.length}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4 }}>autonomous on-chain</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {policies.slice(0, 6).map((p) => (
              <span
                key={p.id}
                title={p.name}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 3,
                  background: p.status === 'active' ? 'var(--safe)' : 'var(--warn)',
                }}
              />
            ))}
          </div>
        </RCard>
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, alignItems: 'start' }}
      >
        {/* venue caps */}
        <RCard
          title="Per-venue exposure caps"
          icon="layers"
          right={
            <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
              {RG.venueLimits.length} venues
            </span>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            {RG.venueLimits.map((v) => {
              const pct = (v.exposure / v.cap) * 100;
              return (
                <div key={v.venue}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: v.kind === 'cex' ? 2 : '50%',
                          background: adapterColor(v.venue),
                        }}
                      />
                      {v.venue}
                      <span
                        className="mono"
                        style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--t3)' }}
                      >
                        {v.kind.toUpperCase()}
                      </span>
                    </span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      <span style={{ color: 'var(--t0)', fontWeight: 600 }}>
                        ${fmtUsd(v.exposure, 0)}
                      </span>
                      <span style={{ color: 'var(--t2)' }}> / ${fmtUsd(v.cap, 0)}</span>
                    </span>
                  </div>
                  <RiskBar pct={pct} />
                </div>
              );
            })}
          </div>
        </RCard>

        {/* liquidation watch */}
        <RCard
          title="Liquidation watch"
          icon="alert"
          right={
            <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
              {RG.liquidations.length} legs
            </span>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {RG.liquidations.map((l, i) => {
              const h = HEALTH[l.health] || HEALTH.safe;
              return (
                <div
                  key={i}
                  style={{
                    padding: '11px 13px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--glass)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 7,
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {l.venue}{' '}
                      <span
                        style={{
                          color: /short/i.test(l.side) ? 'var(--danger)' : 'var(--safe)',
                          fontWeight: 700,
                        }}
                      >
                        {l.side}
                      </span>
                    </span>
                    <span className="badge" style={{ fontSize: 9, background: h[1], color: h[0] }}>
                      <span className="dot"></span>
                      {l.buffer}% buffer
                    </span>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: 'var(--t2)',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>mark ${l.markPx}</span>
                    <span>liq ${l.liqPx}</span>
                  </div>
                  <div
                    style={{
                      position: 'relative',
                      height: 5,
                      background: 'var(--bg-0)',
                      borderRadius: 100,
                      marginTop: 7,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: 100 - l.buffer + '%',
                        height: '100%',
                        background: h[0],
                        opacity: 0.5,
                      }}
                    />
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>
              Agent deleverages a leg before its buffer reaches zero.
            </div>
          </div>
        </RCard>

        {/* oracle health */}
        <RCard title="Oracle health" icon="globe">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {RG.oracles.map((o, i) => {
              const h = HEALTH[o.status] || HEALTH.ok;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '10px 0',
                    borderTop: i ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: h[0],
                      flexShrink: 0,
                      boxShadow: o.status === 'ok' ? `0 0 6px ${h[0]}` : 'none',
                    }}
                  />
                  <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{o.feed}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 10.5,
                      color: o.status === 'stale' ? 'var(--warn)' : 'var(--t2)',
                    }}
                  >
                    {o.age}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: 'var(--t2)', width: 44, textAlign: 'right' }}
                  >
                    ±{o.dev}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 10 }}>
            Stale or divergent feeds block execution until they recover.
          </div>
        </RCard>

        {/* signer health */}
        <RCard title="Signer & executor" icon="key">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {RG.signers.map((s, i) => {
              const h = HEALTH[s.status] || HEALTH.ok;
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '11px 13px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--glass)',
                    border: '1px solid var(--border)',
                    opacity: s.status === 'offline' ? 0.68 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: h[1],
                      color: h[0],
                    }}
                  >
                    <Icon
                      name={
                        s.kind === 'zklogin' ? 'fingerprint' : s.kind === 'cloud' ? 'cloud' : 'cpu'
                      }
                      size={15}
                    />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{s.name}</div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                      {s.detail}
                    </div>
                  </div>
                  <span className="badge" style={{ fontSize: 9, background: h[1], color: h[0] }}>
                    <span className={`dot ${s.status === 'ok' ? 'pulse' : ''}`}></span>
                    {s.status}
                  </span>
                </div>
              );
            })}
          </div>
        </RCard>
      </div>

      {/* guardian rule editor + simulator */}
      <GuardianRules onToast={onToast} />

      {/* capability matrix */}
      <RCard title="What the agent can — and cannot — do" icon="shield">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
              <span style={{ color: 'var(--safe)' }}>
                <Icon name="check" size={15} stroke={2.4} />
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--safe)' }}>
                Authorized
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RG.capabilities.can.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 9,
                    fontSize: 12,
                    color: 'var(--t1)',
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: 'var(--safe)', flexShrink: 0, marginTop: 1 }}>
                    <Icon name="check" size={13} stroke={2.4} />
                  </span>
                  {c}
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 11 }}>
              <span style={{ color: 'var(--danger)' }}>
                <Icon name="x" size={15} stroke={2.4} />
              </span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--danger)' }}>
                Never permitted
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {RG.capabilities.cannot.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 9,
                    fontSize: 12,
                    color: 'var(--t1)',
                    lineHeight: 1.4,
                  }}
                >
                  <span style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }}>
                    <Icon name="x" size={13} stroke={2.4} />
                  </span>
                  {c}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 9,
            marginTop: 16,
            padding: '11px 13px',
            borderRadius: 'var(--r-sm)',
            background: 'var(--glass)',
          }}
        >
          <span style={{ color: 'var(--sui)', flexShrink: 0, marginTop: 1 }}>
            <Icon name="shield" size={14} />
          </span>
          <div style={{ fontSize: 11, color: 'var(--t1)', lineHeight: 1.5 }}>
            These limits are enforced by the{' '}
            <strong style={{ color: 'var(--t0)' }}>Move Policy Object on-chain</strong>, not by the
            agent's good behavior. Revoke the object and all authority disappears in one
            transaction.
          </div>
        </div>
      </RCard>
    </div>
  );
}
