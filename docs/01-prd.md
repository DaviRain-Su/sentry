# Sentry PRD v1.0

状态：Draft
日期：2026-06-01
项目名称：Sentry：自主 DeFi 风险响应 Agent
英文定位：Autonomous DeFi Risk Response Agent
定位：跨链自主风险代理平台
当前实现：Sui Testnet MVP（基于 MoveGate）
目标：多链控制平面 × 链上受限执行 × 自然语言意图

## 1. 概述

Sentry 是一个跨链自主 DeFi 风险代理平台。当前 Sui Testnet MVP 让用户通过 MoveGate Mandate + SentryPolicyWrapper 授权，把有限预算、允许交易范围、滑点、过期时间和撤销能力写入链上约束，然后允许 Agent 在这些约束内自主监控、风控、选择执行适配器、构建 PTB 并执行风险响应交易。

MVP 的核心叙事是：用户无需把钱包私钥交给 Agent，也无需每笔交易手动签名；Agent 只能在用户明确授权的 Mandate + Wrapper 范围内行动，所有执行都有链上日志，并且 owner 可以随时撤销。Deepbook 是首个执行适配器，不是 Sentry 的长期边界。

### 竞争定位

"链上约束 + Agent 自主执行"赛道已有 MoveGate（Sui）、Sigil（Solana）、ERC-8004（Ethereum）等项目。Sentry 不重新发明 Agent 授权协议。它基于 **MoveGate Mandate** 复用已经过测试覆盖验证的链上授权基础设施（Agent 身份、可撤销授权、hot-potato AuthToken、不可变审计轨迹），在此之上叠加 DeFi 风险响应垂直场景：自然语言策略解析、Guardian 风险检查、Deepbook 执行和 zkLogin 无密码登录，集成到一个完整可演示闭环中。

差异化组合：Sui 原生 × 可组合协议适配器 × 自然语言意图 × 链上受限执行 × 风险响应场景 × zkLogin。

## 2. 问题与机会

当前 AI + DeFi 产品常见问题：

- Agent 只能给建议，真实交易仍需要用户每次签名，无法在快速下跌或脱钩时自主响应。
- 风险规则通常停留在中心化后端或静态参数里，用户难以验证 Agent 是否越权。
- 自然语言交易意图容易产生误解，缺少可读 PTB 预览和系统化 Guardian 检查。

Sui 的对象模型、PTB、zkLogin 和 Deepbook 让 Sentry 可以把“安全授权”和“自主执行”放在同一个可演示闭环里。后续接入 Cetus DLMM、Scallop、Kai 或类似 LeafSheep/CDPM 的仓位管理协议时，应复用同一套 Policy、Guardian、Runtime 和 Activity 边界，只替换或新增 ExecutorAdapter。

更长期的多链、多 venue、CEX、Hyperliquid、跨链结算和再平衡路线，不进入黑客松 MVP；规划见 [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md)。该路线的核心原则是统一策略、权限、风控和执行接口，而不是强行把所有链和交易所伪装成一个底层账户。

## 3. 目标用户

- Active Sui DeFi user：Alice 在 Sui 上持有 5,000 USDC，希望 SUI 闪跌时自动分批买入或响应仓位风险，但不想 24 小时盯盘。
- AI-native crypto builder：Ben 想用自然语言描述策略，看到可读 PTB 和风险提示后一次授权，让 Agent 在明确预算内自主执行。

Local-first 高隐私用户是后续扩展人群。MVP 架构为 Local Mode 预留扩展点，但不实现本地 LLM runtime 或本地守护进程；后续 Local Agent 需要一个 CLI daemon 来长期运行 tick、读取链上状态、管理本地 agent key、执行 adapter PTB、写本地日志并向 Dashboard 或 CLI 展示状态。

## 4. MVP 成功标准

MVP 必须完成一个 Testnet 演示闭环：

1. 用户通过 Web Dashboard 登录并输入自然语言策略。
2. 系统解析策略并展示 human-readable PTB preview 和 Guardian 风险提示。
3. 用户确认后创建链上 MoveGate Mandate 和 SentryPolicyWrapper。
4. Cloud Agent 在无需 owner 每次签名的情况下监控价格、MoveGate Mandate 和 SentryPolicyWrapper 状态。
5. Agent 在 Mandate + Wrapper 限制内执行至少一笔 Deepbook Testnet 交易。
6. 链上产生可追溯 activity log。
7. owner 在 Dashboard 撤销 Policy。
8. Dashboard 通过轮询 activity API 同步显示 revoked 状态。
9. 撤销后 Agent 后续执行被链上或执行前检查拒绝。

