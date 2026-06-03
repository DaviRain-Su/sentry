# Sentry Test Spec v1.0

状态：Draft
日期：2026-06-01
定位：Sentry：自主 DeFi 风险响应 Agent
原则：测试先于生产实现；实现偏离本文件时，先改规格再改测试和代码。

## 1. Test Layers

- Move unit tests：Mandate + Wrapper 创建、撤销、授权、预算、滑点、过期、事件。
- Worker API tests：intent parse、preview、policy API、activity API、agent tick。
- Guardian tests：各类 block reason 和允许路径。
- ExecutorAdapter tests：adapter registry、ExecutionPlan、preview、PTB build conformance。
- Integration tests：Worker + Sui Testnet package + Deepbook execution。
- Browser QA：Dashboard 登录、确认、状态展示、撤销。
- Demo acceptance：完整 create -> autonomous execute -> activity log -> revoke -> blocked-after-revoke 闭环。

## 2. Move Tests

### `create_policy`

Happy path:

- owner 创建有效 Policy（同时创建 MoveGate Mandate + SentryPolicyWrapper），事件 `PolicyCreated` 包含 `mandate_id` 和 `wrapper_id`。
- `budget_ceiling > 0` 且 `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- 创建后的 `SentryPolicyWrapper` 是 shared object，MoveGate Mandate 也必须可被授权 agent 后续无 owner co-sign 引用。
- `mandate_id` 在 Wrapper 中正确关联。
- MoveGate creation fee payment、FeeConfig、ProtocolTreasury、MandateRegistry、AgentRegistry 和 AgentPassport 参数全部正确传入。

Boundary:

- `max_slippage_bps == MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- `expires_at_ms` 恰好等于最大生命周期边界时创建成功。
- MoveGate Mandate expiry 采用 `now_ms < expires_at_ms`，因此执行时 `now_ms == expires_at_ms` 必须被视为 expired。

Error / attack:

- `budget_ceiling == 0` abort。
- `max_slippage_bps > MAX_ALLOWED_SLIPPAGE_BPS` abort。
- `expires_at_ms <= now_ms` abort。
- `expires_at_ms` 超过最大生命周期 abort。
- `agent == @0x0` abort。

### `revoke_policy`

Happy path:

- owner 撤销未撤销 Policy，调用 MoveGate `revoke_mandate`，发出 `PolicyRevoked`。
- MoveGate Mandate 的 `revoked` 标志被设置。

Boundary:

- 临近过期但未过期的 Policy 仍可撤销。

Error / attack:

- 非 owner 撤销 abort。
- 重复撤销 abort（MoveGate 层拒绝）。

### `assert_policy_valid`

Happy path:

- 正确 pool_id、预算、滑点、agent 匹配时通过。
- 注意：agent/revoked/expiry 由 MoveGate `authorize_action` 层检验，`assert_policy_valid` 只检查 Sentry 特有约束。

Boundary:

- `spent_amount + amount == budget_ceiling` 通过。
- `slippage_bps == max_slippage_bps` 通过。

Error / attack:

- 错误 pool abort。
- 错误 agent abort。
- `spent_amount + amount > budget_ceiling` abort。
- `slippage_bps > max_slippage_bps` abort。
- `spent_amount + amount` 溢出 abort。

### `record_agent_trade`

Happy path:

- 成功记录交易后 `spent_amount` 增加。
- MoveGate AuthToken 通过 `movegate::receipt::create_success_receipt` 被正确消费（PTB 结束后无法再使用）。
- MoveGate ActionReceipt 被创建并 freeze。
- 事件 `AgentTradeExecuted` 包含 `mandate_id`、`wrapper_id`、agent、pool、spent after、budget、slippage、client order id、timestamp。
- Dashboard 从事件 metadata 读取 transaction digest。

Boundary:

- 最后一笔交易刚好花完预算。

Error / attack:

