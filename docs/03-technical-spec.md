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

## 2. Deployment Agent

MVP uses one team-controlled Testnet agent wallet per deployment.

- The public address is configured as `RESCUEGRID_AGENT_ADDRESS`.
- The signing credential is stored as a Cloudflare secret or equivalent local dev secret, never in frontend code.
- Users cannot choose or override `agent` in MVP.
- `/api/intents/parse` inserts this address into the structured strategy and PTB preview.
- `/api/policies` must verify the submitted strategy agent equals `RESCUEGRID_AGENT_ADDRESS`.
- Agent key rotation affects only new policies. Existing policies name the old agent until owner revokes and recreates them.

## 3. Move Package Surface

### RescuePolicy object

The MVP Move package must expose one shared policy object. It is shared so the authorized agent can include it as a mutable object in later PTBs, while owner authority is enforced by the stored `owner` field.

```move
public struct RescuePolicy has key, store {
    id: UID,
    owner: address,
    agent: address,
    pool_id: ID,
    budget_coin_type: String,
    budget_ceiling: u64,
    spent_amount: u64,
    max_slippage_bps: u16,
    expires_at_ms: u64,
    revoked: bool,
    created_at_ms: u64,
    strategy_hash: vector<u8>,
}
```

Field rules:

- `owner` is the only address allowed to revoke.
- `agent` is the only address allowed to record an agent trade.
- `pool_id` is the only Deepbook pool this policy may target.
- `budget_coin_type` is the human-readable coin type used for preview and UI consistency.
- `budget_ceiling` and `spent_amount` use the smallest unit of `budget_coin_type`.
- `max_slippage_bps` must be `<= MAX_ALLOWED_SLIPPAGE_BPS`.
- `expires_at_ms` must be greater than `created_at_ms` and no more than `MAX_POLICY_LIFETIME_SECONDS` after creation.
- `revoked` starts false and only changes to true.
- `strategy_hash` is `blake2b-256(canonical_strategy_json_utf8)`.
- `create_policy` must call `transfer::share_object(policy)` after initialization.

### Move entry functions

```move
public entry fun create_policy(
    agent: address,
    pool_id: ID,
    budget_coin_type: String,
    budget_ceiling: u64,
    max_slippage_bps: u16,
    expires_at_ms: u64,
    strategy_hash: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx)` is recorded as `owner`.
- `budget_ceiling > 0`.
- `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS`.
- `expires_at_ms > now_ms`.
- `expires_at_ms - now_ms <= MAX_POLICY_LIFETIME_SECONDS * 1000`.
- `agent != @0x0`.

Postconditions:

- Creates one `RescuePolicy`.
- Emits `PolicyCreated`.

```move
public entry fun revoke_policy(
    policy: &mut RescuePolicy,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == policy.owner`.
- `policy.revoked == false`.

Postconditions:

- Sets `policy.revoked = true`.
- Emits `PolicyRevoked`.

```move
public fun assert_agent_authorized(
    policy: &RescuePolicy,
    agent: address,
    pool_id: ID,
    amount: u64,
    slippage_bps: u16,
    clock: &Clock,
)
```

Preconditions:

- `agent == policy.agent`.
- `pool_id == policy.pool_id`.
- `policy.revoked == false`.
- `now_ms <= policy.expires_at_ms`.
- `policy.spent_amount + amount <= policy.budget_ceiling`.
- `slippage_bps <= policy.max_slippage_bps`.

Postconditions:

- No state mutation. Abort on any violation.

