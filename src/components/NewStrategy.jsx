/* ===========================================================
   RescueGrid — New Strategy flow (intent → policy)
   =========================================================== */
import { useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit'
import { RG } from '../data.js'
import { Icon, Sparkline } from './primitives.jsx'
import { Slider } from '@heroui/react'
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

export function NewStrategy({ onDone, mode, setMode }) {
  const [step, setStep] = useState(0)
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [scenario, setScenario] = useState('safe')
  const [budget, setBudget] = useState(500)
  const [slip, setSlip] = useState(1.2)
  const [expiry, setExpiry] = useState(14)
  const [livePreview, setLivePreview] = useState(null)
  const [livePreviewSource, setLivePreviewSource] = useState(null)
  const [liveBacktest, setLiveBacktest] = useState(null)
  const account = useCurrentAccount()
  const workerPreview = WORKER_CONFIGURED
  const live = !!account || workerPreview
  const readOnlyPreview = !account && workerPreview
  const previewOwner = account?.address || deployment.agent.address
  const steps = ['Intent', 'Review', 'Policy', 'Deploy']
  const PARSED = { safe: RG.parsed, dca: RG.parsedDCA, hedge: RG.parsedHedge, risky: RG.parsedRisky }
  const P = PARSED[scenario]
  const meta = P.meta || RG.parsed.meta
  const blocked = P.guardian.some(g => g.level === 'fail')
  const failCount = P.guardian.filter(g => g.level === 'fail').length
  const BT = (live && liveBacktest) ? liveBacktest : P.backtest
  const btLive = !!(live && liveBacktest)

  const classify = (s) => {
    if (/entire|all-?in|ignore slippage|everything|max leverage|20x/i.test(s)) return 'risky'
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
              <button key={ex} onClick={() => setText(ex)}
                style={{ background: 'var(--glass-2)', border: '1px solid var(--border)', borderRadius: 100, color: 'var(--t1)',
                  fontSize: 12, padding: '7px 13px', cursor: 'pointer', fontFamily: 'var(--f-body)' }}>
                <span style={{ color: 'var(--accent)', marginRight: 6 }}>＋</span>{ex}
              </button>
            ))}
            <button onClick={() => setText(RG.riskyExample)}
              style={{ background: 'var(--danger-dim)', border: '1px solid rgba(255,84,112,0.35)', borderRadius: 100, color: 'var(--danger)',
                fontSize: 12, padding: '7px 13px', cursor: 'pointer', fontFamily: 'var(--f-body)' }}>
              <span style={{ marginRight: 6 }}>⚠</span>Try a risky one (Guardian blocks it)
            </button>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 22 }}>
            <button className="btn btn-primary" disabled={!text.trim() || parsing} onClick={parse}>
              {parsing ? <><Icon name="refresh" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Parsing intent…</> : <>Parse intent <Icon name="chevR" size={15} /></>}
            </button>
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
            <button className="btn btn-ghost" onClick={() => setStep(0)}><Icon name="chevL" size={15} /> Edit intent</button>
            {blocked
              ? <button className="btn" disabled style={{ opacity: .5 }}><Icon name="x" size={15} /> Blocked by Guardian</button>
              : <button className="btn btn-primary" onClick={() => setStep(2)}>Configure policy <Icon name="chevR" size={15} /></button>}
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
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Allowed Deepbook venues</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {['SUI/USDC', 'DEEP/USDC', 'WAL/USDC'].map((v) => {
                  const on = v === meta.scope
                  return (
                    <div key={v} className={`badge ${on ? 'badge-accent' : 'badge-neutral'}`} style={{ padding: '8px 12px', fontSize: 12 }}>
                      {on && <Icon name="check" size={12} stroke={2.6} />}{v}
                    </div>
                  )
                })}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 8 }}>Scope locks the agent to these pools only. Anything else is rejected on-chain.</div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 26 }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)}><Icon name="chevL" size={15} /> Back</button>
            <button className="btn btn-primary" onClick={() => setStep(3)}>Choose run mode <Icon name="chevR" size={15} /></button>
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
              <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--sui-dim)', color: 'var(--sui)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="link" size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{readOnlyPreview ? 'Read-only Worker preview' : 'One signature creates the Policy Object'}</div>
                <div style={{ fontSize: 12, color: 'var(--t2)' }}>
                  {readOnlyPreview
                    ? 'The parsed intent, PTB preview and Guardian output came from the live Worker. Connect a Sui wallet only when you want to sign and deploy.'
                    : 'After this, the agent acts autonomously within limits — no more signing.'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setStep(2)}><Icon name="chevL" size={15} /> Back</button>
            <button className="btn btn-primary" onClick={() => onDone(meta, text)}><Icon name="shield" size={15} /> {readOnlyPreview ? 'Preview only · connect wallet' : 'Sign & deploy policy'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
