# Sentry Technical Spec v1.0

状态：Draft
日期：2026-06-01
定位：Sentry：自主 DeFi 风险响应 Agent
适用范围：Sui Testnet Worker demo + Local Agent-first technical contract

## 0. Agent Dispatch Architecture

2026-06-03 起，Sentry 的生产架构改为 **Agent 调度平台**：

- 守护程序（daemon）负责 Policy 管理、Tick 监控、Guardian 风控、Agent 调度。
- 守护程序**不自行执行交易**。交易执行委托给外部 Agent（Claude Code、Codex、Kimi 等）。
- 外部 Agent 使用本机已有的 OWS vault、Solana CLI、钱包、chain RPC 等工具链完成签名和执行。
- Worker/Durable Object 仍是已验证的 Sui Testnet demo runtime，保留但不作为生产路径。
- Worker Bridge 是可选 relay，用于 paired 守护程序的远程状态和 typed command。

外部 Agent 调度协议详见 `docs/11-local-agent-worker-bridge.md` §5a。

## 1. Constants

所有实现必须集中定义以下常量，不允许在业务逻辑里散落 magic numbers。

| Name | Value | Notes |
| --- | --- | --- |
| `BPS_DENOMINATOR` | `10_000` | basis points denominator |
| `DEFAULT_MAX_SLIPPAGE_BPS` | `100` | 1.00% default preview value |
| `MAX_ALLOWED_SLIPPAGE_BPS` | `500` | 5.00% hard MVP ceiling |
| `DEFAULT_TICK_INTERVAL_SECONDS` | `60` | Local Agent / demo Worker tick interval |
| `MAX_POLICY_LIFETIME_SECONDS` | `604800` | 7 days |
| `MIN_POLICY_BUDGET` | implementation coin unit dependent | must be non-zero |
| `SUPPORTED_CHAIN` | `sui:testnet` | MVP only |
| `EXECUTOR_KIND_DEEPBOOK` | `deepbook` | only registered MVP executor adapter |
| `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` | `10` | MVP concurrency cap |
| `SENTRY_PROTOCOL_ADDRESS` | published Sentry package address | protocol address passed to MoveGate |
| `ACTION_DEEPBOOK_RESCUE` | `1` | MoveGate action type for rescue trades |
| `REVOKE_REASON_OWNER` | `1` | owner-requested revocation reason |
| `MOVEGATE_DEFAULT_CREATION_FEE_MIST` | `10_000_000` | MoveGate source default, 0.01 SUI |
| `INTERNAL_AGENT_TICK_HEADER` | `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>` | required for internal tick endpoint |
| `DEFAULT_AGENT_MODE` | `local` | production default runtime |
| `DEFAULT_OWS_VAULT_PATH` | `~/.ows` | local wallet vault |
| `DEFAULT_SENTRY_HOME` | `~/.sentry` | local agent config, state and logs |
| `BRIDGE_PROTOCOL_VERSION` | `1` | Local Agent bridge envelope version |
| `PAIRING_CODE_TTL_SECONDS` | `300` | pairing code lifetime |
| `AGENT_BRIDGE_HEARTBEAT_SECONDS` | `30` | daemon heartbeat upper bound |
| `AGENT_BRIDGE_STALE_SECONDS` | `90` | mark remote session stale after missing heartbeat |
| `REMOTE_COMMAND_TTL_SECONDS` | `120` | default command expiry |
| `MAX_BRIDGE_COMMAND_QUEUE` | `100` | bounded queue per AgentSession DO |
| `MAX_AGENT_COMMAND_RECORDS` | `50` | bounded command result records retained per AgentSession DO |
| `TARGET_VENUE_IDS` | `solana-mainnet`, `ethereum-mainnet`, `hyperliquid`, `okx` | production target integration catalog |
| `LEGACY_DEMO_VENUE_IDS` | `sui-testnet-demo` | verified Sui Testnet demo path |

Enforcement notes:

- `DEFAULT_MAX_SLIPPAGE_BPS` is the default value inserted into new strategy previews.
- `MAX_ALLOWED_SLIPPAGE_BPS` is the chain-level creation cap. Runtime Guardian checks use each policy's `max_slippage_bps`, not the global default.
- `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` is enforced only by Worker/API state. The Move package does not enforce a global deployment count, so direct chain calls can create more policies; this cap is an MVP operational limit, not a security invariant.
- `EXECUTOR_KIND_DEEPBOOK` is part of the confirmed strategy hash. Future adapters must introduce explicit executor kinds and tests before they can be accepted.
- `TARGET_VENUE_IDS` is the shared catalog used by frontend, Worker and daemon. It is a target integration list, not proof that every adapter is production-ready.

## 2. Agent Identity and Signing

### Agent Dispatch Model

Sentry 守护程序不自行签名或执行交易。签名和执行由外部 Agent 使用本机环境完成。

守护程序的角色：
- 构建 `AgentTask`（策略上下文 + 动作 + 约束）
- 通过 subprocess/stdio 分发给外部 Agent
- 接收 `AgentTaskResult`，验证并记录

外部 Agent 的角色：
- 接收结构化任务
- 使用本机 OWS vault / Solana CLI / wallets 等环境构建并签名交易
- 返回结构化结果

```ts
type AgentTask = {
  task_id: string;
  policy_id: string;
  target_agent: string;
  policy_context: { chain: string; venue: string; budget_remaining: string; spent_amount: string; max_slippage_bps: number; strategy_type: string; expires_at_ms: number };
  action: { type: string; params: Record<string, unknown> };
  constraints: { budget_cap: string; slippage_cap_bps: number; venue_scope: string[]; require_simulation: boolean; require_receipt: boolean };
  authorization: AgentTaskAuthorization;
  issued_at_ms: number;
  expires_at_ms: number;
};

type AgentTaskResult = {
  task_id: string;
  status: 'proposed' | 'submitted' | 'done' | 'blocked' | 'error';
  tx_digest?: string;
  venue_order_id?: string;
  order_id?: string;
  evidence?: Record<string, unknown>;
  code?: string;
  summary?: string;
  amount_spent?: string;
  amount_received?: string;
  observed_at?: string;
};
```

Current implementation:

- `agent/src/local-agent-registry.mjs` stores local external Agent metadata in `~/.sentry/agents.json` (override: `SENTRY_AGENT_REGISTRY` or `--agent-registry`). It records `agent_id`, display name, command, capabilities and enabled flag with `0600` file permissions, and rejects command arguments that look like raw tokens/secrets/passwords/passphrases/API keys/private keys.
- `agent/src/local-agent-capability-probe.mjs` probes registered external Agent commands with bounded `--version` execution, infers a known profile for Codex / Claude Code / Kimi where possible, checks declared baseline dispatch capabilities, and redacts secret-shaped probe output. It proves local command availability, not trade execution competence.
- `agent/src/local-policy-store.mjs` stores local policy metadata in `~/.sentry/policies.json` (override: `SENTRY_POLICY_STORE` or `--policy-store`). It records policy id, target venues, target Agent, status and tick cadence, rejects raw secret-shaped fields, and can compute due policy ticks without executing them.
- `agent/src/local-policy-task-planner.mjs` turns due policies with explicit `task_template(s)` / `planned_tasks` into planned AgentTasks for OKX, Hyperliquid, Solana and Ethereum. It requires local key metadata or explicit account metadata, validates with `allow_planned`, rejects raw secret-shaped fields, and does not dispatch or mark ticks.
- `agent/src/local-policy-trigger-guard.mjs` evaluates explicit local policy trigger metadata against a supplied market snapshot. It supports price above/below, price drop/rise bps, funding rate and venue-health triggers. Missing trigger market data blocks readiness/dispatch; an unsatisfied trigger returns a no-op/skipped result and must not spawn an external Agent.
- `agent/src/local-market-snapshot.mjs` builds a one-shot public market snapshot for trigger checks. It can read OKX public ticker/funding endpoints and Hyperliquid public `info` market endpoints without API keys. This is not yet a durable market subscription service; failures surface as access issues and must not be replaced with demo prices.
- `agent/src/local-policy-runner.mjs` is the current one-shot policy loop skeleton. It consumes the due-policy plan, runs a local policy guard for venue/agent/action/capability/budget/slippage scope, evaluates market triggers when readiness, inventory or dispatch is requested, optionally checks local dispatch readiness, and only dispatches to a registered external Agent when `dispatch=true`.
- `agent/src/local-policy-loop.mjs` controls the daemon-owned periodic policy loop. It supports start/stop/status/run_now, prevents overlapping runs, records run summaries including no-op/skipped counts, defaults to `dispatch=false`, and calls the guarded runner on each interval.
- `core/agent-task.js` validates AgentTask shape, rejects raw secret-shaped fields, requires authorization metadata and blocks expired tasks.
- `agent/src/agent-dispatcher.mjs` implements the current stdio transport: spawn command, write sanitized AgentTask JSON to stdin, parse the final JSON AgentTaskResult line from stdout, and reject results that contain raw secret-shaped fields.
- `agent/src/local-activity-log.mjs` writes sanitized `agent.dispatch` activity to `~/.sentry/activity.jsonl` by default, records blocked local decisions and accepted dispatch summaries, and supports local/remote tail reads without exposing raw secret-shaped fields.
- Submitted/done results require `tx_digest`, `venue_order_id`, `order_id`, `simulation_id` or `receipt_ref` evidence before the daemon accepts the result.
- This is still pre-production dispatch for the global Worker registry: target venue execution adapters are not globally dispatch-ready. The local daemon can create a narrow `local_daemon` dispatch-ready override for OKX `place_order` tasks only after local key metadata, IP allowlist and credential resolution pass; it can create the same task-local override for Hyperliquid `place_order` only after linked local metadata proves `read` + `place_order`, no withdrawal/transfer scope, a real master/subaccount read address and, by default, public `userRole` live grant evidence. Solana and Ethereum can create a task-local override when the task account matches either the locally configured wallet-address env or a metadata-only OWS wallet reference and the task requires `read/sign/submit_tx`; `agent/src/local-signer-probe.mjs` can add separate non-signing address proof from explicit signer env or a local probe command. Solana/Ethereum proposed results now have to provide prepared transaction + successful simulation evidence before daemon acceptance, and `agent/src/local-signer-command-handoff.mjs` can hand those prepared transactions to a configured local signer command (`SENTRY_SOLANA_SIGNER_COMMAND` / `SENTRY_ETHEREUM_SIGNER_COMMAND`) before bounded JSON-RPC receipt polling. This is still not OWS API-token handoff, real signature probing or live receipt dry-run completion.

