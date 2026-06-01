# RescueGrid

> Autonomous DeFi risk-rescue agent on Sui — on a leash you control.

A hi-fi, fully clickable dashboard prototype implementing the [Claude Design handoff](docs/) for RescueGrid: an AI agent that monitors your positions, decides, and executes real trades on Deepbook — strictly inside a **Move Policy Object** you authorize once.

This repo is the **Web Dashboard** layer described in [`docs/02-architecture.md`](docs/02-architecture.md), recreated pixel-faithfully from the design prototype as a Vite + React single-page app.

## Quickstart

**Demo mode** (no backend, no credentials — fully clickable):

```bash
npm install
npm run dev      # http://localhost:5173
```

**Live mode** (real Sui Testnet backend + zkLogin):

```bash
npm run config            # prints on-chain ids + the env templates below

# 1) backend
cd worker && npm install && npm run dev      # http://localhost:8787

# 2) frontend (new shell)
cp .env.example .env.local   # fill VITE_WORKER_URL + Enoki/Google creds
npm install && npm run dev   # http://localhost:5173
```

```bash
npm run build    # production build → dist/
npm run preview  # serve the production build
cd worker && npm test   # 23 backend checks (hash + guardian + tick)
```

A live deployment already exists on Sui Testnet (see [`docs/STATUS.md`](docs/STATUS.md) / `npm run config`); the Move package is published and the agent runtime is provisioned.

## The flow

`Landing → zkLogin → Dashboard`, all client-side routes in one SPA:

- **Landing** — pitch page: hero rescue-grid visual, the gap, how-it-works, "Why Sui" (granted-vs-denied capabilities), features, sub-track alignment.
- **zkLogin** — branded sign-in framing the no-seed-phrase / no-extension story.
- **Command center** — live portfolio KPIs, a SUI/USDC Deepbook chart, an animated radial risk gauge, agent reasoning trail, open positions, and an agent live feed.
- **New strategy** — natural language → parsed intent + human-readable **PTB preview** + 30-day backtest + **Guardian** risk checks (including a hard **BLOCK** path) → Move Policy config → Local/Cloud mode → one-signature deploy.
- **Agent activity** — filterable on-chain log of every autonomous decision (executions, retries, failures, guardian blocks), with clickable tx hashes opening a **Sui explorer drawer**.
- **Policies** — your on-chain authority as cards (budget bars, scope, expiry, revoke) with an **Inspect** slide-over exposing the `AgentPolicy` Move struct, delegated-vs-denied capabilities, protocol allow-list, gas/signing, and audit trail.

### The centerpiece demo

Hit **Simulate flash crash** (top right): SUI drops −8.4%, the risk gauge spikes red, then the agent autonomously fires a rescue grid on Deepbook — partial fill → re-quote → fills → on-chain log — all without a signature. There's also a global **Emergency stop** circuit breaker, and a **Tweaks** panel (bottom-right gear) to live-toggle accent color, crash severity, and market jitter.

## Live mode (real zkLogin + Worker)

By default the app runs **self-contained in demo mode** (mock data, simulated sign-in). To run it against the real Sui Testnet backend:

1. Set `VITE_WORKER_URL` in `.env.local` (`cd worker && npm run dev`, default `http://localhost:8787`).
2. **Sign in with a Sui wallet** — install [Slush](https://slush.app) (or any standard Sui wallet), switch it to **Testnet**, and grab test SUI from the faucet. No signups, no API keys. The sign-in screen shows a "Connect <wallet>" button.

With a connected wallet + Worker URL, **New strategy → Sign & deploy** parses via the Worker, builds the `create_policy` transaction, you sign it in your wallet, and the policy's agent runtime is registered — a real on-chain Move Policy Object. Live policy list + on-chain revoke work the same way. (Creating/revoking costs only the ~0.01 SUI MoveGate fee + gas; no DBUSDC needed.)

**zkLogin (optional):** if you'd rather use Google zkLogin, also set `VITE_ENOKI_API_KEY` (Enoki public key from [portal.enoki.mystenlabs.com](https://portal.enoki.mystenlabs.com)) and `VITE_GOOGLE_CLIENT_ID` (Google OAuth Web client, registered in the Enoki portal). Then "Continue with Google" performs real zkLogin. Wallet login needs none of this.

> The agent (autonomous execution) signs with a dedicated key held by the Worker (`worker/.dev.vars`), never your zkLogin key. Live Deepbook execution is gated pending testnet DBUSDC (see `docs/B-feasibility-findings.md`).

## Tech

- **Vite + React 18** (JSX). No backend — all data is plausible mock data in [`src/data.js`](src/data.js).
- Design system (`neon-on-near-black`, glassy dark fintech) lives in [`src/styles.css`](src/styles.css); landing-only styles in [`src/landing.css`](src/landing.css).

```
src/
  main.jsx                 # entry
  App.jsx                  # app shell, nav, crash orchestration, routing
  data.js                  # mock data layer
  styles.css / landing.css # design tokens + components
  components/
    primitives.jsx         # Icon, Sparkline, RiskGauge, Token, Logo, helpers
    Landing.jsx            # pitch / marketing page
    ZkLogin.jsx            # sign-in entry
    Dashboard.jsx          # command center + reasoning panel
    NewStrategy.jsx        # intent → review → policy → deploy
    Views.jsx              # activity log + policies
    Detail.jsx             # policy inspect slide-over + tx explorer drawer
    TweaksPanel.jsx        # live demo controls
```

> Prototype only — mock data, Testnet-oriented copy. The on-chain MoveGate / RescuePolicyWrapper contracts, Cloudflare Worker agent runtime, and real Deepbook execution are specified in [`docs/`](docs/) but not implemented here.
