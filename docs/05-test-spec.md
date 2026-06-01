# RescueGrid Test Spec v1.0

状态：Draft
日期：2026-06-01
原则：测试先于生产实现；实现偏离本文件时，先改规格再改测试和代码。

## 1. Test Layers

- Move unit tests：Policy 创建、撤销、授权、预算、滑点、过期、事件。
- Worker API tests：intent parse、preview、policy API、activity API、agent tick。
- Guardian tests：各类 block reason 和允许路径。
- Integration tests：Worker + Sui Testnet package + Deepbook execution。
- Browser QA：Dashboard 登录、确认、状态展示、撤销。
- Demo acceptance：完整 create -> autonomous execute -> activity log -> revoke -> blocked-after-revoke 闭环。

## 2. Move Tests

### `create_policy`

Happy path:

- owner 创建有效 Policy，事件 `PolicyCreated` 字段完整。
- `budget_ceiling > 0` 且 `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- 创建后的 Policy 是 shared object，授权 agent 后续可以在 PTB 中引用它。

Boundary:

- `max_slippage_bps == MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- `expires_at_ms` 恰好等于最大生命周期边界时创建成功。

Error / attack:

- `budget_ceiling == 0` abort。
- `max_slippage_bps > MAX_ALLOWED_SLIPPAGE_BPS` abort。
- `expires_at_ms <= now_ms` abort。
- `expires_at_ms` 超过最大生命周期 abort。
- `agent == @0x0` abort。

### `revoke_policy`

Happy path:

- owner 撤销未撤销 Policy，`revoked = true`，发出 `PolicyRevoked`。

Boundary:

- 临近过期但未过期的 Policy 仍可撤销。

Error / attack:

- 非 owner 撤销 abort。
- 重复撤销 abort。

### `assert_agent_authorized`

Happy path:

- 正确 agent、pool、预算、滑点、未过期、未撤销时通过。

Boundary:

- `spent_amount + amount == budget_ceiling` 通过。
- `slippage_bps == max_slippage_bps` 通过。
- `now_ms == expires_at_ms` 通过。

Error / attack:

- 错误 agent abort。
- 错误 pool abort。
- revoked policy abort。
- expired policy abort。
- `spent_amount + amount > budget_ceiling` abort。
- `slippage_bps > max_slippage_bps` abort。
- `spent_amount + amount` 溢出 abort。

### `record_agent_trade`

Happy path:

- 成功记录交易后 `spent_amount` 增加。
- 事件 `AgentTradeExecuted` 包含 policy、agent、pool、spent after、budget、slippage、client order id、timestamp。
- Dashboard 从事件 metadata 读取 transaction digest，而不是从 Move event payload 读取。

Boundary:

- 最后一笔交易刚好花完预算。

Error / attack:

- `quote_amount_spent == 0` abort。
- 非授权 agent abort。
- 超预算 abort。
- 撤销后记录 abort。

### `record_guardian_block`

Happy path:

- 授权 agent 可记录 block event。
- 不改变 `spent_amount`。

Error / attack:

- 非授权 agent abort。

## 3. Worker API Tests

### `POST /api/intents/parse`

Happy path:

- 输入“当 SUI 下跌超过 8% 时启动 500 USDC 救援网格”返回 `status=ok`。
- 响应包含 `strategy`、`strategy_hash`、`guardian_warnings`、`ptb_preview`。
- 响应包含部署配置中的 `agent_address`，且 preview 明确展示该 address。
- preview 必须包含 owner、agent、pool、budget、slippage、expiry。

Boundary:

- 用户省略滑点时使用 `DEFAULT_MAX_SLIPPAGE_BPS`。
- 用户省略过期时间时使用默认有效期，但不超过最大生命周期。

Error:

- 缺失预算返回 `INTENT_AMBIGUOUS`。
- 不支持 chain 返回 `UNSUPPORTED_CHAIN`。
- 不支持 strategy 返回 `UNSUPPORTED_STRATEGY`。
- 滑点超过硬上限返回 `GUARDIAN_STATIC_BLOCK`。

### `POST /api/policies`

Happy path:

- `confirmed=true` 且 strategy hash 匹配时创建 Policy。
- 成功响应包含 `policy_id`、`tx_digest`、`agent_address`。
- Durable Object 被激活。

Error:

- `confirmed=false` 拒绝。
- `strategy.agent` 不等于部署配置 `RESCUEGRID_AGENT_ADDRESS` 时拒绝。
- strategy hash 不匹配拒绝。
- 活跃 Policy 数达到 `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` 时返回 `ACTIVE_POLICY_LIMIT_REACHED`。
- Sui transaction 失败时不激活 Durable Object。

### `POST /api/policies/:id/revoke`

Happy path:

- owner 确认撤销，返回 tx digest 和 `runtime_state=Revoked`。

