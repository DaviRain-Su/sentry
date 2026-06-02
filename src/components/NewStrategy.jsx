/* ===========================================================
   RescueGrid — New Strategy flow (intent → policy)
   =========================================================== */
import { useState, useEffect } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { RG } from '../data.js'
import { Icon, Sparkline, fmtUsd } from './primitives.jsx'
import { Slider, Button } from '@heroui/react'
import { WORKER_CONFIGURED, parseIntent as parseWorkerIntent, getSuiPriceHistory } from '../api.js'
import { parseIntent as parseLocalIntent } from '../../core/strategy.js'
import { runBacktest } from '../../core/backtest.js'
import deployment from '../../core/deployment.js'

function Stepper({ step, steps }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: 'contents' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--f-mono)', fontWeight: 600, fontSize: 12, flexShrink: 0,
              background: i < step ? 'var(--accent)' : i === step ? 'var(--accent-dim)' : 'var(--glass-2)',
              color: i < step ? '#06231f' : i === step ? 'var(--accent)' : 'var(--t2)',
              border: i === step ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
              {i < step ? <Icon name="check" size={13} stroke={2.6} /> : i + 1}
            </div>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: i <= step ? 'var(--t0)' : 'var(--t2)', whiteSpace: 'nowrap' }}>{s}</span>
          </div>
          {i < steps.length - 1 && <div style={{ flex: 1, height: 1, background: i < step ? 'var(--accent)' : 'var(--border)', margin: '0 14px' }} />}
        </div>
      ))}
    </div>
  )
}

function GuardianRow({ g }) {
  const map = {
    pass: { c: 'var(--safe)', bg: 'var(--safe-dim)', icon: 'check', label: 'PASS' },
    warn: { c: 'var(--warn)', bg: 'var(--warn-dim)', icon: 'alert', label: 'REVIEW' },
    fail: { c: 'var(--danger)', bg: 'var(--danger-dim)', icon: 'x', label: 'BLOCK' },
  }
  const m = map[g.level]
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: m.bg, color: m.c, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={m.icon} size={15} stroke={2.2} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{g.label}</span>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: m.c, letterSpacing: '0.08em' }}>{m.label}</span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 2 }}>{g.detail}</div>
      </div>
    </div>
  )
}

/* visual multi-leg builder — add/remove legs, live net-delta, liquidation preview */
const VENUE_OPTS = {
  'funding-arb': ['Bluefin', 'Hyperliquid', 'Aevo', 'Binance', 'Bybit', 'Drift'],
  spot: ['Binance', 'OKX', 'Bybit', 'Cetus', 'DeepBook', 'Raydium', 'Uniswap'],
}
const MARK_PX = { 'funding-arb': 4.182, spot: 4.182 }

