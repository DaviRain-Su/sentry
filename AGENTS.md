# AGENTS.md

This file provides guidance to Code Agents (Codex, Cursor, Claude, Pi, etc.) when working with code in this repository.

## Project Overview

**Sentry** — cross-chain autonomous DeFi risk-rescue agent. Set your policy, Sentry patrols the chains. The current implementation is a Sui Testnet MVP: a Vite + React dashboard, a Cloudflare Worker (Hono + Durable Objects), a Sui Move package (MoveGate + SentryPolicyWrapper), and a shared `core/` logic layer.

The long-term vision is a cross-chain control plane: one policy language, one Guardian, one activity ledger, with venue-specific execution adapters underneath (Solana, EVM, Hyperliquid, CEX).

## Quickstart

```bash
# Dashboard demo mode (no backend needed)
npm install
npm run dev                    # → http://localhost:5173

# With Worker running on Sui Testnet
cd worker && npm install && npm run dev   # → http://localhost:8787
cp .env.example .env.local    # add VITE_WORKER_URL=http://localhost:8787
npm run dev
```

## Commands

```bash
npm run dev               # Dev server on port 5173 (strict)
npm run build             # Production build
npm run preview           # Preview production build
npm run config            # Print deployment config (chain ids, env templates)
npm run baseline:smoke    # Smoke test the baseline demo
```

The Worker has its own package: `cd worker && npm run dev | npm test | npm run typecheck`.

No test framework is configured for the frontend. Manual testing via `npm run dev` and the flash-crash demo in the UI.

## Architecture

### Three-Plane Design

```
Control Plane     — Sentry Account, strategy mandates, Guardian decisions, emergency stop, activity ledger (chain-agnostic)
Execution Plane   — One adapter per venue/protocol. Currently: Sui/DeepBook. Planned: Solana/Jupiter, EVM/Safe, etc.
Settlement Plane  — Moves inventory between venues (LI.FI, deBridge, native transfers). Modeled as sagas.
```

### Request Flow

```
Browser (Vite+React SPA)
  → TanStack Router (lazy-loaded / → Landing, /app → Dashboard)
  → src/api.js (Worker-first, fallback to src/chain-read.js)
  → Cloudflare Worker (Hono API)
    → Durable Object per active policy (AgentRuntime)
    → Tick loop: monitor price → Guardian check → ExecutorAdapter → PTB → submit
  → Sui Testnet (MoveGate Mandate + SentryPolicyWrapper + DeepBook)
```

### Key Source Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | React dashboard (Vite SPA) — components, API client, queries, styles |
| `src/components/` | UI components: Dashboard, NewStrategy, Views, Profile, etc. |
| `src/queries/` | TanStack Query hooks: feeds, live dashboard, market data |
| `worker/` | Cloudflare Worker (Hono + Durable Objects) — HTTP API, agent runtime, chain reads, tick loop |
| `worker/src/` | Worker source: index.ts (API), tick.js, chain.js, guardian.js, sui-tx.js, deepbook.js |
| `core/` | Shared SDK-agnostic logic: strategy hash/intent parser, Guardian, deployment constants |
| `move/sentry/` | Sui Move package — SentryPolicyWrapper, events, tests |
| `docs/` | Architecture, technical spec, status, roadmap, review findings |
| `scripts/` | Demo config printer, baseline smoke test |

### Key Architectural Patterns

- **Code splitting**: The landing page loads eagerly (light, no Sui SDK). The dashboard (`/app`) with Sui/zkLogin providers is code-split via `React.lazy(() => import('./AppBundle.jsx'))` and loaded only when the user enters the app.

- **Worker-first reads with chain fallback**: `src/api.js` tries the Worker first. On failure, `src/chain-read.js` reads directly from Sui RPC. This means the dashboard works in demo mode (mock data), Worker-connected mode, and direct-chain fallback mode.

- **Shared core layer**: `core/strategy.js` (canonical strategy JSON, blake2b-256 strategy_hash, NL intent parser) and `core/guardian.js` (Guardian decision logic) are pure functions shared between frontend, Worker, and any future local agent. No platform-specific imports.