Error:

- 非 owner 请求拒绝。
- 已撤销 Policy 返回 `ALREADY_REVOKED`，且不提交第二笔 revoke transaction。

### `GET /api/policies/:id/activity`

Happy path:

- 返回 chain policy snapshot、runtime state、events。
- budget 数字以字符串返回，避免 JS integer loss。
- 当链上状态与 Durable Object runtime state 冲突时，链上状态优先，`runtime_state_stale=true`。

Error:

- 不存在的 policy 返回 `NOT_FOUND`。
- 链读取失败返回 `CHAIN_READ_FAILED`。

### `POST /api/agent/tick`

Happy path:

- trigger false 返回 `action=no_op`。
- trigger true 且检查通过返回 `action=executed` 和 tx digest。

Blocked:

- revoked 返回 `stopped_revoked`。
- expired 返回 `stopped_expired`。
- 滑点超限返回 `blocked`。
- 预算超限返回 `blocked`。
- pool mismatch 返回 `blocked`。

Error:

- market read failed 返回 `error`，不提交交易。
- Deepbook transaction failed 返回 `error`，不更新成功状态。

## 4. Guardian Tests

Happy path:

- 剩余额度足够、滑点在范围内、pool 匹配、Policy active 时 allow。

Boundary:

- proposed amount 等于 remaining budget 时 allow。
- estimated slippage 等于 max slippage 时 allow。

Block cases:

- proposed amount 大于 remaining budget。
- estimated slippage 大于 max slippage。
- Policy revoked。
- Policy expired。
- pool mismatch。
- remaining budget 为 0。

Advisory:

- concentration risk score 高时 UI 显示 warning，但 MVP 不因此自动 abort，除非后续技术规格升级为强制检查。
- UI warning 断言方式：显示包含 “Concentration risk” 的文本标签、severity badge 和解释文案；不能只依赖颜色变化。

## 5. Integration Tests

### Policy lifecycle

1. Deploy Move package to Sui Testnet.
2. Create Policy with test owner and agent.
3. Read object and verify fields.
4. Revoke Policy.
5. Confirm subsequent agent trade record aborts.

### Agent autonomous execution

1. Create active Policy with sufficient Testnet budget.
2. Activate Durable Object runtime.
3. In automated tests, use a dev-only mock price feed or `force_trigger=true` test hook to satisfy the trigger condition; natural market movement is not required.
4. Run agent tick.
5. Confirm Deepbook transaction digest exists.
6. Confirm `AgentTradeExecuted` event exists.
7. Confirm `spent_amount` increased.

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
5. Attempt direct `record_agent_trade` as agent.
6. Confirm chain abort.

## 6. Browser QA

Desktop viewport:

- Dashboard loads without console errors.
- Login shows owner address.
- Intent input accepts the sample strategy.
- Preview panel shows all critical policy parameters.
- Confirm flow creates Policy and updates state.
- Activity view shows events and budget.
- Revoke button changes state to revoked.

Mobile viewport:

- Strategy input, preview, status, activity and revoke controls do not overlap.
- Long addresses and tx digests truncate or wrap cleanly.
- Primary actions remain reachable.

Accessibility:

- Buttons have clear labels.
- Risk warnings are not color-only.
- Loading and error states are visible.
- All primary actions are reachable by Tab and activatable by keyboard.

Concurrency:

- MVP supports at most 10 active policies per deployment.
- Creating the 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.
- Ten active Durable Object instances must not leak runtime state into each other.

## 7. Demo Acceptance Script

The final demo must prove this exact sequence:

1. Start with no active Policy.
2. Login with zkLogin on Sui Testnet.
3. Enter: “当 SUI 下跌超过 8% 时启动 500 USDC 救援网格。”
4. Show structured strategy and PTB preview.
5. Confirm and create Policy.
6. Show Policy object id and budget ceiling.
7. Let Cloud Agent tick execute one Deepbook Testnet trade; demo may use a dev-only manual trigger or mock price feed if the real 8% price drop is not happening.
8. Show transaction digest and `AgentTradeExecuted` event.
9. Revoke Policy from Dashboard.
10. Run or wait for another tick.
11. Show Agent cannot execute after revoke.

Passing criteria:

- At least one real Sui Testnet transaction is visible.
- At least one real Deepbook-related execution is visible, or a documented Testnet blocker is explicitly shown with fallback approved before demo.
- Revocation is visible both in UI and chain state.
- No step requires exposing a user private key to the Agent.
- The deployed agent address shown in preview matches the agent recorded in the Policy.

## 8. Open Test Decisions

Before implementation starts, resolve and update `docs/03-technical-spec.md` if needed:

- Exact Sui Testnet pool id and coin decimals.
- Exact zkLogin SDK flow and test provider.
- Exact Deepbook call shape for the selected pool.
