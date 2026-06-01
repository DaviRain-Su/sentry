# RescueGrid Technical Spec v1.0

状态：Draft
日期：2026-06-01
适用范围：Hackathon MVP technical contract

## 1. Constants

所有实现必须集中定义以下常量，不允许在业务逻辑里散落 magic numbers。

| Name | Value | Notes |
| --- | --- | --- |
| `BPS_DENOMINATOR` | `10_000` | basis points denominator |
| `DEFAULT_MAX_SLIPPAGE_BPS` | `100` | 1.00% default preview value |
| `MAX_ALLOWED_SLIPPAGE_BPS` | `500` | 5.00% hard MVP ceiling |
| `DEFAULT_TICK_INTERVAL_SECONDS` | `60` | Cloud Agent tick interval |
| `MAX_POLICY_LIFETIME_SECONDS` | `604800` | 7 days |
| `MIN_POLICY_BUDGET` | implementation coin unit dependent | must be non-zero |
| `SUPPORTED_CHAIN` | `sui:testnet` | MVP only |
| `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` | `10` | MVP concurrency cap |
| `RESCUEGRID_PROTOCOL_ADDRESS` | published RescueGrid package address | protocol address passed to MoveGate |
| `ACTION_DEEPBOOK_RESCUE` | `1` | MoveGate action type for rescue trades |
| `REVOKE_REASON_OWNER` | `1` | owner-requested revocation reason |
| `MOVEGATE_DEFAULT_CREATION_FEE_MIST` | `10_000_000` | MoveGate source default, 0.01 SUI |
| `INTERNAL_AGENT_TICK_HEADER` | `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>` | required for internal tick endpoint |

Enforcement notes:

- `DEFAULT_MAX_SLIPPAGE_BPS` is the default value inserted into new strategy previews.
- `MAX_ALLOWED_SLIPPAGE_BPS` is the chain-level creation cap. Runtime Guardian checks use each policy's `max_slippage_bps`, not the global default.
- `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` is enforced only by Worker/API state. The Move package does not enforce a global deployment count, so direct chain calls can create more policies; this cap is an MVP operational limit, not a security invariant.

## 2. Deployment Agent

MVP uses one team-controlled Testnet agent wallet per deployment.

- The public address is configured as `RESCUEGRID_AGENT_ADDRESS`.
- The signing credential is stored as a Cloudflare secret or equivalent local dev secret, never in frontend code.
- Users cannot choose or override `agent` in MVP.
- `/api/intents/parse` inserts this address into the structured strategy and PTB preview.
- `/api/policies` must verify the submitted strategy agent equals `RESCUEGRID_AGENT_ADDRESS`.
- Agent key rotation affects only new policies. Existing policies name the old agent until owner revokes and recreates them.

## 3. Move Package Surface

### 架构：MoveGate + RescuePolicyWrapper

RescueGrid 复用 MoveGate 的 Mandate（Agent 授权、撤销、过期）和 AuthToken（hot-potato 同一 PTB 强制消费），在此之上搭建 RescuePolicyWrapper 覆盖 DeFi 救仓特有约束（pool_id、递减预算、滑点、strategy_hash）。

MoveGate Testnet 部署：
- Package ID：`0xec91e604714e263ad43723d43470f236607bd0b13f64731aad36b00a61cf884a`
- Published-at：`0x1e7fbc6ee51094c3df050fade2e37455adfef7de4d9b79c84a168910067c9f46`
- AgentRegistry：`0xb2fadc7ccf9c7b578ba3b1adb8ebfd73191563e536b6b2cc18aa14dac6c7ba46`
- MandateRegistry：`0x26a66d91fef324b833d07d134e5ab6e796e0dfd77f670c27da099479d939b0d3`
- FeeConfig：`0x5c92c420f4b3801eb4126fcab6cb4b98212b31f591b4b3d0a025b4e4957120f3`
- ProtocolTreasury：`0xf0714bd816e595cacfc9e5921d1754cca0205f6b65867eab6183d0b0a98fc82c`

