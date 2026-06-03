/* ===========================================================
   Sentry — shared components & helpers
   =========================================================== */
import { useState, useEffect, useRef, useMemo } from 'react';
import { Liveline } from 'liveline';
import { RG } from '../data.js';

/* ---------- color helper ---------- */
export function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h,
    16
  );
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ---------- icon set (stroke svg) ---------- */
export function Icon({ name, size = 18, stroke = 1.7, style }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    style,
  };
  const paths = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    dashboard: (
      <>
        <rect x="3" y="3" width="8" height="10" rx="1.5" />
        <rect x="13" y="3" width="8" height="6" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
        <rect x="3" y="17" width="8" height="4" rx="1.5" />
      </>
    ),
    spark: (
      <>
        <path d="M3 16l4-5 3 3 5-7 6 8" />
      </>
    ),
    activity: (
      <>
        <path d="M3 12h4l2 6 4-14 2 8h6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
    bolt: (
      <>
        <path d="M13 2L4 14h6l-1 8 9-12h-6z" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    chevR: (
      <>
        <path d="M9 6l6 6-6 6" />
      </>
    ),
    chevL: (
      <>
        <path d="M15 6l-6 6 6 6" />
      </>
    ),
    check: (
      <>
        <path d="M5 12l5 5L20 6" />
      </>
    ),
    x: (
      <>
        <path d="M6 6l12 12M18 6L6 18" />
      </>
    ),
    cloud: (
      <>
        <path d="M7 18h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 9.5 3.5 3.5 0 0 0 6 18z" />
      </>
    ),
    cpu: (
      <>
        <rect x="6" y="6" width="12" height="12" rx="2" />
        <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
      </>
    ),
    wallet: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" />
        <path d="M3 10h18" />
        <circle cx="17" cy="14" r="1.3" />
      </>
    ),
    alert: (
      <>
        <path d="M12 3l9 16H3z" />
        <path d="M12 10v4M12 17.5v.01" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    arrowDown: (
      <>
        <path d="M12 5v14M6 13l6 6 6-6" />
      </>
    ),
    arrowUp: (
      <>
        <path d="M12 19V5M6 11l6-6 6 6" />
      </>
    ),
    sliders: (
      <>
        <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="13" cy="18" r="2" />
      </>
    ),
    link: (
      <>
        <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66L11 7" />
        <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66L13 17" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
        <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" />
      </>
    ),
    pause: (
      <>
        <rect x="7" y="5" width="3.5" height="14" rx="1" />
        <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.4" />
      </>
    ),
    coin: (
      <>
        <ellipse cx="12" cy="7" rx="8" ry="3.2" />
        <path d="M4 7v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7" />
        <path d="M4 13v4c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-4" />
      </>
    ),
    logout: (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <path d="M16 17l5-5-5-5M21 12H9" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2.2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    key: (
      <>
        <circle cx="8" cy="14" r="4.5" />
        <path d="M11.2 10.8 20 2M16 6l3 3M14 8l2.5 2.5" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3.5 7l8.5 6 8.5-6" />
      </>
    ),
    fingerprint: (
      <>
        <path d="M12 5a7 7 0 0 0-7 7v2M19 13v-1a7 7 0 0 0-3.5-6.06" />
        <path d="M9 12a3 3 0 0 1 6 0v3a4 4 0 0 1-1 2.6M12 12v4M8 16v1a4 4 0 0 0 .5 2" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.87-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 13.5H4.5a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 2.87-1.2V2.5a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-1.2 2.87h.1a2 2 0 0 1 0 4z" />
      </>
    ),
    layers: (
      <>
        <path d="M12 3 3 8l9 5 9-5z" />
        <path d="M3 13l9 5 9-5M3 18l9 5 9-5" />
      </>
    ),
    swap: (
      <>
        <path d="M7 4 3 8l4 4" />
        <path d="M3 8h13" />
        <path d="M17 20l4-4-4-4" />
        <path d="M21 16H8" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
      </>
    ),
    droplet: (
      <>
        <path d="M12 3s6 5.7 6 10.5A6 6 0 0 1 6 13.5C6 8.7 12 3 12 3z" />
      </>
    ),
    flame: (
      <>
        <path d="M12 3c1 3 4 4.5 4 8a4 4 0 0 1-8 0c0-1.4.5-2.3 1-3 .3 1 .8 1.5 1.5 1.8C10 8 11 5.5 12 3z" />
      </>
    ),
    percent: (
      <>
        <path d="M19 5 5 19" />
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="16.5" cy="16.5" r="2.5" />
      </>
    ),
    scale: (
      <>
        <path d="M12 3v18M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0L5 7zM19 7l-2.5 6a3 3 0 0 0 5 0L19 7zM8 21h8" />
      </>
    ),
    radar: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <path d="M12 12 19 8" />
        <circle cx="12" cy="12" r="1.4" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
      </>
    ),
    moon: (
      <>
        <path d="M20 14.5A8 8 0 1 1 9.5 4a6.3 6.3 0 0 0 10.5 10.5z" />
      </>
    ),
  };
  return <svg {...p}>{paths[name] || null}</svg>;
}

