/* ===========================================================
   RescueGrid — state controller. Owns all app state + hooks
   (must sit under the dapp-kit providers), publishes them via
   AppCtx, and renders the TanStack Router shell when authed.
   The shell/pages live in router.jsx + components/.
   =========================================================== */
import { useState, useEffect, useRef } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useCurrentAccount, useCurrentWallet, useSuiClient, useSignAndExecuteTransaction, useDisconnectWallet } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { RG } from './data.js'
import deployment from '../core/deployment.js'
import {
  WORKER_CONFIGURED, parseIntent, buildPolicyTx, activatePolicy, buildRevokeTx,
  listPolicies, listActivity, getSummary, getMarket, getBalances,
} from './api.js'
import { hexToRgba } from './components/primitives.jsx'
import { ZkLogin } from './components/ZkLogin.jsx'
import { useTweaks } from './components/TweaksPanel.jsx'
import { AppCtx } from './app-context.jsx'
import { router } from './router.jsx'

const BASE_SPARK = [4.61,4.58,4.55,4.59,4.52,4.48,4.51,4.44,4.40,4.43,4.38,4.31,4.27,4.30,4.24,4.19,4.182]
const CRASH_TAIL = [4.10,3.96,3.84,3.71,3.79]

const TWEAK_DEFAULTS = {
  accent: '#2EE6CE',
  theme: 'dark',
  crashSeverity: 'severe',
  liveJitter: true,
}

// blend a hex toward another hex by t (0..1) — deepens accent for light mode
function mixHex(hex, toward, t) {
  const p = h => { const x = h.replace('#', ''); const n = parseInt(x.length === 3 ? x.split('').map(c => c + c).join('') : x, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const a = p(hex), b = p(toward)
  const m = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${m[0]}, ${m[1]}, ${m[2]})`
}

const go = (to) => router.navigate({ to })

export default function App({ onExit }) {
  const [authed, setAuthed] = useState(false)
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS)
  const [inspect, setInspect] = useState(null)
  const [txView, setTxView] = useState(null)
  const [seed, setSeed] = useState(null)
  const [liveId, setLiveId] = useState(null)
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

  // apply accent + theme to CSS vars
  useEffect(() => {
    const root = document.documentElement
    const light = t.theme === 'light'
    root.dataset.theme = light ? 'light' : 'dark'
    const acc = light ? mixHex(t.accent, '#05201c', 0.5) : t.accent
    root.style.setProperty('--accent', acc)
    root.style.setProperty('--accent-dim', hexToRgba(t.accent, light ? 0.16 : 0.14))
    root.style.setProperty('--accent-glow', hexToRgba(t.accent, light ? 0.32 : 0.45))
  }, [t.accent, t.theme])

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
    go('/')
    setCrashState('crashing')
    const severe = t.crashSeverity === 'severe'
    const rk = severe ? 5 : 2.6
    const pr = severe ? 0.09 : 0.05
    let step = 0
    const ramp = setInterval(() => {
      step++
      setRisk(38 + step * rk)
      setSuiPrice(+(4.182 - step * pr).toFixed(3))
      if (step >= 9) clearInterval(ramp)
    }, 240)
    timers.current.push(ramp)
    after(900, () => setSuiSpark([...BASE_SPARK, ...CRASH_TAIL.slice(0, 3)]))

    after(2600, () => {
      setCrashState('rescuing')
      setRisk(severe ? 70 : 54)
      setSuiSpark([...BASE_SPARK, ...CRASH_TAIL])
    })
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

  const togglePolicy = (p) => {
    setPolicies(ps => ps.map(x => x.id === p.id ? { ...x, status: x.status === 'active' ? 'paused' : 'active' } : x))
    showToast(p.status === 'active' ? 'Strategy paused — agent holds, no new actions' : 'Strategy resumed — agent active within policy', p.status === 'active' ? 'var(--warn)' : 'var(--accent)')
  }

  const rebalanceNow = (p) => {
    setActivity(a => [{ t: '14:40:11', date: 'Today', kind: 'rebalance', policy: p.name, title: 'Manual rebalance triggered', detail: 'Owner requested re-centering · agent restored target exposure within policy limits.', amount: 0, tx: '0x' + Math.random().toString(16).slice(2, 6) + '…' + Math.random().toString(16).slice(2, 6), risk: null, mode: p.mode }, ...a])
    showToast('Rebalance executed — exposure restored within policy', 'var(--accent)')
    pushNotif('rebalance', `Rebalanced · ${p.name}`)
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
      go('/policies')
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
    go('/policies')
  }

  const logout = () => { if (account) disconnect(); setAuthed(false); onExit && onExit() }

  const shownActivity = liveReadsEnabled ? liveActivity : activity
  const state = { risk, suiPrice, suiSpark, crashState, mode, agentOn, activity: shownActivity }

  if (!authed) return (
    <>
      <div className="app-bg"></div>
      <ZkLogin onAuth={() => setAuthed(true)} onBackToLanding={onExit} />
    </>
  )

  const ctx = {
    // tweaks / theme
    t, setTweak,
    // agent + mode
    mode, setMode, agentOn, setAgentOn, halted, crashState, suiPrice,
    // identity / live mode
    account, currentWallet, owner, ownerShort, readOnlyLiveMode, liveReadsEnabled, liveReadMeta, disconnect, logout, onExit,
    // notifications + toast
    notifs, setNotifs, notifOpen, setNotifOpen, unread, toast, showToast,
    // drawers
    inspect, setInspect, txView, setTxView, runtimeOpen, runtimeMode, setRuntimeOpen, setRuntimeMode,
    // data
    state, policies, shownActivity, liveSummary, liveMarket, liveActivity, liveHoldings, liveFunding, liveLoading,
    liveFeed, setLiveFeed, seed, setSeed, liveId, setLiveId,
    // actions
    simulateCrash, resetDemo, resumeAgents, emergencyStop, handleRevoke, togglePolicy, rebalanceNow, deployPolicy,
  }

  return (
    <AppCtx.Provider value={ctx}>
      <RouterProvider router={router} />
    </AppCtx.Provider>
  )
}
