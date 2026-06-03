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

Enforcement notes:

- `DEFAULT_MAX_SLIPPAGE_BPS` is the default value inserted into new strategy previews.
- `MAX_ALLOWED_SLIPPAGE_BPS` is the chain-level creation cap. Runtime Guardian checks use each policy's `max_slippage_bps`, not the global default.
- `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` is enforced only by Worker/API state. The Move package does not enforce a global deployment count, so direct chain calls can create more policies; this cap is an MVP operational limit, not a security invariant.
- `EXECUTOR_KIND_DEEPBOOK` is part of the confirmed strategy hash. Future adapters must introduce explicit executor kinds and tests before they can be accepted.

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
  issued_at_ms: number;
  expires_at_ms: number;
};

type AgentTaskResult = {
  task_id: string;
  status: 'executed' | 'blocked' | 'failed' | 'needs_approval' | 'expired';
  tx_digest?: string;
  venue_order_id?: string;
  evidence?: Record<string, unknown>;
  reason?: string;
  amount_spent?: string;
  amount_received?: string;
  executed_at_ms: number;
};
```

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
- `~/.sentry` stores metadata only: key handle, venue id, permission proof, subaccount id, IP allowlist status and rotation time.
- Any key with withdrawal permission must be rejected.
- Key use must be written to local activity log with request summary, not raw secret.

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
  relay_url: string;
};

type PairingSubmit = {
  pairing_code: string;
  agent_public_key: string;
  device_name: string;
  supported_capabilities: string[];
  signed_nonce: string;
};

type PairingResult = {
  agent_id: string;
  session_id: string;
  websocket_url: string;
  relay_token: string;
};
```

Rules:

- pairing code TTL is `PAIRING_CODE_TTL_SECONDS`.
- pairing code is single-use.
- daemon stores its private identity key in OS keychain or a 600-permission local identity file.
- Worker stores only public key, owner binding, device metadata and capabilities.
- `relay_token` is short-lived and must be refreshable by signing a Worker challenge.

### BridgeEnvelope

All WebSocket messages use a signed JSON envelope.

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
- `message_id` is unique and `seq` is monotonic per session.
- signed `hello` is required before AgentSession DO marks the daemon online.
- command messages must include `expires_at`.
- command results must reference original `message_id` or `idempotency_key`.
- messages must not contain OWS token, wallet passphrase, wallet private key, exchange raw API secret or full local DB rows.

### RemoteCommand

```ts
type RemoteCommand =
  | { type: 'agent.status' }
  | { type: 'agent.start'; command?: string }
  | { type: 'agent.stop' }
  | { type: 'inventory.sync'; scope?: string[] }
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
POST /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands/:command_id
GET  /api/local-agents/:agent_id/activity
```

Rules:

- `/connect` requires WebSocket upgrade and a valid relay token.
- Worker validates owner/session before routing to AgentSession DO.
- AgentSession DO validates signed `hello`, heartbeat sequence, command expiry and idempotency.
- AgentSession DO marks status `stale` after `AGENT_BRIDGE_STALE_SECONDS` without heartbeat.
- Cloudflare deploys may drop WebSockets; daemon must reconnect with backoff and local tick loop must continue offline.

## 5. Composable Runtime Contract

Runtime Core is shared by the Local Agent daemon and the optional Worker/Durable Object demo. It owns policy loading, adapter selection, Guardian evaluation and activity logging. Protocol-specific behavior lives behind ExecutorAdapter.

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

Post-MVP adapter candidates:

- `cdpm`: Cetus DLMM Position Manager / LeafSheep-style agent operations.
- `scallop`: supply, redeem, unwind and risk-reduction flows.
- `kai`: SAV vault supply/redeem flows.

These adapters are not allowed to reuse the Deepbook-specific `pool_id` constraint unless their target semantics are equivalent. If they need position ids, vault ids, lending market ids or bin ranges, add adapter-specific wrapper fields or a new wrapper version.

## 6. Move Package Surface

### 架构：MoveGate + SentryPolicyWrapper

Sentry 复用 MoveGate 的 Mandate（Agent 授权、撤销、过期）和 AuthToken（hot-potato 同一 PTB 强制消费），在此之上搭建 SentryPolicyWrapper 覆盖 DeFi 风险响应特有约束（pool_id、递减预算、滑点、strategy_hash）。

MoveGate Testnet 部署：
- Package ID：`0xec91e604714e263ad43723d43470f236607bd0b13f64731aad36b00a61cf884a`
- Published-at：`0x1e7fbc6ee51094c3df050fade2e37455adfef7de4d9b79c84a168910067c9f46`
- AgentRegistry：`0xb2fadc7ccf9c7b578ba3b1adb8ebfd73191563e536b6b2cc18aa14dac6c7ba46`
- MandateRegistry：`0x26a66d91fef324b833d07d134e5ab6e796e0dfd77f670c27da099479d939b0d3`
- FeeConfig：`0x5c92c420f4b3801eb4126fcab6cb4b98212b31f591b4b3d0a025b4e4957120f3`
- ProtocolTreasury：`0xf0714bd816e595cacfc9e5921d1754cca0205f6b65867eab6183d0b0a98fc82c`

Integration constraints:

- The deployment agent must register its MoveGate `AgentPassport` once before any user creates a policy.
- Worker must either build MoveGate calls directly in the PTB or call a thin Sentry Move helper that wraps MoveGate creation. In both routes, the MoveGate SDK is only a transaction-building convenience; chain enforcement comes from MoveGate + SentryPolicyWrapper code.
- A created Mandate must be accessible to later agent-signed PTBs. Preferred route: the owner creation PTB creates the Mandate and makes it shared before activation. Phase B0 must compile-prove this with MoveGate's current package. If the Mandate cannot be shared or otherwise accessed by the agent without owner signing, MoveGate integration is invalid for MVP and the project must fall back to an independent shared `RescuePolicy` route.
- MoveGate authorizes the Sentry wrapper protocol, not Deepbook directly. Sentry enforces the Deepbook `pool_id`, budget and slippage constraints.
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

The Move compiler enforces that the AuthToken is consumed in the same PTB — this is a structural guarantee, not a runtime check.

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