Integration constraints:

- The deployment agent must register its MoveGate `AgentPassport` once before any user creates a policy.
- Worker must either build MoveGate calls directly in the PTB or call a thin RescueGrid Move helper that wraps MoveGate creation. In both routes, the MoveGate SDK is only a transaction-building convenience; chain enforcement comes from MoveGate + RescuePolicyWrapper code.
- A created Mandate must be accessible to later agent-signed PTBs. Preferred route: the owner creation PTB creates the Mandate and makes it shared before activation. Phase B0 must compile-prove this with MoveGate's current package. If the Mandate cannot be shared or otherwise accessed by the agent without owner signing, MoveGate integration is invalid for MVP and the project must fall back to an independent shared `RescuePolicy` route.
- MoveGate authorizes the RescueGrid wrapper protocol, not Deepbook directly. RescueGrid enforces the Deepbook `pool_id`, budget and slippage constraints.
- MoveGate Mandate data must be read through public accessors such as `mandate_owner`, `mandate_agent`, `mandate_expires_at_ms`, `mandate_revoked`, `mandate_spent_this_epoch`, and `mandate_total_actions`; RescueGrid must not assume private field access.
- MoveGate source default creation fee is `10_000_000` MIST. Phase B0 must read the live `FeeConfig` via `movegate::treasury::creation_fee` or an equivalent chain read before submitting creation transactions, because the deployed fee can be changed by MoveGate admin.

### RescuePolicyWrapper object

The MVP Move package must expose one shared policy wrapper object that references a MoveGate Mandate.

```move
public struct RescuePolicyWrapper has key, store {
    id: UID,
    owner: address,
    mandate_id: ID,          // reference to MoveGate Mandate
    agent: address,          // cached from mandate for efficiency
    pool_id: ID,             // specific Deepbook pool constraint
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
- `pool_id` is the only Deepbook pool this policy may target.
- `budget_coin_type` is the human-readable coin type used for preview and UI consistency.
- `budget_ceiling` and `spent_amount` use the smallest unit of `budget_coin_type`.
- `max_slippage_bps` must be `<= MAX_ALLOWED_SLIPPAGE_BPS`.
- `strategy_hash` is `blake2b-256(canonical_strategy_json_utf8)`.
- The owner creation PTB must share the returned wrapper before activation.

### Move entry functions and PTB composition

`create_policy` is a Worker-built creation flow. Phase B0 chooses one of two routes:

- Direct PTB route: Worker calls MoveGate `create_mandate`, then RescueGrid `create_policy_wrapper`, then shares the returned objects.
- Thin helper route: Worker calls a RescueGrid Move helper that internally builds `allowed_coin_types`, calls MoveGate `create_mandate`, creates the wrapper, and shares both objects.

Either route must:

1. Use the owner as transaction sender.
2. Call MoveGate `create_mandate` with:
   - `registry: &mut movegate::mandate::MandateRegistry`
   - `agent_registry: &mut movegate::passport::AgentRegistry`
   - `passport: &mut movegate::passport::AgentPassport`
   - `treasury: &mut movegate::treasury::ProtocolTreasury`
   - `fee_config: &movegate::treasury::FeeConfig`
   - `agent = RESCUEGRID_AGENT_ADDRESS`
   - `spend_cap = max_single_trade_amount`
   - `daily_limit = budget_ceiling`
   - `allowed_protocols = [RESCUEGRID_PROTOCOL_ADDRESS]`
   - `allowed_coin_types = [type_name::with_original_ids<BudgetCoin>()]` if the PTB route can construct `TypeName`; otherwise Phase B0 must switch creation to a thin RescueGrid Move helper that builds this vector inside Move.
   - `allowed_actions = [ACTION_DEEPBOOK_RESCUE]`
   - `expires_at_ms` from the confirmed strategy
   - `min_agent_score = option::none()` for MVP
   - `payment: &mut Coin<SUI>` with value at least the live MoveGate creation fee; expected default is `10_000_000` MIST.
   - `clock: &Clock`
   - `ctx: &mut TxContext`
3. Pass the returned Mandate to RescueGrid `create_policy_wrapper`.
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
): RescuePolicyWrapper
```