### Legacy SignerRouter（Sui Testnet Worker demo）

```ts
type SignerRef =
  | { kind: 'ows_wallet'; wallet_id: string; account_id: string; chain_id: string; token_ref: string }
  | { kind: 'exchange_api_key'; venue_id: string; key_handle: string; permissions: string[] }
  | { kind: 'manual_approval'; account_id: string; reason: string };

interface SignerRouter {
  resolve(policy: PolicySnapshot, plan: ExecutionPlan): Promise<SignerRef>;
  signOrExecute(ref: SignerRef, plan: ExecutionPlan): Promise<ExecutionResult>;
}
```

Rules:

- `ows_wallet` signs chain transactions or messages through OWS local service / subprocess / binding.
- OWS owner passphrase must not be passed through the browser.
- `token_ref` is a local reference to an OWS `ows_key_...` token, not the raw token string in UI state.
- `exchange_api_key` may only represent read + trade scopes. Withdrawal permission is a hard failure.
- `manual_approval` is returned when a policy requires human approval or a planned action exceeds autonomous scope.

### Sui Testnet Worker demo

The existing MVP uses one team-controlled Testnet agent wallet per deployment.

- The public address is configured as `SENTRY_AGENT_ADDRESS`.
- The signing credential is stored as a Cloudflare secret or equivalent local dev secret, never in frontend code.
- Users cannot choose or override `agent` in MVP.
- `/api/intents/parse` inserts this address into the structured strategy and PTB preview.
- `/api/policies` must verify the submitted strategy agent equals `SENTRY_AGENT_ADDRESS`.
- Agent key rotation affects only new policies. Existing policies name the old agent until owner revokes and recreates them.

## 3. Local Secret Store and Inventory

### VenueAccount

```ts
type VenueAccount = {
  id: string;
  venue_kind: 'chain' | 'dex' | 'perps' | 'cex' | 'bridge';
  venue_id: string;
  custody_model: 'self_custody' | 'smart_account' | 'subaccount' | 'api_key' | 'vault';
  authority_model: string;
  authorization_model: AuthorizationModel;
  enforcement_layer: EnforcementLayer;
  authorization_ref?: string;
  constraint_support: ConstraintSupport;
  chain_enforced: boolean;
  budget_enforcement: BudgetEnforcement;
  funds_custodied: boolean;
  owner_address?: string;
  agent_address?: string;
  account_ref?: string;
  signer_ref?: SignerRef;
  capabilities: string[];
  status: 'active' | 'paused' | 'revoked' | 'expired' | 'needs_reauth';
};
```

Rules:

- CEX accounts must use subaccounts when available.
- CEX API keys must be read + trade only.
- `account_ref` may be a wrapper id, Safe address, subaccount id, API key handle or OWS wallet id.
- `capabilities` must distinguish read, sign, submit tx, place order, cancel order, transfer and withdraw. Withdraw must be false by default and unsupported for autonomous strategies.
- `chain_enforced=true` is valid only when a chain contract/module/native delegation can actually reject invalid actions.
- `ows_policy_only` must use `enforcement_layer='local'` and must not be presented as chain-enforced.
- `venue_api_key` must use `enforcement_layer='venue'` or `hybrid`, and must reject withdrawal permission by default.

### AuthorizationAdapter

Sentry separates authorization from execution. `AuthorizationAdapter` answers "what authority exists and where is it enforced"; `ExecutorAdapter` answers "how to execute a specific plan".

```ts
type AuthorizationModel =
  | 'ows_policy_only'
  | 'native_delegation'
  | 'smart_account_module'
  | 'sentry_contract'
  | 'venue_api_key';

type EnforcementLayer = 'local' | 'chain' | 'venue' | 'hybrid';

type BudgetEnforcement =
  | 'none'
  | 'local_accounting'
  | 'chain_accounting'
  | 'custody'
  | 'venue_limit';

type AuthCapability =
  | 'read'
  | 'sign'
  | 'submit_tx'
  | 'place_order'
  | 'cancel_order'
  | 'transfer'
  | 'withdraw'
  | 'set_leverage'
  | 'settle';

type ConstraintSupport = {
  budget: 'none' | 'local' | 'chain' | 'venue';
  expiry: 'none' | 'local' | 'chain' | 'venue';
  revoke: 'none' | 'local' | 'chain' | 'venue';
  venue_scope: 'none' | 'local' | 'chain' | 'venue';
  audit_log: 'none' | 'local' | 'chain' | 'venue';
};

type AgentTaskAuthorization = {
  authorization_ref: string;
  authorization_model: AuthorizationModel;
  enforcement_layer: EnforcementLayer;
  chain_enforced: boolean;
  budget_enforcement: BudgetEnforcement;
  funds_custodied: boolean;
  capabilities_required: AuthCapability[];
  constraint_support: ConstraintSupport;
  must_not_claim_chain_enforced: boolean;
};
```

Rules:

- Every `VenueAccount` must resolve to exactly one active `AuthorizationAdapter`.
- Every executable `AgentTask` must include `AgentTaskAuthorization`.
- Missing or stale `authorization_ref` must block dispatch.
- OWS can sign or submit through an external Agent, but OWS-only is local policy enforcement.
- Custom Sentry contracts/programs are required only when product claims require chain-enforced budget, scope, expiry, revoke or audit and existing chain/venue primitives cannot provide them.
- `chain_enforced=true` does not automatically mean funds are custodied. A chain contract may enforce authorization and accounting while real funds remain in an agent wallet or venue account.
- `funds_custodied=true` is required before UI or docs claim that real funds cannot exceed a policy's physical budget.
- Dashboard copy must reflect `enforcement_layer` exactly: local, chain, venue or hybrid.

### SecretStore

```ts
interface SecretStore {
  putExchangeKey(input: ExchangeKeyImport): Promise<KeyHandle>;
  getScopedCredential(handle: KeyHandle, purpose: 'read' | 'trade'): Promise<ScopedCredential>;
  revoke(handle: KeyHandle): Promise<void>;
  verifyPermissions(handle: KeyHandle): Promise<PermissionCheck>;
}
```

Rules:

- Raw exchange secret is stored in OS keychain / keyring.
- `~/.sentry` stores metadata only: key handle, venue id, permission proof, subaccount id, IP allowlist status, rotation interval and last rotation timestamp.
- Any key with withdrawal permission must be rejected.
- Key use must be written to local activity log with request summary, not raw secret.
- `core/local-secrets.js` validates metadata-only OKX and Hyperliquid key handles, rejects raw secret-shaped fields, rejects `withdraw`, and exposes only sanitized key handles.
- `agent/src/local-venue-store.mjs` implements the current local metadata file at `~/.sentry/venues.json` (override: `SENTRY_VENUE_CONFIG` or `--venue-config`). It writes `0600` JSON containing `venue_id`, `key_handle`, `display_handle`, `account_ref`, permissions, IP allowlist status, rotation interval and `created_at` / `rotated_at` metadata only.
- Current CLI surface: `sentry-daemon venue add/list/remove/rotate` plus `sentry-daemon venue credentials status/store` for OKX. `venue rotate --confirm` records local rotation metadata after the operator rotates key material outside Sentry; it is not a live venue API rotation. The `store` command uses macOS Keychain's interactive `security ... -w` prompt and must not accept raw secret values as CLI arguments.
- `verifyVenueKeyOperationalProof` is the current local proof gate for OKX and Hyperliquid autonomous dispatch. It requires `status='linked'`, `read` and `place_order`, no `withdraw`, non-expired local rotation metadata when a rotation timestamp exists, and `ip_allowlist=true` for OKX before receipt verification can query the venue. This is metadata attestation plus credential-auth proof, not an OKX/Hyperliquid API-readable permission export.

### AssetPosition

```ts
type AssetPosition = {
  venue_id: string;
  account_ref: string;
  asset_id: string;
  symbol: string;
  free: string;
  locked: string;
  borrowed?: string;
  notional_usd: string;
  source: 'ows' | 'chain_rpc' | 'cex_api' | 'perps_api' | 'manual';
  observed_at: string;
  stale_after_ms: number;
};
```

Guardian must consume a bounded `InventorySnapshot` built from these positions. Adapters should not bypass InventoryStore for risk checks.

`core/inventory.js` is the current local InventoryStore skeleton. It exposes read-only adapter metadata for Solana, Ethereum, Hyperliquid, OKX and the Sui demo path. OKX and Hyperliquid can be marked `configured_readonly` when a local key handle exists; Solana and Ethereum are `read_adapter_ready` for explicit local live reads when wallet/RPC environment variables are configured. The skeleton must not invent balances: empty `positions` are valid until a real adapter returns observed data.

`agent/src/okx-readonly-adapter.mjs` is the first exchange read adapter skeleton. It implements OKX API v5 request path construction, HMAC-SHA256 Base64 signing, authenticated headers, read-scope preflight, balance response normalization and mock-fetch tests for `GET /api/v5/account/balance`. It also exposes `verifyOkxLiveReadProof`, which sends the same signed balance read and returns only sanitized proof metadata (`key_handle`, `account_ref`, request path, HTTP status, OKX code, observed time and retry summary). This proves the local key is currently accepted for signed read access; it does not prove a complete venue-side trade-permission export.

