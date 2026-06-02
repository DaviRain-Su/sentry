/* ===========================================================
   RescueGrid — app shell, navigation, crash orchestration
   =========================================================== */
import { useState, useEffect, useRef } from 'react'
import { useCurrentAccount, useCurrentWallet, useSuiClient, useSignAndExecuteTransaction, useDisconnectWallet } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { RG } from './data.js'
import deployment from '../core/deployment.js'
import {
  WORKER_CONFIGURED,
  parseIntent,
  buildPolicyTx,
  activatePolicy,
  buildRevokeTx,
  listPolicies,
  listActivity,
  getSummary,
  getMarket,
  getBalances,
} from './api.js'
import { Icon, Logo, Token, hexToRgba } from './components/primitives.jsx'
import { ZkLogin } from './components/ZkLogin.jsx'
import { Dashboard } from './components/Dashboard.jsx'
import { NewStrategy } from './components/NewStrategy.jsx'
import { ActivityView, PoliciesView } from './components/Views.jsx'
import { Profile } from './components/Profile.jsx'
import { PolicyInspect, TxDrawer } from './components/Detail.jsx'
import { MarketsView } from './components/Markets.jsx'
import { RiskCenter } from './components/Risk.jsx'
import { StrategyMarketplace, StrategyDetail } from './components/Marketplace.jsx'
import { AgentRuntimeDrawer } from './components/MarketDrawers.jsx'
import { useTweaks, TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle } from './components/TweaksPanel.jsx'
import { Button } from '@heroui/react'

const BASE_SPARK = [4.61,4.58,4.55,4.59,4.52,4.48,4.51,4.44,4.40,4.43,4.38,4.31,4.27,4.30,4.24,4.19,4.182]
const CRASH_TAIL = [4.10,3.96,3.84,3.71,3.79]

const TWEAK_DEFAULTS = {
  accent: '#2EE6CE',
  crashSeverity: 'severe',
  liveJitter: true,
}

function NavItem({ icon, label, active, onClick, badge }) {
  return (
    <button onClick={onClick} className="rg-navitem" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 13px',
      borderRadius: 'var(--r-md)', border: 'none', cursor: 'pointer', textAlign: 'left', position: 'relative',
      background: active ? 'var(--glass-hi)' : 'transparent', color: active ? 'var(--t0)' : 'var(--t1)',
      fontFamily: 'var(--f-body)', fontSize: 13.5, fontWeight: active ? 600 : 500, transition: 'all .14s' }}>
      {active && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />}
      <span style={{ color: active ? 'var(--accent)' : 'var(--t2)' }}><Icon name={icon} size={18} /></span>
      <span className="rg-navlabel" style={{ flex: 1 }}>{label}</span>
      {badge != null && <span className="badge badge-accent" style={{ fontSize: 9.5, padding: '2px 7px' }}>{badge}</span>}
    </button>
  )
}

