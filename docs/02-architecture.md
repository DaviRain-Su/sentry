# RescueGrid Architecture v1.0

状态：Draft
日期：2026-06-01
定位：RescueGrid：自主 DeFi 风险响应 Agent
默认环境：Sui Testnet
默认模式：Cloud first，Local Mode 作为后续扩展点

## 1. 架构目标

RescueGrid 的架构目标是把 Agent 自主执行拆成三个层次：

- 链上强约束：MoveGate Mandate + RescuePolicyWrapper 共同负责权限、预算、范围、过期、撤销和事件日志。
- 链下策略核心：Runtime Core 负责自然语言策略解析后的定时监控、Policy 读取、Guardian 预检查、adapter 选择和 activity 写入。
- 协议执行适配器：ExecutorAdapter 负责具体协议的市场读取、preview、PTB 片段和执行结果解析。MVP 只注册 Deepbook adapter；后续 Cetus DLMM、Scallop、Kai、LeafSheep/CDPM 类仓位管理都必须以 adapter 形式接入。

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
Runtime Core
  | tick / monitor / guardian / adapter select
  v
Executor Adapter Registry
  | MVP: deepbook
  v
Sui Testnet
  | MoveGate Mandate / RescuePolicyWrapper / PTB / Deepbook / events
  v