Hackathon 视角的成功指标：

- 覆盖 Sub-track 2 的所有 must-have：真实 Deepbook 执行、自主预算检查、链上 activity log、owner revocation。
- 融合 Sub-track 3 的 Intent + Guardian：自然语言到 PTB preview，用户确认，至少两类风险检查。
- 清晰体现 Why Sui：MoveGate Mandate + SentryPolicyWrapper 是 Agent 自主但受限执行的核心。

## 5. 范围

### Must-have

- Web Dashboard
  - zkLogin 登录入口。
  - 自然语言策略输入。
  - 结构化策略展示。
  - PTB preview 展示。
  - Guardian 风险提示。
  - Policy 状态、剩余额度、风险分数和链上日志展示。
  - Policy 撤销按钮。

- Move 合约层（基于 MoveGate 基础设施）
  - 复用 MoveGate Mandate：Agent 身份、可撤销授权、hot-potato AuthToken 同一 PTB 强制消费、不可变 ActionReceipt。
  - SentryPolicyWrapper（自有 shared object）：记录 Deepbook pool_id、递减预算（ceiling - spent）、max_slippage_bps、strategy_hash 和 agent trade 累计记录。
  - 支持 owner 创建和撤销。
  - 支持 Agent 在 Mandate + Wrapper 范围内记录交易。
  - 超预算、过期、撤销、错误 pool 或非授权 agent 必须失败。

- Cloud Agent
  - 使用 Cloudflare Worker + Durable Object 管理 Policy 运行状态。
  - MVP 使用团队部署时预设的 Testnet agent address；用户不能自选 agent，但 Dashboard 必须展示该 address。
  - 定时 tick：读取市场状态、选择 ExecutorAdapter、检查 Guardian、构建 PTB、提交交易、记录执行结果。
  - 自主检查剩余额度，避免提交明显越权交易。

- Executor Adapter 层
  - MVP 只实现 `deepbook` adapter，面向 Sui Testnet Deepbook pool。
  - Adapter 负责读取协议状态、生成可读 preview、估算滑点/预算影响、构建协议 PTB 片段。
  - Adapter 不拥有最终安全边界；任何交易仍必须通过 Mandate + Wrapper + Guardian。

- Deepbook execution
  - MVP 面向 Sui Testnet。
  - 至少完成一次真实 Deepbook 下单或 swap 风格执行。
  - 每次执行必须关联 Mandate + Wrapper，并写入 MoveGate ActionReceipt 与 Sentry `AgentTradeExecuted` 事件。

- Guardian
  - MVP 必须阻止滑点超限。
  - MVP 必须阻止预算超限。
  - MVP 必须阻止过期或已撤销 Mandate。
  - 资金集中风险作为 dashboard score 展示，首版不强制链上阻断。

### Non-goals

- 不在 MVP 承诺 Mainnet 资金执行。
- 不在 MVP 承诺完整本地 LLM 产品化。
- MVP 只保留 Local Mode 和 CLI daemon 扩展点；未来 Local Agent 与 Cloud Agent 共享 PolicyReader、Guardian、ExecutorAdapter 和 ActivityWriter 边界。
- 不在 MVP 承诺多交易所、多链、跨链桥、CEX、Hyperliquid 或复杂组合保证金管理；这些属于 Post-MVP multivenue roadmap，见 [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md)。
- 不在 MVP 承诺自动生成任意 PTB；仅支持 Sentry 已知策略模板。
- 不在 MVP 承诺法律、投资建议或收益保证。

## 6. 用户流程

### 策略创建流程

1. 用户打开 Dashboard。
2. 用户通过 zkLogin 登录，获得 owner address。
3. 用户输入自然语言策略，例如：“当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”
4. 系统解析为结构化策略：触发条件、预算、交易池、最大滑点、过期时间。
5. 系统展示 PTB preview、Guardian 风险提示和即将创建的 Policy 参数。
6. 用户明确确认。
7. 系统创建 MoveGate Mandate + SentryPolicyWrapper 并绑定 Cloud Agent address。
8. Dashboard 展示 PolicyActive 状态。

### Agent 执行流程

1. Durable Object 定时触发 agent tick。
2. Agent 读取 MoveGate Mandate、SentryPolicyWrapper、价格和 Deepbook pool 状态。
3. Agent 执行 Guardian 检查。
4. 如果触发条件未满足，记录 no-op 状态。
5. 如果 Guardian 阻止执行，Dashboard activity feed 展示 blocked reason、observed value 和 threshold。
6. 如果触发条件满足且检查通过，Agent 通过 `deepbook` ExecutorAdapter 构建 PTB。
7. Agent 提交交易并调用 Wrapper 记录函数，由 Wrapper 消费 MoveGate AuthToken 并创建 ActionReceipt。
8. Dashboard 展示交易哈希、预算变化和 activity log。

