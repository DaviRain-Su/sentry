# Sentry

> Cross-chain autonomous risk agent — set your policy, Sentry patrols the chains.

Sentry is an Agent dispatch platform — a local daemon that watches your positions across blockchains, perps venues, and exchanges, runs Guardian policy checks, and dispatches structured tasks to external Agents (Claude Code, Codex, Kimi) for execution. You set the rules, the daemon dispatches the work. External Agents use your local toolchain (OWS vault, wallets, Solana/Ethereum CLIs, exchange/perps APIs) — private keys never leave your machine and never touch the daemon.

## Origin

Sentry began as a Sui-only hackathon project. The current codebase carries that heritage: a
MoveGate + SentryPolicyWrapper contract on Sui Testnet, a DeepBook executor adapter, a Vite +
React dashboard, and a Cloudflare Worker runtime. The verified Sui Testnet path remains useful
for demos, but the product direction is now an **Agent dispatch platform**: a local daemon that
dispatches tasks to external Agents instead of executing trades itself.

The target production slice is Solana, Ethereum, Hyperliquid, and OKX, with Sui Testnet
kept as the verified demo path. The long-term vision is cross-chain: one local control plane,
one policy language, one Guardian, one activity ledger — with external Agents doing the actual
execution using the user's local toolchain. Chain wallets are handled through OWS or native
wallet tooling; OKX credentials stay in local keychain as read + trade keys, never withdrawal
keys. See the
[Local Agent + Open Wallet plan](docs/10-local-agent-openwallet.md) and
[Local Agent, Agent Dispatch & Worker Bridge](docs/11-local-agent-worker-bridge.md), plus the
[Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md) and
[Authorization Adapter Model](docs/13-authorization-adapters.md).

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
cd worker && npm run dev -- --port 8787
curl -sS -X POST http://localhost:8787/api/local-agents/pairing | jq .
cd agent && node src/index.mjs --pairing-code <pairing_code> --worker-url http://localhost:8787 --agent-cmd "codex"
```

Repeatable bridge smoke:

```bash
npm run test:local-policy
npm run local-bridge:smoke
```

`npm run test:local-policy` verifies the New Strategy Local Agent metadata builder can produce
sanitized task templates for OKX, Solana, Ethereum and Hyperliquid, inject real daemon-reported
authorization refs and OWS wallet refs, and reject missing refs before the heavier Worker bridge
smoke runs.

This starts a temporary local Worker and daemon, pairs them, writes Hyperliquid/OKX and
Solana/Ethereum policies through remote `policy.local.add`, reads them back through
`policy.local.list`, verifies `authorization.state`, verifies local `authorization.rotate` metadata
proof, verifies `policy.local.plan`, runs no-dispatch `policy.local.run_once` readiness against
metadata-only venue handles plus OWS wallet refs, verifies online-only `authorization.revoke` as a
local metadata safety stop, and deletes the temporary daemon state directory. The smoke policies are
built through the same `src/local-policy-metadata.js` helper
used by New Strategy Local Agent deploy, so the repeatable bridge check covers the Dashboard payload
shape across the four Local Agent target venues.

Local venue key metadata:

```bash
cd agent
node src/index.mjs agent register codex --command "codex" \
  --capabilities read_context,return_evidence \
  --task-capabilities okx:place_order,hyperliquid:place_order,solana-mainnet:submit_tx,ethereum-mainnet:submit_tx
node src/index.mjs agent register jupiter --command "node src/index.mjs solana prepare-swap" \
  --task-capabilities solana-mainnet:submit_tx
node src/index.mjs agent register uniswap --command "node src/index.mjs ethereum prepare-swap" \
  --task-capabilities ethereum-mainnet:submit_tx
node src/index.mjs agent list
node src/index.mjs agent probe codex --json
node src/index.mjs venue add --venue okx --key-handle okx_key_xxxx \
  --account-ref okx:subaccount:sentry-main \
  --permissions read,place_order,cancel_order \
  --ip-allowlist true
node src/index.mjs venue add --venue hyperliquid --key-handle hl_agent_xxxx \
  --account-ref hyperliquid:subaccount:sentry-main \
  --read-account-address 0x0000000000000000000000000000000000000000 \
  --agent-wallet-address 0x1111111111111111111111111111111111111111 \
  --permissions read,place_order,cancel_order,set_leverage
node src/index.mjs venue list
node src/index.mjs venue credentials status --venue okx --key-handle okx_key_xxxx
node src/index.mjs venue credentials store --venue okx --key-handle okx_key_xxxx
node src/index.mjs signer probe --scope solana-mainnet,ethereum-mainnet --json
node src/index.mjs activity tail --json
node src/index.mjs policy add --policy-id funding-arb-1 \
  --target-venues hyperliquid,okx \
  --target-agent codex