- `quote_amount_spent == 0` abort。
- 非授权 agent abort。
- 超预算 abort。
- 撤销后记录 abort（MoveGate AuthToken 无法从已撤销 Mandate 获得）。
- AuthToken 来源不是当前 Policy 关联的 Mandate abort。
- AuthToken protocol 不是 `SENTRY_PROTOCOL_ADDRESS` abort。
- AuthToken amount 不等于 `quote_amount_spent` abort。

### Guardian block runtime log

Happy path:

- Guardian block 写入 Worker runtime activity log。
- 不提交 Deepbook transaction。
- 不创建 MoveGate ActionReceipt。
- 不改变 `spent_amount`。

## 3. Worker API Tests

### `POST /api/intents/parse`

Happy path:

- 输入“当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”返回 `status=ok`。
- 响应包含 `strategy`、`strategy_hash`、`guardian_warnings`、`ptb_preview`。
- `strategy.strategy_type` 必须等于 `risk_response`。
- `strategy.executor_kind` 必须等于 `deepbook`。
- 响应包含部署配置中的 `agent_address`，且 preview 明确展示该 address。
- preview 必须包含 owner、agent、executor、pool、budget、slippage、expiry。

Boundary:

- 用户省略滑点时使用 `DEFAULT_MAX_SLIPPAGE_BPS`。
- 用户省略过期时间时使用默认有效期，但不超过最大生命周期。
- `strategy_hash` canonicalization 覆盖空输入、中文输入和大数字 decimal string；必须匹配 `docs/03-technical-spec.md` 的 hash vectors。

Error:

- 缺失预算返回 `INTENT_AMBIGUOUS`。
- 不支持 chain 返回 `UNSUPPORTED_CHAIN`。
- 不支持 strategy 返回 `UNSUPPORTED_STRATEGY`。
- 不支持 executor 返回 `UNSUPPORTED_EXECUTOR`。
- 滑点超过硬上限返回 `GUARDIAN_STATIC_BLOCK`。

### `POST /api/policies`

Happy path:

- `confirmed=true` 且 strategy hash 匹配时创建 Policy。
- 成功响应包含 `policy_id`、`mandate_id`、`wrapper_id`、`tx_digest`、`agent_address`。
- Durable Object 被激活。

Error:

- `confirmed=false` 拒绝。
- `strategy.agent` 不等于部署配置 `SENTRY_AGENT_ADDRESS` 时拒绝。
- strategy hash 不匹配拒绝。
- 活跃 Policy 数达到 `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` 时返回 `ACTIVE_POLICY_LIMIT_REACHED`。
- Sui transaction 失败时不激活 Durable Object。

### `POST /api/policies/:wrapper_id/revoke`

Happy path:

- owner 确认撤销，返回 tx digest 和 `runtime_state=Revoked`。

Error:

- 非 owner 请求拒绝。
- 已撤销 Policy 返回 `ALREADY_REVOKED`，且不提交第二笔 revoke transaction。

### `GET /api/policies/:wrapper_id/activity`

Happy path:

- 返回 MoveGate Mandate snapshot、SentryPolicyWrapper snapshot、runtime state、events。
- budget 数字以字符串返回，避免 JS integer loss。
- 当链上状态与 Durable Object runtime state 冲突时，链上状态优先，`runtime_state_stale=true`。

Error:

- 不存在的 policy 返回 `NOT_FOUND`。
- 链读取失败返回 `CHAIN_READ_FAILED`。

### `POST /api/agent/tick`

Happy path:

- trigger false 返回 `action=no_op`。
- trigger true 且检查通过返回 `action=executed` 和 tx digest。
- tick 必须通过 adapter registry 选择 `deepbook` adapter；不能直接调用 Deepbook-specific runtime code。
- 内部 token 有效且 `SENTRY_DEMO_MODE=true` 时，`force_trigger=true` 可以绕过自然市场触发条件。