Dashboard Activity View
```

### In scope

- zkLogin 登录和 owner address 获取。
- Cloudflare Worker API。
- Durable Object 保存每个 Policy 的运行状态。
- Runtime Core 和 ExecutorAdapter 接口。
- Move package 定义 RescuePolicyWrapper 和事件，并复用 MoveGate Mandate。
- Deepbook V3 SDK 或 PTB 集成，作为首个 `deepbook` adapter。
- Dashboard 展示和撤销。

### Out of scope for MVP

- Mainnet 资金执行。
- 完整本地 LLM runtime；MVP 只保留与 Cloud Agent 相同的 Policy、Guardian、ExecutorAdapter 接口扩展点。
- 本地 CLI daemon 产品化；MVP 只保留运行时接口和任务拆解。
- 任意自然语言到任意 PTB。
- 多链、多 venue 交易；Post-MVP 通过 adapter registry 扩展。
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
- 调用 Runtime Core 检查 Policy 是否可执行。
- 执行 Guardian。
- 调用选定 ExecutorAdapter 构建并提交 PTB。
- 将结果写回链上事件和 runtime log。

Durable Object 只允许处理已确认的 Policy，不允许自己扩大预算、替换 pool 或延长过期时间。

### Runtime Core

职责：

- 读取 Policy、Mandate、Wrapper、runtime state 和策略 JSON。
- 根据 `strategy_type`、`executor_kind` 和部署配置选择 ExecutorAdapter。
- 调用 adapter 读取协议状态并生成 `ExecutionPlan`。
- 在提交前执行 Guardian；Guardian 只能读取 plan，不允许被 adapter 绕过。
- 把 allow、blocked、executed、failed、stale 等状态写入 ActivityWriter。

Runtime Core 是 Cloud Agent 和未来 Local CLI daemon 的共享内核。它不直接依赖 Cloudflare Durable Object，也不直接依赖 Deepbook SDK。

### Executor Adapter Registry

职责：

- 提供 `deepbook` adapter 的唯一 MVP 注册项。
- 暴露统一接口：`readMarket`、`planExecution`、`buildPtb`、`parseExecutionResult`、`preview`.
- 拒绝未注册的 `executor_kind`，返回 `UNSUPPORTED_EXECUTOR`。
- 要求 adapter 在构建 PTB 前输出可审计的 `ExecutionPlan`：target id、quote amount、estimated slippage、action type、expected event。

Post-MVP adapter backlog：

- `cdpm`：Cetus DLMM Position Manager / LeafSheep-style 仓位管理，支持 add/remove liquidity、collect fees、rebalance。
- `scallop`：借贷仓位 supply/redeem/unwind。
- `kai`：SAV vault supply/redeem。

新 adapter 不能直接扩大现有 Policy 的权限。若目标协议不等价于 Deepbook pool 约束，必须引入 adapter-specific wrapper 或升级 Policy schema。

### Local CLI Daemon（Post-MVP）

职责：

- 以 `rescuegrid daemon run` 形式长期运行本地 agent。
- 管理本地 agent key 或外部 signer 引用，私钥不进入 Cloud Worker。
- 轮询或订阅 Policy 状态，执行与 Cloud Agent 相同的 Runtime Core。
- 使用同一 ExecutorAdapter registry 构建 PTB。
- 提供 `status`、`policies list`、`tick`、`logs`、`stop` 等操作入口。

CLI daemon 是 Local Mode 的必要载体。没有长期进程，本地 Agent 无法可靠执行 tick、错误恢复、重试退避和日志持久化。

### Dashboard Activity View

职责：

- Dashboard 不直接索引链上事件；MVP 通过 `GET /api/policies/:wrapper_id/activity` 轮询 Worker。
- Worker 聚合四类数据：MoveGate Mandate snapshot、RescuePolicyWrapper snapshot、链上事件 metadata、Durable Object runtime state。
- 链上 Mandate + Wrapper 是最终状态源；如果 runtime state 与链上状态冲突，Dashboard 必须优先显示链上状态并标记 runtime stale。
- MVP 默认 5 秒轮询一次；这是 Sui Testnet RPC 频率、用户可感知反馈和实现复杂度之间的平衡。不实现 WebSocket 或专用事件索引器。
- Agent runtime 默认 60 秒 tick 一次；Dashboard 轮询只刷新状态，不触发交易执行。

### Move 合约层（基于 MoveGate）

RescueGrid 不重新发明 Agent 授权协议。它基于 **MoveGate** 的 Mandate、AuthToken 和 ActionReceipt 基础设施，叠加 RescuePolicyWrapper 实现 DeFi 风险响应特有的约束。

#### MoveGate（复用）

职责：

- **Mandate**：Agent 授权、可撤销、过期、hot-potato AuthToken 同一 PTB 强制消费。
- **AgentPassport**：Agent 链上身份建立（自动创建，附带使用）。
- **ActionReceipt**：`freeze_object` 不可变审计轨迹，每次授权操作产生永久记录。

#### RescuePolicyWrapper（自有）

MoveGate 是通用授权基础设施，不覆盖 DeFi 风险响应特有约束。RescuePolicyWrapper 是一个 Shared Object，存储 MoveGate 不覆盖的部分：

- `pool_id`：仅允许此 Deepbook pool。MoveGate 的 Mandate 有 `protocol` 白名单但无细粒度 pool 级约束。
- `budget_ceiling` 和 `spent_amount`：递减总预算模型（MoveGate 的 daily limit 每 epoch 重置，不是累计递减）。
- `max_slippage_bps`：DeFi 特有的交易滑点约束。
- `strategy_hash`：绑定链上策略与用户确认的 JSON 内容。
- `record_agent_trade`：递增 `spent_amount` 并 emit `AgentTradeExecuted` 事件。
- 将 Mandate 与其关联（`mandate_id` 引用）。

#### 执行 PTB 结构

单次交易必须在同一个 PTB 内完成：

1. MoveGate `authorize_action<BudgetCoin>(mandate, passport, RESCUEGRID_PROTOCOL_ADDRESS, amount, ACTION_DEEPBOOK_RESCUE)` → 获得 AuthToken（hot potato）。
2. Deepbook swap/order（pool_id, amount, min_out）。
3. RescuePolicyWrapper `record_agent_trade(...)` 校验 wrapper 约束，调用 MoveGate `create_success_receipt(...)` 消费 AuthToken 并冻结 ActionReceipt，再递增 `spent_amount` 并 emit `AgentTradeExecuted`。

链上校验是最终安全边界。链下 Guardian 通过并不代表可绕过链上检查。

### Deepbook ExecutorAdapter

职责：

- 读取 pool 状态和价格。
- 生成 Deepbook-specific `ExecutionPlan`，包括 pool id、quote amount、min_out 和 estimated slippage。
- 在 MoveGate AuthToken 的同一 PTB 内构建 Deepbook swap call。
- 执行最小可演示订单。
- 将执行金额和成交结果通过 RescuePolicyWrapper 回填，并由 wrapper 调用 MoveGate receipt 创建 ActionReceipt。

MVP 优先选一个流动性和测试资产可用的 Sui Testnet pool。具体 pool id 必须在实现前通过最新 Testnet 状态确认。

### Route Decision: MoveGate Integration

MVP 选择复用 MoveGate 而非独立实现授权协议，原因：

- AuthToken hot-potato 机制（同一 PTB 强制消费、编译器级安全保障）已由 MoveGate 测试套件覆盖验证；自建等价安全需要更多测试。
- 复用已部署的 Mandate、AgentPassport 和 ActionReceipt 基础设施，让 RescueGrid 把工程重心放在风险响应策略、Deepbook 执行和 Dashboard 闭环。
- 评委印象：站在成熟基础设施上构建垂直应用优于不完整的自建授权协议。
- RescueGrid 的差异化在自然语言 → 风险响应策略 → Deepbook 执行 → zkLogin 闭环，不在底层授权协议。

Phase B0 将确认 MoveGate 合约稳定性（package ID `0xec91e6...` 已在 Sui Testnet 部署，83 tests 通过）。

Critical integration assumption: the MoveGate Mandate must be accessible to future agent-signed PTBs without owner co-signing. Preferred route is to make the Mandate shared during the owner creation PTB. If this cannot be compiled against MoveGate's current package, Phase C must fall back to the independent shared `RescuePolicy` design before Worker execution code starts.

### Agent Interface

Cloud Agent 和未来 Local Agent 必须共享同一组接口边界：

- `PolicyReader`：读取 MoveGate Mandate、RescuePolicyWrapper、事件和剩余额度。
- `MarketReader`：读取 adapter 需要的协议状态、价格和预计滑点；MVP 来源是 Deepbook pool。
- `Guardian`：基于 Mandate、Wrapper、market snapshot 和 proposed trade 返回 allow/block。
- `ExecutorAdapter`：生成协议执行计划、构建 PTB 片段并解析执行结果。
- `Signer`：以被授权 agent address 签名；Cloud Mode 使用 Worker secret，Local Mode 使用 CLI daemon key 或外部 signer。
- `ActivityWriter`：写 runtime log。MVP 不为 Guardian block 写链上事件。

MVP 只实现 Cloud Agent 和 `deepbook` adapter。Local Agent 后续复用这些接口，不改变 MoveGate + Wrapper 合约 surface。

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
  -> MoveGate mandate_id + RescuePolicyWrapper wrapper_id
  -> API Worker registers wrapper_id with Durable Object
  -> Durable Object activation
```