`core/okx-trade.js` is the first exchange trade-task skeleton. It builds and validates OKX spot
`place_order` AgentTasks for `/api/v5/trade/order` in `tdMode='cash'`, requires local key metadata
with both `read` and `place_order` capabilities, rejects `withdraw`, carries
`budget_enforcement='venue_limit'` and `funds_custodied=false`, and uses `clOrdId` as the task
idempotency key. It also builds OKX order-status queries, normalizes accepted order responses and
order-status responses, and verifies venue order id / client order id evidence. `agent/src/agent-dispatcher.mjs`
calls the OKX verifier for `venue_id='okx'` / `action.type='place_order'` tasks, so submitted/done
results must include `venue_order_id` or `order_id`, and `client_order_id` must match the dispatched
task when present.

`agent/src/okx-order-status-adapter.mjs` is the daemon-side order-status adapter. It signs
`GET /api/v5/trade/order` requests with the same OKX API v5 HMAC header helper, fetches status by
`instId` plus `ordId` and/or `clOrdId`, rejects mismatched `clOrdId`, and returns sanitized status
evidence only. `agent/src/dispatch-receipt-verifier.mjs` wires this into daemon `agent.dispatch`:
after an OKX external Agent returns `submitted` / `done`, the daemon checks local key operational
proof, resolves local OKX credentials, queries order status, rejects mismatched `clOrdId`, and
returns a sanitized `receipt_verification` object without raw secrets.
`agent/src/local-dispatch-readiness.mjs` is the current local ready gate: before spawning an OKX
external Agent, daemon `agent.dispatch` requires linked OKX key metadata, `read` + `place_order`, no
`withdraw`, `ip_allowlist=true`, and resolvable local env/keychain credentials. For direct
`agent.dispatch` and `policy.local.run_once dispatch=true`, the daemon defaults to an additional
signed OKX balance-read proof unless payload `verify_okx_live_read=false` or CLI
`--no-verify-okx-live-read` is used for offline tests. Before spawning a
Hyperliquid external Agent, it requires linked Hyperliquid metadata, `read` + `place_order`, no
`withdraw` / `transfer`, an actual master/subaccount read address, and active agent-wallet grant
metadata. When daemon `agent.dispatch` runs Hyperliquid tasks it defaults to an additional public
`info.userRole` check that confirms the configured agent wallet still has role `agent` and still
points at the expected master/subaccount read address; payload `verify_live_grant=false` is reserved
for offline tests and demos. On success it passes `local_dispatch_ready_venues=['okx']` or
`['hyperliquid']` into the shared AgentTask validator, which sets
`dispatch_ready_source='local_daemon'` for that task only. The Worker registry still must not list
OKX or Hyperliquid in global `ready_for_dispatch`; production UI wiring, complete OKX permission
enumeration / live key revoke, Hyperliquid live-account dry-runs and live submit verification remain
pending.

`agent/src/okx-rate-limit.mjs` implements the current local OKX retry policy. OKX authenticated
balance reads and order-status reads retry HTTP 429 / 5xx and retryable OKX API codes with bounded
exponential backoff, optional `Retry-After` handling, and sanitized retry summaries. This is a local
daemon protection layer; it does not prove venue-side quotas or replace production monitoring.

`agent/src/chain-rpc-rate-limit.mjs` implements the shared local Solana/Ethereum JSON-RPC retry
policy. Solana/Ethereum read-only inventory calls and receipt polling retry network errors, HTTP
429 / 5xx and configured retryable JSON-RPC error codes with bounded exponential backoff, optional
`Retry-After` handling and sanitized retry summaries. `agent/src/solana-readonly-adapter.mjs`,
`agent/src/ethereum-readonly-adapter.mjs`, `agent/src/solana-receipt-adapter.mjs` and
`agent/src/ethereum-receipt-adapter.mjs` use this helper. This improves local daemon robustness
against public RPC instability; it is not a durable subscription system or proof that a transaction
will eventually finalize.

`agent/src/local-credential-resolver.mjs` resolves OKX live-read credentials from local environment variables first: generic `SENTRY_OKX_API_KEY`, `SENTRY_OKX_SECRET_KEY`, `SENTRY_OKX_PASSPHRASE`, or key-handle-specific `SENTRY_OKX_<KEY_HANDLE>_API_KEY` / `SECRET_KEY` / `PASSPHRASE`. If env is incomplete, it falls back to `agent/src/os-keychain.mjs`, which reads macOS Keychain generic-password entries under service `sh.sentry.venue.okx.<key_handle>` with accounts `api_key`, `secret_key` and `passphrase`. The resolver returns only credential resolution metadata in daemon outputs; raw secrets are not stored in `~/.sentry`, not returned to Worker and not included in `inventory.sync` results.

`agent/src/live-inventory-sync.mjs` adds explicit live OKX, Hyperliquid, Solana and Ethereum reads for daemon `inventory.sync` when the remote command payload sets `live: true`. Default inventory sync remains metadata-only and must not make network calls.

`agent/src/hyperliquid-readonly-adapter.mjs` implements the Hyperliquid read-only public `info` endpoint path for `clearinghouseState`, `spotClearinghouseState` and `frontendOpenOrders`. It requires the actual master/subaccount user address from `read_account_address`, `account_ref` when it is a 42-character address, or `SENTRY_HYPERLIQUID_USER_ADDRESS`; agent-wallet handles are not valid for account state reads. The adapter normalizes perp positions, spot balances and open orders into the local inventory shape and uses `agent/src/hyperliquid-rate-limit.mjs` for bounded retry/backoff on network errors, HTTP 429 and 5xx responses.

`core/hyperliquid-trade.js` is the first Hyperliquid perps trade-task skeleton. It builds and
validates `venue_id='hyperliquid'` / `action.type='place_order'` AgentTasks for `/exchange`,
requires local metadata with both `read` and `place_order`, rejects `withdraw` and `transfer`,
stores `budget_enforcement='venue_limit'` and `funds_custodied=false`, and uses a 128-bit `cloid`
as `constraints.idempotency_key`. It normalizes resting/filled order responses into
AgentTaskResult evidence and verifies `venue_order_id`, `client_order_id`/`cloid`, `coin` and
`venue_id` before the dispatcher accepts submitted/done results. It also builds `orderStatus`
queries for Hyperliquid's public `info` endpoint, normalizes order state, and verifies returned
`oid` / `cloid` / `coin` evidence. `agent/src/hyperliquid-order-status-adapter.mjs` wires that query
to bounded retry/backoff, and `agent/src/dispatch-receipt-verifier.mjs` can enrich accepted
Hyperliquid dispatch results with sanitized order state.

`core/hyperliquid-trade.js` also validates external-Agent-produced signed `/exchange` payloads:
`action`, safe-integer `nonce`, optional future `expiresAfter`, optional `vaultAddress`, public
`signature.{r,s,v}`, no raw secret-shaped fields, and task-bound `cloid`. `agent/src/hyperliquid-exchange-submit-adapter.mjs`
can POST that pre-signed payload to `/exchange`, normalize the accepted/fill response and feed the
result into Hyperliquid receipt verification. This still does not put private keys in the daemon and
external Agent/local wallet tooling remains responsible for producing the signature.

`core/local-secrets.js` stores Hyperliquid agent-wallet grant metadata without raw secrets:
`agent_wallet_address`, `agent_wallet.grant_status`, proof source, `verified_at`, scoped
permissions, optional `revoked_at` and optional expiry. `agent/src/local-dispatch-readiness.mjs` and
`agent/src/dispatch-receipt-verifier.mjs` both require this proof to be active, distinct from the
master/subaccount read address, include `read` + `place_order`, and exclude `withdraw` / `transfer`
before accepting Hyperliquid dispatch or receipt verification. `agent/src/hyperliquid-agent-wallet-adapter.mjs`
adds the mock-tested live verifier: it POSTs public `info` requests with `type='userRole'` for the
agent wallet address, requires role `agent`, verifies the returned owner/master user matches the
configured master/subaccount read address, and returns sanitized `agent_wallet_live_grant` evidence.
Daemon `agent.dispatch` enables that live check by default before Hyperliquid dispatch and receipt
verification.

`agent/src/hyperliquid-nonce-store.mjs` is the current local replay guard for signed exchange
submits. Daemon `agent.dispatch` defaults to `~/.sentry/hyperliquid-nonces.json`, with
`SENTRY_HYPERLIQUID_NONCE_STORE` or `--hyperliquid-nonce-store <path>` as overrides. The submit
adapter persists a claim before POSTing and later finalizes the record as `submitted` / `done` /
`submit_failed` / `submit_rejected`. The record key is `authorization_ref + nonce`, and duplicate
claims are rejected before any network request. This is a local daemon guard, not a venue-side
grant/revoke management layer, not a real-account dry-run, and not a replacement for Hyperliquid's
nonce rules.

`agent/src/solana-readonly-adapter.mjs` implements local Solana JSON-RPC reads for native SOL balance and SPL token accounts. It requires `SENTRY_SOLANA_WALLET_ADDRESS` or `SENTRY_SOLANA_OWNER`, and optionally uses `SENTRY_SOLANA_RPC_URL`; it does not sign or submit transactions.

`core/solana-trade.js` is the first Solana swap task skeleton. It builds and validates
`venue_id='solana-mainnet'` / `action.type='submit_tx'` AgentTasks for external Agent execution,
with `intent='swap'`, adapter `jupiter` / `raydium` / `orca` / `custom`, wallet owner, input/output
mints, base-unit amount, slippage bps and quote id. It requires `read`, `sign` and `submit_tx`,
rejects `withdraw`, carries quote id as `constraints.idempotency_key`, and verifies returned Solana
prepared unsigned transaction + successful simulation evidence or transaction `signature` /
`tx_signature`, `venue_id`, quote id and error evidence before dispatcher acceptance. This is not a
daemon submit adapter: `agent/src/solana-jupiter-swap-builder.mjs` can prepare a Jupiter unsigned
swap transaction and single-line `proposed` AgentTaskResult for local signing, while Raydium/Orca
builders, signing and submission remain with the external Agent / local wallet tooling.
`agent/src/solana-receipt-adapter.mjs` adds daemon-side mock-tested receipt polling through
`getSignatureStatuses`; submitted/done Solana dispatch results are accepted as receipt-verified only
after RPC observes the signature and reports no transaction error.
`agent/src/local-dispatch-readiness.mjs` can also create a task-local Solana dispatch-ready override
after `validateSolanaSwapTask` passes and either `SENTRY_SOLANA_WALLET_ADDRESS` /
`SENTRY_SOLANA_OWNER` or a linked OWS `solana:mainnet:<address>` wallet reference matches the task
owner. `agent/src/local-signer-probe.mjs` can attach optional non-signing proof via
`SENTRY_SOLANA_SIGNER_ADDRESS` or `SENTRY_SOLANA_SIGNER_PROBE_COMMAND`; daemon `agent.dispatch` may
require this with `require_signer_probe=true`. `agent/src/local-signer-command-handoff.mjs` can pass
accepted `proposed` unsigned transactions to `SENTRY_SOLANA_SIGNER_COMMAND` or
`--solana-signer-cmd`, normalize the returned signature and then continue receipt verification. This
must not be presented as OWS API-token handoff, real signature probing or global Worker dispatch
readiness.