Blocked:

- revoked 返回 `stopped_revoked`。
- expired 返回 `stopped_expired`。
- 滑点超限返回 `blocked`。
- 预算超限返回 `blocked`。
- pool mismatch 返回 `blocked`。

Error:

- market read failed 返回 `error`，不提交交易。
- adapter plan failed 返回 `error`，不提交交易。
- unknown executor 返回 `UNSUPPORTED_EXECUTOR`，不提交交易。
- Deepbook transaction failed 返回 `error`，不更新成功状态。
- 缺失或错误 internal token 时返回 `401` 或 `403`，不运行 tick。
- 生产部署或 `SENTRY_DEMO_MODE=false` 时提交 `force_trigger=true` 返回 `FORCE_TRIGGER_DISABLED`。

## 4. Guardian Tests

Happy path:

- Mandate 未撤销/未过期，Wrapper 剩余额度足够、滑点在范围内、pool 匹配时 allow。

Boundary:

- proposed amount 等于 remaining budget 时 allow。
- estimated slippage 等于 max slippage 时 allow。

Block cases:

- proposed amount 大于 remaining budget。
- estimated slippage 大于 max slippage。
- MoveGate Mandate revoked。
- MoveGate Mandate expired。
- Wrapper mandate_id 与 Mandate id 不一致。测试构造方式：创建两个有效 Mandate/Wrapper fixture，故意把 Wrapper A 与 Mandate B 传入 Guardian；预期返回 `MANDATE_MISMATCH`，不提交交易。
- pool mismatch。
- remaining budget 为 0。

Advisory:

- concentration risk score 高时 UI 显示 warning，但 MVP 不因此自动 abort，除非后续技术规格升级为强制检查。
- UI warning 断言方式：显示包含 “Concentration risk” 的文本标签、severity badge 和解释文案；不能只依赖颜色变化。

## 5. ExecutorAdapter Tests

### Registry

- `deepbook` 是唯一 MVP registered adapter。
- unknown `executor_kind` 返回 `UNSUPPORTED_EXECUTOR`。
- Runtime Core 只能通过 registry 获取 adapter，不能直接 import Deepbook execution path。

### ExecutionPlan conformance

- Deepbook adapter returns `executor_kind=deepbook`、`target_id=pool_id`、`quote_amount`、`estimated_slippage_bps`、`action_type=ACTION_DEEPBOOK_RESCUE`。
- Guardian sees the same `quote_amount` and `estimated_slippage_bps` that later appear in PTB arguments。
- Adapter preview lines include executor, pool, budget impact, slippage and expected event。

### PTB build

- Adapter build fails if plan target differs from Wrapper `pool_id`。
- Adapter build fails if plan action type differs from `ACTION_DEEPBOOK_RESCUE`。
- Adapter does not sign or submit; signing belongs to Runtime Core signer boundary。

## 6. Integration Tests

### Policy lifecycle

1. Deploy Move package to Sui Testnet.
2. Create Policy with test owner and agent.
3. Read MoveGate Mandate and SentryPolicyWrapper, then verify linked fields.
4. Revoke Policy.
5. Confirm subsequent `authorize_action` + trade record aborts.

### Agent autonomous execution

1. Create active Policy with sufficient Testnet budget（MoveGate Mandate + SentryPolicyWrapper）。
2. Activate Durable Object runtime.
3. In automated tests, use a dev-only mock price feed or `force_trigger=true` test hook to satisfy the trigger condition; natural market movement is not required.
4. Run agent tick.
5. Confirm Deepbook transaction digest exists.
6. Confirm `AgentTradeExecuted` event exists with correct `mandate_id` and `wrapper_id`.
7. Confirm `spent_amount` increased in SentryPolicyWrapper.
8. Confirm MoveGate ActionReceipt was created（`freeze_object`）。
9. Confirm MoveGate Mandate `spent_this_epoch` and `total_actions` updated.