### 后续 Local Agent 流程

1. 用户安装 `sentry` CLI 并初始化本地 agent key。
2. CLI daemon 读取用户授权过的 Policy 列表，订阅或轮询链上状态。
3. daemon 复用与 Cloud Agent 相同的 PolicyReader、Guardian 和 ExecutorAdapter。
4. daemon 在本地签名并提交 agent PTB；私钥不进入 Cloud Worker。
5. daemon 写本地日志，并可把只读状态同步给 Dashboard 或 CLI。

### 撤销流程

1. owner 在 Dashboard 点击 revoke。
2. 系统提交 revoke PTB。
3. MoveGate Mandate 状态变为 revoked，Dashboard 的 Policy 视图同步显示 revoked。
4. 后续 agent tick 必须停止执行；若仍提交交易，MoveGate 授权或 Wrapper 校验必须拒绝。

## 7. 非功能需求

- 安全性：Mandate + Wrapper 限制必须在链上表达；Cloud Agent 只作为提前检查和自动化执行层。
- 可演示性：所有核心状态必须能在 Dashboard 和链上事件中看到。
- 状态反馈：Dashboard 在用户创建、撤销或 Agent 执行后，应在 5 秒轮询周期内反映最新 Policy 状态或明确显示 pending/stale 状态。
- 可恢复性：Agent tick 失败不能破坏 Policy 状态；失败结果应进入 activity log 或 worker log。
- 隐私：MVP Cloud Mode 不上传私钥；未来 Local Mode 允许本地策略推理。
- Agent 权限透明：MVP 的 agent address 来自部署配置，创建 Policy 前必须在 PTB preview 中展示。
- 可扩展性：策略模板应支持后续加入 DCA、网格、止损、对冲；协议执行通过 adapter registry 扩展，不能把 Deepbook 逻辑散落到 Policy、Guardian 或 Runtime 核心里。

## 8. 参考资源

- MoveGate：https://movegate.xyz/ | 合约：https://github.com/hamzzaaamalik/movegate-contracts | SDK：https://github.com/hamzzaaamalik/movegate-sdk
- pi-worker：https://github.com/qaml-ai/pi-worker
- Sui Agentic Web ideas：https://github.com/DaviRain-Su/Overflow2026-CNNo1/tree/main/ideas/agentic-web
- Sui zkLogin docs：https://docs.sui.io/sui-stack/zklogin-integration/
- Deepbook V3 SDK：https://docs.sui.io/onchain-finance/deepbookv3-sdk/
- Cloudflare Durable Objects + AI Agent：https://developers.cloudflare.com/workflows/get-started/durable-agents/
- Sui Data Stack（GraphQL RPC / gRPC / Archival Store）：https://blog.sui.io/graphql-archival-store-sui-data-stack/?utm_source=twitter&utm_medium=organic&utm_campaign=build_beyond
- Seal（Sui access-controlled decentralized secrets management）：https://seal-docs.wal.app
- WaaP for Agents（two-party signing / policy / approvals）：https://docs.waap.xyz/for-agents
- Sui Agent Skills：https://docs.sui.io/skills

竞品参考（差异化对齐）：
- Sigil（Solana on-chain guardrails）：https://sigil.codes/
- ERC-8004（Ethereum agent authorization standard）：https://eips.ethereum.org/EIPS/eip-8004
- Maw（intent-compiled DeFi agent）：https://github.com/farouk-allani/agentvault
- LeafSheep/CDPM（Sui Cetus DLMM Position Manager agent）：https://app.leafsheep.xyz/skills/README.md
- LI.FI（cross-chain routing / agent integration）：https://docs.li.fi/ | https://docs.li.fi/agents/overview
- deBridge（cross-chain execution / hooks）：https://docs.debridge.com/ | https://docs.debridge.com/home/use-cases/hooks
- Hyperliquid API wallets / perps venue： https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- Sui Stack CRM（Seal + Walrus + Sui shared-object ACL reference）：https://github.com/abhinavg6/sui-stack-crm

外部资料评估：
- Sui data / agent stack assessment：[`docs/08-sui-data-agent-stack-assessment.md`](08-sui-data-agent-stack-assessment.md)
- Market product / frontend roadmap：[`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md)

以上外部资源在进入实现前必须重新核验最新官方文档；本 PRD 只锁定产品意图和 MVP 范围。
