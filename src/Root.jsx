// Top-level router. Landing renders eagerly (light, no SDK); the dashboard +
// Sui/zkLogin providers are code-split and loaded only on "Launch app".
import { useState, lazy, Suspense } from 'react'
import { Landing } from './components/Landing.jsx'

const AppBundle = lazy(() => import('./AppBundle.jsx'))

export default function Root() {
  const [launched, setLaunched] = useState(false)
  if (!launched) return <Landing onLaunch={() => setLaunched(true)} />
  return (
    <Suspense fallback={
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--t2)', fontFamily: 'var(--f-mono)', fontSize: 13 }}>Loading RescueGrid…</div>
    }>
      <AppBundle onExit={() => setLaunched(false)} />
    </Suspense>
  )
}