Production-like e2e tests must not depend on `force_trigger=true`; they must use a controlled mock market provider in non-production or a real trigger condition.

### Guardian block

1. Create Policy with low max slippage.
2. Force estimated slippage above limit.
3. Run tick.
4. Confirm no Deepbook transaction submitted.
5. Confirm block reason is visible in activity.

### Revoke enforcement

1. Create active Policy.
2. Revoke as owner.
3. Run agent tick.
4. Confirm action is `stopped_revoked`.
5. Attempt direct `authorize_action` + `record_agent_trade` as agent.
6. Confirm chain abort.

### Concurrent policy isolation

1. Create 10 active policies with distinct owners and wrapper ids.
2. Activate 10 Durable Object runtimes.
3. Run one tick for each policy.
4. Confirm each runtime reads only its own mandate id, wrapper id, budget, market snapshot and last action.
5. Confirm creating an 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.

## 7. Browser QA

MVP desktop viewport:

- Dashboard loads without console errors.
- Login shows owner address.
- Intent input accepts the sample strategy.
- Preview panel shows all critical policy parameters.
- Confirm flow creates Policy and updates state.
- Activity view shows events and budget within one 5 second polling interval after chain state changes.
- Revoke button changes state to revoked within one 5 second polling interval.
- Primary buttons have text labels and disabled/loading states.

Post-MVP mobile viewport:

- Strategy input, preview, status, activity and revoke controls do not overlap.
- Long addresses and tx digests truncate or wrap cleanly.
- Primary actions remain reachable.

Post-MVP accessibility:

- Buttons have clear labels.
- Risk warnings are not color-only.
- Loading and error states are visible.
- All primary actions are reachable by Tab and activatable by keyboard.

Concurrency:

- MVP supports at most 10 active policies per deployment.
- Creating the 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.
- Ten active Durable Object instances must not leak runtime state into each other.

## 8. Demo Acceptance Script

The final demo must prove this exact sequence:

1. Start with no active Policy.
2. Login with zkLogin on Sui Testnet.
3. Enter: “当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”
4. Show structured strategy and PTB preview.
5. Show `executor_kind=deepbook` in structured strategy.
6. Confirm and create Policy.
7. Show mandate id, wrapper id and budget ceiling.
8. Let Cloud Agent tick execute one Deepbook Testnet trade; demo may use a dev-only manual trigger or mock price feed if the real 8% price drop is not happening.
9. Show transaction digest and `AgentTradeExecuted` event.
10. Revoke Policy from Dashboard.
11. Run or wait for another tick.
12. Show Agent cannot execute after revoke.

Passing criteria:

- At least one real Sui Testnet transaction is visible.
- At least one real Deepbook-related execution is visible, or a documented Testnet blocker is explicitly shown with fallback approved before demo.
- Revocation is visible both in UI and chain state.
- No step requires exposing a user private key to the Agent.
- The deployed agent address shown in preview matches the agent recorded in the Mandate and Wrapper.

## 9. Post-MVP Local CLI Daemon Tests

These tests are not MVP gates, but they define the composability target.

- `sentry daemon run` loads local agent config and starts periodic ticks.
- `sentry daemon status` shows agent address, chain, registered adapters and watched policies.
- daemon uses the same Runtime Core and ExecutorAdapter registry as Cloud Agent.
- daemon refuses to run when the local agent address does not match the Policy Mandate agent.
- daemon writes local activity logs and can recover after restart without double-submitting an already confirmed action.
- daemon supports external signer mode before any Mainnet policy is accepted.

## 10. Open Test Decisions

Before implementation starts, resolve and update `docs/03-technical-spec.md` if needed:

- Exact Sui Testnet pool id and coin decimals.
- Exact zkLogin SDK flow and test provider.
- Exact Deepbook call shape for the selected pool.
- Exact adapter package boundary between Worker and future CLI daemon.
