/* ===========================================================
   PoC — TanStack Router (SPA mode) over RescueGrid pages.
   Proves: type-safe URL routes, deep-linking, browser back/
   forward, link nav, and a param route (/strategy/$id).
   Uses the real page components with demo data — no Worker,
   no wallet — so it stays self-contained and reversible.
   =========================================================== */
import {
  createRootRoute, createRoute, createRouter, RouterProvider,
  Outlet, Link, useParams, useNavigate,
} from '@tanstack/react-router'
import { RG } from '../data.js'
import { Icon, Logo } from '../components/primitives.jsx'
import { Dashboard } from '../components/Dashboard.jsx'
import { MarketsView } from '../components/Markets.jsx'
import { StrategyMarketplace, StrategyDetail } from '../components/Marketplace.jsx'
import { RiskCenter } from '../components/Risk.jsx'

const demoState = {
  risk: 38, suiPrice: 4.182, suiSpark: RG.suiSpark, crashState: 'idle',
  mode: 'cloud', agentOn: true, activity: RG.activity,
}
const toast = (m) => console.log('[toast]', m)

const NAV = [
  { to: '/', icon: 'dashboard', label: 'Dashboard' },
  { to: '/markets', icon: 'radar', label: 'Markets monitor' },
  { to: '/strategies', icon: 'grid', label: 'Strategy catalog' },
  { to: '/risk', icon: 'alert', label: 'Risk center' },
]

function NavLink({ to, icon, label }) {
  return (
    <Link to={to} activeOptions={{ exact: to === '/' }} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 13px', borderRadius: 'var(--r-md)',
          position: 'relative', fontSize: 13.5, fontWeight: isActive ? 600 : 500,
          background: isActive ? 'var(--glass-hi)' : 'transparent', color: isActive ? 'var(--t0)' : 'var(--t1)', transition: 'all .14s' }}>
          {isActive && <div style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, borderRadius: 4, background: 'var(--accent)', boxShadow: '0 0 8px var(--accent-glow)' }} />}
          <span style={{ color: isActive ? 'var(--accent)' : 'var(--t2)' }}><Icon name={icon} size={18} /></span>
          <span style={{ flex: 1 }}>{label}</span>
        </div>
      )}
    </Link>
  )
}

function Shell() {
  return (
    <div style={{ display: 'flex', height: '100vh', position: 'relative', zIndex: 1 }}>
      <aside style={{ width: 248, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
        padding: '20px 16px', background: 'var(--chrome)', backdropFilter: 'blur(10px)' }}>
        <div style={{ padding: '0 8px 8px' }}><Logo /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 18 }}>
          <div className="eyebrow" style={{ padding: '0 13px 8px' }}>Workspace · Router PoC</div>
          {NAV.map(n => <NavLink key={n.to} {...n} />)}
        </div>
        <div style={{ flex: 1 }} />
        <div className="card" style={{ padding: 12, fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 }}>
          <span className="badge badge-accent" style={{ fontSize: 9, marginBottom: 6 }}><span className="dot pulse" />TanStack Router</span>
          <div>URL 驱动 · 深链 · 前进后退 · 类型安全。地址栏会随页面变化,可刷新/分享。</div>
        </div>
      </aside>
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 26px 60px' }}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}

const rootRoute = createRootRoute({ component: Shell })

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <Dashboard state={demoState} live={null} /> })
const marketsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/markets', component: MarketsPage })
const strategiesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/strategies', component: StrategiesPage })
const strategyRoute = createRoute({ getParentRoute: () => rootRoute, path: '/strategy/$id', component: StrategyPage })
const riskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/risk', component: () => <RiskCenter policies={RG.policies} stopped={false} onEmergencyStop={() => {}} onToast={toast} /> })

function MarketsPage() {
  const nav = useNavigate()
  return <MarketsView live={false} onToast={toast} onDeploy={() => nav({ to: '/strategies' })} />
}
function StrategiesPage() {
  const nav = useNavigate()
  return <StrategyMarketplace onToast={toast} onDeploy={() => toast('deploy')} onOpen={(id) => nav({ to: '/strategy/$id', params: { id } })} />
}
function StrategyPage() {
  const nav = useNavigate()
  const { id } = useParams({ from: '/strategy/$id' })
  return <StrategyDetail id={id} onBack={() => nav({ to: '/strategies' })} onDeploy={() => toast('deploy')} onToast={toast} />
}

const routeTree = rootRoute.addChildren([indexRoute, marketsRoute, strategiesRoute, strategyRoute, riskRoute])
const router = createRouter({ routeTree, defaultPreload: 'intent' })

export default function RouterApp() {
  return <RouterProvider router={router} />
}
