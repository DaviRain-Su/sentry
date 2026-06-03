# Sentry

> Cross-chain autonomous risk agent — set your policy, Sentry patrols the chains.

Sentry is an Agent dispatch platform — a local daemon that watches your positions across blockchains, exchanges, and perps venues, runs Guardian policy checks, and dispatches structured tasks to external Agents (Claude Code, Codex, Kimi) for execution. You set the rules, the daemon dispatches the work. External Agents use your local toolchain (OWS vault, wallets, Solana CLI) — private keys never leave your machine and never touch the daemon.

## Origin

Sentry began as a Sui-only hackathon project. The current codebase carries that heritage: a
MoveGate + SentryPolicyWrapper contract on Sui Testnet, a DeepBook executor adapter, a Vite +
React dashboard, and a Cloudflare Worker runtime. The verified Sui Testnet path remains useful
for demos, but the product direction is now an **Agent dispatch platform**: a local daemon that
dispatches tasks to external Agents instead of executing trades itself.

The long-term vision is cross-chain: one local control plane, one policy language, one Guardian,
one activity ledger — with external Agents doing the actual execution using the user's local
toolchain. Chain wallets handled through OWS; exchange credentials stay in local keychain as
read + trade keys, never withdrawal keys. See the
[Local Agent + Open Wallet plan](docs/10-local-agent-openwallet.md) and
[Local Agent, Agent Dispatch & Worker Bridge](docs/11-local-agent-worker-bridge.md), plus the
[Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md).

## Quickstart

Dashboard demo mode:

```bash
npm install
npm run dev -- --host localhost --port 5175      # demo mode (no backend needed)
```

Optional Sui Testnet Worker path:

```bash
cd worker && npm install && npm run dev -- --port 8787
cp .env.example .env.local   # VITE_WORKER_URL=http://localhost:8787
npm install && npm run dev -- --host localhost --port 5175
```

Local daemon bridge skeleton:

```bash
cd worker && DAEMON_AUTH_TOKEN=sk_daemon_dev npm run dev
cd agent && node src/index.mjs --token sk_daemon_dev --worker-url http://localhost:8787 --agent-cmd "codex"
```

## How It Works

```
You (owner)                  Sentry Daemon                External Agent
    │                            │                              │
    ├─ Natural language intent → │  "if SUI drops 8%, buy"      │
    │                            │                              │
    │ ← Preview + Guardian ──────┤  checks budget, slippage     │
    │                            │                              │
    ├─ Sign policy / mandate ─→  │  chain/venue policy created  │
    │                            │                              │
    │                       ┌────┴────┐                         │
    │                       │  TICK   │  monitors prices        │
    │                       └────┬────┘                         │
    │                            │                              │
    │                            ├── AgentTask ────────────────→│  "swap 100 USDC on Solana"
    │                            │                              │
    │                            │  ← AgentTaskResult ──────────┤  tx_digest, evidence
    │                            │                              │
    │ ← Activity feed ───────────┤  execute, block, or approve  │
    │                            │                              │
    ├─ Revoke / emergency stop → │  local loop stops            │
```

The daemon can only dispatch tasks inside the policy you authorize. External Agents use your
local wallets and keys — the daemon never touches private keys.

## Architecture

Sentry is built in three planes:

- **Control Plane** — the Sentry Account, strategy mandates, Guardian decisions, emergency stop, and activity ledger. This is chain-agnostic.
- **Execution Plane** — one adapter per venue/protocol. Currently: Sui/DeepBook demo. Planned: Solana/Jupiter, EVM/Safe, Hyperliquid, OKX, Binance.
- **Settlement Plane** — moves inventory between venues (LI.FI, deBridge, native transfers). Modeled as sagas, not atomic transactions.

```
Sentry Account (chain-agnostic identity)
  ├── owner identities (wallet / passkey / oauth)
  ├── local agent runtime
  │   ├── OWS wallet vault
  │   ├── Sentry secret store
  │   ├── normalized asset inventory
  │   └── Worker bridge client
  ├── venue accounts
  │   ├── sui: MoveGate Mandate + SentryPolicyWrapper
  │   ├── solana: delegated PDA account         ← next
  │   ├── evm: Safe module / ERC-4337           ← planned
  │   ├── hyperliquid: API wallet + subaccount  ← planned
  │   └── okx/binance: trade-only API key       ← planned
  ├── strategy mandates
  └── unified activity ledger
```

Detailed architecture: [`docs/02-architecture.md`](docs/02-architecture.md).
Build status: [`docs/STATUS.md`](docs/STATUS.md).

## Tech

- **Vite + React** (JSX) with TanStack Query, Router, Table, and Form
- **Cloudflare Worker** (Hono) with Durable Objects for per-policy runtime and bridge relay
- **Local daemon** — Node.js CLI + loopback API + Agent dispatch to external Agents (stdio)
- **External Agents** — Claude Code, Codex, Kimi (user-installed; daemon dispatches tasks)
- **Local signing** — OWS wallet vault, OS keychain (used by external Agents, not by daemon)
- **`core/`** — shared SDK-agnostic logic (strategy hash, intent parser, Guardian)
- **`move/sentry`** — Sui Move package (MoveGate Mandate + SentryPolicyWrapper)
- **Design system** — `neon-on-near-black` glassy dark fintech

```
src/
  main.jsx                  # entry
  App.jsx                   # app shell, nav, crash orchestration, routing
  api.js                    # Worker-first frontend API client
  chain-read.js             # direct-chain fallback
  data.js                   # demo/mock data
  components/
    Landing.jsx             # pitch page
    ZkLogin.jsx             # wallet/zkLogin sign-in
    Dashboard.jsx           # command center + reasoning panel
    NewStrategy.jsx         # intent → review → policy → deploy
    Views.jsx               # activity log + policies
    Detail.jsx              # policy inspect + tx explorer
    Profile.jsx             # wallet identity, balances, agent authority
core/
  strategy.js               # canonical strategy_hash + NL intent parser
  guardian.js               # Guardian decision logic
  deployment.js             # on-chain ids / constants
agent/
  src/index.mjs             # local daemon bridge + external Agent process manager skeleton
```

## Docs

- [Architecture](docs/02-architecture.md)
- [Local Agent + Open Wallet Plan](docs/10-local-agent-openwallet.md)
- [Local Agent, Agent Dispatch & Worker Bridge](docs/11-local-agent-worker-bridge.md)
- [Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md) — Solana, EVM, CEX, settlement
- [Build Status](docs/STATUS.md)
- [Technical Spec](docs/03-technical-spec.md)
- [Market & Product Roadmap](docs/09-market-product-and-frontend-roadmap.md)
