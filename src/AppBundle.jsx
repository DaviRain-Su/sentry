// Lazy-loaded app bundle: the Sui/zkLogin providers + dashboard. Kept out of
// the landing's critical path so the marketing page paints without the SDK.
import { Providers } from './providers.jsx'
import App from './App.jsx'

export default function AppBundle({ onExit }) {
  return (
    <Providers>
      <App onExit={onExit} />
    </Providers>
  )
}