- **Durable Object per policy**: Each active policy gets its own Durable Object instance. It stores runtime state, runs a tick loop (default 60s), monitors prices, evaluates triggers, runs Guardian checks, and submits execution PTBs.

- **zkLogin + wallet signing**: The dashboard supports Sui wallet (primary) and Enoki zkLogin (optional). The Worker never holds owner keys — it builds unsigned PTBs that the user signs in their wallet. Agent execution uses a dedicated Worker-held key, scoped to policies that name it.

- **Provider/Adapter pattern**: ExecutorAdapters (`worker/src/deepbook.js`) implement a uniform interface: `readMarket`, `planExecution`, `buildPtb`, `parseExecutionResult`. New venues (Cetus, Scallop, future chains) add adapters without touching the core tick loop.

- **Environment variables**: Frontend uses `VITE_` prefix (build-time). Worker uses `worker/.dev.vars` (runtime secrets). See `.env.example` for the dashboard; Worker secrets are NOT in version control.

### Database / Storage

No traditional database. The Worker uses:
- **Durable Object storage** for per-policy runtime state (tick count, error count, last action, market snapshot)
- **Sui chain as source of truth** for mandates, wrappers, budgets, and events
- **In-memory parse cache** in the Worker (simple `Map`, consideration: needs LRU cap)

### Deployment Constants

All chain addresses, pool IDs, and deployment config live in two mirrored files:
- `deployment.testnet.json` — JSON, read by scripts and Worker config
- `core/deployment.js` — ESM, imported by frontend and shared logic

Print the current config: `npm run config`

## Code Style

### Conventions
- **File names**: PascalCase for React components (`Dashboard.jsx`, `NewStrategy.jsx`), camelCase for utilities (`api.js`, `chain-read.js`), kebab-case for docs and config
- **Components**: PascalCase (`Dashboard`, `NewStrategy`)
- **Hooks**: camelCase with `use` prefix
- **Constants**: SCREAMING_SNAKE_CASE
- **Styling**: Custom CSS design system in `src/styles.css` (neon-on-near-black dark fintech theme with light mode support). HeroUI components are themed to match via `src/tailwind.css`. Tailwind utilities are available but native CSS classes (`.card`, `.badge`, `.glass`) are preferred for consistency.
- **Icons**: Custom SVG icon component in `src/components/primitives.jsx` (`Icon`, `Logo`, `Token`)
- **State**: TanStack Query for server/chain state, React `useState` for UI state. The main App component manages demo vs live mode switching.
- **Design system**: CSS custom properties on `:root` — backgrounds (`--bg-0` through `--bg-3`), glass surfaces (`--glass`, `--glass-2`, `--glass-hi`), text (`--t0` through `--t3`), brand/semantic colors (`--accent`, `--safe`, `--warn`, `--danger`), fonts (`--f-display`, `--f-body`, `--f-mono`)
- **Dark + light theme**: Toggle via `data-theme="light"` on `:root`. HeroUI components and native CSS both respond.

### Files excluded from linting
Not applicable — no linter is configured yet. See "Known gaps" below.

### Cloudflare Workers Constraints
Worker code runs on the Cloudflare Workers runtime, not Node.js. Avoid Node.js-specific APIs. The Worker uses:
- Hono for HTTP routing
- Durable Objects for stateful agent runtimes
- Sui SDK for chain interactions
- `@noble/hashes` for blake2b (pure JS, CF-compatible)

## Known Gaps

1. **No linter/formatter configured** — Biome or Prettier should be added
2. **No frontend tests** — Worker has `npm test`, but the dashboard has none
3. **No AGENTS.md** — this file fixes that!
4. **Mixed JS/TS** — Worker is mostly TypeScript, frontend is plain JSX; could migrate to TypeScript
5. **DBUSDC funding** — live execution gated on testnet DBUSDC; `EXECUTION_ENABLED=false` until then
6. **parseCache no LRU** — Worker's in-memory parse cache has no eviction policy
7. **No CI/CD** — GitHub Actions workflows could run Move tests and Worker tests