### Agent Tick

```
tick(wrapper_id)
  -> read RescuePolicyWrapper
  -> read linked MoveGate Mandate
  -> stop if mandate revoked or expired
  -> read wrapper budget and spent_amount
  -> select executor adapter from strategy.executor_kind
  -> adapter reads protocol market/state data
  -> evaluate trigger
  -> adapter plans execution
  -> run Guardian checks
  -> build authorize_action + adapter action + record_agent_trade PTB
  -> submit transaction as agent
  -> record trade event or runtime block
  -> update dashboard-readable runtime state
```

### Revoke

```
owner click revoke
  -> build revoke PTB
  -> submit owner transaction
  -> MoveGate mandate.revoked = true
  -> emit PolicyRevoked
  -> Dashboard polls activity API and reads revoked chain state
  -> Durable Object state = Revoked
  -> future ticks no-op
```

## 5. Trust Model

- Owner trusts Sui chain, the deployed MoveGate contracts, and the RescuePolicyWrapper for enforcement.
- Owner does not need to trust Cloud Agent with unlimited authority.
- Agent can only act through a Mandate that names the agent address, paired with a RescuePolicyWrapper that constrains pool, budget, slippage and strategy.
- ExecutorAdapters are not trusted policy engines. They propose `ExecutionPlan`; Guardian and chain constraints decide whether it can execute.
- The AuthToken hot-potato mechanism (Move type-system enforced) ensures authorization cannot escape the execution PTB.
- MVP agent address is deployment-controlled. Users can inspect it before confirmation but cannot choose it.
- Dashboard and Worker can fail closed; if they disappear, owner can still revoke with a direct transaction path once CLI/script support exists.
- Any off-chain risk score is advisory unless mirrored by a chain-enforced condition.

### Dependency Trust

- RescueGrid trusts MoveGate's Mandate and AuthToken for agent authorization and ActionReceipt for the audit trail.
- If MoveGate has a critical bug, RescueGrid inherits that risk. The wrapper contract limits the blast radius: pool_id, budget, slippage, and strategy_hash are enforced by RescueGrid's own code regardless of MoveGate state.
- MoveGate's contracts are open-source, deployed on Sui Testnet (verified), with 83 tests and 96.66% line coverage.

