# RescueGrid Architecture v1.0

状态：Draft
日期：2026-06-01
默认环境：Sui Testnet
默认模式：Cloud first，Local Mode 作为后续扩展点

## 1. 架构目标

RescueGrid 的架构目标是把 Agent 自主执行拆成两个层次：

- 链上强约束：Move Policy Object 负责权限、预算、范围、过期、撤销和事件日志。
- 链下自动化：Cloud Agent 负责自然语言策略解析后的定时监控、Guardian 预检查、PTB 构建和交易提交。

MVP 不追求通用自动交易平台，而是追求一个可演示、可验证、可撤销的 Agent Wallet 闭环。

## 2. 系统边界

```
User
  |
  v
Web Dashboard
  | login / confirm / revoke / inspect
  v
API Worker
  | intent parse / PTB preview / policy submit
  | register active policy / read runtime state
  v
Durable Object Agent Runtime
  | tick / monitor / guardian / execute
  v
Sui Testnet
  | Move Policy Object / PTB / Deepbook / events
  v
Dashboard Activity View
```

### In scope

- zkLogin 登录和 owner address 获取。
- Cloudflare Worker API。
- Durable Object 保存每个 Policy 的运行状态。
- Move package 定义 Policy Object 和事件。
- Deepbook V3 SDK 或 PTB 集成。
- Dashboard 展示和撤销。

### Out of scope for MVP

- Mainnet 资金执行。
- 完整本地 LLM runtime；MVP 只保留与 Cloud Agent 相同的 Policy、Guardian、Executor 接口扩展点。
- 任意自然语言到任意 PTB。
- 多链、多 venue 交易。
- 自动收益优化。

## 3. 组件

### Web Dashboard

职责：

- 提供 zkLogin 登录入口。
- 收集自然语言策略和显式确认。
- 展示结构化策略、PTB preview、Guardian warnings。
- 展示 Policy 状态、预算、风险分数、执行日志。
- 发起 owner revoke。

Dashboard 不直接保存用户私钥，不直接替代链上 Policy 校验。

### API Worker

职责：

- 提供 HTTP API。
- 调用 intent parser，把用户输入映射到受支持策略模板。
- 生成 human-readable PTB preview。
- 提交 Policy 创建和撤销交易请求。
- 把活跃 Policy 注册到 Durable Object。
- 为 Dashboard 提供 activity 聚合 API。
- 从部署配置读取唯一 MVP agent address，并在 preview、Policy 创建和 activity 中保持一致。

Worker 是编排层；它不能成为唯一安全边界。

### Durable Object Agent Runtime

职责：

- 一个 active Policy 对应一个 Durable Object instance。
- 保存 agent runtime state、最近一次 tick 时间、最近一次 market snapshot、错误计数。
- 定时执行 tick。
- 检查 Policy 是否可执行。
- 执行 Guardian。
- 构建并提交 Deepbook PTB。
- 将结果写回链上事件和 runtime log。

Durable Object 只允许处理已确认的 Policy，不允许自己扩大预算、替换 pool 或延长过期时间。

### Dashboard Activity View

职责：

- Dashboard 不直接索引链上事件；MVP 通过 `GET /api/policies/:id/activity` 轮询 Worker。
- Worker 聚合三类数据：链上 Policy object snapshot、链上事件 metadata、Durable Object runtime state。
- 链上 Policy object 是最终状态源；如果 runtime state 与链上状态冲突，Dashboard 必须优先显示链上状态并标记 runtime stale。
- MVP 默认 5 秒轮询一次；不实现 WebSocket 或专用事件索引器。

### Move Policy Package

职责：

- 创建 RescuePolicy 对象。
- 校验 agent 是否授权。
- 校验 revoked、expires_at、budget_ceiling、spent_amount、pool_id。
- 记录 AgentTradeExecuted、GuardianBlocked 等事件。
- 提供 owner revoke。

链上校验是最终安全边界。链下 Guardian 通过并不代表可绕过链上检查。

### Deepbook Integration

职责：

- 读取 pool 状态和价格。
- 构建交易 PTB。
- 执行最小可演示订单。
- 将执行金额和成交结果回填 Policy 事件。

MVP 优先选一个流动性和测试资产可用的 Sui Testnet pool。具体 pool id 必须在实现前通过最新 Testnet 状态确认。

## 4. 数据流

### Intent to Policy

```
Natural language
  -> supported strategy template
  -> structured strategy
  -> Guardian static checks
  -> PTB preview
  -> user confirm
  -> create_policy PTB
  -> RescuePolicy object id
  -> API Worker registers policy id with Durable Object
  -> Durable Object activation
```

### Agent Tick

```
tick(policy_id)
  -> read policy object
  -> stop if revoked or expired
  -> read budget and spent_amount
  -> read market data
  -> evaluate trigger
  -> run Guardian checks
  -> build Deepbook PTB
  -> submit transaction as agent
  -> record trade or block event
  -> update dashboard-readable runtime state
```

### Revoke

```
owner click revoke
  -> build revoke PTB
  -> submit owner transaction
  -> policy.revoked = true
  -> emit PolicyRevoked
  -> Dashboard polls activity API and reads revoked chain state
  -> Durable Object state = Revoked
  -> future ticks no-op
```

## 5. Trust Model

- Owner trusts Sui chain and the deployed Move package for enforcement.
- Owner does not need to trust Cloud Agent with unlimited authority.
- Agent can only act through a Policy object that names the agent address.
- MVP agent address is deployment-controlled. Users can inspect it before confirmation but cannot choose it.
- Dashboard and Worker can fail closed; if they disappear, owner can still revoke with a direct transaction path once CLI/script support exists.
- Any off-chain risk score is advisory unless mirrored by a chain-enforced condition.

## 6. Failure Modes

- Intent parse ambiguous：return AwaitingConfirm with warnings; do not create Policy.
- PTB preview cannot be generated：block confirmation.
- Policy creation fails：do not activate Durable Object.
- Tick market read fails：record runtime error and retry next tick.
- Guardian fails：emit or log blocked reason; do not submit Deepbook order.
- Deepbook transaction fails：record failed execution in runtime log; do not increment spent_amount unless chain event confirms execution.
- Revoke succeeds but Durable Object misses update：next chain read must detect revoked and stop.
- Dashboard polls before Durable Object updates：activity API returns chain `revoked=true` and marks runtime state stale.
- Agent submits stale transaction after expiry：Move check must reject.

## 7. Deployment Shape

MVP deployment targets:

- Web Dashboard：single frontend app.
- API Worker：Cloudflare Worker.
- Agent Runtime：Cloudflare Durable Objects.
- Chain：Sui Testnet package.

Production hardening backlog:

- Dedicated event indexer.
- Direct owner emergency revoke script.
- Multi-agent key rotation.
- Local Mode runner with same Policy and Guardian interfaces.
- Mainnet deployment checklist and audit.