`agent/src/ethereum-readonly-adapter.mjs` implements local Ethereum JSON-RPC reads for native ETH balance and optional ERC-20 balances. It requires `SENTRY_ETHEREUM_WALLET_ADDRESS` or `SENTRY_ETHEREUM_OWNER`, optionally uses `SENTRY_ETHEREUM_RPC_URL`, and reads ERC-20 balances from `SENTRY_ETHEREUM_TOKENS` in `SYMBOL:ADDRESS:DECIMALS,...` or JSON-array form. It does not install a Safe module, create a session key, sign calls or submit transactions.

`core/ethereum-trade.js` is the first Ethereum swap task skeleton. It builds and validates
`venue_id='ethereum-mainnet'` / `action.type='submit_tx'` AgentTasks for external Agent execution,
with `intent='swap'`, adapter `uniswap` / `safe` / `erc4337` / `custom`, local wallet or smart
account address, input/output ERC-20 addresses, base-unit amount, slippage bps and quote id. It
requires `read`, `sign` and `submit_tx`, rejects `withdraw`, carries quote id as
`constraints.idempotency_key`, declares `transaction_format='evm_transaction_request'`, and
verifies either a prepared EVM transaction request with matching `from`, non-empty calldata and
successful simulation evidence or returned `tx_hash` / `transaction_hash`, `venue_id`, `chain_id`,
quote id and receipt error evidence before dispatcher acceptance. This is not a daemon submit
adapter: `agent/src/ethereum-uniswap-calldata-builder.mjs` can prepare a Uniswap V3
`exactInputSingle` transaction request and RPC `eth_call` simulation evidence, while Safe/session-key
grant installation, signing and submission remain with the external Agent / local wallet tooling.
`agent/src/ethereum-receipt-adapter.mjs` adds daemon-side mock-tested receipt polling through
`eth_getTransactionReceipt`; submitted/done Ethereum dispatch results are accepted as
receipt-verified only after RPC observes a matching transaction receipt and does not report
`status=0x0`.
`agent/src/local-dispatch-readiness.mjs` can also create a task-local Ethereum dispatch-ready
override after `validateEthereumSwapTask` passes and either `SENTRY_ETHEREUM_WALLET_ADDRESS` /
`SENTRY_ETHEREUM_OWNER` or a linked OWS `eip155:1:<address>` wallet reference matches the task
account. `agent/src/local-signer-probe.mjs` can attach optional non-signing proof via
`SENTRY_ETHEREUM_SIGNER_ADDRESS` or `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND`; daemon
`agent.dispatch` may require this with `require_signer_probe=true`.
`agent/src/local-signer-command-handoff.mjs` can pass accepted `proposed` transaction requests to
`SENTRY_ETHEREUM_SIGNER_COMMAND` or `--ethereum-signer-cmd`, normalize the returned transaction hash
and then continue receipt verification. This must not be presented as Safe/session-key discovery,
OWS API-token handoff, real signature probing or global Worker dispatch readiness.

### TargetVenueCatalog

`core/venues.js` is the shared source of truth for the current target scope. It must be importable by frontend, Worker and daemon without Node-only APIs.

```ts
type TargetVenueCatalog = {
  generated_at: string;
  target_venue_ids: string[];
  legacy_demo_venue_ids: string[];
  venues: VenueAccount[];
  readiness: {
    target_count: number;
    chain_or_ledger_count: number;
    exchange_count: number;
    legacy_demo_count: number;
  };
};
```

Rules:

- Target venues are Solana, Ethereum, Hyperliquid and OKX.
- Sui Testnet DeepBook remains in `legacy_demo_venue_ids` because it is the verified demo path, not the production target scope.
- OKX must be represented as `authorization_model='venue_api_key'`, `enforcement_layer='venue'`, `budget_enforcement='venue_limit'`, `funds_custodied=false`, and no `withdraw` capability.
- Solana and Ethereum may expose swap task/result verifier skeletons, prepared transaction signing-handoff checks, local signer command handoff, env-or-OWS-account local dispatch-ready gates, non-signing signer/address probe, bounded JSON-RPC retry/backoff and RPC receipt polling while remaining non-global-dispatch-ready until OWS signing handoff and live-account dry-runs exist. Solana may additionally expose a Jupiter unsigned transaction builder; Ethereum may additionally expose a Uniswap V3 calldata builder. Both must still expose their intended authorization model (`native_delegation`, `smart_account_module`) and whether chain enforcement is currently true or false.
- Hyperliquid must be represented as a perps/spot venue with venue-side enforcement, not as an EVM/Solana chain. Its current adapter status is a trade-task skeleton plus read-only inventory, local agent-wallet grant metadata gate, public `userRole` live grant check, pre-signed `/exchange` payload submission, default local nonce-store replay guard and public order-status verification; daemon-held signing, end-to-end live-account dry-runs, live submit verification and production UI wiring remain incomplete.

## 4. Local Agent Bridge Protocol

The Worker bridge is optional. It lets a paired browser session observe and request actions from a Local Agent daemon without opening an inbound port on the user's machine.

### Pairing

```ts
type PairingRequest = {
  owner_session_id: string;
  device_label?: string;
};

type PairingChallenge = {
  pairing_code: string;
  expires_at: string;
  owner_control_token: string;
  owner_control_token_expires_at: string;
};

type PairingSubmit = {
  pairing_code: string;
  agent_id: string;
  agent_public_key: string; // Ed25519 SPKI DER, base64url
  agent_public_key_alg: 'Ed25519';
  agent_public_key_encoding: 'spki-der-base64url';
  agent_public_key_id: string;
  device_name: string;
  supported_capabilities: string[];
  pairing_proof_issued_at: string;
  signed_nonce: string; // Ed25519 signature over canonical daemon pairing proof payload
};

type PairingResult = {
  agent_id: string;
  websocket_url: string;
  relay_token: string;
  relay_token_expires_at: string;
};

type RelayTokenChallenge = {
  agent_id: string;
  agent_public_key_id: string | null;
  challenge_id: string;
  challenge: string;
  expires_at: string;
};

type RelayTokenRefresh = {
  challenge_id: string;
  challenge: string;
  agent_public_key_id: string;
  refresh_proof_issued_at: string;
  signed_nonce: string; // Ed25519 signature over canonical daemon refresh proof payload
};
```

Rules:

- pairing code TTL is `PAIRING_CODE_TTL_SECONDS`.
- pairing code is single-use.
- `owner_control_token` is short-lived and belongs to the Dashboard/session side for command submission until real user auth replaces it.
- daemon identity key storage is implemented: the daemon stores an Ed25519 key in
  `~/.sentry/identity.json` by default, submits a signed pairing proof, and Worker verifies it before
  consuming the pairing code or issuing a relay token. The same paired public key is used to verify
  daemon-origin WebSocket envelope signatures.
- Worker stores only token hashes, owner binding, device metadata, capabilities and daemon public key
  metadata.
- `relay_token` is short-lived, belongs only to the daemon WebSocket connection and must not be exposed to the browser.
- daemon should send `relay_token` through `Sec-WebSocket-Protocol: sentry-rt.<token>` for WebSocket
  upgrade. Query-string token support is a compatibility fallback only.
- Relay token refresh uses `POST /api/local-agents/:agent_id/relay-token/challenge` followed by
  `POST /api/local-agents/:agent_id/relay-token/refresh`. The daemon signs the Worker challenge
  with its local Ed25519 identity; AgentSession verifies the stored public key, rotates the
  short-lived relay token, resets relay-token-scoped sequence counters and closes the old WebSocket
  so the daemon reconnects with the new token.

### BridgeEnvelope

All WebSocket messages use a signed JSON envelope. Implemented v0 uses relay-token-bound
HMAC-SHA256 over the canonical envelope without signature fields. AgentSession verifies
daemon-origin messages before mutating session state, and daemon verifies Worker-origin
session/command messages before acting on them. For paired sessions, daemon-origin envelopes must
also include `agent_public_key_id`, `agent_signature_alg: "Ed25519"` and `agent_signature` over the
same canonical envelope; AgentSession verifies that signature against the stored daemon public key.
AgentSession also persists a Worker bridge Ed25519 identity and includes its public key metadata in
the signed `session_accepted` envelope. After accepting that key, daemon requires Worker-origin
envelopes to include `worker_public_key_id`, `worker_signature_alg: "Ed25519"` and
`worker_signature` over the same canonical envelope. Both sides attach a positive monotonic `seq`
and reject missing, repeated or lower sequence numbers for the same relay session. Worker sequence
state is persisted in AgentSession Durable Object storage; daemon sequence state is persisted in
`~/.sentry/bridge-sequences.json` using a derived relay-token key, never the raw relay token or HMAC
signing key. Both sides also reject stale or far-future `issued_at` timestamps. Worker `command`
envelopes must include `expires_at`; the daemon blocks expired commands before dispatch and returns
a command-result error for Dashboard polling. The daemon returns `command_ack` before executing a
remote command; AgentSession stores that as `acknowledged`, and a sent command that does not receive
ack before the ack deadline is finalized as `COMMAND_ACK_TIMEOUT`. The daemon device identity is
also used for challenge-based relay token refresh. Low-risk read/status commands may be stored in a
bounded AgentSession pending queue while daemon is offline and replayed on reconnect; high-risk
dispatch/control commands fail fast instead of being replayed.