node src/index.mjs policy list
node src/index.mjs policy tick --json
node src/index.mjs policy plan --json
node src/index.mjs policy run-once --check-readiness --json
# daemon mode only: start periodic preflight loop, still no dispatch unless explicit
node src/index.mjs --relay-token dev_relay --policy-loop --policy-loop-check-readiness
```

This writes metadata only to `~/.sentry/venues.json` or `--venue-config <path>`. Raw OKX /
Hyperliquid secrets stay in OS keychain or the user's external-agent environment. On macOS,
`venue credentials store` uses the system `security` prompt to write OKX credentials without
accepting raw secret values as CLI flags; `venue credentials status` checks env/keychain presence
without revealing values.
The OKX read-only adapter can build and sign API v5 balance requests and normalize balance
responses under test. For explicit live reads, the daemon first resolves OKX credentials from local
environment variables such as `SENTRY_OKX_API_KEY`, `SENTRY_OKX_SECRET_KEY` and
`SENTRY_OKX_PASSPHRASE`, or key-handle-specific variants like
`SENTRY_OKX_OKX_KEY_XXXX_API_KEY`, then falls back to macOS Keychain. These values are never
persisted to `~/.sentry` or sent to Worker.
`core/okx-trade.js` adds the first trade-task skeleton for OKX: it builds and validates
`place_order` AgentTasks for spot `cash` mode, rejects withdrawal scope, normalizes OKX order
responses into `AgentTaskResult` evidence, builds order-status queries, and verifies venue order id
/ client order id before the dispatcher accepts a submitted result. The daemon has a mock-tested OKX
order-status fetch adapter and dispatch receipt verifier, so `agent.dispatch` can enrich an OKX
submitted result with venue order state before returning. OKX is still not globally
dispatch-ready in the Worker registry, but the local daemon can now mark a specific OKX
`place_order` task dispatch-ready when linked key metadata proves `read` + `place_order`, no
`withdraw`, `ip_allowlist=true`, local env/keychain credentials resolve, and, for dispatch paths,
local rotation metadata is not expired. An optional signed OKX balance read proves the key is
currently accepted by the venue. This is still not a complete OKX permission export or budget
custody proof; production UI wiring, live-account dry-runs and live venue key revoke/rotation are
still pending.
Hyperliquid read-only sync uses its public `info` endpoint and requires the actual master or
subaccount address via `--read-account-address` or `SENTRY_HYPERLIQUID_USER_ADDRESS`; do not use an
agent-wallet address for account state reads.
`core/hyperliquid-trade.js` adds the first Hyperliquid perps order task skeleton: it builds and
validates `place_order` AgentTasks, requires `read` + `place_order`, rejects withdrawal/transfer
scope, uses a 128-bit `cloid` as idempotency evidence, normalizes accepted/filled order responses
and lets the dispatcher reject mismatched `cloid`, coin or venue evidence. The daemon also has a
read-only Hyperliquid `orderStatus` adapter, `userRole` agent-wallet live checker and dispatch
receipt verifier, so `agent.dispatch` can confirm the configured agent wallet is still linked to the
expected master/subaccount, then enrich a submitted Hyperliquid result with sanitized order state. It
can also submit an external Agent-produced pre-signed `/exchange` payload, then verify the resulting
order state. It does not sign inside the daemon, and Hyperliquid still stays out of global
`ready_for_dispatch` until production UI wiring and end-to-end live-account dry-runs are complete.
Hyperliquid live reads, live grant checks, signed-submit POSTs and order-status checks use bounded
retry/backoff for HTTP 429 / 5xx and sanitized retry summaries. The daemon persists local
signed-submit nonce claims by default in `~/.sentry/hyperliquid-nonces.json` and blocks duplicate
`authorization_ref + nonce` reuse across restarts; use `SENTRY_HYPERLIQUID_NONCE_STORE` or
`--hyperliquid-nonce-store <path>` to override the path.
The local daemon can also mark a specific Hyperliquid `place_order` task dispatch-ready when linked
metadata proves `read` + `place_order`, no `withdraw` / `transfer`, and an actual master/subaccount
read address plus active agent-wallet grant metadata are configured. Remote daemon `agent.dispatch`
defaults to checking Hyperliquid public `info.userRole` before external-agent dispatch and before
receipt verification; direct unit calls can leave this disabled for offline tests. That local
override does not imply daemon-held signing keys or Worker global dispatch readiness.
Solana and Ethereum live inventory reads are also local-only and read-only. Set
`SENTRY_SOLANA_WALLET_ADDRESS` plus optional `SENTRY_SOLANA_RPC_URL`, and
`SENTRY_ETHEREUM_WALLET_ADDRESS` plus optional `SENTRY_ETHEREUM_RPC_URL` and
`SENTRY_ETHEREUM_TOKENS` (`SYMBOL:ADDRESS:DECIMALS,...`) before requesting an explicit live
inventory sync. `core/token-registry.js` provides the shared Solana/Ethereum metadata for SOL,
Solana USDC, ETH, WETH and Ethereum USDC, and the read adapters use it for stable symbol/decimal
normalization. These reads use bounded JSON-RPC retry/backoff and return sanitized retry summaries;
they never give the daemon signing authority.
`core/solana-trade.js` adds the first Solana swap task skeleton for external Agents: it builds a
`submit_tx` AgentTask for Jupiter/Raydium/Orca-style swaps, requires `read + sign + submit_tx`,
rejects withdrawal scope, carries quote id as idempotency evidence and verifies returned Solana
prepared unsigned transaction + simulation evidence or transaction signatures before dispatcher
acceptance. `agent/src/solana-jupiter-swap-builder.mjs` plus
`sentry-daemon solana prepare-swap` can call Jupiter quote/swap endpoints and output a one-line
`proposed` AgentTaskResult containing an unsigned transaction for local signing; it still does not
hold private keys. If `SENTRY_SOLANA_SIGNER_COMMAND` or `--solana-signer-cmd` is configured,
`agent/src/local-signer-command-handoff.mjs` can pass that prepared transaction to a local signer
command, accept the returned signature, and then `agent/src/solana-receipt-adapter.mjs` can poll
Solana `getSignatureStatuses` with bounded retry/backoff and attach sanitized receipt verification
to `agent.dispatch`.
`core/ethereum-trade.js` adds the matching Ethereum swap task skeleton for external Agents: it
builds a `submit_tx` AgentTask for Uniswap/Safe/ERC-4337-style execution, requires `read`, `sign`
and `submit_tx`, rejects withdrawal scope, carries quote id as idempotency evidence and verifies
prepared EVM transaction request + simulation evidence or returned EVM transaction hashes before
dispatcher acceptance. `agent/src/ethereum-uniswap-calldata-builder.mjs` plus
`sentry-daemon ethereum prepare-swap` can build Uniswap V3 `exactInputSingle` calldata, run
`eth_call` simulation, and output a one-line `proposed` AgentTaskResult for local signing. It does
not install a Safe module, grant a session key, or hold private keys. If
`SENTRY_ETHEREUM_SIGNER_COMMAND` or `--ethereum-signer-cmd` is configured,
`agent/src/local-signer-command-handoff.mjs` can pass the transaction request to a local signer
command, accept the returned transaction hash, and then `agent/src/ethereum-receipt-adapter.mjs`
can poll `eth_getTransactionReceipt` with bounded retry/backoff and attach sanitized receipt verification to
`agent.dispatch`.
For both Solana and Ethereum, the daemon can create a task-local dispatch-ready override only when
the task account matches either the locally configured wallet address env or a metadata-only OWS
wallet reference from `sentry-daemon wallet link`, and the task requests `read/sign/submit_tx`.
`agent/src/local-signer-probe.mjs` adds a separate non-signing local signer/address proof: set
`SENTRY_SOLANA_SIGNER_ADDRESS` or `SENTRY_SOLANA_SIGNER_PROBE_COMMAND`, and
`SENTRY_ETHEREUM_SIGNER_ADDRESS` or `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND`, then run
`sentry-daemon signer probe`. OWS wallet refs prove account/scope alignment only; they are not OWS
API-token handoff, real signature probing, or Worker global `ready_for_dispatch`.
`agent/src/local-activity-log.mjs` now writes sanitized daemon dispatch activity to
`~/.sentry/activity.jsonl` by default, records blocked and completed `agent.dispatch` attempts, and
exposes local CLI / remote `activity.tail` reads without returning raw secret-shaped fields.
`agent/src/local-policy-store.mjs` now provides the first local PolicyManager storage layer:
`~/.sentry/policies.json`, `sentry-daemon policy add/list/pause/resume/revoke`, and a due-policy
`policy tick` snapshot. Remote `policy.local.add` can upsert sanitized policy metadata through the
Worker bridge, so Dashboard controls can seed a local policy before plan/preflight without importing
secrets or dispatching. `agent/src/local-policy-task-planner.mjs` can turn due policies with
explicit `task_template(s)` into planned AgentTasks for OKX, Hyperliquid, Solana and Ethereum via
`sentry-daemon policy plan`. `agent/src/local-policy-runner.mjs` adds a guarded `policy run-once`
path that can preflight local policy scope, market triggers and readiness and, only with
`--dispatch`, send tasks to a registered external Agent. `--market-snapshot <json>` can supply
price/funding/venue-health evidence for trigger checks, and `--live-market` can build the snapshot
from public OKX ticker/funding endpoints plus Hyperliquid public `info` market endpoints. Missing
trigger data blocks dispatch, while unsatisfied triggers return a no-op/skipped result.
`agent/src/local-policy-loop.mjs` adds a daemon-owned periodic loop
controller (`--policy-loop`, remote start/stop/status/run_now) that repeatedly invokes the guarded
runner and can mark ticks. It still defaults to no dispatch and is not a production-complete
Guardian loop for live accounts.
Profile / Wallet can queue these same Worker bridge commands from the dashboard: no-dispatch policy
metadata seed, policy list/store visibility, plan/preflight, public OKX/Hyperliquid `live_market`
trigger checks, optional live inventory preflight, loop status/start/run_now/stop, activity tail and
OWS wallet refs, and `authorization.state` readiness summaries that distinguish blocked, planned,
metadata-ready and dispatch-ready venues. Dispatch remains off by default; the dashboard only sends
`dispatch=true` after the operator explicitly arms dispatch, and the daemon still enforces local
readiness plus any configured signer probe / signer command handoff.
New Strategy also uses this bridge in Local Agent mode: venue-scoped strategies register sanitized
policy metadata for OKX, Solana, Ethereum and Hyperliquid through `policy.local.add` when the daemon
is paired. Before registration, the dashboard refreshes `authorization.state` and, for chain
wallet legs, `wallet.refs`; it blocks the deploy if OKX/Hyperliquid key handles or Solana/Ethereum
OWS account refs are missing or locally blocked instead of writing placeholder accounts into the
local policy store.
It also shows an explicit blocked state when the Worker bridge is not configured.
The bridge now uses WebSocket subprotocol relay-token handoff plus bidirectional relay-token-bound
HMAC signatures for daemon `hello` / `heartbeat` / `command_result` messages and Worker
`session_accepted` / `session_revoked` / `command` messages. Both sides also reject stale
`issued_at` timestamps and missing or replayed `seq` values for the same relay session; Worker
commands must carry `expires_at`, and the daemon returns a blocked `command_result` instead of
dispatching an expired command. The Worker keeps relay-session sequence state in the AgentSession
Durable Object, and the daemon persists its local sequence counters in
`~/.sentry/bridge-sequences.json` keyed by a derived relay-token key, not by the raw token or HMAC
key. Pairing now also creates/loads a local Ed25519 daemon identity at `~/.sentry/identity.json`;
the daemon signs the pairing proof, and Worker verifies/stores the device public key before issuing
the relay token. Daemon-origin WebSocket business envelopes also carry `agent_public_key_id`,
`agent_signature_alg` and an Ed25519 `agent_signature`; AgentSession requires that device signature
when a paired public key exists, so `hello` / `heartbeat` / `command_result` are bound to the local
identity as well as the relay token. AgentSession also creates a Worker bridge Ed25519 identity and
includes its public key in the signed `session_accepted`; the daemon caches that key and requires
`worker_public_key_id`, `worker_signature_alg` and `worker_signature` on Worker-origin
`session_revoked` / `command` / `error` messages. Relay token refresh now uses a Worker-issued
short challenge signed by the local daemon Ed25519 identity: the Worker verifies the proof, rotates
the relay token, closes the old WebSocket and lets the daemon reconnect with the new short-lived
token. AgentSession now keeps a bounded pending queue for low-risk read/status commands while the
daemon is offline and replays them on reconnect; high-risk dispatch/control commands still fail fast
instead of being replayed. Sent commands now move from `queued` to `acknowledged` when daemon returns
`command_ack`; commands that were sent but not acknowledged in time are finalized as
`COMMAND_ACK_TIMEOUT` instead of staying ambiguous. If a reconnect happens after `command_ack` but
before `command_result`, AgentSession sends an internal `command.resume` probe; the daemon answers
from its local `~/.sentry/command-results.json` cache when it has a stored result, or marks the
original command as `COMMAND_RESUME_NOT_FOUND` without replaying the high-risk command.
`agent/src/local-agent-capability-probe.mjs` adds a local `agent probe` / remote `agent.probe`
surface that runs registered Agents with `--version`, checks declared baseline capabilities, reports
declared task-level venue/action capabilities, and returns bounded metadata only. Registered Agents
must declare matching task capabilities such as `okx:place_order` or `solana-mainnet:submit_tx`
before `dispatch=true` can spawn them for an autonomous task.

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

Sentry is built around three runtime planes plus an explicit authorization model:

- **Control Plane** — the Sentry Account, strategy mandates, Guardian decisions, emergency stop, and activity ledger. This is chain-agnostic.
- **Authorization Model** — one AuthorizationAdapter per venue account: OWS local policy, native delegation, smart account module, Sentry contract, or venue API key. The UI must show whether enforcement is local, chain, venue, or hybrid.
- **Execution Plane** — one adapter per venue/protocol. Currently: Sui/DeepBook demo, a shared target venue catalog and token registry, read-only inventory adapters for Solana, Ethereum, Hyperliquid and OKX, OKX `place_order` AgentTask/result verifier, order-status adapter and daemon receipt verifier, Hyperliquid `place_order` AgentTask/result verifier, local agent-wallet grant metadata gate, public `userRole` live checker, pre-signed exchange-submit adapter, local nonce store, order-status adapter and daemon receipt verifier skeleton, plus Solana and Ethereum `submit_tx` swap AgentTask/result verifier, Solana Jupiter unsigned transaction preparation, Ethereum Uniswap V3 calldata preparation, local signer command handoff for prepared transactions, env-or-OWS-account local dispatch-ready gate, non-signing local signer/address probe, bounded JSON-RPC retry/backoff and RPC receipt polling skeletons. Production trade execution still needs OWS signing API handoff, live receipt dry-runs, Safe/session-key wiring, Raydium/Orca builders, and Hyperliquid live-account dry-runs/UI wiring.
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
  │   ├── sui: MoveGate Mandate + SentryPolicyWrapper (chain accounting)
  │   ├── solana: native delegation / delegated PDA    ← target
  │   ├── ethereum: Safe module / ERC-4337 session key ← target
  │   ├── hyperliquid: API wallet + subaccount         ← target
  │   └── okx: trade-only API key + subaccount         ← first exchange
  ├── authorization adapters
  │   └── local / chain / venue / hybrid enforcement metadata
  ├── strategy mandates
  └── unified activity ledger
```