/* ---------- animated number ---------- */
export function useAnimatedNumber(target, dur = 600) {
  const [val, setVal] = useState(target);
  const ref = useRef(target);
  useEffect(() => {
    const from = ref.current,
      to = target,
      start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const e = 1 - (1 - p) ** 3;
      setVal(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else ref.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return val;
}

export function fmtUsd(n, dp = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// compact USD from a millions value, e.g. 612.4 -> "$612.4M", 1240 -> "$1.24B"
export function fmtTvlM(m) {
  if (m >= 1000) return '$' + (m / 1000).toFixed(2) + 'B';
  return '$' + (m >= 100 ? m.toFixed(0) : m.toFixed(1)) + 'M';
}

// protocol monogram — gradient disc with 1-letter, matches Token style
export function ProtoGlyph({ proto, size = 30 }) {
  const m = (RG.protocols && RG.protocols[proto]) || { name: proto, c: '#5C6A78' };
  return (
    <div
      title={m.name}
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${m.c}, ${m.c}99)`,
        color: '#06140f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--f-display)',
        fontWeight: 700,
        fontSize: size * 0.42,
        boxShadow: `0 2px 8px ${m.c}40`,
      }}
    >
      {m.name[0]}
    </div>
  );
}

// adapter/venue name → brand color (protocols + known CEX/bridges)
export function adapterColor(name) {
  const m = {};
  Object.values(RG.protocols || {}).forEach((p) => {
    m[p.name] = p.c;
  });
  Object.assign(m, {
    Hyperliquid: '#7CF5D0',
    Aevo: '#7B8BFF',
    Drift: '#9945FF',
    Binance: '#F0B90B',
    OKX: '#AEB7C2',
    Bybit: '#F7A600',
    Solana: '#9945FF',
    Ethereum: '#7B8BFF',
    Raydium: '#C200FB',
    Uniswap: '#FF4DA6',
    deBridge: '#2EE6CE',
    Wormhole: '#5AA6FF',
    Sentry: '#2EE6CE',
    'all venues': 'var(--t3)',
  });
  return m[name] || 'var(--t2)';
}

// open the agent runtime drawer from anywhere (App listens for this)
export function openRuntime(mode) {
  window.dispatchEvent(new CustomEvent('rg:runtime', { detail: mode || null }));
}

// clickable mode badge → opens the runtime drawer for that mode
export function ModeBadge({ mode, size = 9.5 }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openRuntime(mode);
      }}
      className="mode-badge"
      title="View agent runtime"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: size,
        fontWeight: 600,
        lineHeight: 1,
        padding: '3px 7px',
        borderRadius: 100,
        cursor: 'pointer',
        fontFamily: 'var(--f-body)',
        background: 'var(--glass-2)',
        border: '1px solid var(--border)',
        color: 'var(--t1)',
        transition: 'all .12s',
      }}
    >
      <Icon name={mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />
      {mode}
      <Icon name="chevR" size={9} style={{ opacity: 0.5 }} />
    </button>
  );
}

/* ---------- sparkline (Liveline-powered) ---------- */
// canvas can't read CSS vars; resolve var(--x) to a concrete hex.
function resolveCssColor(c, fallback = '#2EE6CE') {
  if (typeof c !== 'string') return fallback;
  if (!c.startsWith('var(')) return c;
  if (typeof window === 'undefined') return fallback;
  const name = c.slice(4, -1).trim();
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function Sparkline({
  data,
  w = 120,
  h = 36,
  color = 'var(--accent)',
  fill = true,
  strokeW = 1.8,
}) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }} />;
  const nowSec = Math.floor(Date.now() / 1000);
  const series = data.map((v, i) => ({ time: nowSec - (data.length - 1 - i), value: v }));
  const value = series[series.length - 1].value;
  return (
    <div style={{ width: w, height: h }}>
      <Liveline
        data={series}
        value={value}
        theme="dark"
        color={resolveCssColor(color)}
        fill={fill}
        lineWidth={strokeW}
        grid={false}
        badge={false}
        momentum={false}
        scrub={false}
        pulse={false}
        padding={{ top: 3, right: 3, bottom: 3, left: 3 }}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}

/* ---------- radial risk gauge ---------- */
export function RiskGauge({ score, size = 168 }) {
  const animated = useAnimatedNumber(score, 800);
  const s = Math.round(animated);
  const r = size / 2 - 14;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const sweep = 0.75; // 270deg arc
  const arcLen = circ * sweep;
  const prog = (s / 100) * arcLen;
  const col = s >= 70 ? 'var(--danger)' : s >= 45 ? 'var(--warn)' : 'var(--safe)';
  const label = s >= 70 ? 'CRITICAL' : s >= 45 ? 'ELEVATED' : 'STABLE';
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="10"
          strokeDasharray={`${arcLen} ${circ}`}
          strokeLinecap="round"
        />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="10"
          strokeDasharray={`${prog} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke .4s ease', filter: `drop-shadow(0 0 8px ${col})` }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          className="mono display"
          style={{
            fontSize: 46,
            fontWeight: 600,
            lineHeight: 1,
            color: col,
            letterSpacing: '-0.02em',
          }}
        >
          {s}
        </div>
        <div className="eyebrow" style={{ marginTop: 6, color: col, letterSpacing: '0.18em' }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>risk score</div>
      </div>
    </div>
  );
}

/* ---------- token glyph ---------- */
export function Token({ sym, size = 28 }) {
  const map = {
    SUI: { bg: 'linear-gradient(135deg,#6FBCFF,#2f7de0)', t: '#fff' },
    USDC: { bg: 'linear-gradient(135deg,#3fa0ff,#2775ca)', t: '#fff' },
    DEEP: { bg: 'linear-gradient(135deg,#39e6c9,#10b39a)', t: '#04231f' },
    WAL: { bg: 'linear-gradient(135deg,#9aa6ff,#5b6bff)', t: '#fff' },
  };
  const m = map[sym] || { bg: '#333', t: '#fff' };
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: m.bg,
        color: m.t,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--f-mono)',
        fontWeight: 700,
        fontSize: size * 0.34,
        flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
      }}
    >
      {sym[0]}
    </div>
  );
}

