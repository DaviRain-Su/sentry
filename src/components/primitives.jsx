/* ===========================================================
   RescueGrid — shared components & helpers
   =========================================================== */
import { useState, useEffect, useRef, useMemo } from 'react'

/* ---------- color helper ---------- */
export function hexToRgba(hex, a) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/* ---------- icon set (stroke svg) ---------- */
export function Icon({ name, size = 18, stroke = 1.7, style }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', style }
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    dashboard: <><rect x="3" y="3" width="8" height="10" rx="1.5"/><rect x="13" y="3" width="8" height="6" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><rect x="3" y="17" width="8" height="4" rx="1.5"/></>,
    spark: <><path d="M3 16l4-5 3 3 5-7 6 8"/></>,
    activity: <><path d="M3 12h4l2 6 4-14 2 8h6"/></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></>,
    bolt: <><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    chevR: <><path d="M9 6l6 6-6 6"/></>,
    chevL: <><path d="M15 6l-6 6 6 6"/></>,
    check: <><path d="M5 12l5 5L20 6"/></>,
    x: <><path d="M6 6l12 12M18 6L6 18"/></>,
    cloud: <><path d="M7 18h9a4 4 0 0 0 .5-7.97A6 6 0 0 0 5 9.5 3.5 3.5 0 0 0 6 18z"/></>,
    cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1.3"/></>,
    alert: <><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    arrowDown: <><path d="M12 5v14M6 13l6 6 6-6"/></>,
    arrowUp: <><path d="M12 19V5M6 11l6-6 6 6"/></>,
    sliders: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="15" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></>,
    link: <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66L11 7"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66L13 17"/></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>,
    sparkles: <><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z"/><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/></>,
    pause: <><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></>,
    refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/></>,
    coin: <><ellipse cx="12" cy="7" rx="8" ry="3.2"/><path d="M4 7v6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7"/><path d="M4 13v4c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-4"/></>,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></>,
  }
  return <svg {...p}>{paths[name] || null}</svg>
}

/* ---------- animated number ---------- */
export function useAnimatedNumber(target, dur = 600) {
  const [val, setVal] = useState(target)
  const ref = useRef(target)
  useEffect(() => {
    const from = ref.current, to = target, start = performance.now()
    let raf
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      setVal(from + (to - from) * e)
      if (p < 1) raf = requestAnimationFrame(tick)
      else ref.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return val
}

export function fmtUsd(n, dp = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

/* ---------- sparkline ---------- */
export function Sparkline({ data, w = 120, h = 36, color = 'var(--accent)', fill = true, strokeW = 1.8 }) {
  const min = Math.min(...data), max = Math.max(...data)
  const rng = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w
    const y = h - ((v - min) / rng) * (h - 4) - 2
    return [x, y]
  })
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = line + ` L${w} ${h} L0 ${h} Z`
  const gid = useMemo(() => 'sg' + Math.random().toString(36).slice(2, 7), [])
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeW} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />
    </svg>
  )
}

/* ---------- radial risk gauge ---------- */
export function RiskGauge({ score, size = 168 }) {
  const animated = useAnimatedNumber(score, 800)
  const s = Math.round(animated)
  const r = size / 2 - 14
  const c = size / 2
  const circ = 2 * Math.PI * r
  const sweep = 0.75 // 270deg arc
  const arcLen = circ * sweep
  const prog = (s / 100) * arcLen
  const col = s >= 70 ? 'var(--danger)' : s >= 45 ? 'var(--warn)' : 'var(--safe)'
  const label = s >= 70 ? 'CRITICAL' : s >= 45 ? 'ELEVATED' : 'STABLE'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(135deg)' }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="10"
          strokeDasharray={`${arcLen} ${circ}`} strokeLinecap="round" />
        <circle cx={c} cy={c} r={r} fill="none" stroke={col} strokeWidth="10"
          strokeDasharray={`${prog} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke .4s ease', filter: `drop-shadow(0 0 8px ${col})` }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mono display" style={{ fontSize: 46, fontWeight: 600, lineHeight: 1, color: col, letterSpacing: '-0.02em' }}>{s}</div>
        <div className="eyebrow" style={{ marginTop: 6, color: col, letterSpacing: '0.18em' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>risk score</div>
      </div>
    </div>
  )
}

/* ---------- token glyph ---------- */
export function Token({ sym, size = 28 }) {
  const map = {
    SUI:  { bg: 'linear-gradient(135deg,#6FBCFF,#2f7de0)', t: '#fff' },
    USDC: { bg: 'linear-gradient(135deg,#3fa0ff,#2775ca)', t: '#fff' },
    DEEP: { bg: 'linear-gradient(135deg,#39e6c9,#10b39a)', t: '#04231f' },
    WAL:  { bg: 'linear-gradient(135deg,#9aa6ff,#5b6bff)', t: '#fff' },
  }
  const m = map[sym] || { bg: '#333', t: '#fff' }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: m.bg, color: m.t,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-mono)',
      fontWeight: 700, fontSize: size * 0.34, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }}>
      {sym[0]}
    </div>
  )
}

export function PairGlyph({ pair }) {
  const [a, b] = pair.split('/')
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <Token sym={a} size={26} />
      <div style={{ marginLeft: -8 }}><Token sym={b} size={26} /></div>
    </div>
  )
}

/* ---------- logo ---------- */
export function Logo({ size = 30 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
          <rect x="2" y="2" width="28" height="28" rx="8" fill="#06231f" stroke="var(--accent)" strokeOpacity="0.5"/>
          <path d="M9 19 l4-5 3 3 4-6" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <circle cx="23" cy="11" r="2.2" fill="var(--accent)"/>
          <path d="M9 23h14" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </div>
      <div style={{ lineHeight: 1 }}>
        <div className="display" style={{ fontWeight: 700, fontSize: 16, letterSpacing: '-0.01em' }}>RescueGrid</div>
      </div>
    </div>
  )
}