Preconditions:

- `tx_context::sender(ctx)` is recorded as `owner`.
- `budget_ceiling > 0`.
- `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS`.
- `movegate::mandate::mandate_owner(mandate) == tx_context::sender(ctx)`.
- `movegate::mandate::mandate_agent(mandate) == RESCUEGRID_AGENT_ADDRESS`.
- `movegate::mandate::mandate_expires_at_ms(mandate)` satisfies the confirmed strategy expiry.
- `movegate::mandate::mandate_allowed_protocols(mandate)` includes `RESCUEGRID_PROTOCOL_ADDRESS`.

Postconditions:

- Creates one `RescuePolicyWrapper` referencing the mandate.
- Shares or returns the wrapper for sharing in the same PTB.
- Emits `PolicyCreated` with both mandate_id and wrapper_id.

```move
public entry fun revoke_policy(
    wrapper: &mut RescuePolicyWrapper,
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
    wrapper: &RescuePolicyWrapper,
    agent: address,
    pool_id: ID,
    amount: u64,
    slippage_bps: u16
)
```

Preconditions (RescueGrid-specific checks, MoveGate auth handled by `authorize_action`):

- `pool_id == wrapper.pool_id`.
- `wrapper.spent_amount + amount <= wrapper.budget_ceiling`.
- `slippage_bps <= wrapper.max_slippage_bps`.
- `agent == wrapper.agent`.

Postconditions:

- No state mutation. Abort on any violation.
- Note: Mandate-level checks (revoked, expired) are enforced by MoveGate's `authorize_action` which runs earlier in the PTB.