export function PairGlyph({ pair }) {
  const [a, b] = pair.split('/');
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Token sym={a} size={26} />
      <div style={{ marginLeft: -8 }}>
        <Token sym={b} size={26} />
      </div>
    </div>
  );
}

/* ---------- logo ---------- */
export function Logo({ size = 30 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <rect
            x="2"
            y="2"
            width="28"
            height="28"
            rx="8"
            fill="#06231f"
            stroke="var(--accent)"
            strokeOpacity="0.5"
          />
          <path
            d="M9 19 l4-5 3 3 4-6"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="23" cy="11" r="2.2" fill="var(--accent)" />
          <path
            d="M9 23h14"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div style={{ lineHeight: 1 }}>
        <div
          className="display"
          style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}
        >
          Sentry
        </div>
      </div>
    </div>
  );
}

/* ---------- interactive time-axis line/area chart (hover crosshair) ---------- */
export function TimeChart({
  data,
  w = 460,
  h = 120,
  color = 'var(--accent)',
  fmt,
  xLabels,
  baseline,
  height,
}) {
  const H = height || h;
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const fmtV = fmt || ((v) => v.toFixed(2));
  const vals = data.map((d) => (typeof d === 'number' ? d : d.v));
  const pad = { l: 6, r: 6, t: 10, b: 18 };
  const min = Math.min(...vals),
    max = Math.max(...vals);
  const rng = max - min || 1;
  const iw = w - pad.l - pad.r,
    ih = H - pad.t - pad.b;
  const X = (i) => pad.l + (i / (vals.length - 1)) * iw;
  const Y = (v) => pad.t + ih - ((v - min) / rng) * ih;
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const line = pts
    .map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1))
    .join(' ');
  const area =
    line +
    ` L${X(vals.length - 1).toFixed(1)} ${(pad.t + ih).toFixed(1)} L${pad.l} ${(pad.t + ih).toFixed(1)} Z`;
  const gid = 'tc' + Math.abs((vals[0] * 1000) | 0) + vals.length;
  const grid = [max, (max + min) / 2, min];
  const baseY = baseline != null && baseline >= min && baseline <= max ? Y(baseline) : null;

  const onMove = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * w;
    let i = Math.round(((x - pad.l) / iw) * (vals.length - 1));
    i = Math.max(0, Math.min(vals.length - 1, i));
    setHover(i);
  };

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${w} ${H}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.26" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {grid.map((g, i) => (
          <line
            key={i}
            x1={pad.l}
            y1={Y(g)}
            x2={w - pad.r}
            y2={Y(g)}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray={i === 1 ? '3 4' : '0'}
            opacity={i === 1 ? 0.6 : 1}
          />
        ))}
        {baseY != null && (
          <line
            x1={pad.l}
            y1={baseY}
            x2={w - pad.r}
            y2={baseY}
            stroke="var(--t3)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hover != null && (
          <>
            <line
              x1={pts[hover][0]}
              y1={pad.t}
              x2={pts[hover][0]}
              y2={pad.t + ih}
              stroke="var(--border-hi)"
              strokeWidth="1"
            />
            <circle
              cx={pts[hover][0]}
              cy={pts[hover][1]}
              r="4"
              fill={color}
              stroke="var(--bg-2)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      <div
        style={{
          position: 'absolute',
          top: pad.t - 6,
          left: 8,
          fontSize: 9,
          fontFamily: 'var(--f-mono)',
          color: 'var(--t3)',
        }}
      >
        {fmtV(max)}
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: pad.b - 4,
          left: 8,
          fontSize: 9,
          fontFamily: 'var(--f-mono)',
          color: 'var(--t3)',
        }}
      >
        {fmtV(min)}
      </div>
      {xLabels && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: -12,
            padding: '0 6px',
          }}
        >
          <span className="mono" style={{ fontSize: 9, color: 'var(--t3)' }}>
            {xLabels[0]}
          </span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--t3)' }}>
            {xLabels[1]}
          </span>
        </div>
      )}
      {hover != null && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: `${(pts[hover][0] / w) * 100}%`,
            transform: 'translate(-50%,0)',
            marginLeft: -28,
            pointerEvents: 'none',
            background: 'var(--bg-3)',
            border: '1px solid var(--border-hi)',
            borderRadius: 6,
            padding: '4px 8px',
            fontFamily: 'var(--f-mono)',
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--t0)',
            whiteSpace: 'nowrap',
            boxShadow: '0 6px 18px -6px rgba(0,0,0,0.5)',
          }}
        >
          {fmtV(vals[hover])}
        </div>
      )}
    </div>
  );
}