```ts
type BridgeEnvelope = {
  version: 1;
  session_id: string;
  agent_id: string;
  message_id: string;
  seq: number;
  kind:
    | 'hello'
    | 'heartbeat'
    | 'capabilities'
    | 'inventory_summary'
    | 'activity_summary'
    | 'command'
    | 'command_ack'
    | 'command_result'
    | 'error';
  issued_at: string;
  expires_at?: string;
  idempotency_key?: string;
  payload: unknown;
  signature: string;
};
```

Requirements:

- `version` must equal `BRIDGE_PROTOCOL_VERSION`.
- `message_id` is unique and `seq` is monotonic per relay session.
- signed daemon `hello` is required before AgentSession DO marks the daemon online.
- AgentSession must reject unsigned or tampered daemon `hello`, `heartbeat`, `agent.status` and
  `command_result` messages before mutating session state.
- daemon must reject unsigned or tampered Worker `session_accepted`, `session_revoked` and
  `command` messages before accepting bridge state changes or executing commands.
- both sides must reject missing, repeated or lower `seq` values for the same relay session.
- both sides must reject stale or far-future `issued_at` values before applying side effects.
- command messages must include `expires_at`, and expired commands must be blocked before dispatch.
- command results must reference original `message_id` or `idempotency_key`.
- AgentSession stores bounded command records for Dashboard polling. Records contain command id,
  idempotency key, command type, safe payload summary and command result metadata; they must not
  store full AgentTask payloads or raw local secrets.
- `POST /commands` is idempotent when the caller supplies `idempotency_key`: the same key and command
  type returns the existing safe command record without sending a duplicate WebSocket command, while
  reusing the same key for a different command type returns `IDEMPOTENCY_KEY_CONFLICT`.
- messages must not contain OWS token, wallet passphrase, wallet private key, exchange raw API secret or full local DB rows.

### RemoteCommand

```ts
type RemoteCommand =
  | { type: 'agent.status' }
  | { type: 'agent.start'; command?: string }
  | { type: 'agent.stop' }
  | { type: 'agent.registry' }
  | { type: 'agent.probe'; agent_id?: string; timeout_ms?: number }
  | { type: 'agent.dispatch'; task: AgentTask; target_agent?: string; command?: string; timeout_ms?: number; verify_live_grant?: boolean; verify_okx_live_read?: boolean; require_signer_probe?: boolean; signer_probe_timeout_ms?: number }
  | { type: 'venue.catalog' }
  | { type: 'authorization.registry' }
  | { type: 'authorization.revoke'; authorization_ref?: string; venue_id?: string; key_handle?: string; wallet_id?: string; reason?: string; confirm: true }
  | { type: 'authorization.rotate'; authorization_ref?: string; venue_id?: string; key_handle?: string; rotated_at?: string; reason?: string; confirm: true }
  | { type: 'authorization.state'; scope?: string[] }
  | { type: 'authorization.validate'; task: AgentTask }
  | { type: 'secret.store' }
  | { type: 'wallet.refs' }
  | { type: 'inventory.adapters' }
  | { type: 'inventory.sync'; scope?: string[]; live?: boolean; okx_ccy?: string; simulated?: boolean }
  | { type: 'signer.probe'; scope?: string[]; timeout_ms?: number }
  | { type: 'activity.tail'; limit?: number }
  | { type: 'policy.local.add'; policy?: object }
  | { type: 'policy.local.list' }
  | { type: 'policy.local.tick'; limit?: number; mark?: boolean }
  | { type: 'policy.local.plan'; limit?: number; simulated?: boolean }
  | { type: 'policy.local.run_once'; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean; timeout_ms?: number; verify_receipt?: boolean; verify_live_grant?: boolean; verify_okx_live_read?: boolean; simulated?: boolean; market_snapshot?: object; live_market?: boolean; market_venues?: string[]; market_symbols?: string[] }
  | { type: 'policy.local.loop.status' }
  | { type: 'policy.local.loop.start'; interval_ms?: number; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean; verify_okx_live_read?: boolean; run_immediately?: boolean; market_snapshot?: object; live_market?: boolean; market_venues?: string[]; market_symbols?: string[] }
  | { type: 'policy.local.loop.stop'; reason?: string }
  | { type: 'policy.local.loop.run_now'; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean; verify_okx_live_read?: boolean; market_snapshot?: object; live_market?: boolean; market_venues?: string[]; market_symbols?: string[] }
  | { type: 'policy.preview'; strategy: StructuredStrategy }
  | { type: 'policy.deploy'; strategy_hash: string; policy_ref: string }
  | { type: 'policy.pause'; policy_id: string }
  | { type: 'policy.resume'; policy_id: string }
  | { type: 'policy.revoke'; policy_id: string }
  | { type: 'venue.recheck'; venue_id: string }
  | { type: 'orders.cancel'; policy_id: string; venue_id?: string }
  | { type: 'emergency.stop'; scope: 'global' | 'policy' | 'venue'; target_id?: string };
```

Rules:

- Worker may request; Local Agent decides.
- `agent.start` and `agent.stop` control only the local external Agent child process. They do not grant trading authority.
- `agent.registry` returns local registered Agent metadata from `~/.sentry/agents.json`; it cannot modify local command registrations.
- `agent.probe` runs bounded local command availability/capability probes for registered Agents. It returns version/capability metadata only and cannot import secrets or prove end-to-end trade execution.
- `agent.dispatch` performs a one-task stdio round trip. It validates AgentTask authorization before spawning, resolves `target_agent` through the local registry when present, sends no raw local secrets, and returns only sanitized AgentTaskResult metadata.
- `authorization.state` loads local venue key metadata and OWS wallet refs, then returns a sanitized
  read-state snapshot for Solana, Ethereum, Hyperliquid, OKX and the legacy Sui demo. It can show
  `metadata_ready`, `missing`, `partial` or `blocked` grant/read/revoke state plus venue-key
  rotation state. Expired local rotation metadata becomes a blocked access issue; due-soon metadata
  is a warning. It cannot create grants, revoke venue permissions, rotate live venue keys, read raw
  API secrets or import wallet credentials.
- `authorization.revoke` is a local metadata safety stop: for OKX/Hyperliquid key handles it marks
  the local key metadata `revoked` and strips trading permissions; for OWS wallet refs it marks the
  wallet ref `revoked` and strips `sign/submit_tx` capability. It requires `confirm=true`, writes
  local activity, must not be replayed after reconnect, and must return `live_authority_revoked=false`
  with `manual_revoke_required` / `chain_revoke_required` until a real venue/chain revoke proof is
  implemented.
- `authorization.rotate` is a local metadata proof update for OKX/Hyperliquid key handles only. It
  requires `confirm=true`, writes local activity, must not be replayed after reconnect, updates
  `rotated_at` / `rotation_reason`, and must return `live_authority_rotated=false` with
  `manual_rotation_required=true` because the live venue key material must be rotated outside
  Sentry first.
- `wallet.refs` returns metadata-only OWS wallet references and CAIP-10 accounts. It must not return
  OWS API tokens, passphrases, private keys, seeds or mnemonics.
- `activity.tail` returns recent sanitized local activity events from the daemon's configured activity JSONL path. It is read-only and cannot reveal raw local secrets.
- `policy.local.add` upserts sanitized local policy metadata into `~/.sentry/policies.json`; it reuses raw-secret rejection and target-venue validation, and it must not grant authority, start loops, mark ticks or submit orders. New Strategy Local Agent deploy and the repeatable bridge smoke must share the same local policy metadata builder so UI payload changes remain covered by smoke. `policy.local.list` returns local policy metadata; `policy.local.tick` returns policies whose `next_tick_after` is due. `mark=true` only advances local tick timestamps; it must not submit orders. `policy.local.plan` turns due policies with explicit task templates into planned AgentTasks and must not spawn external Agents. `policy.local.run_once` runs the same plan through local policy guard, trigger guard, and optional readiness/dispatch; `market_snapshot` or CLI `--market-snapshot` supplies explicit trigger evidence, while `live_market=true` / `--live-market` builds a public OKX/Hyperliquid market snapshot. `dispatch=false` is preflight only, while `dispatch=true` still requires trigger satisfaction, a registered Agent command and local readiness. `policy.local.loop.*` controls the daemon-owned periodic run-once loop and must default to no dispatch unless explicitly requested.
- `policy.pause`, `policy.resume` and `policy.revoke` update local policy status and write sanitized local activity. They do not grant new authority, raise limits or import strategy secrets.
- Local Agent must validate policy scope, credential scope, Guardian result, inventory freshness and owner approval requirements before executing.
- Unsupported or high-risk remote actions return `OWNER_APPROVAL_REQUIRED`, `POLICY_SCOPE_DENIED`, `CREDENTIAL_SCOPE_DENIED`, `STALE_INVENTORY`, `SESSION_REVOKED`, `COMMAND_EXPIRED` or `UNSUPPORTED_REMOTE_COMMAND`.
- Withdrawal, wallet/key export, raw secret reveal, exchange key import and policy limit increase are not supported remotely.
- External Agent stdout/stderr must be size-bounded and treated as untrusted data.

### Worker API

```text
POST /api/local-agents/pairing
POST /api/local-agents/pair
GET  /api/local-agents
GET  /api/local-agents/:agent_id
POST /api/local-agents/:agent_id/revoke
GET  /api/local-agents/:agent_id/connect
POST /api/local-agents/:agent_id/relay-token/challenge
POST /api/local-agents/:agent_id/relay-token/refresh
POST /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands/:command_id
GET  /api/local-agents/:agent_id/activity
GET  /api/venues/catalog
GET  /api/authorization/registry
```

Rules:

- `/connect` requires WebSocket upgrade and a valid relay token.
- Worker validates owner/session before routing to AgentSession DO.
- AgentSession DO validates signed daemon envelopes, paired daemon Ed25519 identity signatures,
  relay-session sequence, envelope timestamp freshness, command expiry and idempotency. Daemon
  validates signed Worker envelopes, paired Worker Ed25519 identity signatures, relay-session
  sequence, envelope timestamp freshness and command expiry. Challenge-based relay token refresh is
  implemented. AgentSession records `command_ack`, marks commands `acknowledged`, finalizes sent
  unacked commands as `COMMAND_ACK_TIMEOUT`, implements low-risk offline command replay with bounded
  storage, sends internal `command.resume` probes for acknowledged commands after reconnect, and
  makes owner command submission idempotent by caller-provided `idempotency_key`. High-risk commands
  are never replayed across reconnect; resume only returns a daemon-stored local result, `pending`,
  or explicit `COMMAND_RESUME_NOT_FOUND`.
- AgentSession DO marks status `stale` after `AGENT_BRIDGE_STALE_SECONDS` without heartbeat.
- `POST /commands` requires owner-control auth, allowlists command types, deduplicates by
  caller-provided `idempotency_key`, sends one command to the live daemon or defers low-risk
  replayable commands while offline, and stores a bounded safe command record. `GET /commands` and
  `GET /commands/:command_id` require the same owner-control auth and may resolve by command
  `message_id` or idempotency key.
- Cloudflare deploys may drop WebSockets; daemon must reconnect with backoff and local tick loop must continue offline.
- `/api/venues/catalog` returns the shared `TargetVenueCatalog` for Dashboard rendering and smoke tests. It must not include secrets, wallet tokens or raw exchange API material.
- `/api/authorization/registry` returns the shared AuthorizationAdapter registry snapshot. It is metadata/preflight only and must not include raw OWS tokens, wallet private keys or exchange API secrets.

## 5. Composable Runtime Contract

Runtime Core is shared by the Local Agent daemon and the optional Worker/Durable Object demo. It owns policy loading, AuthorizationAdapter selection, ExecutorAdapter selection, Guardian evaluation and activity logging. Protocol-specific behavior lives behind AuthorizationAdapter and ExecutorAdapter.

`core/authorization.js` is the current shared AuthorizationAdapter registry skeleton. It must:

- resolve every target `VenueAccount` to one authorization ref;
- expose `authorization_model`, `enforcement_layer`, `capabilities`, `constraint_support`, `chain_enforced`, `budget_enforcement` and `funds_custodied`;
- reject AgentTask dispatch when authorization metadata or `authorization_ref` is missing;
- reject capability requirements outside the ref scope, especially `withdraw`;
- return `ADAPTER_NOT_DISPATCH_READY` for target adapters that only have metadata/preflight and are not yet executable;
- accept a daemon-supplied local dispatch-ready override only for venues that the local daemon has just proven ready for the current task;
- preserve Sui Testnet as the only globally dispatch-ready legacy demo authorization.

```ts
type ExecutorKind = 'deepbook';

type ExecutionPlan = {
  executor_kind: ExecutorKind;
  target_id: string;
  action_type: number;
  quote_amount: string;
  estimated_slippage_bps: number;
  preview: string[];
};

interface ExecutorAdapter {
  kind: ExecutorKind;
  readMarket(policy: PolicySnapshot): Promise<MarketSnapshot>;
  planExecution(policy: PolicySnapshot, strategy: StructuredStrategy, market: MarketSnapshot): Promise<ExecutionPlan>;
  buildPtb?(plan: ExecutionPlan, auth: MoveGateAuthContext): Promise<Transaction>;
  buildOrder?(plan: ExecutionPlan, signer: SignerRef): Promise<VenueOrderRequest>;
  parseExecutionResult(result: SuiTransactionResult | VenueOrderResult): Promise<ActivityEvent>;
}
```

Rules:

- MVP registers only `deepbook`.
- `/api/intents/parse` must reject unknown `executor_kind` with `UNSUPPORTED_EXECUTOR`.
- The adapter must return an `ExecutionPlan` before any PTB is signed.
- Guardian checks run against the `ExecutionPlan`; an adapter cannot submit directly.
- `quote_amount`, `estimated_slippage_bps`, `target_id`, and `action_type` must match the values encoded in the PTB.
- Runtime Core must use the same adapter interface in Local Agent and optional Worker/Durable Object demo code.
- Non-chain adapters use `buildOrder` and must still emit an auditable `ExecutionPlan`.
- Chain adapters use `buildPtb` and SignerRouter routes signing to OWS or the existing Worker demo signer.
- Runtime Core must resolve `AgentTaskAuthorization` before dispatch. Execution without an authorization ref is invalid even if Guardian allows the plan.

Post-MVP adapter candidates:

- `cdpm`: Cetus DLMM Position Manager / LeafSheep-style agent operations.
- `scallop`: supply, redeem, unwind and risk-reduction flows.
- `kai`: SAV vault supply/redeem flows.

These adapters are not allowed to reuse the Deepbook-specific `pool_id` constraint unless their target semantics are equivalent. If they need position ids, vault ids, lending market ids or bin ranges, add adapter-specific wrapper fields or a new wrapper version.

## 6. Move Package Surface

### 架构：MoveGate + SentryPolicyWrapper

Sentry 复用 MoveGate 的 Mandate（Agent 授权、撤销、过期）和 AuthToken（hot-potato 同一 PTB 强制消费），在此之上搭建 SentryPolicyWrapper 覆盖 DeFi 风险响应特有约束（pool_id、链上记账预算、滑点、strategy_hash）。MVP wrapper 不是 custody vault。

MoveGate Testnet 部署：
- Package ID：`0xec91e604714e263ad43723d43470f236607bd0b13f64731aad36b00a61cf884a`
- Published-at：`0x1e7fbc6ee51094c3df050fade2e37455adfef7de4d9b79c84a168910067c9f46`
- AgentRegistry：`0xb2fadc7ccf9c7b578ba3b1adb8ebfd73191563e536b6b2cc18aa14dac6c7ba46`
- MandateRegistry：`0x26a66d91fef324b833d07d134e5ab6e796e0dfd77f670c27da099479d939b0d3`
- FeeConfig：`0x5c92c420f4b3801eb4126fcab6cb4b98212b31f591b4b3d0a025b4e4957120f3`
- ProtocolTreasury：`0xf0714bd816e595cacfc9e5921d1754cca0205f6b65867eab6183d0b0a98fc82c`

Integration constraints:

- The deployment agent must register its MoveGate `AgentPassport` once before any user creates a policy.
- Worker must either build MoveGate calls directly in the PTB or call a thin Sentry Move helper that wraps MoveGate creation. In both routes, the MoveGate SDK is only a transaction-building convenience. Chain authorization/accounting comes from MoveGate + SentryPolicyWrapper code; custody enforcement does not exist in v1.
- A created Mandate must be accessible to later agent-signed PTBs. Preferred route: the owner creation PTB creates the Mandate and makes it shared before activation. Phase B0 must compile-prove this with MoveGate's current package. If the Mandate cannot be shared or otherwise accessed by the agent without owner signing, MoveGate integration is invalid for MVP and the project must fall back to an independent shared `RescuePolicy` route.
- MoveGate authorizes the Sentry wrapper protocol, not Deepbook directly. Sentry checks the Deepbook `pool_id`, recorded budget amount and slippage constraints, but v1 does not bind those checks to actual custody of DeepBook funds.
- MoveGate Mandate data must be read through public accessors such as `mandate_owner`, `mandate_agent`, `mandate_expires_at_ms`, `mandate_revoked`, `mandate_spent_this_epoch`, and `mandate_total_actions`; Sentry must not assume private field access.
- MoveGate source default creation fee is `10_000_000` MIST. Phase B0 must read the live `FeeConfig` via `movegate::treasury::creation_fee` or an equivalent chain read before submitting creation transactions, because the deployed fee can be changed by MoveGate admin.

### SentryPolicyWrapper object

The MVP Move package must expose one shared policy wrapper object that references a MoveGate Mandate.

```move
public struct SentryPolicyWrapper has key, store {
    id: UID,
    owner: address,
    mandate_id: ID,          // reference to MoveGate Mandate
    agent: address,          // cached from mandate for efficiency
    pool_id: ID,             // v1 target constraint: specific Deepbook pool
    budget_coin_type: String,
    budget_ceiling: u64,
    spent_amount: u64,       // cumulative, never resets
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
}
```

Field rules:

- `owner` is recorded at creation from `tx_context::sender(ctx)`.
- `mandate_id` references the MoveGate Mandate that enforces agent authorization, expiry and revocation.
- `agent` is cached from the Mandate for fast access; must match `movegate::mandate::mandate_agent(mandate)`.
- `pool_id` is the only Deepbook pool this policy may target. In v1 this is a Deepbook-specific target field; future non-Deepbook adapters must add adapter-specific target constraints instead of overloading it.
- `budget_coin_type` is the human-readable coin type used for preview and UI consistency.
- `budget_ceiling` and `spent_amount` use the smallest unit of `budget_coin_type`.
- `budget_ceiling` and `spent_amount` are accounting fields. They do not represent a `Balance<BudgetCoin>` held by the wrapper.
- `max_slippage_bps` must be `<= MAX_ALLOWED_SLIPPAGE_BPS`.
- `strategy_hash` is `blake2b-256(canonical_strategy_json_utf8)`.
- The owner creation PTB must share the returned wrapper before activation.

### Move entry functions and PTB composition

`create_policy` is a Worker-built creation flow. Phase B0 chooses one of two routes:

- Direct PTB route: Worker calls MoveGate `create_mandate`, then Sentry `create_policy_wrapper`, then shares the returned objects.
- Thin helper route: Worker calls a Sentry Move helper that internally builds `allowed_coin_types`, calls MoveGate `create_mandate`, creates the wrapper, and shares both objects.

Either route must:

1. Use the owner as transaction sender.
2. Call MoveGate `create_mandate` with:
   - `registry: &mut movegate::mandate::MandateRegistry`
   - `agent_registry: &mut movegate::passport::AgentRegistry`
   - `passport: &mut movegate::passport::AgentPassport`
   - `treasury: &mut movegate::treasury::ProtocolTreasury`
   - `fee_config: &movegate::treasury::FeeConfig`
   - `agent = SENTRY_AGENT_ADDRESS`
   - `spend_cap = max_single_trade_amount`
   - `daily_limit = budget_ceiling`
   - `allowed_protocols = [SENTRY_PROTOCOL_ADDRESS]`
   - `allowed_coin_types = [type_name::with_original_ids<BudgetCoin>()]` if the PTB route can construct `TypeName`; otherwise Phase B0 must switch creation to a thin Sentry Move helper that builds this vector inside Move.
   - `allowed_actions = [ACTION_DEEPBOOK_RESCUE]`
   - `expires_at_ms` from the confirmed strategy
   - `min_agent_score = option::none()` for MVP
   - `payment: &mut Coin<SUI>` with value at least the live MoveGate creation fee; expected default is `10_000_000` MIST.
   - `clock: &Clock`
   - `ctx: &mut TxContext`
3. Pass the returned Mandate to Sentry `create_policy_wrapper`.
4. Make both the Mandate and the wrapper accessible to future agent-signed execution PTBs.

```move
public fun create_policy_wrapper(
    mandate: &movegate::mandate::Mandate,
    pool_id: ID,
    budget_coin_type: String,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    strategy_hash: vector<u8>,
    ctx: &mut TxContext,
): SentryPolicyWrapper
```

Preconditions:

- `tx_context::sender(ctx)` is recorded as `owner`.
- `budget_ceiling > 0`.
- `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS`.
- `movegate::mandate::mandate_owner(mandate) == tx_context::sender(ctx)`.
- `movegate::mandate::mandate_agent(mandate) == SENTRY_AGENT_ADDRESS`.
- `movegate::mandate::mandate_expires_at_ms(mandate)` satisfies the confirmed strategy expiry.
- `movegate::mandate::mandate_allowed_protocols(mandate)` includes `SENTRY_PROTOCOL_ADDRESS`.

Postconditions:

- Creates one `SentryPolicyWrapper` referencing the mandate.
- Shares or returns the wrapper for sharing in the same PTB.
- Emits `PolicyCreated` with both mandate_id and wrapper_id.
- Does not deposit budget funds into the wrapper. Execution funds remain in the agent wallet / DeepBook BalanceManager for v1.

```move
public entry fun revoke_policy(
    wrapper: &mut SentryPolicyWrapper,
    mandate: &mut movegate::mandate::Mandate,
    mandate_registry: &mut movegate::mandate::MandateRegistry,
    passport: &mut movegate::passport::AgentPassport,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == wrapper.owner` and `wrapper.owner == movegate::mandate::mandate_owner(mandate)`.
- `!movegate::mandate::mandate_revoked(mandate)`.
- `object::id(mandate) == wrapper.mandate_id`.

Postconditions:

- Calls MoveGate `revoke_mandate(mandate, mandate_registry, passport, REVOKE_REASON_OWNER, clock, ctx)`.
- Emits `PolicyRevoked`.

```move
public fun assert_policy_valid(
    wrapper: &SentryPolicyWrapper,
    agent: address,
    pool_id: ID,
    amount: u64,
    slippage_bps: u16
)
```

Preconditions (Sentry-specific checks, MoveGate auth handled by `authorize_action`):

- `pool_id == wrapper.pool_id`.
- `wrapper.spent_amount + amount <= wrapper.budget_ceiling`.
- `slippage_bps <= wrapper.max_slippage_bps`.
- `agent == wrapper.agent`.

Postconditions:

- No state mutation. Abort on any violation.
- Note: Mandate-level checks (revoked, expired) are enforced by MoveGate's `authorize_action` which runs earlier in the PTB.

```move
public fun record_agent_trade(
    wrapper: &mut SentryPolicyWrapper,
    mandate: &mut movegate::mandate::Mandate,
    passport: &mut movegate::passport::AgentPassport,
    agent_registry: &mut movegate::passport::AgentRegistry,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    auth_token: movegate::mandate::AuthToken,  // consumed here
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == wrapper.agent`.
- `object::id(mandate) == wrapper.mandate_id`.
- `pool_id == wrapper.pool_id`.
- `wrapper.spent_amount + quote_amount_spent <= wrapper.budget_ceiling`.
- `slippage_bps <= wrapper.max_slippage_bps`.
- `quote_amount_spent > 0`.
- `movegate::mandate::auth_token_mandate_id(&auth_token) == wrapper.mandate_id`.
- `movegate::mandate::auth_token_agent(&auth_token) == wrapper.agent`.
- `movegate::mandate::auth_token_protocol(&auth_token) == SENTRY_PROTOCOL_ADDRESS`.
- `movegate::mandate::auth_token_amount(&auth_token) == quote_amount_spent`.

Postconditions:

- Runs all wrapper-specific asserts before consuming the AuthToken.
- Calls `movegate::receipt::create_success_receipt(auth_token, mandate, passport, agent_registry, wrapper.owner, SENTRY_PROTOCOL_ADDRESS, quote_amount_spent, 0, option::none(), clock, ctx)`.
- Consumes the AuthToken exactly once through MoveGate receipt creation.
- Increments `wrapper.spent_amount` by `quote_amount_spent`.
- Emits `AgentTradeExecuted`.
- Does not move `Coin<BudgetCoin>` or verify a real DeepBook fill. `quote_amount_spent` and `base_amount_received` are PTB inputs, so callers must not treat v1 as custody-enforced.

## 7. Sentry Events

Sentry 自身发出以下事件。MoveGate 的 ActionReceipt 提供额外的不可变审计轨迹（`freeze_object`）。

```move
public struct PolicyCreated has copy, drop {
    mandate_id: ID,            // MoveGate Mandate ID
    wrapper_id: ID,            // SentryPolicyWrapper ID
    owner: address,
    agent: address,
    pool_id: ID,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    expires_at_ms: u64,
    strategy_hash: vector<u8>,
}
```

```move
public struct PolicyRevoked has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    owner: address,
    revoked_at_ms: u64,
}
```

```move
public struct AgentTradeExecuted has copy, drop {
    mandate_id: ID,
    wrapper_id: ID,
    agent: address,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    spent_amount_after: u64,
    budget_ceiling: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    executed_at_ms: u64,
}
```

The transaction digest is not stored inside the Move event because it is not available inside the transaction before execution completes. Indexers and the dashboard must read it from event metadata. MoveGate's ActionReceipt（`freeze_object`）provides a second, immutable audit source.

Guardian blocks are runtime activity records in MVP, not Move events. This avoids paying gas for no-op safety decisions and avoids emitting block events after a Mandate has been revoked or expired.

Guardian reason codes:

- `1`: slippage exceeds max.
- `2`: budget would exceed ceiling.
- `3`: mandate expired.
- `4`: mandate revoked.
- `5`: pool mismatch.
- `6`: concentration risk warning.
- `7`: mandate and wrapper mismatch.

## 8. Structured Strategy

Natural language must parse into this JSON shape before confirmation:

```json
{
  "version": "1",
  "strategy_type": "risk_response",
  "owner": "0x...",
  "agent": "0x...",
  "chain": "sui:testnet",
  "executor_kind": "deepbook",
  "pool_id": "0x...",
  "budget_coin_type": "0x...::coin::USDC",
  "budget_ceiling": "500000000",
  "trigger": {
    "metric": "price_drop_pct",
    "asset": "SUI",
    "threshold_pct": "8"
  },
  "execution": {
    "order_type": "market_or_ioc",
    "max_slippage_bps": 100,
    "max_single_trade_amount": "100000000"
  },
  "expires_at_ms": 1780000000000
}
```

Rules:

- `strategy_type` MVP supports only `risk_response`.
- `executor_kind` MVP supports only `deepbook`.
- `agent` must equal deployment config `SENTRY_AGENT_ADDRESS`.
- `chain` must equal `sui:testnet`.
- `budget_ceiling` and `max_single_trade_amount` are decimal strings to avoid JavaScript integer loss.
- `max_single_trade_amount <= budget_ceiling`.
- `expires_at_ms` must satisfy the Move lifetime rules.
- `strategy_hash` is computed from canonical JSON: UTF-8, lexicographically sorted keys, no insignificant whitespace, decimal strings preserved exactly, then `blake2b-256`.
- Worker owns the canonicalization implementation and exposes the resulting `strategy_hash`; Dashboard may display the hash but must not be the authority for acceptance. Tests must use the vectors below to prevent JavaScript key-ordering, float serialization or Unicode handling drift.

Test vector:

Canonical JSON:

```json
{"agent":"0x2222222222222222222222222222222222222222222222222222222222222222","budget_ceiling":"500000000","budget_coin_type":"0x3333333333333333333333333333333333333333333333333333333333333333::usdc::USDC","chain":"sui:testnet","execution":{"max_single_trade_amount":"100000000","max_slippage_bps":100,"order_type":"market_or_ioc"},"executor_kind":"deepbook","expires_at_ms":1780000000000,"owner":"0x1111111111111111111111111111111111111111111111111111111111111111","pool_id":"0x4444444444444444444444444444444444444444444444444444444444444444","strategy_type":"risk_response","trigger":{"asset":"SUI","metric":"price_drop_pct","threshold_pct":"8"},"version":"1"}
```

Expected `blake2b-256`:

```text
0xa6554d4c4ea6f63d5cbc05e60fe917043fad64a8a7eb09acec89124e94721f5c
```

Additional hash conformance vectors:

| Canonical UTF-8 input | Expected `blake2b-256` |
| --- | --- |
| empty string | `0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8` |
| `{"text":"当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。"}` | `0x041503ce868c54347445d99743f185ba13ece965d179e0f40c36e22083c3e80f` |
| `{"amount":"1000000000000000000000000","threshold_pct":"8.0"}` | `0x93bc4163c34e49983b49c47cc70821f1c6b236ba418cf02cbe88adf653db03fa` |

## 9. PTB Construction

An execution PTB is valid only if it binds MoveGate authorization, adapter action, MoveGate receipt creation and SentryPolicyWrapper recording into one transaction intent. The MVP Deepbook command sequence is:

1. MoveGate `authorize_action<BudgetCoin>(mandate, passport, SENTRY_PROTOCOL_ADDRESS, quote_amount, ACTION_DEEPBOOK_RESCUE, clock, ctx)` returns AuthToken.
2. Deepbook adapter emits swap/order call for the allowed `pool_id` with computed `min_out` from slippage.
3. SentryPolicyWrapper `record_agent_trade(wrapper, mandate, passport, agent_registry, pool_id, quote_amount, base_amount, slippage_bps, client_order_id, auth_token, clock, ctx)`.
4. `record_agent_trade` verifies wrapper constraints, calls MoveGate `create_success_receipt` to consume the AuthToken and freeze an ActionReceipt, then increments `spent_amount` and emits `AgentTradeExecuted`.

The Move compiler enforces that the AuthToken is consumed in the same PTB — this is a structural guarantee, not a runtime check. It proves the authorized amount was consumed into a receipt; it does not prove funds were custodied by the wrapper.

If Deepbook or a future adapter requires a command order that prevents the wrapper record from sharing the same PTB, Phase B or the adapter feasibility phase must stop and redesign the execution path before implementation continues.

### AuthToken 消费说明

`record_agent_trade` 接受 `auth_token: movegate::mandate::AuthToken`，但不直接调用 `consume_auth_token`。它把 token 交给 `movegate::receipt::create_success_receipt`，由 MoveGate 消费 token 并冻结 ActionReceipt。因为 AuthToken 是 zero-ability struct（no `store`, `copy`, `drop`），Move 编译器在编译时强制它必须在获得它的 PTB 内被消费。这消除了"AuthToken 被存储、复制或逃逸"的可能性，同时保留 MoveGate 的审计轨迹。

## 10. HTTP API Contract

### `POST /api/intents/parse`

Request:

```json
{
  "owner": "0x...",
  "text": "当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。",
  "defaults": {
    "chain": "sui:testnet",
    "executor_kind": "deepbook",
    "pool_id": "0x...",
    "max_slippage_bps": 100,
    "expires_in_seconds": 86400
  }
}
```

Response:

```json
{
  "status": "ok",
  "strategy": {},
  "strategy_hash": "0x...",
  "agent_address": "0x...",
  "guardian_warnings": [],
  "ptb_preview": [
    "Create MoveGate Mandate and SentryPolicyWrapper for owner 0x...",
    "Use deepbook executor adapter",
    "Allow agent 0x... to trade only pool 0x...",
    "Set budget ceiling to 500 USDC",
    "Set max slippage to 1.00%",
    "Expire policy at 2026-06-02T12:00:00.000Z"
  ]
}
```

Error response:

```json
{
  "status": "error",
  "code": "INTENT_AMBIGUOUS",
  "message": "Budget or trigger threshold is missing."
}
```

Unknown executor response:

```json
{
  "status": "error",
  "code": "UNSUPPORTED_EXECUTOR",
  "message": "Executor adapter is not registered."
}
```

### `POST /api/policies`

Creates a policy after explicit user confirmation.

Request:

```json
{
  "owner": "0x...",
  "strategy": {},
  "strategy_hash": "0x...",
  "confirmed": true
}
```

Response:

```json
{
  "status": "ok",
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "tx_digest": "0x...",
  "agent_address": "0x...",
  "runtime_state": "PolicyActive"
}
```

`policy_id` is an API compatibility alias for `wrapper_id` in MVP.

Validation:

- `confirmed` must be true.
- `strategy.owner` must equal request `owner`.
- `strategy.agent` must equal `SENTRY_AGENT_ADDRESS`.
- `strategy.executor_kind` must be registered in the ExecutorAdapter registry.
- `strategy_hash` must equal the server recomputed hash.
- The deployment must have fewer than `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies, otherwise return `ACTIVE_POLICY_LIMIT_REACHED`.

### `POST /api/policies/:wrapper_id/revoke`

Request:

```json
{
  "owner": "0x...",
  "confirmed": true
}
```

Response:

```json
{
  "status": "ok",
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "tx_digest": "0x...",
  "runtime_state": "Revoked"
}
```

If the Mandate is already revoked, the API must not submit another transaction. It returns:

```json
{
  "status": "error",
  "code": "ALREADY_REVOKED",
  "message": "Policy is already revoked."
}
```

### `GET /api/policies/:wrapper_id/activity`

Response:

```json
{
  "status": "ok",
  "policy": {
    "policy_id": "0x...",
    "mandate_id": "0x...",
    "wrapper_id": "0x...",
    "runtime_state": "Monitoring",
    "runtime_state_stale": false,
    "budget_ceiling": "500000000",
    "spent_amount": "100000000",
    "revoked": false,
    "expires_at_ms": 1780000000000
  },
  "events": []
}
```

Data source rules:

- `revoked` and `expires_at_ms` come from the MoveGate Mandate.
- `spent_amount`, `budget_ceiling`, `pool_id`, `max_slippage_bps`, and `strategy_hash` come from the SentryPolicyWrapper.
- `events` come from chain event queries and include transaction digest from event metadata.
- `runtime_state` comes from Durable Object state.
- If chain state conflicts with runtime state, chain state wins and `runtime_state_stale` is true.

### `POST /api/agent/tick`

Internal endpoint called by scheduler or Durable Object alarm. This endpoint is not exposed to Dashboard and must reject public traffic; local development may call it only with an internal dev token.

Authentication:

- Every request must include `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>`.
- The token is stored as a Worker secret and a local `.dev.vars` secret; it must not be bundled into Dashboard code.
- Production deployments must reject missing, invalid or demo-mode-only tokens with `401` or `403`.
- `force_trigger=true` is accepted only when both the internal token is valid and `SENTRY_DEMO_MODE=true`.

Request:

```json
{
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "source": "durable_object_alarm",
  "force_trigger": false
}
```

`force_trigger=true` is allowed only in local tests or controlled demo mode. Production Worker deployments must reject it.

Response:

```json
{
  "status": "ok",
  "policy_id": "0x...",
  "mandate_id": "0x...",
  "wrapper_id": "0x...",
  "action": "executed",
  "tx_digest": "0x..."
}
```

Allowed `action` values:

- `no_op`
- `blocked`
- `executed`
- `stopped_revoked`
- `stopped_expired`
- `error`

## 11. Agent State Machine

| Current | Trigger | Condition | Next | Side effect |
| --- | --- | --- | --- | --- |
| `DraftIntent` | parse ok | preview generated | `AwaitingConfirm` | return PTB preview |
| `DraftIntent` | parse error | missing fields | `DraftIntent` | return error |
| `AwaitingConfirm` | user confirms | tx succeeds | `PolicyActive` | create policy |
| `PolicyActive` | runtime registered | mandate and wrapper readable | `Monitoring` | schedule tick |
| `Monitoring` | tick | trigger false | `Monitoring` | no-op log |
| `Monitoring` | tick | guardian blocks | `Paused` or `Monitoring` | runtime block log |
| `Monitoring` | tick | checks pass | `Executing` | submit PTB |
| `Executing` | tx success | event confirmed | `Monitoring` | update spent |
| `Executing` | tx fail | recoverable | `Monitoring` | record error |
| any active | owner revoke | chain confirms | `Revoked` | stop alarms |
| any active | expiry reached | now >= expires | `Expired` | stop execution |

`Paused` is reserved for repeated Guardian or execution failures. MVP may keep blocked policies in `Monitoring` if failures are transient, but must never execute while a blocking condition remains true.

## 12. Guardian Algorithm

Every tick must read both the MoveGate Mandate and SentryPolicyWrapper, then run checks in this order:

1. Chain and adapter target match.
2. Mandate and wrapper exist and `wrapper.mandate_id == mandate.id`.
3. Mandate is not revoked.
4. Mandate is not expired.
5. Wrapper remaining budget is positive.
6. Proposed trade amount is `<= remaining_budget`.
7. Estimated slippage is `<= wrapper.max_slippage_bps`.
8. Concentration score is computed for UI.

Expiry decisions must be derived from the latest MoveGate Mandate and Sui `Clock` semantics. Budget decisions must be derived from the latest SentryPolicyWrapper. Worker system time may be used only for scheduling and optimistic UI labels; it must not be the final authority for expiry.

Pseudocode:

```text
remaining = wrapper.budget_ceiling - wrapper.spent_amount
if wrapper.mandate_id != mandate.id: block(MANDATE_MISMATCH)
if mandate.revoked: block(REVOKED)
if now_ms >= mandate.expires_at_ms: block(EXPIRED)
if proposed_amount > remaining: block(BUDGET)
if estimated_slippage_bps > wrapper.max_slippage_bps: block(SLIPPAGE)
if plan.target_id != wrapper.pool_id: block(POOL_MISMATCH) // v1 Deepbook target
return allow
```

Block logging policy:

- No-op ticks are runtime log only.
- Static parse-time warnings are API response only.
- Hard blocks after a trigger condition is met are runtime log by default.
- MVP does not emit on-chain `GuardianBlocked`. Public no-trade proof is deferred until a post-MVP design can bind block events to a valid Mandate without creating gas spam or post-revocation noise.

## 13. Edge Cases

- Natural language does not include budget.
- Natural language includes unsupported asset.
- Natural language selects an unsupported executor.
- User changes wallet after preview before confirm.
- Mandate + Wrapper creation transaction succeeds but Worker response times out.
- Durable Object activates before chain event query returns the creation event.
- Agent tick reads stale market price.
- Adapter produces an ExecutionPlan from stale protocol state.
- Deepbook pool has insufficient liquidity.
- Estimated slippage passes but submitted transaction fails.
- `spent_amount + amount` would overflow `u64`.
- Mandate is revoked while Agent is constructing PTB.
- Mandate expires between preview and transaction submission.
- Agent key is rotated but old Mandate still names old agent.
- Dashboard shows runtime state different from chain state.
- User tries to revoke an already revoked Policy.
- Deployment already has `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies.

## 14. Implementation Rule

When implementation begins, tests must be written from `docs/05-test-spec.md` before production code. Any code behavior that differs from this technical spec must update this document first.