```move
public entry fun record_agent_trade(
    policy: &mut RescuePolicy,
    pool_id: ID,
    quote_amount_spent: u64,
    base_amount_received: u64,
    slippage_bps: u16,
    client_order_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- Same checks as `assert_agent_authorized`, using `tx_context::sender(ctx)` as the agent address.
- `quote_amount_spent > 0`.

Postconditions:

- Increments `policy.spent_amount` by `quote_amount_spent`.
- Emits `AgentTradeExecuted`.

```move
public entry fun record_guardian_block(
    policy: &RescuePolicy,
    reason_code: u8,
    observed_value: u64,
    threshold_value: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Preconditions:

- `tx_context::sender(ctx) == policy.agent`.

Postconditions:

- Emits `GuardianBlocked`.
- Does not mutate budget.
- This entry function is optional for each blocked tick. MVP must use runtime logs by default and call this on-chain function only for hard blocks where the trigger condition was met and execution would otherwise have been attempted.

## 4. Move Events

```move
public struct PolicyCreated has copy, drop {
    policy_id: ID,
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
    policy_id: ID,
    owner: address,
    revoked_at_ms: u64,
}
```

```move
public struct AgentTradeExecuted has copy, drop {
    policy_id: ID,
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

The transaction digest is not stored inside the Move event because it is not available inside the transaction before execution completes. Indexers and the dashboard must read it from event metadata.

```move
public struct GuardianBlocked has copy, drop {
    policy_id: ID,
    agent: address,
    reason_code: u8,
    observed_value: u64,
    threshold_value: u64,
    blocked_at_ms: u64,
}
```

Guardian reason codes:

- `1`: slippage exceeds max.
- `2`: budget would exceed ceiling.
- `3`: policy expired.
- `4`: policy revoked.
- `5`: pool mismatch.
- `6`: concentration risk warning.

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

## 6. HTTP API Contract

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
    "Create RescuePolicy for owner 0x...",
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
  "tx_digest": "0x...",
  "agent_address": "0x...",
  "runtime_state": "PolicyActive"
}
```

Validation:

- `confirmed` must be true.
- `strategy.owner` must equal request `owner`.
- `strategy.agent` must equal `RESCUEGRID_AGENT_ADDRESS`.
- `strategy_hash` must equal the server recomputed hash.
- The deployment must have fewer than `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies, otherwise return `ACTIVE_POLICY_LIMIT_REACHED`.

### `POST /api/policies/:id/revoke`

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
  "tx_digest": "0x...",
  "runtime_state": "Revoked"
}
```

If the chain object is already revoked, the API must not submit another transaction. It returns:

```json
{
  "status": "error",
  "code": "ALREADY_REVOKED",
  "message": "Policy is already revoked."
}
```

### `GET /api/policies/:id/activity`

Response:

```json
{
  "status": "ok",
  "policy": {
    "policy_id": "0x...",
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

- `policy.revoked`, `spent_amount`, `budget_ceiling`, and `expires_at_ms` come from the latest chain object read.
- `events` come from chain event queries and include transaction digest from event metadata.
- `runtime_state` comes from Durable Object state.
- If chain state conflicts with runtime state, chain state wins and `runtime_state_stale` is true.

### `POST /api/agent/tick`

Internal endpoint called by scheduler or Durable Object alarm. This endpoint is not exposed to Dashboard and must reject public traffic; local development may call it only with an internal dev token.

Request:

```json
{
  "policy_id": "0x...",
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

## 7. Agent State Machine

| Current | Trigger | Condition | Next | Side effect |
| --- | --- | --- | --- | --- |
| `DraftIntent` | parse ok | preview generated | `AwaitingConfirm` | return PTB preview |
| `DraftIntent` | parse error | missing fields | `DraftIntent` | return error |
| `AwaitingConfirm` | user confirms | tx succeeds | `PolicyActive` | create policy |
| `PolicyActive` | runtime registered | policy readable | `Monitoring` | schedule tick |
| `Monitoring` | tick | trigger false | `Monitoring` | no-op log |
| `Monitoring` | tick | guardian blocks | `Paused` or `Monitoring` | emit/log block |
| `Monitoring` | tick | checks pass | `Executing` | submit PTB |
| `Executing` | tx success | event confirmed | `Monitoring` | update spent |
| `Executing` | tx fail | recoverable | `Monitoring` | record error |
| any active | owner revoke | chain confirms | `Revoked` | stop alarms |
| any active | expiry reached | now > expires | `Expired` | stop execution |

`Paused` is reserved for repeated Guardian or execution failures. MVP may keep blocked policies in `Monitoring` if failures are transient, but must never execute while a blocking condition remains true.

## 8. Guardian Algorithm

Every tick must run checks in this order:

1. Chain and pool match.
2. Policy exists.
3. Policy is not revoked.
4. Policy is not expired.
5. Remaining budget is positive.
6. Proposed trade amount is `<= remaining_budget`.
7. Estimated slippage is `<= max_slippage_bps`.
8. Concentration score is computed for UI.

Pseudocode:

```text
remaining = policy.budget_ceiling - policy.spent_amount
if policy.revoked: block(REVOKED)
if now_ms > policy.expires_at_ms: block(EXPIRED)
if proposed_amount > remaining: block(BUDGET)
if estimated_slippage_bps > policy.max_slippage_bps: block(SLIPPAGE)
if pool_id != policy.pool_id: block(POOL_MISMATCH)
return allow
```

Block logging policy:

- No-op ticks are runtime log only.
- Static parse-time warnings are API response only.
- Hard blocks after a trigger condition is met are runtime log by default.
- On-chain `GuardianBlocked` is used only when the demo or operator needs public proof that the Agent chose not to execute; this costs gas and must be rate-limited by the Worker to at most one on-chain block event per policy per reason per tick.

## 9. Edge Cases

- Natural language does not include budget.
- Natural language includes unsupported asset.
- User changes wallet after preview before confirm.
- Policy creation transaction succeeds but Worker response times out.
- Durable Object activates before chain event query returns the creation event.
- Agent tick reads stale market price.
- Deepbook pool has insufficient liquidity.
- Estimated slippage passes but submitted transaction fails.
- `spent_amount + amount` would overflow `u64`.
- Policy is revoked while Agent is constructing PTB.
- Policy expires between preview and transaction submission.
- Agent key is rotated but old Policy still names old agent.
- Dashboard shows runtime state different from chain state.
- User tries to revoke an already revoked Policy.
- Deployment already has `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` active policies.

## 10. Implementation Rule

When implementation begins, tests must be written from `docs/05-test-spec.md` before production code. Any code behavior that differs from this technical spec must update this document first.
