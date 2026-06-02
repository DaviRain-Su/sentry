/* ===========================================================
   RescueGrid — TanStack Router (SPA). RootLayout is the shell
   (sidebar + topbar + drawers + toast + tweaks) rendering an
   <Outlet/>; each view is a route. All data comes from useApp().
   =========================================================== */
import {
  createRootRoute, createRoute, createRouter,
  Outlet, Link, useNavigate, useRouterState, useParams,
} from '@tanstack/react-router'
import { RG } from './data.js'
import { useApp } from './app-context.jsx'
import { Icon, Logo, Token, hexToRgba } from './components/primitives.jsx'
import { Dashboard } from './components/Dashboard.jsx'
import { NewStrategy } from './components/NewStrategy.jsx'
import { ActivityView, PoliciesView } from './components/Views.jsx'
import { Profile } from './components/Profile.jsx'
import { PolicyInspect, TxDrawer } from './components/Detail.jsx'
import { MarketsView } from './components/Markets.jsx'
import { RiskCenter } from './components/Risk.jsx'
import { StrategyMarketplace, StrategyDetail } from './components/Marketplace.jsx'
import { DataSources } from './components/DataSources.jsx'
import { ActiveStrategy } from './components/Active.jsx'
import { AgentRuntimeDrawer } from './components/MarketDrawers.jsx'
import { TweaksPanel, TweakSection, TweakColor, TweakRadio, TweakToggle } from './components/TweaksPanel.jsx'
import { Button } from '@heroui/react'

const TITLES = {
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
function titleFor(pathname) {
  if (pathname === '/') return TITLES.dashboard
  if (pathname.startsWith('/strategy/')) return TITLES['strategy-detail']
  if (pathname.startsWith('/active')) return TITLES.active
  const key = { '/new': 'new', '/activity': 'activity', '/markets': 'markets', '/strategies': 'strategies', '/risk': 'risk', '/data': 'data', '/policies': 'policies', '/profile': 'profile' }[pathname]
  return TITLES[key] || TITLES.dashboard
}

const NAV = [
  { to: '/', icon: 'dashboard', label: 'Dashboard' },
  { to: '/activity', icon: 'activity', label: 'Agent activity', badge: true },
  { to: '/markets', icon: 'radar', label: 'Markets monitor' },
  { to: '/strategies', icon: 'grid', label: 'Strategy catalog' },
  { to: '/policies', icon: 'shield', label: 'Policies' },
  { to: '/risk', icon: 'alert', label: 'Risk center' },
  { to: '/data', icon: 'globe', label: 'Data sources' },
  { to: '/profile', icon: 'wallet', label: 'Profile & wallet' },
]

function NavItem({ to, icon, label, badge }) {
  const pathname = useRouterState({ select: s => s.location.pathname })
  const { shownActivity } = useApp()
  const active = to === '/' ? pathname === '/' : (pathname.startsWith(to) || (to === '/strategies' && pathname.startsWith('/strategy')))
  return (
    <Link to={to} className="rg-navitem" style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 13px',
      borderRadius: 'var(--r-md)', textDecoration: 'none', position: 'relative',
      background: active ? 'var(--glass-hi)' : 'transparent', color: active ? 'var(--t0)' : 'var(--t1)',
      fontFamily: 'var(--f-body)', fontSize: 13.5, fontWeight: active ? 600 : 500, transition: 'all .14s' }}>
      {active && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />}
      <span style={{ color: active ? 'var(--accent)' : 'var(--t2)' }}><Icon name={icon} size={18} /></span>
      <span className="rg-navlabel" style={{ flex: 1 }}>{label}</span>
      {badge && <span className="badge badge-accent" style={{ fontSize: 9.5, padding: '2px 7px' }}>{shownActivity.length}</span>}
    </Link>
  )
}

