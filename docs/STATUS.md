# Sentry — Build Status

日期：2026-06-02 · 环境：Sui Testnet

A running snapshot of what is built and how it was verified. Demo-facing summary for judges / handoff.

## Product direction update (2026-06-03)

Production direction is now **Agent dispatch platform**. The Sentry daemon manages policies, Guardian checks, and dispatches tasks to external Agents (Claude Code / Codex / Kimi). The daemon does NOT execute trades itself — external Agents use local toolchains (OWS, Solana CLI, wallets) for signing and execution.

New planning/frontend work:

- `docs/10-local-agent-openwallet.md` records the Open Wallet Standard assessment.
- `docs/11-local-agent-worker-bridge.md` records the CLI daemon, Agent dispatch protocol, pairing, Cloudflare Worker bridge, and AgentSession Durable Object.
- `docs/02-architecture.md` updated to Agent dispatch architecture.
- `docs/01-prd.md` updated to Agent dispatch model.
- Profile / Wallet now exposes a daemon control plane: OWS vault, Worker bridge, registered Agents, venue accounts and asset sources.
- New Strategy defaults to Local (daemon + Agent dispatch) and labels Remote Worker as the optional Sui Testnet path.

## What ships

| Layer | Status | Verified by |
| --- | --- | --- |
| **Web dashboard** (Vite + React) | ✅ | `npm run build` (2,419 modules); landing → zkLogin → dashboard, flash-crash demo |
| **Move package** `sentry::policy` | ✅ deployed | `sui move test` 8/8; published `0x92f6e3…bb78` |
| **Worker API** (Cloudflare + Hono) | ✅ all endpoints | `npm test` + `npm run typecheck`; runtime activity log covered |
| **Sign-in** | ✅ | Sui wallet (Slush/std, no creds) primary; Enoki zkLogin optional |
| **Frontend ↔ Worker contract** | ✅ wired | live reads are Worker-first with direct-chain fallback; create/revoke use Worker-built unsigned txs |
| **Live write loop** (create / list / revoke) | ✅ **verified on-chain** | real policy created (`9SQWkBne…`) + revoked (`Gzniih…`); endpoints return live data; post-revoke reads `Revoked` |
| **Live execution** (Deepbook order) | 🟡 gated | builders + dry-run; blocked on testnet DBUSDC funding |
| **Local Agent daemon** | 🟡 skeleton | `agent/` Node daemon can connect to Worker and manage one external child process over stdio |
| **Agent dispatch protocol** | 🟡 skeleton | AgentTask/AgentTaskResult types + stdio dispatch path in daemon; Claude Code / Codex child process support started |
| **Local Agent Worker bridge** | 🟡 skeleton | Worker daemon auth + AgentSession WebSocket/status/command endpoints started; not production auth |
| **External Agent process manager** | 🟡 skeleton | `agent.start` / `agent.stop` command path exists for Claude Code / Codex-style child processes |
| **OWS integration** | 🔴 planned | architecture/spec assessed; package not wired into runtime yet |
| **Exchange API key store** | 🔴 planned | local secret-store contract documented; no keyring implementation yet |

## On-chain (testnet)

- sentry package: `0x92f6e3218151e4d16fa51fd49df974a84ea744510f5e5a8ff79a01aacf27bb78`
- agent: `0x9eeed099…2ee43` · passport `0x0e7421…f8e6b` · BalanceManager `0x2e2e818f…aec2` (unfunded)
- reuses deployed MoveGate `0xec91e6…cf884a` · Deepbook `SUI_DBUSDC` pool `0x1c1936…7163a5`
- See `deployment.testnet.json` (`npm run config`).

## Phase ledger

- **B** feasibility — ✅ GO (`docs/B-feasibility-findings.md`): MoveGate Mandate shareable w/o owner co-sign, AuthToken hot-potato, Deepbook pools live.
- **C** Move — ✅ C1–C7. SentryPolicyWrapper + create/revoke/assert/record; thin helper builds `vector<TypeName>`; AuthToken consumed via MoveGate receipt; published.
- **E** Worker — ✅ E1–E8. parse (strategy_hash matches all 4 spec vectors) · create_policy PTB (zkLogin-signed, dry-run success) · activity (chain-authoritative + Durable Object runtime feed) · Guardian · tick state machine · Durable Object alarm · state sync.
- **F** Deepbook — 🟡 F1/F3 builders structurally verified (serialize + dry-run of create). Agent + BalanceManager provisioned on-chain. **Blocked:** DBUSDC mint is permissioned and the SUI_DBUSDC pool is illiquid, so the BM can't be self-funded → live execution dry-run pending an external DBUSDC source. `EXECUTION_ENABLED=false` until then.
- **D** dashboard wiring — ✅ sign-in (Sui wallet primary, zkLogin optional); live create-policy (parse → build → wallet-sign → activate); live D4 activity + D5 revoke; responsive + lazy-loaded landing; D3 live PTB preview. **Live write loop proven on-chain** (see below).
- **G** packaging — ✅ G1 `npm run config`; G3 README quickstart; this status doc. G2 execute-leg of the demo script is gated with F.

## Live write loop — verified on-chain (2026-06-02)

Broadcast with the dedicated agent key (agent-as-owner for the test):
- `create_policy` → tx `9SQWkBneN2jZ1ovETaZyRkx8UrwntSUBceBwPT2gRYdP` → wrapper `0x85703d17…55ea4`, mandate `0x1587a441…33825`.
- Worker endpoints returned it live: `/api/policies?owner=` (1), `/api/activity?owner=` (PolicyCreated), `/api/policies/:id/activity` (`Monitoring`, spent 0).
- `revoke_policy` → tx `GzniihEkpUNJG3dr1K1e5J3f5YWJ75B6yBnYMvmWEfmg` → `PolicyRevoked`; post-revoke reads `revoked:true` / `runtime_state: Revoked`, activity = 2 events.

So create / list / activity / revoke are real on testnet. In the browser, a connected Sui wallet drives the same Worker-first flow (no DBUSDC needed); read-only screens can fall back to direct Sui/DeepBook reads when `VITE_WORKER_URL` is absent.

## Known gaps / next

0. **Agent dispatch implementation** — production direction is Agent dispatch platform. The repo has a first Worker bridge + `agent/` daemon skeleton, but does not yet: (a) remove self-execution ExecutorAdapter code from daemon, (b) fully implement AgentTask/AgentTaskResult dispatch protocol, (c) implement subprocess/stdio dispatch for Claude Code/Codex/Kimi, (d) add Agent registry and capability matrix.
1. **DBUSDC funding** — the only true remaining gap, and **self-funding is confirmed impossible** on this testnet: DBUSDC `mint` is TreasuryCap-gated (cap not public), DEEP `mint` returns `FunctionNotFound` on the current package, and a SUI→DBUSDC swap needs DEEP for taker fees (a zero-DEEP swap fills 0 even with a live bid). Needs an **external DBUSDC source** (DeepBook-team faucet, or an address that already holds DBUSDC/DEEP). Once the agent BalanceManager holds DBUSDC: flip `EXECUTION_ENABLED=true` and replay the execution PTB (`worker/src/deepbook.js` `buildExecutionTx`).
2. **Browser wallet click-through** — connect Slush (testnet) and run create/revoke from the UI against `VITE_WORKER_URL` (the on-chain txs above prove the underlying Worker path; the current UI now uses Worker-built txs again).
3. **zkLogin live test** (optional) — only if using Enoki instead of a wallet.
