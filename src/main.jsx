import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import RouterApp from './poc/RouterApp.jsx' // PoC: TanStack Router (branch poc/tanstack-router only — revert to Root.jsx to ship)
import './tailwind.css'
import './styles.css'
import './landing.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterApp />
  </StrictMode>
)