function LegBuilder({ scenario, budget, leverage, legs, setLegs }) {
  const venues = VENUE_OPTS[scenario] || VENUE_OPTS['funding-arb']
  const isSpot = scenario === 'spot'
  const longWord = isSpot ? 'Buy' : 'Long', shortWord = isSpot ? 'Sell' : 'Short'
  const mark = MARK_PX[scenario] || 4.182

  const sumLong = legs.filter(l => l.side === 'long').reduce((s, l) => s + l.pct, 0)
  const sumShort = legs.filter(l => l.side === 'short').reduce((s, l) => s + l.pct, 0)
  const net = sumLong - sumShort
  const neutral = Math.abs(net) <= 5
  const lev = (scenario === 'funding-arb') ? leverage : 1

  const setLeg = (i, patch) => setLegs(legs.map((l, j) => j === i ? { ...l, ...patch } : l))
  const addLeg = () => { if (legs.length < 4) setLegs([...legs, { venue: venues.find(v => !legs.some(l => l.venue === v)) || venues[0], side: 'short', pct: 50 }]) }
  const removeLeg = (i) => { if (legs.length > 1) setLegs(legs.filter((_, j) => j !== i)) }

  const sideC = (s) => s === 'long' ? 'var(--safe)' : 'var(--danger)'
  const off = Math.max(-46, Math.min(46, net / 100 * 46))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Position legs</span>
        <button onClick={addLeg} disabled={legs.length >= 4} className="btn btn-sm"
          style={{ padding: '5px 10px', opacity: legs.length >= 4 ? .5 : 1 }}><Icon name="plus" size={12} /> Add leg</button>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {legs.map((l, i) => {
          const notional = budget * l.pct / 100 * lev
          const liqPx = lev > 1 ? (l.side === 'long' ? mark * (1 - 1 / lev * 0.9) : mark * (1 + 1 / lev * 0.9)) : null
          return (
            <div key={i} style={{ flex: '1 1 200px', minWidth: 200, padding: 13, borderRadius: 'var(--r-md)',
              background: 'var(--glass)', border: `1.5px solid ${sideC(l.side)}55` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
                <span className="mono" style={{ fontSize: 9.5, color: 'var(--t2)' }}>LEG {i + 1}</span>
                {legs.length > 1 && <button onClick={() => removeLeg(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t2)', padding: 2 }}><Icon name="x" size={13} /></button>}
              </div>
              <div style={{ display: 'flex', gap: 4, background: 'var(--bg-0)', borderRadius: 'var(--r-sm)', padding: 3, marginBottom: 9 }}>
                {[['long', longWord], ['short', shortWord]].map(([s, lbl]) => (
                  <button key={s} onClick={() => setLeg(i, { side: s })} style={{ flex: 1, padding: '5px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--f-body)', fontSize: 11, fontWeight: 700, background: l.side === s ? `color-mix(in srgb, ${sideC(s)} 18%, transparent)` : 'transparent',
                    color: l.side === s ? sideC(s) : 'var(--t2)' }}>{lbl}</button>
                ))}
              </div>
              <select value={l.venue} onChange={e => setLeg(i, { venue: e.target.value })}
                style={{ width: '100%', padding: '7px 9px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', background: 'var(--bg-0)',
                  color: 'var(--t0)', fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 600, marginBottom: 9, cursor: 'pointer' }}>
                {venues.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 10.5, color: 'var(--t2)' }}>Size</span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 600 }}>{l.pct}% · ${fmtUsd(notional, 0)}</span>
              </div>
              <input type="range" min="10" max="100" step="5" value={l.pct} onChange={e => setLeg(i, { pct: +e.target.value })} className="rg-slider" />
              {liqPx && <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', marginTop: 7 }}>liq ≈ ${liqPx.toFixed(3)} · {lev}× </div>}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Net exposure</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: neutral ? 'var(--safe)' : 'var(--warn)' }}>{neutral ? 'market-neutral' : (net > 0 ? 'net long ' : 'net short ') + Math.abs(net) + '%'}</span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'var(--bg-0)', borderRadius: 100 }}>
          <div style={{ position: 'absolute', left: '50%', top: -3, width: 1, height: 14, background: 'var(--border-hi)' }} />
          <div style={{ position: 'absolute', left: `calc(50% + ${off}px)`, top: '50%', transform: 'translate(-50%,-50%)', width: 14, height: 14, borderRadius: '50%',
            background: neutral ? 'var(--safe)' : 'var(--warn)', boxShadow: `0 0 8px ${neutral ? 'var(--safe)' : 'var(--warn)'}`, transition: 'left .2s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>{shortWord} ${fmtUsd(budget * sumShort / 100, 0)}</span>
          <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>{longWord} ${fmtUsd(budget * sumLong / 100, 0)}</span>
        </div>
        {!neutral && <div style={{ fontSize: 10.5, color: 'var(--warn)', marginTop: 8, display: 'flex', gap: 6 }}>
          <Icon name="alert" size={12} style={{ flexShrink: 0, marginTop: 1 }} />Legs are unbalanced — this strategy carries directional risk. Match {longWord.toLowerCase()} and {shortWord.toLowerCase()} sizes for neutrality.</div>}
      </div>
    </div>
  )
}

export function NewStrategy({ onDone, mode, setMode, seed }) {
  const PARSED = { safe: RG.parsed, dca: RG.parsedDCA, hedge: RG.parsedHedge, risky: RG.parsedRisky,
    'funding-arb': RG.parsedFundingArb, lp: RG.parsedLP, lend: RG.parsedLendYield, spot: RG.parsedSpotArb }
  // a market/catalog "Deploy" seeds the wizard: jump to Review with the scenario pre-filled
  const seeded = seed && PARSED[seed.scenario] ? seed.scenario : null
  const seedMeta = seeded ? PARSED[seeded].meta : null
  const [step, setStep] = useState(seeded ? 1 : 0)
  const [text, setText] = useState((seed && seed.text) || '')
  const [parsing, setParsing] = useState(false)
  const [scenario, setScenario] = useState(seeded || 'safe')
  const [budget, setBudget] = useState(seedMeta ? seedMeta.budget : 500)
  const [slip, setSlip] = useState(seedMeta ? seedMeta.slip : 1.2)
  const [expiry, setExpiry] = useState(14)
  // Builder v2 — advanced, strategy-aware controls
  const [leverage, setLeverage] = useState(2)
  const [liqBuffer, setLiqBuffer] = useState(25)
  const [flipThresh, setFlipThresh] = useState(0)
  const [requireApproval, setRequireApproval] = useState(false)
  const [legs, setLegs] = useState([{ venue: 'Bluefin', side: 'short', pct: 50 }, { venue: 'Hyperliquid', side: 'long', pct: 50 }])
  const [livePreview, setLivePreview] = useState(null)
  const [livePreviewSource, setLivePreviewSource] = useState(null)
  const [liveBacktest, setLiveBacktest] = useState(null)
  const account = useCurrentAccount()
  const workerPreview = WORKER_CONFIGURED
  const live = !!account || workerPreview
  const readOnlyPreview = !account && workerPreview
  const previewOwner = account?.address || deployment.agent.address
  const steps = ['Intent', 'Review', 'Policy', 'Deploy']
  const P = PARSED[scenario]
  const meta = P.meta || RG.parsed.meta
  // which advanced (builder v2) controls apply to this strategy
  const adv = {
    leverage: ['funding-arb', 'hedge'].includes(scenario),
    twoLeg: ['funding-arb', 'spot'].includes(scenario),
    flip: scenario === 'funding-arb',
    ltv: scenario === 'lend',
  }
  const blocked = P.guardian.some(g => g.level === 'fail')
  const failCount = P.guardian.filter(g => g.level === 'fail').length
  const BT = (live && liveBacktest) ? liveBacktest : P.backtest
  const btLive = !!(live && liveBacktest)

  // seed leg-builder defaults per scenario
  useEffect(() => {
    if (scenario === 'spot') setLegs([{ venue: 'OKX', side: 'long', pct: 50 }, { venue: 'Raydium', side: 'short', pct: 50 }])
    else if (scenario === 'funding-arb') setLegs([{ venue: 'Aevo', side: 'short', pct: 50 }, { venue: 'Hyperliquid', side: 'long', pct: 50 }])
  }, [scenario])

  const classify = (s) => {
    if (/entire|all-?in|ignore slippage|everything|max leverage|20x/i.test(s)) return 'risky'
    if (/spot arb|cross-?venue|cross-?exchange/i.test(s)) return 'spot'
    if (/funding|arb|arbitrage|perp|delta-?neutral|basis/i.test(s)) return 'funding-arb'
    if (/\blp\b|liquidity|concentrated|re-?center|pool range/i.test(s)) return 'lp'
    if (/stablecoin|idle|yield router|lend|lending|supply|money market|best (rate|yield)/i.test(s)) return 'lend'
    if (/dca|every day|each day|accumulate|tranche|ladder|daily/i.test(s)) return 'dca'
    if (/hedge|falls below|drops below|downside|protect|short/i.test(s)) return 'hedge'
    return 'safe'
  }

  const parse = async () => {
    setParsing(true)
    const sc = classify(text)
    const m = PARSED[sc].meta
    if (live) {
      // Worker-first parse; local parser is only a fallback when a connected wallet has no Worker URL configured.
      try {
        const preview = workerPreview
          ? await parseWorkerIntent(previewOwner, text)
          : parseLocalIntent(text, previewOwner)
        setLivePreview(preview)
        setLivePreviewSource(workerPreview ? 'Worker' : 'local fallback')
        if (preview?.status === 'ok' && preview.strategy) {
          const th = Number(preview.strategy.trigger?.threshold_pct) || 8
          const bud = preview.strategy.budget_ceiling ? Number(preview.strategy.budget_ceiling) / 1e6 : budget
          try {
            const h = await getSuiPriceHistory(30)
            setLiveBacktest(h.status === 'ok' && h.prices.length > 2 ? runBacktest(h.prices, { thresholdPct: th, budget: bud }) : null)
          } catch { setLiveBacktest(null) }
        } else setLiveBacktest(null)
      } catch {
        setLivePreview(null)
        setLivePreviewSource(null)
        setLiveBacktest(null)
      }
    } else {
      await new Promise(r => setTimeout(r, 1400))
      setLivePreview(null)
      setLivePreviewSource(null)
    }
    setParsing(false)
    setScenario(sc)
    if (m) { setBudget(m.budget); setSlip(m.slip) }
    setStep(1)
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card" style={{ padding: '18px 22px' }}>
        <Stepper step={step} steps={steps} />
      </div>

      {/* STEP 0 — intent */}
      {step === 0 && (
        <div className="card fade-up" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <span style={{ color: 'var(--accent)' }}><Icon name="sparkles" size={18} /></span>
            <h2 className="display" style={{ fontSize: 19, fontWeight: 600 }}>Describe your strategy</h2>
          </div>
          <p style={{ color: 'var(--t1)', fontSize: 13.5, marginBottom: 16 }}>
            Write it in plain language. The agent translates intent into a programmable transaction block (PTB) and a Move Policy Object that limits exactly what it can do.
          </p>
          <div style={{ position: 'relative' }}>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
              placeholder="e.g. When SUI drops more than 8%, deploy a 500 USDC rescue grid…"
              style={{ width: '100%', resize: 'none', background: 'var(--bg-0)', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-md)',
                color: 'var(--t0)', fontFamily: 'var(--f-body)', fontSize: 15, padding: '16px 18px', lineHeight: 1.5, outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
            {RG.examples.map(ex => (
              <Button key={ex} size="sm" onPress={() => setText(ex)}
                className="rg-btn-2 text-xs font-normal"
                startContent={<span style={{ color: 'var(--accent)' }}>＋</span>}>
                {ex}
              </Button>
            ))}
            <Button size="sm" onPress={() => setText(RG.riskyExample)}
              className="rg-btn-danger-2 text-xs font-normal"
              startContent={<span>⚠</span>}>
              Try a risky one (Guardian blocks it)
            </Button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
            <Button className="bg-accent text-accent-foreground font-semibold" isDisabled={!text.trim() || parsing} onPress={parse}>
              {parsing ? <><Icon name="refresh" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Parsing intent…</> : <>Parse intent <Icon name="chevR" size={15} /></>}
            </Button>
          </div>
        </div>
      )}

      {/* STEP 1 — review: parsed intent + PTB + guardian */}
      {step === 1 && (
        <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* D3: Worker parse when configured; local preview is read-only fallback. */}
          {livePreview?.status === 'ok' && (
            <div className="card" style={{ padding: 18, borderColor: 'var(--accent)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--accent)' }}><Icon name="link" size={16} /></span>
                  <div className="card-title">{livePreviewSource === 'Worker' ? 'On-chain parse · Worker' : 'Local preview'}</div>
                </div>
                <span className="badge badge-accent"><span className="dot pulse"></span>{livePreviewSource === 'Worker' ? 'worker · testnet' : 'fallback · no worker'}</span>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)', wordBreak: 'break-all', marginBottom: 10 }}>
                strategy_hash {livePreview.strategy_hash}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {livePreview.ptb_preview.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, color: 'var(--t1)' }}><span style={{ color: 'var(--accent)', marginRight: 6 }}>↳</span>{l}</div>
                ))}
              </div>
              {livePreview.guardian_warnings?.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {livePreview.guardian_warnings.map((g, i) => (
                    <span key={i} className={`badge badge-${g.level === 'fail' ? 'danger' : g.level === 'warn' ? 'warn' : 'safe'}`} style={{ fontSize: 10 }}>
                      <span className="dot"></span>{g.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {livePreview?.status === 'error' && (
            <div className="card" style={{ padding: 14, borderColor: 'rgba(255,84,112,0.4)' }}>
              <span className="badge badge-danger" style={{ fontSize: 10 }}>worker parse: {livePreview.code}</span>
              <span style={{ fontSize: 12, color: 'var(--t1)', marginLeft: 10 }}>{livePreview.message}</span>
            </div>
          )}
          <div className="card" style={{ padding: 22 }}>
            <div className="badge badge-accent" style={{ marginBottom: 12 }}><Icon name="sparkles" size={12} /> Interpreted intent</div>
            <h2 className="display" style={{ fontSize: 18, fontWeight: 600 }}>{P.intent}</h2>
            <p style={{ color: 'var(--t1)', fontSize: 13.5, marginTop: 6, lineHeight: 1.55 }}>{P.summary}</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginTop: 18 }}>
              {P.params.map(pp => (
                <div key={pp.k} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '11px 13px' }}>
                  <div className="eyebrow" style={{ fontSize: 9.5 }}>{pp.k}</div>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 600, marginTop: 5 }}>{pp.v}</div>
                </div>
              ))}
            </div>
          </div>

          {BT && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="card-hd" style={{ paddingBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--safe)' }}><Icon name="spark" size={16} /></span>
                  <div className="card-title">30-day backtest</div>
                </div>
                <span className={`badge ${btLive ? 'badge-accent' : 'badge-neutral'}`} style={{ fontSize: 9.5 }}>{btLive ? 'real · DeepBook mainnet' : 'simulated · last 30d'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, padding: '4px 18px 18px', alignItems: 'center' }}>
                <div style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '12px 14px' }}>
                  <Sparkline data={BT.curve} w={172} h={56} color="var(--safe)" />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>−30d</span>
                    <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>today</span>
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', gap: 22, marginBottom: 12 }}>
                    {BT.stats.map(s => (
                      <div key={s.k}>
                        <div className="mono display" style={{ fontSize: 18, fontWeight: 600, color: s.v.startsWith('+') ? 'var(--safe)' : 'var(--t0)' }}>{s.v}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 2 }}>{s.k}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.5 }}>{BT.verdict}</div>
                  {btLive && <div style={{ fontSize: 10.5, color: 'var(--t3)', marginTop: 8 }}>Simulated on real SUI/USDC daily prices from DeepBook mainnet using your parsed threshold + budget. Past performance is not indicative of future results.</div>}
                </div>
              </div>
            </div>
          )}

          <div className="rg-2col" style={{ alignItems: 'start' }}>
            {/* PTB preview */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-hd" style={{ paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--sui)' }}><Icon name="grid" size={16} /></span>
                  <div className="card-title">Transaction preview</div>
                </div>
                <span className="badge badge-sui">PTB · human-readable</span>
              </div>
              <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {P.ptb.map((op, i) => (
                  <div key={i} style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>#{i+1}</span>
                      <span className="badge badge-neutral" style={{ fontSize: 9.5, padding: '2px 7px' }}>{op.op}</span>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--sui)', fontWeight: 600 }}>{op.fn}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 11, color: 'var(--t1)', marginTop: 6, wordBreak: 'break-all' }}>{op.args}</div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 4, fontStyle: 'italic' }}>↳ {op.note}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* guardian */}
            <div className="card">
              <div className="card-hd" style={{ paddingBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: blocked ? 'var(--danger)' : 'var(--accent)' }}><Icon name="shield" size={16} /></span>
                  <div className="card-title">Guardian risk check</div>
                </div>
                {blocked
                  ? <span className="badge badge-danger"><span className="dot"></span>{failCount} blocking</span>
                  : <span className="badge badge-warn"><span className="dot"></span>1 to review</span>}
              </div>
              <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 9 }}>
                {P.guardian.map((g, i) => <GuardianRow key={i} g={g} />)}
              </div>
            </div>
          </div>

          {blocked && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 'var(--r-lg)',
              background: 'var(--danger-dim)', border: '1px solid rgba(255,84,112,0.4)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--danger)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="shield" size={19} stroke={2.2} />
              </div>
              <div style={{ flex: 1 }}>
                <div className="display" style={{ fontWeight: 600, fontSize: 14, color: 'var(--danger)' }}>Guardian blocked this strategy</div>
                <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 1 }}>{failCount} critical risks must be resolved before a Policy Object can be created. The agent will never deploy an unsafe intent.</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button className="rg-btn-2" onPress={() => setStep(0)} startContent={<Icon name="chevL" size={15} />}>Edit intent</Button>
            {blocked
              ? <Button isDisabled className="opacity-50"><Icon name="x" size={15} /> Blocked by Guardian</Button>
              : <Button className="bg-accent text-accent-foreground font-semibold" onPress={() => setStep(2)}>Configure policy <Icon name="chevR" size={15} /></Button>}
          </div>
        </div>
      )}

      {/* STEP 2 — policy config */}
      {step === 2 && (
        <div className="fade-up card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <span style={{ color: 'var(--accent)' }}><Icon name="shield" size={18} /></span>
            <h2 className="display" style={{ fontSize: 19, fontWeight: 600 }}>Move Policy Object</h2>
          </div>
          <p style={{ color: 'var(--t1)', fontSize: 13.5, marginBottom: 20 }}>
            This on-chain object is the agent's leash. It can <strong style={{ color: 'var(--t0)' }}>never</strong> exceed these limits — enforced by Move, not by trust. You can revoke it any time.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Budget ceiling</label>
                <span className="mono" style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>{budget} USDC</span>
              </div>
              <Slider value={budget} onChange={setBudget} minValue={100} maxValue={2000} step={50} className="w-full">
                <Slider.Track><Slider.Fill className="bg-accent" /><Slider.Thumb /></Slider.Track>
              </Slider>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 6 }}>Hard cap on total spend. The agent self-checks remaining budget before every order.</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Max slippage</label>
                  <span className="mono" style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>{slip.toFixed(1)}%</span>
                </div>
                <Slider value={slip} onChange={setSlip} minValue={0.2} maxValue={3} step={0.1} className="w-full">
                  <Slider.Track><Slider.Fill className="bg-accent" /><Slider.Thumb /></Slider.Track>
                </Slider>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>Expires in</label>
                  <span className="mono" style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>{expiry} days</span>
                </div>
                <Slider value={expiry} onChange={setExpiry} minValue={1} maxValue={30} step={1} className="w-full">
                  <Slider.Track><Slider.Fill className="bg-accent" /><Slider.Thumb /></Slider.Track>
                </Slider>
              </div>
            </div>

            <div>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Allowed markets &amp; venues</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {Array.from(new Set([meta.scope, 'SUI/USDC', 'DEEP/USDC', 'WAL/USDC'])).map((v) => {
                  const on = v === meta.scope
                  return (
                    <div key={v} className={`badge ${on ? 'badge-accent' : 'badge-neutral'}`} style={{ padding: '8px 12px', fontSize: 12 }}>
                      {on && <Icon name="check" size={12} stroke={2.6} />}{v}
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 8 }}>Scope locks the agent to these markets only. Anything else is rejected on-chain.</div>
            </div>

            {/* Builder v2 — advanced, strategy-aware controls */}
            {(adv.leverage || adv.ltv || adv.flip || adv.twoLeg) && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ color: 'var(--accent)' }}><Icon name="settings" size={15} /></span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Advanced limits</span>
                  <span className="badge badge-neutral" style={{ fontSize: 9 }}>{meta.strategy}</span>
                </div>
                {adv.twoLeg && (
                  <div style={{ marginBottom: 18 }}>
                    <LegBuilder scenario={scenario} budget={budget} leverage={leverage} legs={legs} setLegs={setLegs} />
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                  {adv.leverage && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <label style={{ fontSize: 13, fontWeight: 600 }}>Max leverage</label>
                        <span className="mono" style={{ fontSize: 14, color: leverage > 4 ? 'var(--warn)' : 'var(--accent)', fontWeight: 600 }}>{leverage.toFixed(1)}×</span>
                      </div>
                      <input type="range" min="1" max="8" step="0.5" value={leverage} onChange={e => setLeverage(+e.target.value)} className="rg-slider" />
                      <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 6 }}>Caps notional per leg. Higher leverage tightens the liquidation buffer.</div>
                    </div>
                  )}
                  {adv.leverage && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <label style={{ fontSize: 13, fontWeight: 600 }}>Min liquidation buffer</label>
                        <span className="mono" style={{ fontSize: 14, color: liqBuffer < 15 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>{liqBuffer}%</span>
                      </div>
                      <input type="range" min="5" max="50" step="1" value={liqBuffer} onChange={e => setLiqBuffer(+e.target.value)} className="rg-slider" />
                      <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 6 }}>Agent deleverages a leg before its margin gets this close to liquidation.</div>
                    </div>
                  )}
                  {adv.ltv && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <label style={{ fontSize: 13, fontWeight: 600 }}>Max LTV</label>
                        <span className="mono" style={{ fontSize: 14, color: liqBuffer > 70 ? 'var(--warn)' : 'var(--accent)', fontWeight: 600 }}>{liqBuffer}%</span>
                      </div>
                      <input type="range" min="20" max="85" step="1" value={liqBuffer} onChange={e => setLiqBuffer(+e.target.value)} className="rg-slider" />
                      <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 6 }}>Loan-to-value ceiling if the optimizer ever borrows to loop. Supply-only by default.</div>
                    </div>
                  )}
                  {adv.flip && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <label style={{ fontSize: 13, fontWeight: 600 }}>Unwind if net carry below</label>
                        <span className="mono" style={{ fontSize: 14, color: 'var(--accent)', fontWeight: 600 }}>{flipThresh > 0 ? '+' : ''}{flipThresh}% APR</span>
                      </div>
                      <input type="range" min="-5" max="8" step="0.5" value={flipThresh} onChange={e => setFlipThresh(+e.target.value)} className="rg-slider" />
                      <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 6 }}>Funding-flip guard — closes both legs if the spread decays past this floor.</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Manual approval toggle — every strategy */}
            <div onClick={() => setRequireApproval(v => !v)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 13,
              padding: '14px 16px', borderRadius: 'var(--r-md)', border: `1.5px solid ${requireApproval ? 'var(--accent)' : 'var(--border)'}`,
              background: requireApproval ? 'var(--accent-dim)' : 'var(--glass)', transition: 'all .15s' }}>
              <div style={{ width: 40, height: 24, borderRadius: 100, flexShrink: 0, padding: 3, background: requireApproval ? 'var(--accent)' : 'var(--bg-0)', transition: 'background .15s' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: requireApproval ? '#06231f' : 'var(--t2)', transform: requireApproval ? 'translateX(16px)' : 'none', transition: 'transform .15s' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Require my approval before each execution</div>
                <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>
                  {requireApproval ? 'Agent stages every order and waits for your sign-off — fully supervised.' : 'Agent executes autonomously within these limits — set-and-forget.'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26 }}>
            <Button className="rg-btn-2" onPress={() => setStep(1)} startContent={<Icon name="chevL" size={15} />}>Back</Button>
            <Button className="bg-accent text-accent-foreground font-semibold" onPress={() => setStep(3)}>Choose run mode <Icon name="chevR" size={15} /></Button>
          </div>
        </div>
      )}

      {/* STEP 3 — mode + deploy */}
      {step === 3 && (
        <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card" style={{ padding: 24 }}>
            <h2 className="display" style={{ fontSize: 19, fontWeight: 600, marginBottom: 4 }}>Where should the agent run?</h2>
            <p style={{ color: 'var(--t1)', fontSize: 13.5, marginBottom: 18 }}>Both modes enforce the same on-chain policy. Choose where the decision logic lives.</p>
            <div className="rg-2col">
              {[
                { id: 'local', icon: 'cpu', t: 'Local-first', s: 'Your own LLM (Ollama / Claude Desktop). Decision logic never leaves your machine — maximum privacy.', tags: ['private', 'BYO LLM'] },
                { id: 'cloud', icon: 'cloud', t: 'Cloud', s: 'Cloudflare Worker + Durable Objects keep watching 24/7, even when your laptop is closed.', tags: ['always-on', 'zero-setup'] },
              ].map(m => (
                <div key={m.id} onClick={() => setMode(m.id)} style={{ cursor: 'pointer', padding: 18, borderRadius: 'var(--r-lg)',
                  background: mode === m.id ? 'var(--accent-dim)' : 'var(--glass)', border: `1.5px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
                  transition: 'all .16s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 10, background: mode === m.id ? 'var(--accent)' : 'var(--glass-hi)',
                      color: mode === m.id ? '#06231f' : 'var(--t1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={m.icon} size={20} />
                    </div>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${mode === m.id ? 'var(--accent)' : 'var(--border-hi)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {mode === m.id && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />}
                    </div>
                  </div>
                  <div className="display" style={{ fontWeight: 600, fontSize: 16, marginTop: 14 }}>{m.t}</div>
                  <p style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 6, lineHeight: 1.5 }}>{m.s}</p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    {m.tags.map(t => <span key={t} className="badge badge-neutral" style={{ fontSize: 10 }}>{t}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 38, height: 38, borderRadius: 10, background: requireApproval ? 'var(--warn-dim)' : 'var(--sui-dim)', color: requireApproval ? 'var(--warn)' : 'var(--sui)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={requireApproval ? 'eye' : 'link'} size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{readOnlyPreview ? 'Read-only Worker preview' : requireApproval ? 'Supervised — you approve each execution' : 'One signature creates the Policy Object'}</div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>
                  {readOnlyPreview
                    ? 'The parsed intent, PTB preview and Guardian output came from the live Worker. Connect a Sui wallet only when you want to sign and deploy.'
                    : requireApproval
                      ? 'The agent stages orders; nothing executes without your sign-off.'
                      : 'After this, the agent acts autonomously within limits — no more signing.'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button className="rg-btn-2" onPress={() => setStep(2)} startContent={<Icon name="chevL" size={15} />}>Back</Button>
            <Button className="bg-accent text-accent-foreground font-semibold" onPress={() => onDone({ ...meta, budget, slip, expiry, leverage: adv.leverage ? leverage : null, liqBuffer: (adv.leverage || adv.ltv) ? liqBuffer : null, requireApproval, legs: adv.twoLeg ? legs : null }, text)}><Icon name="shield" size={15} /> {readOnlyPreview ? 'Preview only · connect wallet' : 'Sign & deploy policy'}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