function RootLayout() {
  const c = useApp()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: s => s.location.pathname })
  const title = titleFor(pathname)
  const { t, setTweak, mode, setMode, agentOn, setAgentOn, halted, crashState, suiPrice,
    account, owner, ownerShort, readOnlyLiveMode, liveReadsEnabled, liveReadMeta, disconnect,
    notifs, setNotifs, notifOpen, setNotifOpen, unread, toast, onExit,
    inspect, setInspect, txView, setTxView, runtimeOpen, runtimeMode, setRuntimeOpen, setRuntimeMode,
    shownActivity, simulateCrash, resetDemo, resumeAgents, emergencyStop, handleRevoke } = c

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
            {NAV.map(n => <NavItem key={n.to} {...n} />)}
          </div>
          <Button className="mt-[18px] bg-accent text-accent-foreground font-semibold" fullWidth onPress={() => navigate({ to: '/new' })}
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
            <div onClick={() => navigate({ to: '/profile' })} title="Profile & wallet" style={{ cursor: 'pointer', width: 32, height: 32, borderRadius: 9, background: 'linear-gradient(135deg,#2EE6CE,#5AA6FF)', color: '#06231f',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, fontFamily: 'var(--f-mono)' }}>{account ? owner.slice(2, 4).toUpperCase() : readOnlyLiveMode ? 'AG' : RG.user.avatar}</div>
            <div className="rg-userblock" onClick={() => navigate({ to: '/profile' })} style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}>
              <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ownerShort}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>{account ? 'Sui wallet · testnet' : readOnlyLiveMode ? 'Worker live reads · no signing' : RG.user.provider}</div>
            </div>
            <button onClick={c.logout} title="Log out" aria-label="Log out"
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'var(--danger-dim)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t2)'; e.currentTarget.style.background = 'transparent' }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, flexShrink: 0,
                borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--t2)', cursor: 'pointer', transition: 'all .14s' }}>
              <Icon name="logout" size={16} />
            </button>
          </div>
        </aside>

        {/* main */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* topbar */}
          <header style={{ height: 'var(--topbar-h)', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex',
            alignItems: 'center', padding: '0 26px', gap: 20, background: 'rgba(8,11,17,0.5)', backdropFilter: 'blur(10px)' }}>
            <div style={{ flex: 1 }}>
              <h1 className="display" style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{title.t}</h1>
              <div className="rg-subtitle" style={{ fontSize: 11.5, color: 'var(--t2)' }}>{title.s}</div>
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

            {/* theme toggle */}
            <Button isIconOnly variant="light" className="rg-btn-ghost" aria-label="Toggle theme"
              onPress={() => setTweak('theme', t.theme === 'light' ? 'dark' : 'light')}>
              <Icon name={t.theme === 'light' ? 'moon' : 'sun'} size={17} />
            </Button>

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
              <Button size="sm" onPress={simulateCrash} isDisabled={halted} className="rg-btn-danger-2"
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
                <Button size="sm" onPress={resumeAgents} className="rg-btn-2"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}
                  startContent={<Icon name="refresh" size={13} />}>
                  Resume
                </Button>
              </div>
            )}
            <Outlet />
          </div>
        </main>

        {inspect && <PolicyInspect p={inspect} activity={shownActivity} onClose={() => setInspect(null)} onRevoke={handleRevoke} onTx={setTxView} readOnly={readOnlyLiveMode} />}
        {txView && <TxDrawer tx={txView} onClose={() => setTxView(null)} />}
        {runtimeOpen && <AgentRuntimeDrawer mode={runtimeMode || mode} onClose={() => { setRuntimeOpen(false); setRuntimeMode(null) }} onToast={c.showToast} />}

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

