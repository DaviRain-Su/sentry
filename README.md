# Sentry

> Cross-chain autonomous risk agent — set your policy, Sentry patrols the chains.

Sentry is an autonomous agent platform that monitors your positions across multiple blockchains, exchanges, and perps venues, decides under Guardian policy checks, and executes risk-response trades inside **policy envelopes** you authorize. You set the rules — Sentry stands watch.

## Origin

Sentry began as a Sui-only hackathon project. The current codebase carries that heritage: a
MoveGate + SentryPolicyWrapper contract on Sui Testnet, a DeepBook executor adapter, a Vite +
React dashboard, and a Cloudflare Worker runtime. All of this is real, tested, and verified
on-chain.

The long-term vision is cross-chain: one control plane, one policy language, one Guardian, one
activity ledger, with venue-specific execution adapters underneath. See the
[Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md) for the full plan — Solana devnet,
EVM, Hyperliquid, and CEX trade-only adapters are on the roadmap.

## Quickstart

The Sui Testnet MVP is fully functional:

```bash
npm install
npm run dev -- --host localhost --port 5175      # demo mode (no backend needed)
```

With the Worker running on Sui Testnet:

```bash
cd worker && npm install && npm run dev -- --port 8787
cp .env.example .env.local   # VITE_WORKER_URL=http://localhost:8787
npm install && npm run dev -- --host localhost --port 5175
```

## How It Works

```
You (owner)                    Sentry (agent)
    │                               │
    ├─ Natural language intent ──→  │  "if SUI drops 8%, market-buy 500 USDC SUI"
    │                               │
    │  ← PTB preview + Guardian ────┤  checks budget, slippage, pool scope
    │                               │
    ├─ Sign & deploy policy ────→   │  on-chain policy object created
    │                               │
    │                           ┌───┴───┐
    │                           │  TICK   │  monitors price, checks triggers
    │                           └───┬───┘
    │                               │
    │  ← Activity feed ────────────┤  execute (if allowed) or block (with reason)
    │                               │
    ├─ Revoke (any time) ────────→  │  policy destroyed, agent loses authority
```

The agent can only act inside the policy you authorize — constrained by budget, pool, slippage,
expiry, and strategy hash. Everything is verifiable on-chain.

## Architecture

Sentry is built in three planes:

- **Control Plane** — the Sentry Account, strategy mandates, Guardian decisions, emergency stop, and activity ledger. This is chain-agnostic.
- **Execution Plane** — one adapter per venue/protocol. Currently: Sui/DeepBook. Planned: Solana/Jupiter, EVM/Safe, Hyperliquid, OKX, Binance.
- **Settlement Plane** — moves inventory between venues (LI.FI, deBridge, native transfers). Modeled as sagas, not atomic transactions.

```
Sentry Account (chain-agnostic identity)
  ├── owner identities (wallet / passkey / oauth)
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
- **Cloudflare Worker** (Hono) with Durable Objects for per-policy runtime
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
```

## Docs

- [Architecture](docs/02-architecture.md)
- [Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md) — Solana, EVM, CEX, settlement
- [Build Status](docs/STATUS.md)
- [Technical Spec](docs/03-technical-spec.md)
- [Market & Product Roadmap](docs/09-market-product-and-frontend-roadmap.md)