Detailed architecture: [`docs/02-architecture.md`](docs/02-architecture.md).
Build status: [`docs/STATUS.md`](docs/STATUS.md).

## Tech

- **Vite + React** (JSX) with TanStack Query, Router, Table, and Form
- **Cloudflare Worker** (Hono) with Durable Objects for per-policy runtime and bridge relay
- **Local daemon** — Node.js CLI + Agent dispatch to external Agents (stdio) + sanitized local activity JSONL
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
  local-policy-metadata.js  # shared Local Agent policy metadata builder
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
  src/index.mjs             # local daemon bridge + typed remote commands
  src/local-agent-registry.mjs # registered external Agent metadata
  src/local-agent-capability-probe.mjs # command/version + declared capability probe
  src/local-policy-store.mjs # local policy metadata + due tick selection
  src/local-policy-task-planner.mjs # due policy task_template(s) -> planned AgentTasks
  src/local-market-snapshot.mjs # public OKX/Hyperliquid market snapshot builder
  src/local-policy-runner.mjs # guarded run-once preflight/readiness/dispatch
  src/local-policy-loop.mjs # daemon-owned periodic policy loop controller
  src/daemon-identity-store.mjs # local Ed25519 device identity + pairing proof
  src/bridge-sequence-store.mjs # relay-session seq persistence without raw relay tokens
  src/agent-dispatcher.mjs  # AgentTask -> subprocess stdin -> AgentTaskResult stdout
  src/local-activity-log.mjs # sanitized local dispatch activity JSONL + tail
scripts/
  local-bridge-smoke.mjs    # repeatable Worker + daemon bridge smoke
```

## Docs

- [Architecture](docs/02-architecture.md)
- [Local Agent + Open Wallet Plan](docs/10-local-agent-openwallet.md)
- [Local Agent, Agent Dispatch & Worker Bridge](docs/11-local-agent-worker-bridge.md)
- [Authorization Adapter Model](docs/13-authorization-adapters.md)
- [Multivenue Roadmap](docs/06-post-mvp-multivenue-roadmap.md) — Solana, Ethereum, Hyperliquid, OKX, settlement
- [Build Status](docs/STATUS.md)
- [Technical Spec](docs/03-technical-spec.md)
- [Market & Product Roadmap](docs/09-market-product-and-frontend-roadmap.md)