export default function App({ onExit }) {
  const [authed, setAuthed] = useState(false)
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS)
  const [view, setView] = useState('dashboard')
  const [inspect, setInspect] = useState(null)
  const [txView, setTxView] = useState(null)
  const [seed, setSeed] = useState(null)
  const [stratId, setStratId] = useState(null)
  const [liveFeed, setLiveFeed] = useState(false)
  const [runtimeOpen, setRuntimeOpen] = useState(false)
  const [runtimeMode, setRuntimeMode] = useState(null)
  const [mode, setMode] = useState('cloud')
  const [agentOn, setAgentOn] = useState(true)
  const [crashState, setCrashState] = useState('idle')
  const [risk, setRisk] = useState(38)
  const [suiPrice, setSuiPrice] = useState(4.182)
  const [suiSpark, setSuiSpark] = useState(BASE_SPARK)
  const [activity, setActivity] = useState(RG.activity)
  const [policies, setPolicies] = useState(RG.policies)
  const [toast, setToast] = useState(null)
  const [halted, setHalted] = useState(false)
  const [notifs, setNotifs] = useState(RG.notifications)
  const [notifOpen, setNotifOpen] = useState(false)
  const prevStatuses = useRef(null)
  const timers = useRef([])
  const notifId = useRef(100)

  // Live mode: connected Sui account. Reads are Worker-first with direct-chain
  // fallback; writes require Worker-built transactions.
  const account = useCurrentAccount()
  const { currentWallet } = useCurrentWallet()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExec } = useSignAndExecuteTransaction()
  const { mutate: disconnect } = useDisconnectWallet()
  const liveMode = !!account
  const readOnlyLiveMode = !account && WORKER_CONFIGURED
  const liveReadsEnabled = liveMode || readOnlyLiveMode
  const owner = account?.address || (readOnlyLiveMode ? deployment.agent.address : RG.user.addr)
  const ownerShort = account
    ? owner.slice(0, 6) + '…' + owner.slice(-4)
    : readOnlyLiveMode
      ? `agent ${owner.slice(0, 6)}…${owner.slice(-4)}`
      : RG.user.handle

  // apply accent tweak to CSS vars
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--accent', t.accent)
    root.style.setProperty('--accent-dim', hexToRgba(t.accent, 0.14))
    root.style.setProperty('--accent-glow', hexToRgba(t.accent, 0.45))
  }, [t.accent])

  // gentle live jitter when idle
  useEffect(() => {
    if (crashState !== 'idle' || !t.liveJitter) return
    const iv = setInterval(() => {
      setSuiPrice(p => +(4.182 + (Math.random() - 0.5) * 0.012).toFixed(3))
      setRisk(r => Math.max(34, Math.min(42, r + (Math.random() - 0.5) * 1.6)))
    }, 2200)
    return () => clearInterval(iv)
  }, [crashState, t.liveJitter])

  const showToast = (msg, c) => { setToast({ msg, c }); setTimeout(() => setToast(null), 2600) }

  // open the agent runtime drawer from any mode/agent badge (global event)
  useEffect(() => {
    const h = (e) => { setRuntimeMode(e.detail || null); setRuntimeOpen(true) }
    window.addEventListener('rg:runtime', h)
    return () => window.removeEventListener('rg:runtime', h)
  }, [])
  const pushNotif = (kind, title) => setNotifs(n => [{ id: ++notifId.current, kind, title, time: 'now', read: false }, ...n])
  const unread = notifs.filter(n => !n.read).length

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const after = (ms, fn) => timers.current.push(setTimeout(fn, ms))

  const simulateCrash = () => {
    clearTimers()
    setView('dashboard')
    setCrashState('crashing')
    const severe = t.crashSeverity === 'severe'
    const rk = severe ? 5 : 2.6       // risk ramp per step
    const pr = severe ? 0.09 : 0.05   // price drop per step
    // ramp risk + drop price over ~2.4s
    let step = 0
    const ramp = setInterval(() => {
      step++
      setRisk(38 + step * rk)
      setSuiPrice(+(4.182 - step * pr).toFixed(3))
      if (step >= 9) clearInterval(ramp)
    }, 240)
    timers.current.push(ramp)
    after(900, () => setSuiSpark([...BASE_SPARK, ...CRASH_TAIL.slice(0, 3)]))

    // agent decides to rescue
    after(2600, () => {
      setCrashState('rescuing')
      setRisk(severe ? 70 : 54)
      setSuiSpark([...BASE_SPARK, ...CRASH_TAIL])
    })
    // stream rescue executions
    after(3300, () => {
      setActivity(a => [{ t: '14:31:02', date: 'Today', kind: 'monitor', policy: 'SUI Crash Rescue Grid', title: 'Trigger condition met · SUI −8.4%', detail: 'Reference −8% breached. Agent authorized by policy to deploy rescue grid.', amount: 0, tx: null, risk: 82, mode }, ...a])
    })
    after(4200, () => {
      setActivity(a => [{ t: '14:31:05', date: 'Today', kind: 'exec', policy: 'SUI Crash Rescue Grid', title: 'Rung #1 partial fill · 14.3 SUI @ 3.85', detail: 'Book thinned mid-fill (60%) · agent re-quoting remainder on Deepbook', amount: -55.0, tx: '0xe1f4…7c33', risk: 70, mode }, ...a])
      setRisk(64)
    })
    after(4750, () => {
      setActivity(a => [{ t: '14:31:07', date: 'Today', kind: 'retry', policy: 'SUI Crash Rescue Grid', title: 'Rung #1 remainder filled on retry · 9.6 SUI @ 3.86', detail: 'Re-quote succeeded · slippage 0.8% · budget check passed', amount: -37.0, tx: '0x3da9…6b22', risk: 62, mode }, ...a])
      setRisk(60)
    })
    after(5100, () => {
      setActivity(a => [{ t: '14:31:09', date: 'Today', kind: 'exec', policy: 'SUI Crash Rescue Grid', title: 'Bought 24.6 SUI @ 3.74', detail: 'Rescue rung #2 filled on Deepbook · slippage 0.9% · 184 / 500 USDC used', amount: -92.0, tx: '0x9a02…b418', risk: 58, mode }, ...a])
      setRisk(52)
    })
    after(6000, () => {
      setActivity(a => [{ t: '14:31:12', date: 'Today', kind: 'policy', policy: 'SUI Crash Rescue Grid', title: 'Activity logged on-chain', detail: 'Agent execution record committed · 2 fills · 184 USDC spent of 500 cap', amount: 0, tx: '0x55cd…2e19', risk: null, mode }, ...a])
      setCrashState('rescued')
      setRisk(46)
      setSuiPrice(3.79)
      setPolicies(ps => ps.map(p => p.strategy === 'rescue-grid' ? { ...p, budgetUsed: 184, execs: p.execs + 2 } : p))
      showToast('Rescue complete — agent acted within policy, no signature needed', 'var(--safe)')
      pushNotif('exec', 'Rescue complete · 184/500 USDC used, budget intact')
    })
  }

  const resetDemo = () => {
    clearTimers()
    setCrashState('idle'); setRisk(38); setSuiPrice(4.182); setSuiSpark(BASE_SPARK)
    setActivity(RG.activity); setPolicies(RG.policies)
  }

  // Live policies (D4): load the owner's on-chain policies from PolicyCreated events,
  // enriched with the real current spend/status from the summary.
  const mapLivePolicy = (p, spentUnits = 0, status = 'active') => ({
    id: p.wrapper_id.slice(0, 6) + '…' + p.wrapper_id.slice(-4),
    _wrapperId: p.wrapper_id, _mandateId: p.mandate_id,
    name: 'SUI Crash Rescue Grid', strategy: 'rescue-grid', status: ['active', 'revoked', 'expired', 'paused'].includes(status) ? status : 'paused', mode,
    budgetCap: Number(p.budget_ceiling) / 1e6, budgetUsed: Number(spentUnits) / 1e6,
    scope: ['SUI/USDC'], maxSlippage: p.max_slippage_bps / 100,
    expires: new Date(Number(p.expires_at_ms)).toISOString(), created: '2026-06-02', execs: 0,
    owner: p.owner,
  })
  const [liveActivity, setLiveActivity] = useState([])
  const [liveSummary, setLiveSummary] = useState(null)
  const [liveMarket, setLiveMarket] = useState(null)
  const [liveHoldings, setLiveHoldings] = useState([])
  const [liveFunding, setLiveFunding] = useState(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveReadMeta, setLiveReadMeta] = useState({ source: null, error: null })
  const refreshLivePolicies = async () => {
    if (!liveReadsEnabled) return
    setLiveLoading(true)
    try {
      const [pr, ar, sr, mr, br] = await Promise.all([listPolicies(owner), listActivity(owner), getSummary(owner), getMarket(), getBalances(owner)])
      const results = [pr, ar, sr, mr, br]
      const fallback = results.find(r => r?.source === 'chain_fallback')
      const worker = results.find(r => r?.source === 'worker')
      setLiveReadMeta({ source: fallback ? 'chain_fallback' : worker ? 'worker' : null, error: fallback?.worker_error || null })
      if (sr.status === 'ok') setLiveSummary(sr.summary)
      else setLiveSummary({ active_policies: 0, total_policies: 0, total_authorized: 0, total_deployed: 0, positions: [] })
      if (pr.status === 'ok') {
        // enrich each policy with real spend + chain-derived status; do not hide revoked/terminal policies.
        const pos = {}
        if (sr.status === 'ok') sr.summary.positions.forEach(po => { pos[po.wrapper_id] = po })
        const live = pr.policies
          .map(p => mapLivePolicy(p, pos[p.wrapper_id]?.spent_amount ?? 0, pos[p.wrapper_id]?.status ?? 'active'))
        setPolicies(live)
      } else setPolicies([])
      if (ar.status === 'ok') setLiveActivity(ar.activity)
      else setLiveActivity([])
      if (mr.status === 'ok') setLiveMarket(mr.market)
      if (br.status === 'ok') {
        setLiveHoldings(br.holdings)
        setLiveFunding(br.funding || null)
      } else {
        setLiveHoldings([])
        setLiveFunding(null)
      }
    } catch (e) {
      setPolicies([])
      setLiveActivity([])
      setLiveHoldings([])
      setLiveFunding(null)
      setLiveSummary({ active_policies: 0, total_policies: 0, total_authorized: 0, total_deployed: 0, positions: [] })
      setLiveReadMeta({ source: 'error', error: String(e?.message || e) })
    }
    finally { setLiveLoading(false) }
  }
  useEffect(() => { if (liveReadsEnabled && authed) refreshLivePolicies() }, [liveReadsEnabled, authed, owner])

  const handleRevoke = async (id) => {
    if (liveMode) {
      if (!WORKER_CONFIGURED) { showToast('Revoke needs the Worker — set VITE_WORKER_URL and run it', 'var(--warn)'); return }
      const pol = policies.find(p => p.id === id)
      const wid = pol?._wrapperId || id
      try {
        const built = await buildRevokeTx(owner, wid)
        if (built.status !== 'ok') { showToast(`Revoke build failed: ${built.message || built.code}`, 'var(--danger)'); return }
        await signAndExec({ transaction: Transaction.from(built.tx_json) })
        showToast('Policy revoked on-chain — agent authority deleted', 'var(--danger)')
        pushNotif('policy', 'Policy revoked on-chain')
        setTimeout(() => refreshLivePolicies(), 1500)
      } catch (e) {
        showToast(`Revoke failed: ${String(e?.message || e).slice(0, 80)}`, 'var(--danger)')
      }
      return
    }
    if (readOnlyLiveMode) {
      showToast('Read-only live Worker mode — connect a wallet to revoke on-chain', 'var(--warn)')
      return
    }
    setPolicies(ps => ps.filter(p => p.id !== id))
    showToast('Policy revoked on-chain — agent authority deleted', 'var(--danger)')
    pushNotif('policy', 'Policy revoked on-chain')
  }

  const emergencyStop = () => {
    clearTimers()
    prevStatuses.current = policies.map(p => ({ id: p.id, status: p.status }))
    setHalted(true)
    setAgentOn(false)
    setCrashState('idle')
    setPolicies(ps => ps.map(p => ({ ...p, status: 'paused' })))
    setActivity(a => [{ t: '14:33:00', date: 'Today', kind: 'guardian', policy: 'All policies', title: 'Emergency stop triggered by owner', detail: 'Global circuit breaker engaged · every agent policy frozen on-chain · no further execution permitted', amount: 0, tx: '0xkill…stop', risk: null, mode }, ...a])
    showToast('Emergency stop — all agents frozen on-chain', 'var(--danger)')
    pushNotif('guardian', 'Emergency stop engaged · all agents halted')
  }

  const resumeAgents = () => {
    const prev = prevStatuses.current
    setHalted(false)
    setAgentOn(true)
    setPolicies(ps => ps.map(p => {
      const was = prev && prev.find(x => x.id === p.id)
      return { ...p, status: was ? was.status : 'active' }
    }))
    showToast('Agents resumed — policies restored to prior state', 'var(--accent)')
  }

  // Live create-policy: Worker parse -> Worker builds unsigned create_policy PTB
  // -> wallet signs -> Worker activates the Durable Object runtime.
  const deployLive = async (text, meta) => {
    try {
      const parsed = await parseIntent(owner, text || `When SUI drops more than 8%, deploy a ${meta.budget} USDC rescue grid`)
      if (parsed.status !== 'ok') { showToast(`Parse failed: ${parsed.message || parsed.code}`, 'var(--danger)'); return false }
      const built = await buildPolicyTx(owner, parsed.strategy, parsed.strategy_hash)
      if (built.status !== 'ok') { showToast(`Build failed: ${built.message || built.code}`, 'var(--danger)'); return false }
      const signed = await signAndExec({ transaction: Transaction.from(built.tx_json) })
      const res = await suiClient.waitForTransaction({ digest: signed.digest, options: { showObjectChanges: true, showEvents: true } })
      const ev = (res.events || []).find(e => String(e.type).endsWith('::policy::PolicyCreated'))
      const wrapperId = ev?.parsedJson?.wrapper_id
      if (wrapperId) await activatePolicy(wrapperId).catch(() => {})
      showToast('Policy created on-chain — agent authorized within limits', 'var(--accent)')
      pushNotif('policy', `Policy deployed on-chain · ${meta.name}`)
      setView('policies')
      setTimeout(() => refreshLivePolicies(), 1500)
      return true
    } catch (e) {
      showToast(`On-chain deploy failed: ${String(e?.message || e).slice(0, 80)}`, 'var(--danger)')
      return false
    }
  }

  const deployPolicy = (meta = { name: 'SUI Crash Rescue Grid', strategy: 'rescue-grid', budget: 500, scope: 'SUI/USDC', slip: 1.2 }, text) => {
    if (liveMode) {
      if (!WORKER_CONFIGURED) { showToast('On-chain deploy needs the Worker — set VITE_WORKER_URL and run it', 'var(--warn)'); return }
      deployLive(text, meta); return
    }
    if (readOnlyLiveMode) {
      showToast('Worker preview is read-only — connect a Sui wallet to sign and deploy', 'var(--warn)')
      return
    }
    const np = { id: '0x' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6),
      name: meta.name, strategy: meta.strategy, status: 'active', mode, budgetCap: meta.budget, budgetUsed: 0,
      scope: [meta.scope], maxSlippage: meta.slip, expires: '2026-06-14T00:00:00Z', created: '2026-06-01', execs: 0 }
    setPolicies(ps => [np, ...ps])
    setActivity(a => [{ t: '14:28:40', date: 'Today', kind: 'policy', policy: np.name, title: 'Policy Object created', detail: `Budget ${meta.budget} USDC · scope ${meta.scope} · ${mode} mode · expires Jun 14`, amount: 0, tx: '0x' + Math.random().toString(16).slice(2,6) + '…' + Math.random().toString(16).slice(2,6), risk: null, mode }, ...a])
    showToast('Policy deployed — agent is now autonomous within limits', 'var(--accent)')
    pushNotif('policy', `Policy deployed · ${meta.name}`)
    setView('policies')
  }

  const shownActivity = liveReadsEnabled ? liveActivity : activity
  const state = { risk, suiPrice, suiSpark, crashState, mode, agentOn, activity: shownActivity }

  if (!authed) return (
    <>
      <div className="app-bg"></div>
      <ZkLogin onAuth={() => setAuthed(true)} onBackToLanding={onExit} />
    </>
  )

  const titles = {
    dashboard: { t: 'Command center', s: 'Live portfolio, risk and autonomous agent activity' },
    new: { t: 'New strategy', s: 'Turn natural language into a safe, autonomous agent policy' },
    activity: { t: 'Agent activity', s: 'Every autonomous decision and on-chain execution' },
    markets: { t: 'Markets monitor', s: 'Cross-protocol DeFi yields and perp funding arbitrage' },
    strategies: { t: 'Strategy catalog', s: 'Policy-constrained strategy templates across venues' },
    'strategy-detail': { t: 'Strategy detail', s: 'Thesis, legs, yield and risk decomposition' },
    active: { t: 'Active strategy', s: 'Live position, exposure and execution' },
    risk: { t: 'Risk center', s: 'Global limits, liquidation watch and kill switches' },
    data: { t: 'Data sources', s: 'Where every live feed comes from — and what needs a backend' },
    policies: { t: 'Policies', s: 'The on-chain authority you grant the agent' },
    profile: { t: 'Profile & wallet', s: 'Your identity, balances and agent authorization' },
  }

  return (
    <>
      <div className="app-bg"></div>
      <div style={{ display: 'flex', height: '100vh', position: 'relative', zIndex: 1 }}>
        {/* sidebar */}
        <aside className="rg-sidebar" style={{ width: 'var(--sidebar-w)', flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', padding: '20px 16px', background: 'rgba(8,11,17,0.6)', backdropFilter: 'blur(10px)' }}>
          <div style={{ padding: '0 8px 8px', cursor: 'pointer' }} onClick={onExit}><Logo /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 18 }}>
            <div className="eyebrow" style={{ padding: '0 13px 8px' }}>Workspace</div>
            <NavItem icon="dashboard" label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
            <NavItem icon="activity" label="Agent activity" active={view === 'activity'} onClick={() => setView('activity')} badge={shownActivity.length} />
            <NavItem icon="radar" label="Markets monitor" active={view === 'markets'} onClick={() => setView('markets')} />
            <NavItem icon="grid" label="Strategy catalog" active={view === 'strategies' || view === 'strategy-detail'} onClick={() => setView('strategies')} />
            <NavItem icon="shield" label="Policies" active={view === 'policies'} onClick={() => setView('policies')} />
            <NavItem icon="alert" label="Risk center" active={view === 'risk'} onClick={() => setView('risk')} />
            <NavItem icon="wallet" label="Profile & wallet" active={view === 'profile'} onClick={() => setView('profile')} />
          </div>
          <Button className="mt-[18px] bg-accent text-accent-foreground font-semibold" fullWidth onPress={() => setView('new')}
            startContent={<Icon name="plus" size={16} stroke={2.4} />}>
            <span className="rg-navlabel">New strategy</span>
          </Button>

          <div style={{ flex: 1 }} />

          {/* mode + agent toggle */}
          <div className="card rg-agentcard" style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span className="eyebrow">Agent</span>
              <button onClick={() => setAgentOn(v => !v)} style={{ width: 38, height: 22, borderRadius: 100, border: 'none', cursor: 'pointer', position: 'relative',
                background: agentOn ? 'var(--accent)' : 'var(--glass-hi)', transition: 'all .18s' }}>
                <div style={{ position: 'absolute', top: 2, left: agentOn ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'all .18s' }} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, background: 'var(--bg-0)', borderRadius: 'var(--r-sm)', padding: 4 }}>
              {[{ id: 'local', icon: 'cpu', l: 'Local' }, { id: 'cloud', icon: 'cloud', l: 'Cloud' }].map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '7px 0', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'var(--f-body)', fontSize: 12, fontWeight: 600,
                  background: mode === m.id ? 'var(--glass-hi)' : 'transparent', color: mode === m.id ? 'var(--accent)' : 'var(--t2)', transition: 'all .14s' }}>
                  <Icon name={m.icon} size={14} /> {m.l}
                </button>
              ))}
            </div>
            {/* gas sponsorship note */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8, padding: '9px 10px', borderRadius: 'var(--r-sm)', background: 'var(--glass)' }}>
              <span style={{ color: 'var(--warn)', flexShrink: 0, marginTop: 1 }}><Icon name="bolt" size={14} /></span>
              <div style={{ fontSize: 10.5, lineHeight: 1.45, color: 'var(--t1)' }}>
                Gas is <strong style={{ color: 'var(--t0)' }}>sponsored</strong> — the agent pays fees from a gas station, so it acts without SUI of its own.
              </div>
            </div>
          </div>

          {/* emergency circuit breaker */}
          {halted ? (
            <Button className="mb-3 bg-accent text-accent-foreground font-semibold" fullWidth onPress={resumeAgents}
              startContent={<Icon name="refresh" size={15} />}>
              <span className="rg-navlabel">Resume agents</span>
            </Button>
          ) : (
            <Button className="mb-3 bg-danger text-white font-semibold" fullWidth onPress={emergencyStop}
              startContent={<Icon name="alert" size={15} />}>
              <span className="rg-navlabel">Emergency stop</span>
            </Button>
          )}

          {/* user */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 8px', borderTop: '1px solid var(--border)' }}>
            <div onClick={() => setView('profile')} title="Profile & wallet" style={{ cursor: 'pointer', width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#2EE6CE,#5AA6FF)', color: '#06231f',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: 'var(--f-mono)' }}>{account ? owner.slice(2, 4).toUpperCase() : readOnlyLiveMode ? 'AG' : RG.user.avatar}</div>
            <div className="rg-userblock" onClick={() => setView('profile')} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerShort}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>{account ? 'Sui wallet · testnet' : readOnlyLiveMode ? 'Worker live reads · no signing' : RG.user.provider}</div>
            </div>
            <span style={{ color: 'var(--t2)', cursor: 'pointer' }} onClick={() => { if (account) disconnect(); setAuthed(false); onExit && onExit() }}><Icon name="logout" size={16} /></span>
          </div>
        </aside>

        {/* main */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* topbar */}
          <header style={{ height: 'var(--topbar-h)', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex',
            alignItems: 'center', padding: '0 26px', gap: 20, background: 'rgba(8,11,17,0.5)', backdropFilter: 'blur(10px)' }}>
            <div style={{ flex: 1 }}>
              <h1 className="display" style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{titles[view].t}</h1>
              <div className="rg-subtitle" style={{ fontSize: 11.5, color: 'var(--t2)' }}>{titles[view].s}</div>
            </div>

            {/* price ticker */}
            <div className="rg-ticker" style={{ display: 'flex', alignItems: 'center', gap: 16, paddingRight: 20, borderRight: '1px solid var(--border)' }}>
              {['SUI', 'DEEP'].map(s => {
                const pr = RG.prices[s]
                const isSui = s === 'SUI'
                const price = isSui ? suiPrice : pr.usd
                const chg = isSui && crashState !== 'idle' ? -8.42 : pr.chg
                return (
                  <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <Token sym={s} size={20} />
                    <div>
                      <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>${isSui ? price.toFixed(3) : price}</div>
                      <div className="mono" style={{ fontSize: 10, fontWeight: 600, color: chg < 0 ? 'var(--danger)' : 'var(--safe)' }}>{chg > 0 ? '+' : ''}{chg}%</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* notifications */}
            <div style={{ position: 'relative' }}>
              <Button isIconOnly variant="light" aria-label="Notifications" className="relative rg-btn-ghost"
                onPress={() => { setNotifOpen(o => !o); if (!notifOpen) setNotifs(n => n.map(x => ({ ...x, read: true }))) }}>
                <Icon name="alert" size={17} />
                {unread > 0 && <span style={{ position: 'absolute', top: 3, right: 3, minWidth: 15, height: 15, padding: '0 4px', borderRadius: 100,
                  background: 'var(--danger)', color: '#fff', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--f-mono)' }}>{unread}</span>}
              </Button>
              {notifOpen && (
                <>
                  <div onClick={() => setNotifOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
                  <div className="card fade-up" style={{ position: 'absolute', top: 44, right: 0, width: 320, zIndex: 61, padding: 0, overflow: 'hidden', boxShadow: '0 20px 50px -16px rgba(0,0,0,0.6)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                      <span className="card-title">Notifications</span>
                      <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>{notifs.length}</span>
                    </div>
                    <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                      {notifs.map(n => {
                        const nm = { exec: ['var(--accent)', 'bolt'], guardian: ['var(--danger)', 'shield'], retry: ['var(--warn)', 'refresh'], policy: ['var(--sui)', 'grid'] }[n.kind] || ['var(--t1)', 'eye']
                        return (
                          <div key={n.id} style={{ display: 'flex', gap: 11, padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
                            <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: hexToRgba(nm[0] === 'var(--t1)' ? '#9DABBA' : ({ 'var(--accent)': t.accent, 'var(--danger)': '#FF5470', 'var(--warn)': '#FFC24B', 'var(--sui)': '#5AA6FF' }[nm[0]] || '#9DABBA'), 0.16), color: nm[0] }}>
                              <Icon name={nm[1]} size={13} /></span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{n.title}</div>
                              <div style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 2 }}>{n.time}</div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* demo controls */}
            {crashState === 'idle' ? (
              <Button size="sm" onPress={simulateCrash} isDisabled={halted}
                className="rg-btn-danger-2"
                startContent={<Icon name="alert" size={14} />}>
                <span className="rg-navlabel">Simulate flash crash</span>
              </Button>
            ) : (
              <Button size="sm" className="rg-btn-2" onPress={resetDemo} startContent={<Icon name="refresh" size={14} />}>
                <span className="rg-navlabel">Reset demo</span>
              </Button>
            )}
          </header>

          {/* scroll body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 60px' }}>
            {liveReadsEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 'var(--r-lg)', marginBottom: 18,
                background: liveReadMeta.source === 'chain_fallback' ? 'var(--warn-dim)' : 'var(--glass)',
                border: `1px solid ${liveReadMeta.source === 'chain_fallback' ? 'rgba(255,194,75,0.35)' : 'var(--border)'}` }}>
                <span style={{ color: liveReadMeta.source === 'chain_fallback' ? 'var(--warn)' : 'var(--accent)', flexShrink: 0 }}><Icon name={liveReadMeta.source === 'chain_fallback' ? 'alert' : 'link'} size={16} /></span>
                <div style={{ flex: 1, fontSize: 12.5, color: 'var(--t1)', lineHeight: 1.45 }}>
                  <strong style={{ color: 'var(--t0)' }}>{liveReadMeta.source === 'chain_fallback' ? 'Direct-chain read-only fallback' : 'Live Worker reads'}</strong>
                  {' '}for {ownerShort}. {readOnlyLiveMode ? 'No wallet signing is required; write actions are disabled until a wallet connects.' : 'Reads come from the configured Worker first.'}
                  {liveReadMeta.error && <span className="mono" style={{ color: 'var(--warn)', marginLeft: 8 }}>worker_error={liveReadMeta.error.slice(0, 90)}</span>}
                </div>
                <span className={`badge ${liveReadMeta.source === 'chain_fallback' ? 'badge-warn' : 'badge-accent'}`} style={{ fontSize: 9.5 }}>
                  <span className="dot"></span>{liveReadMeta.source === 'chain_fallback' ? 'fallback · read-only' : 'worker · testnet'}</span>
              </div>
            )}
            {halted && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderRadius: 'var(--r-lg)', marginBottom: 18,
                background: 'var(--danger-dim)', border: '1px solid rgba(255,84,112,0.45)' }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: 'var(--danger)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="alert" size={20} stroke={2.2} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="display" style={{ fontWeight: 600, fontSize: 14.5, color: 'var(--danger)' }}>Circuit breaker engaged — all agents halted</div>
                  <div style={{ fontSize: 12.5, color: 'var(--t1)', marginTop: 1 }}>Every policy is frozen on-chain. No agent can execute until you resume — your funds and limits are untouched.</div>
                </div>
                <Button size="sm" onPress={resumeAgents}
                  className="rg-btn-2"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}
                  startContent={<Icon name="refresh" size={13} />}>
                  Resume
                </Button>
              </div>
            )}
            {view === 'dashboard' && <Dashboard state={state} live={liveReadsEnabled ? { summary: liveSummary, market: liveMarket, activity: liveActivity } : null} />}
            {view === 'new' && <NewStrategy mode={mode} setMode={setMode} onDone={deployPolicy} />}
            {view === 'activity' && <ActivityView activity={shownActivity} onTx={setTxView} live={liveReadsEnabled} loading={liveReadsEnabled && liveLoading} />}
            {view === 'markets' && <MarketsView onDeploy={(s) => { setSeed(s); setView('new') }} live={liveFeed} onToast={showToast} />}
            {view === 'risk' && <RiskCenter policies={policies} stopped={halted} onEmergencyStop={emergencyStop} onToast={showToast} />}
            {view === 'strategies' && <StrategyMarketplace onDeploy={(s) => { setSeed(s); setView('new') }} onToast={showToast} onOpen={(id) => { setStratId(id); setView('strategy-detail') }} />}
            {view === 'strategy-detail' && <StrategyDetail id={stratId} onBack={() => setView('strategies')} onDeploy={(s) => { setSeed(s); setView('new') }} onToast={showToast} />}
            {view === 'policies' && <PoliciesView policies={policies} onRevoke={handleRevoke} onInspect={setInspect} live={liveReadsEnabled} readOnly={readOnlyLiveMode} loading={liveReadsEnabled && liveLoading} />}
            {view === 'profile' && <Profile
              live={liveReadsEnabled}
              readOnly={readOnlyLiveMode}
              loading={liveReadsEnabled && liveLoading}
              policies={policies}
              holdings={liveReadsEnabled ? liveHoldings : RG.holdings}
              funding={liveReadsEnabled ? liveFunding : null}
              account={liveReadsEnabled ? {
                avatar: account ? owner.slice(2, 4).toUpperCase() : 'AG',
                handle: ownerShort,
                addr: ownerShort,
                fullAddr: owner,
                provider: account ? (currentWallet?.name || 'Sui wallet') : 'RescueGrid Worker',
                network: 'Sui Testnet',
              } : RG.account}
              onNav={setView}
              onToast={(m, c) => showToast(m, c)}
            />}
          </div>
        </main>

        {inspect && <PolicyInspect p={inspect} activity={shownActivity} onClose={() => setInspect(null)} onRevoke={handleRevoke} onTx={setTxView} readOnly={readOnlyLiveMode} />}
        {txView && <TxDrawer tx={txView} onClose={() => setTxView(null)} />}
        {runtimeOpen && <AgentRuntimeDrawer mode={runtimeMode || mode} onClose={() => { setRuntimeOpen(false); setRuntimeMode(null) }} onToast={showToast} />}

        {/* toast */}
        {toast && (
          <div className="fade-up" style={{ position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
            display: 'flex', alignItems: 'center', gap: 11, padding: '13px 20px', borderRadius: 'var(--r-lg)',
            background: 'var(--bg-3)', border: `1px solid ${toast.c}`, boxShadow: `0 12px 40px -10px ${toast.c}80` }}>
            <span style={{ color: toast.c }}><Icon name="check" size={17} stroke={2.4} /></span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{toast.msg}</span>
          </div>
        )}

        <TweaksPanel>
          <TweakSection label="Theme" />
          <TweakColor label="Accent" value={t.accent}
            options={['#2EE6CE', '#5AA6FF', '#A78BFA', '#FFC24B', '#FF7A8A']}
            onChange={(v) => setTweak('accent', v)} />
          <TweakSection label="Demo" />
          <TweakRadio label="Crash severity" value={t.crashSeverity}
            options={['mild', 'severe']}
            onChange={(v) => setTweak('crashSeverity', v)} />
          <TweakToggle label="Live market jitter" value={t.liveJitter}
            onChange={(v) => setTweak('liveJitter', v)} />
        </TweaksPanel>
      </div>
    </>
  )
}
