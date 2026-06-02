/* ===========================================================
   RescueGrid — app-wide state context.
   App.jsx owns all state/hooks/handlers (it must sit under the
   dapp-kit providers) and publishes them here; the router's
   RootLayout + route components consume via useApp().
   =========================================================== */
import { createContext, useContext } from 'react'

export const AppCtx = createContext(null)
export const useApp = () => useContext(AppCtx)
