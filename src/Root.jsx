// Top-level router. Landing renders eagerly (light, no SDK); the dashboard +
// Sui/zkLogin providers are code-split and loaded only on "/app".
import { lazy, Suspense } from 'react';
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Landing } from './components/Landing.jsx';

const AppBundle = lazy(() => import('./AppBundle.jsx'));

function RootLayout() {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
    </>
  );
}

function LandingRoute() {
  const navigate = useNavigate();
  return <Landing onLaunch={() => navigate({ to: '/app' })} />;
}

function AppRoute() {
  const navigate = useNavigate();
  return (
    <Suspense
      fallback={
        <div
          style={{
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--t2)',
            fontFamily: 'var(--f-mono)',
            fontSize: 13,
          }}
        >
          Loading Sentry…
        </div>
      }
    >
      <AppBundle onExit={() => navigate({ to: '/' })} />
    </Suspense>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingRoute,
});
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppRoute,
  validateSearch: (search) => search,
});
const routeTree = rootRoute.addChildren([indexRoute, appRoute]);
const router = createRouter({ routeTree });

export default function Root() {
  return <RouterProvider router={router} />;
}
