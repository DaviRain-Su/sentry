import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root from './Root.jsx'
import './tailwind.css'
import './styles.css'
import './landing.css'

// Build stamp — confirms the browser actually loaded the latest bundle.
// If you don't see this in the console, you're on a stale/cached page.
const RG_BUILD = 'RESCUEGRID-BUILD · 2026-06-02 · session-modes+logout'
console.log('%c' + RG_BUILD, 'background:#2EE6CE;color:#04211c;font-weight:700;padding:3px 8px;border-radius:4px')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