## 6. MVP Key Management

- Agent key is generated per Testnet deployment and its public address is published as `RESCUEGRID_AGENT_ADDRESS`.
- The private signing credential is stored only as a Worker secret for deployed Cloud Mode and as a local `.dev.vars` secret for local development; it is never bundled into Dashboard code or docs.
- If the Worker is compromised, the attacker can only spend through policies that name that agent and only within each policy's pool, budget, slippage and expiry constraints.
- Key rotation creates a new `RESCUEGRID_AGENT_ADDRESS` for new policies. Existing policies must be revoked and recreated by owners; the system does not silently migrate policy authority.
- Production hardening requires hardware-backed signing or external signer isolation; MVP accepts Worker-secret custody because policies are Testnet-only and chain-limited.

## 7. Failure Modes

- Intent parse ambiguous：return AwaitingConfirm with warnings; do not create Policy.
- PTB preview cannot be generated：block confirmation.
- Policy creation fails：do not activate Durable Object.
- Tick market read fails：record runtime error and retry next tick.
- Guardian fails：record runtime blocked reason; do not submit Deepbook order.
- Deepbook transaction fails：record failed execution in runtime log; do not increment spent_amount unless chain event confirms execution.
- Revoke succeeds but Durable Object misses update：next chain read must detect revoked and stop.
- Dashboard polls before Durable Object updates：activity API returns chain `revoked=true` and marks runtime state stale.
- Agent submits stale transaction after expiry：MoveGate authorization or Wrapper checks must reject.

## 8. Deployment Shape

MVP deployment targets:

- Web Dashboard：single frontend app.
- API Worker：Cloudflare Worker.
- Agent Runtime：Cloudflare Durable Objects.
- Chain：Sui Testnet package.

Production hardening backlog:

- Dedicated event indexer.
- Migrate Worker reads behind a `ChainDataProvider` boundary from JSON-RPC/SuiClient reads to Sui GraphQL RPC, with gRPC reserved for low-latency agent monitoring and Archival Store-backed providers for history/replay.
- Optional Seal + Walrus encrypted policy record layer for private strategy snapshots, backtests, reasoning traces and incident reports; never for wallet or agent private keys.
- Optional `SignerAdapter` layer for local daemon, hardware signer, remote signer or WaaP-style two-party signing; MoveGate + RescuePolicyWrapper remain the Sui on-chain enforcement layer.
- Direct owner emergency revoke script.
- Multi-agent key rotation.
- Local CLI daemon with same Runtime Core, Policy, Guardian and ExecutorAdapter interfaces.
- Optional `PiWorkerAgentRuntime` adapter for operator console and local/cloud agent-session parity; see [`docs/07-pi-worker-assessment.md`](07-pi-worker-assessment.md). It must not receive `AGENT_KEY` until a separate security review passes.
- Adapter SDK for CDPM / Cetus DLMM, Scallop and Kai integrations.
- Strategy Marketplace, Opportunity Scanner and multi-leg strategy templates for funding, perp spread, lending, borrow health, LP range management, rebalance and alert-only watchtower; see [`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md).
- Multivenue control plane for Sui, EVM, Solana, Hyperliquid and CEX venue accounts; see [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md).
- Settlement adapters for LI.FI, deBridge and native venue transfers, used for inventory rebalancing rather than hot-path execution.
- Mainnet deployment checklist and audit.

Multivenue expansion must preserve the MVP security boundary: adapters propose `ExecutionPlan`s, Guardian approves or blocks, and each venue keeps its own authority model. Sui can enforce policy on-chain through Move objects; EVM, Solana, Hyperliquid and CEX integrations need venue-specific account wrappers, modules, delegates, agent wallets, subaccounts or API keys. RescueGrid should unify strategy, risk and activity, not pretend every venue has identical custody or enforcement semantics.

See [`docs/08-sui-data-agent-stack-assessment.md`](08-sui-data-agent-stack-assessment.md) for the Sui Data Stack, Seal/Walrus, WaaP, Sui Stack CRM and Sui Agent Skills assessment. See [`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md) for market research, product surfaces and frontend design backlog.