```move
public fun record_agent_trade(
    wrapper: &mut RescuePolicyWrapper,
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
- `movegate::mandate::auth_token_protocol(&auth_token) == RESCUEGRID_PROTOCOL_ADDRESS`.
- `movegate::mandate::auth_token_amount(&auth_token) == quote_amount_spent`.

Postconditions:

- Runs all wrapper-specific asserts before consuming the AuthToken.
- Calls `movegate::receipt::create_success_receipt(auth_token, mandate, passport, agent_registry, wrapper.owner, RESCUEGRID_PROTOCOL_ADDRESS, quote_amount_spent, 0, option::none(), clock, ctx)`.
- Consumes the AuthToken exactly once through MoveGate receipt creation.
- Increments `wrapper.spent_amount` by `quote_amount_spent`.
- Emits `AgentTradeExecuted`.

## 4. RescueGrid Events

RescueGrid 自身发出以下事件。MoveGate 的 ActionReceipt 提供额外的不可变审计轨迹（`freeze_object`）。

```move
public struct PolicyCreated has copy, drop {
    mandate_id: ID,            // MoveGate Mandate ID
    wrapper_id: ID,            // RescuePolicyWrapper ID
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

## 5. Structured Strategy

Natural language must parse into this JSON shape before confirmation:

```json
{
  "version": "1",
  "strategy_type": "rescue_grid",
  "owner": "0x...",
  "agent": "0x...",
  "chain": "sui:testnet",
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

- `strategy_type` MVP supports only `rescue_grid`.
- `agent` must equal deployment config `RESCUEGRID_AGENT_ADDRESS`.
- `chain` must equal `sui:testnet`.
- `budget_ceiling` and `max_single_trade_amount` are decimal strings to avoid JavaScript integer loss.
- `max_single_trade_amount <= budget_ceiling`.
- `expires_at_ms` must satisfy the Move lifetime rules.
- `strategy_hash` is computed from canonical JSON: UTF-8, lexicographically sorted keys, no insignificant whitespace, decimal strings preserved exactly, then `blake2b-256`.
- Worker owns the canonicalization implementation and exposes the resulting `strategy_hash`; Dashboard may display the hash but must not be the authority for acceptance. Tests must use the vectors below to prevent JavaScript key-ordering, float serialization or Unicode handling drift.

Test vector:

Canonical JSON:

```json
{"agent":"0x2222222222222222222222222222222222222222222222222222222222222222","budget_ceiling":"500000000","budget_coin_type":"0x3333333333333333333333333333333333333333333333333333333333333333::usdc::USDC","chain":"sui:testnet","execution":{"max_single_trade_amount":"100000000","max_slippage_bps":100,"order_type":"market_or_ioc"},"expires_at_ms":1780000000000,"owner":"0x1111111111111111111111111111111111111111111111111111111111111111","pool_id":"0x4444444444444444444444444444444444444444444444444444444444444444","strategy_type":"rescue_grid","trigger":{"asset":"SUI","metric":"price_drop_pct","threshold_pct":"8"},"version":"1"}
```

Expected `blake2b-256`:

```text
0xfb70611291c43a5afbbb27c5211705b0f7419d23c1384a55ecbfacd08114a3f2
```

Additional hash conformance vectors:

| Canonical UTF-8 input | Expected `blake2b-256` |
| --- | --- |
| empty string | `0x0e5751c026e543b2e8ab2eb06099daa1d1e5df47778f7787faab45cdf12fe3a8` |
| `{"text":"当 SUI 下跌超过 8% 时启动 500 USDC 救援网格"}` | `0xc2b9520eaad63e4de52da50eb145ed5e72f68bf8af2c1507ede26de27fe8994e` |
| `{"amount":"1000000000000000000000000","threshold_pct":"8.0"}` | `0x93bc4163c34e49983b49c47cc70821f1c6b236ba418cf02cbe88adf653db03fa` |

## 6. PTB Construction

An execution PTB is valid only if it binds MoveGate authorization, Deepbook action, MoveGate receipt creation and RescuePolicyWrapper recording into one transaction intent. The command sequence is:

1. MoveGate `authorize_action<BudgetCoin>(mandate, passport, RESCUEGRID_PROTOCOL_ADDRESS, quote_amount, ACTION_DEEPBOOK_RESCUE, clock, ctx)` returns AuthToken.
2. Deepbook swap/order call for the allowed `pool_id` with computed `min_out` from slippage.
3. RescuePolicyWrapper `record_agent_trade(wrapper, mandate, passport, agent_registry, pool_id, quote_amount, base_amount, slippage_bps, client_order_id, auth_token, clock, ctx)`.
4. `record_agent_trade` verifies wrapper constraints, calls MoveGate `create_success_receipt` to consume the AuthToken and freeze an ActionReceipt, then increments `spent_amount` and emits `AgentTradeExecuted`.

The Move compiler enforces that the AuthToken is consumed in the same PTB — this is a structural guarantee, not a runtime check.

If Deepbook requires a command order that prevents the wrapper record from sharing the same PTB, Phase B must stop and redesign the execution path before implementation continues.

### AuthToken 消费说明

`record_agent_trade` 接受 `auth_token: movegate::mandate::AuthToken`，但不直接调用 `consume_auth_token`。它把 token 交给 `movegate::receipt::create_success_receipt`，由 MoveGate 消费 token 并冻结 ActionReceipt。因为 AuthToken 是 zero-ability struct（no `store`, `copy`, `drop`），Move 编译器在编译时强制它必须在获得它的 PTB 内被消费。这消除了"AuthToken 被存储、复制或逃逸"的可能性，同时保留 MoveGate 的审计轨迹。

## 7. HTTP API Contract

### `POST /api/intents/parse`

Request:

```json
{
  "owner": "0x...",
  "text": "当 SUI 下跌超过 8% 时启动 500 USDC 救援网格",
  "defaults": {
    "chain": "sui:testnet",
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
    "Create MoveGate Mandate and RescuePolicyWrapper for owner 0x...",
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
- `strategy.agent` must equal `RESCUEGRID_AGENT_ADDRESS`.
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
- `spent_amount`, `budget_ceiling`, `pool_id`, `max_slippage_bps`, and `strategy_hash` come from the RescuePolicyWrapper.
- `events` come from chain event queries and include transaction digest from event metadata.
- `runtime_state` comes from Durable Object state.
- If chain state conflicts with runtime state, chain state wins and `runtime_state_stale` is true.

### `POST /api/agent/tick`

Internal endpoint called by scheduler or Durable Object alarm. This endpoint is not exposed to Dashboard and must reject public traffic; local development may call it only with an internal dev token.

Authentication:

- Every request must include `Authorization: Bearer <INTERNAL_AGENT_TICK_TOKEN>`.
- The token is stored as a Worker secret and a local `.dev.vars` secret; it must not be bundled into Dashboard code.
- Production deployments must reject missing, invalid or demo-mode-only tokens with `401` or `403`.
- `force_trigger=true` is accepted only when both the internal token is valid and `RESCUEGRID_DEMO_MODE=true`.

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

## 8. Agent State Machine

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

## 9. Guardian Algorithm

Every tick must read both the MoveGate Mandate and RescuePolicyWrapper, then run checks in this order:

1. Chain and pool match.
2. Mandate and wrapper exist and `wrapper.mandate_id == mandate.id`.
3. Mandate is not revoked.
4. Mandate is not expired.
5. Wrapper remaining budget is positive.
6. Proposed trade amount is `<= remaining_budget`.
7. Estimated slippage is `<= wrapper.max_slippage_bps`.
8. Concentration score is computed for UI.

Expiry decisions must be derived from the latest MoveGate Mandate and Sui `Clock` semantics. Budget decisions must be derived from the latest RescuePolicyWrapper. Worker system time may be used only for scheduling and optimistic UI labels; it must not be the final authority for expiry.

Pseudocode:

```text
remaining = wrapper.budget_ceiling - wrapper.spent_amount
if wrapper.mandate_id != mandate.id: block(MANDATE_MISMATCH)
if mandate.revoked: block(REVOKED)
if now_ms >= mandate.expires_at_ms: block(EXPIRED)
if proposed_amount > remaining: block(BUDGET)
if estimated_slippage_bps > wrapper.max_slippage_bps: block(SLIPPAGE)
if pool_id != wrapper.pool_id: block(POOL_MISMATCH)
return allow
```

Block logging policy:

- No-op ticks are runtime log only.
- Static parse-time warnings are API response only.
- Hard blocks after a trigger condition is met are runtime log by default.
- MVP does not emit on-chain `GuardianBlocked`. Public no-trade proof is deferred until a post-MVP design can bind block events to a valid Mandate without creating gas spam or post-revocation noise.

## 10. Edge Cases

- Natural language does not include budget.
- Natural language includes unsupported asset.
- User changes wallet after preview before confirm.
- Mandate + Wrapper creation transaction succeeds but Worker response times out.
- Durable Object activates before chain event query returns the creation event.
- Agent tick reads stale market price.
- Deepbook pool has insufficient liquidity.
- Estimated slippage passes but submitted transaction fails.
- `spent_amount + amount` would overflow `u64`.
- Mandate is revoked while Agent is constructing PTB.
- Mandate expires between preview and transaction submission.
- Agent key is rotated but old Mandate still names old agent.
- Dashboard shows runtime state different from chain state.
- User tries to revoke an already revoked Policy.
- Deployment already has `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies.

## 11. Implementation Rule

When implementation begins, tests must be written from `docs/05-test-spec.md` before production code. Any code behavior that differs from this technical spec must update this document first.