/* ---------- per-view route components (data from useApp) ---------- */
function DashboardRoute() {
  const c = useApp()
  return <Dashboard state={c.state} live={c.liveReadsEnabled ? { summary: c.liveSummary, market: c.liveMarket, activity: c.liveActivity } : null} />
}
function NewRoute() {
  const c = useApp()
  return <NewStrategy mode={c.mode} setMode={c.setMode} onDone={c.deployPolicy} />
}
function ActivityRoute() {
  const c = useApp()
  return <ActivityView activity={c.shownActivity} onTx={c.setTxView} live={c.liveReadsEnabled} loading={c.liveReadsEnabled && c.liveLoading} />
}
function MarketsRoute() {
  const c = useApp()
  const navigate = useNavigate()
  return <MarketsView live={c.liveFeed} onToast={c.showToast} onDeploy={(s) => { c.setSeed(s); navigate({ to: '/new' }) }} />
}
function RiskRoute() {
  const c = useApp()
  return <RiskCenter policies={c.policies} stopped={c.halted} onEmergencyStop={c.emergencyStop} onToast={c.showToast} />
}
function StrategiesRoute() {
  const c = useApp()
  const navigate = useNavigate()
  return <StrategyMarketplace onToast={c.showToast} onDeploy={(s) => { c.setSeed(s); navigate({ to: '/new' }) }} onOpen={(id) => navigate({ to: '/strategy/$id', params: { id } })} />
}
function StrategyDetailRoute() {
  const c = useApp()
  const navigate = useNavigate()
  const { id } = useParams({ from: '/strategy/$id' })
  return <StrategyDetail id={id} onBack={() => navigate({ to: '/strategies' })} onDeploy={(s) => { c.setSeed(s); navigate({ to: '/new' }) }} onToast={c.showToast} />
}
function DataRoute() {
  const c = useApp()
  return <DataSources onToast={c.showToast} live={c.liveFeed} setLive={c.setLiveFeed} />
}
function PoliciesRoute() {
  const c = useApp()
  const navigate = useNavigate()
  return <PoliciesView policies={c.policies} onRevoke={c.handleRevoke} onInspect={c.setInspect}
    onLive={(p) => { c.setLiveId(p.id); navigate({ to: '/active' }) }}
    live={c.liveReadsEnabled} readOnly={c.readOnlyLiveMode} loading={c.liveReadsEnabled && c.liveLoading} />
}
function ActiveRoute() {
  const c = useApp()
  const navigate = useNavigate()
  const p = c.policies.find(x => x.id === c.liveId)
  if (!p) return <PoliciesRoute />
  return <ActiveStrategy p={p} activity={c.shownActivity} onBack={() => navigate({ to: '/policies' })}
    onToggle={c.togglePolicy} onRebalance={c.rebalanceNow} onRevoke={c.handleRevoke} onTx={c.setTxView} onToast={c.showToast} />
}
function ProfileRoute() {
  const c = useApp()
  const navigate = useNavigate()
  const VIEW_TO_PATH = { dashboard: '/', new: '/new', activity: '/activity', markets: '/markets', strategies: '/strategies', risk: '/risk', data: '/data', policies: '/policies', profile: '/profile' }
  return <Profile
    live={c.liveReadsEnabled} readOnly={c.readOnlyLiveMode} loading={c.liveReadsEnabled && c.liveLoading}
    policies={c.policies}
    holdings={c.liveReadsEnabled ? c.liveHoldings : RG.holdings}
    funding={c.liveReadsEnabled ? c.liveFunding : null}
    account={c.liveReadsEnabled ? {
      avatar: c.account ? c.owner.slice(2, 4).toUpperCase() : 'AG',
      handle: c.ownerShort, addr: c.ownerShort, fullAddr: c.owner,
      provider: c.account ? (c.currentWallet?.name || 'Sui wallet') : 'RescueGrid Worker',
      network: 'Sui Testnet',
    } : RG.account}
    onNav={(v) => navigate({ to: VIEW_TO_PATH[v] || '/' })}
    onToast={(m, col) => c.showToast(m, col)}
  />
}

const rootRoute = createRootRoute({ component: RootLayout })
const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: DashboardRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/new', component: NewRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/activity', component: ActivityRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/markets', component: MarketsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/strategies', component: StrategiesRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/strategy/$id', component: StrategyDetailRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/policies', component: PoliciesRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/active', component: ActiveRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/risk', component: RiskRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/data', component: DataRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/profile', component: ProfileRoute }),
]
const routeTree = rootRoute.addChildren(routes)
export const router = createRouter({ routeTree, defaultPreload: 'intent' })
