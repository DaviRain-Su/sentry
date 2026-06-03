# Sentry PRD v1.0

状态:Draft
日期:2026-06-01
项目名称:Sentry:自主 DeFi 风险响应 Agent
英文定位:Autonomous DeFi Risk Response Agent
定位:跨链自主风险代理平台
当前实现:Sui Testnet MVP(基于 MoveGate)+ Local Agent-first 产品转向
目标:本地 Agent 调度平台 × 多 venue 资产控制 × 链上/交易所受限执行 × 自然语言意图

## 1. 概述

Sentry 是一个 **Local Agent 调度平台**。它不是自己执行交易的 Agent,而是一个**守护程序**(daemon)--负责管理策略、监控状态、Guardian 风控,然后**调度外部 Agent**(Claude Code、Codex、Kimi 等)去执行具体的链上或交易所操作。

当前 Sui Testnet MVP 已经证明 MoveGate Mandate + SentryPolicyWrapper 能把有限预算、允许交易范围、滑点、过期时间和撤销能力写入链上约束。新的产品方向是:用户本机运行 Sentry 守护程序,守护程序根据策略触发条件,向外部 Agent 分发任务,外部 Agent 使用本机已有的钱包、OWS vault、交易所 API key 等环境完成执行,结果回报给守护程序记录。

核心叙事是:用户无需把钱包私钥或交易所 withdrawal key 交给云端服务;Sentinel 守护程序自己不碰私钥,而是调度本机已有的 Agent 工具(Claude Code / Codex / Kimi)在策略约束内行动。守护程序是"大脑"(策略 + 风控 + 调度),外部 Agent 是"手"(执行 + 签名)。

### 2026-06-03 Agent dispatch architecture

Sentry 的生产架构是 Agent 调度平台:

- **守护程序(Sentry daemon)**:管理策略、Tick 监控、Guardian 风险检查、Agent 调度、Activity 日志。不自行执行交易。
- **外部 Agent**:Claude Code、Codex、Kimi 等本地 Agent 工具。守护程序向它们分发任务("在 Solana 上 swap 100 USDC"),外部 Agent 使用本机已有的钱包/OWS/CLI 环境签名执行。
- **Worker bridge**:CLI daemon 主动通过 outbound WebSocket 连接 Cloudflare Worker / AgentSession Durable Object,用于远程状态展示和命令中继。
- **链上策略约束**:MoveGate(Sui)、Sigil(Solana)、ERC-8004(Ethereum)等链上授权基础设施,确保 Agent 不越权。
- **本机环境**:OWS vault、OS keychain/keyring、Solana CLI、各种钱包工具--这些由外部 Agent 直接使用,Sentry 守护程序不代理也不保存。

### 竞争定位

"链上约束 + Agent 自主执行"赛道已有 MoveGate(Sui)、Sigil(Solana)、ERC-8004(Ethereum)等项目。Sentry 不重新发明 Agent 授权协议。它基于 **MoveGate Mandate** 复用已经过测试覆盖验证的链上授权基础设施(Agent 身份、可撤销授权、hot-potato AuthToken、不可变审计轨迹),在此之上叠加 DeFi 风险响应垂直场景:自然语言策略解析、Guardian 风险检查、Deepbook 执行和 zkLogin 无密码登录,集成到一个完整可演示闭环中。

差异化组合:Agent 调度平台 × 策略引擎 × Guardian 风控 × 链上约束执行 × 自然语言意图 × 零云端 custody。

Sentry 自身不写交易执行代码。DAO 守护程序负责策略 + 风控 + 调度,具体交易的构建和签名由外部 Agent(Claude Code / Codex / Kimi)使用本机已有工具链完成。

## 2. 问题与机会

当前 AI + DeFi 产品常见问题:

- Agent 只能给建议,真实交易仍需要用户每次签名,无法在快速下跌或脱钩时自主响应。
- 风险规则通常停留在中心化后端或静态参数里,用户难以验证 Agent 是否越权。
- 自然语言交易意图容易产生误解,缺少可读 PTB 预览和系统化 Guardian 检查。

Sui 的对象模型、PTB、zkLogin 和 Deepbook 让 Sentry 可以把"安全授权"和"自主执行"放在同一个可演示闭环里。后续接入 Cetus DLMM、Scallop、Kai 或类似 LeafSheep/CDPM 的仓位管理协议时,应复用同一套 Policy、Guardian、Runtime 和 Activity 边界,只替换或新增 ExecutorAdapter。

更长期的多链、多 venue、CEX、Hyperliquid、跨链结算和再平衡路线,不进入黑客松 MVP;规划见 [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md)。该路线的核心原则是统一策略、权限、风控和执行接口,而不是强行把所有链和交易所伪装成一个底层账户。

## 3. 目标用户

- Active Sui DeFi user:Alice 在 Sui 上持有 5,000 USDC,希望 SUI 闪跌时自动分批买入或响应仓位风险,但不想 24 小时盯盘。
- AI-native crypto builder:Ben 想用自然语言描述策略,看到可读 PTB 和风险提示后一次授权,让 Agent 在明确预算内自主执行。

Local-first 高隐私用户是默认目标用户。Sentry 守护程序(CLI daemon)长期运行 tick、监控链上和交易所状态、执行 Guardian 检查,并在策略触发时将任务分发给外部 Agent。外部 Agent 使用本机已有的钱包/OWS/CLI 环境完成执行。用户若需从浏览器或移动端控制守护程序,通过 Worker bridge 与 AgentSession Durable Object 保持连接;Worker 只中继命令和摘要,不保存 secrets。

## 4. MVP 成功标准

MVP 必须完成一个 Testnet 演示闭环:

1. 用户通过 Web Dashboard 登录并输入自然语言策略。
2. 系统解析策略并展示 human-readable PTB preview 和 Guardian 风险提示。
3. 用户确认后创建链上 MoveGate Mandate 和 SentryPolicyWrapper。
4. Cloud Agent 在无需 owner 每次签名的情况下监控价格、MoveGate Mandate 和 SentryPolicyWrapper 状态。
5. Agent 在 Mandate + Wrapper 限制内执行至少一笔 Deepbook Testnet 交易。
6. 链上产生可追溯 activity log。
7. owner 在 Dashboard 撤销 Policy。
8. Dashboard 通过轮询 activity API 同步显示 revoked 状态。
9. 撤销后 Agent 后续执行被链上或执行前检查拒绝。

Hackathon 视角的成功指标:

- 覆盖 Sub-track 2 的所有 must-have:真实 Deepbook 执行、自主预算检查、链上 activity log、owner revocation。
- 融合 Sub-track 3 的 Intent + Guardian:自然语言到 PTB preview,用户确认,至少两类风险检查。
- 清晰体现 Why Sui:MoveGate Mandate + SentryPolicyWrapper 是 Agent 自主但受限执行的核心。

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

- Move 合约层(基于 MoveGate 基础设施)
  - 复用 MoveGate Mandate:Agent 身份、可撤销授权、hot-potato AuthToken 同一 PTB 强制消费、不可变 ActionReceipt。
  - SentryPolicyWrapper(自有 shared object):记录 Deepbook pool_id、递减预算(ceiling - spent)、max_slippage_bps、strategy_hash 和 agent trade 累计记录。
  - 支持 owner 创建和撤销。
  - 支持 Agent 在 Mandate + Wrapper 范围内记录交易。
  - 超预算、过期、撤销、错误 pool 或非授权 agent 必须失败。

- Sentry 守护程序(daemon)
  - 管理 Policy 运行状态、tick loop、资产同步、Guardian 风险检查、Agent 调度和本地 activity log。
  - 守护程序不自行执行交易。交易执行委托给外部 Agent(Claude Code / Codex / Kimi 等)。
  - 守护程序通过 Agent dispatch protocol 向外部 Agent 分发任务,包含:策略上下文、约束参数(预算、滑点、venue)、期望动作。
  - 外部 Agent 使用本机已有环境(OWS vault、Solana CLI、钱包等)签名和执行。守护程序不代理也不保存私钥或 API secret。
  - 定时 tick:读取市场状态、资产快照、订单状态和 venue health,检查 Guardian,决定是否触发,若触发则向外部 Agent 分发任务。
  - 接收外部 Agent 的执行结果,写入本地 activity log。
  - 自主检查剩余额度、venue caps、stale data、key scope 和撤销状态,避免分发明显越权任务。

- Remote Worker(可选,Sui Testnet demo 路径)
  - 保留 Cloudflare Worker + Durable Object 的 Sui Testnet demo 路径。
  - 可作为远程只读 API、活动聚合或 judge demo runtime。
  - 不作为生产默认 custody 或 Agent 调度路径。

- Agent 调度层
  - 守护程序内置 Agent registry:注册可用的外部 Agent(Claude Code、Codex、Kimi 等)。
  - Agent dispatch protocol:守护程序向外部 Agent 发送结构化任务,包含策略上下文、约束参数、期望动作。
  - 外部 Agent 返回结构化执行结果,守护程序写入 activity log。
  - MVP 阶段先支持 CLI-based 调度(通过 subprocess/stdio),后续可扩展 MCP(Model Context Protocol)。
  - 守护程序不捆绑特定 Agent;用户可选择自己信任的 Agent 工具。

- Deepbook execution
  - MVP 面向 Sui Testnet。
  - 至少完成一次真实 Deepbook 下单或 swap 风格执行。
  - 每次执行必须关联 Mandate + Wrapper,并写入 MoveGate ActionReceipt 与 Sentry `AgentTradeExecuted` 事件。

- Guardian
  - MVP 必须阻止滑点超限。
  - MVP 必须阻止预算超限。
  - MVP 必须阻止过期或已撤销 Mandate。
  - 资金集中风险作为 dashboard score 展示,首版不强制链上阻断。

### Non-goals

- 不在 MVP 承诺 Mainnet 资金执行。
- 不在当前代码中承诺完整本地 daemon 已实现。本文档锁定 Local Agent-first 产品方向和接口边界。
- Local Agent 与现有 Worker demo 共享 PolicyReader、Guardian、ExecutorAdapter 和 ActivityWriter 边界,但生产 custody 默认只走本地。
- 不在 MVP 承诺多交易所、多链、跨链桥、CEX、Hyperliquid 或复杂组合保证金管理;这些属于 Post-MVP multivenue roadmap,见 [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md)。
- 不在 MVP 承诺自动生成任意 PTB;仅支持 Sentry 已知策略模板。
- 不在 MVP 承诺法律、投资建议或收益保证。

## 6. 用户流程

### 策略创建流程

1. 用户打开 Dashboard。
2. 用户通过 zkLogin 登录,获得 owner address。
3. 用户输入自然语言策略,例如:"当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。"
4. 系统解析为结构化策略:触发条件、预算、交易池、最大滑点、过期时间。
5. 系统展示 PTB preview、Guardian 风险提示和即将创建的 Policy 参数。
6. 用户明确确认。
7. 系统创建 MoveGate Mandate + SentryPolicyWrapper 并绑定 Cloud Agent address。
8. Dashboard 展示 PolicyActive 状态。

### Agent 调度执行流程

1. 守护程序定时触发 tick。
2. 守护程序读取策略状态、价格、链上数据。
3. 守护程序执行 Guardian 检查。
4. 如果触发条件未满足,记录 no-op 状态。
5. 如果 Guardian 阻止执行,activity feed 展示 blocked reason。
6. 如果触发条件满足且检查通过,守护程序构建 Agent 任务(task)。
7. 守护程序向注册的外部 Agent(如 Claude Code)分发任务。
8. 外部 Agent 使用本机环境(wallet/OWS/CLI)构建并提交交易。
9. 外部 Agent 回报执行结果给守护程序。
10. 守护程序写入 activity log,Dashboard 展示交易哈希、预算变化。

### 守护程序 + Agent 调度流程

1. 用户安装 `sentry` CLI 并初始化守护程序。
2. 用户注册外部 Agent(`sentry agent register claude-code`),守护程序验证 Agent 可用性。
3. CLI 检查本机环境(OWS vault、Solana CLI、钱包工具等),创建 Sentry 本地配置目录。
4. 用户可执行 `sentry agent pair <pairing_code>`,让守护程序连接 Worker bridge;未配对时仍可 local-only 运行。
5. 守护程序读取用户授权过的 Policy 列表,订阅或轮询链上、交易所和 perps 状态。
6. 守护程序执行 tick loop:读状态 → Guardian 检查 → 若触发则构建任务 → 分发给外部 Agent。
7. 外部 Agent 使用本机环境签名/下单;私钥和交易所 secret 不进入守护程序,也不进入 Cloud Worker。
8. 外部 Agent 回报结果,守护程序写本地日志,并可同步摘要给 Dashboard。

### 撤销流程

1. owner 在 Dashboard 点击 revoke。
2. 系统提交 revoke PTB。
3. MoveGate Mandate 状态变为 revoked,Dashboard 的 Policy 视图同步显示 revoked。
4. 后续 agent tick 必须停止执行;若仍提交交易,MoveGate 授权或 Wrapper 校验必须拒绝。

## 7. 非功能需求

- 安全性：Mandate + Wrapper 限制必须在链上表达；Guardian 在守护程序侧做预检查；外部 Agent 在策略约束内执行。
- 可演示性：所有核心状态必须能在 Dashboard 和链上事件中看到。
- 状态反馈：Dashboard 在用户创建、撤销或 Agent 执行后，应在 5 秒轮询周期内反映最新 Policy 状态或明确显示 pending/stale 状态。
- 可恢复性：守护程序 tick 失败不能破坏 Policy 状态；失败结果应进入 activity log。
- 隐私：守护程序不上传私钥或 API secret；外部 Agent 使用本机环境完成签名。
- Agent 权限透明：策略创建前必须在 preview 中展示 Agent 身份和约束边界。
- 可扩展性：策略模板应支持后续加入 DCA、网格、止损、对冲；Agent 调度协议应支持多种外部 Agent 接入。

## 8. 参考资源

- MoveGate:https://movegate.xyz/ | 合约:https://github.com/hamzzaaamalik/movegate-contracts | SDK:https://github.com/hamzzaaamalik/movegate-sdk
- pi-worker:https://github.com/qaml-ai/pi-worker
- Sui Agentic Web ideas:https://github.com/DaviRain-Su/Overflow2026-CNNo1/tree/main/ideas/agentic-web
- Sui zkLogin docs:https://docs.sui.io/sui-stack/zklogin-integration/
- Deepbook V3 SDK:https://docs.sui.io/onchain-finance/deepbookv3-sdk/
- Cloudflare Durable Objects + AI Agent:https://developers.cloudflare.com/workflows/get-started/durable-agents/
- Sui Data Stack(GraphQL RPC / gRPC / Archival Store):https://blog.sui.io/graphql-archival-store-sui-data-stack/?utm_source=twitter&utm_medium=organic&utm_campaign=build_beyond
- Seal(Sui access-controlled decentralized secrets management):https://seal-docs.wal.app
- WaaP for Agents(two-party signing / policy / approvals):https://docs.waap.xyz/for-agents
- Open Wallet Standard(local wallet storage / policy-gated signing / agent access):https://docs.openwallet.sh/
- Sui Agent Skills:https://docs.sui.io/skills

竞品参考(差异化对齐):
- Sigil(Solana on-chain guardrails):https://sigil.codes/
- ERC-8004(Ethereum agent authorization standard):https://eips.ethereum.org/EIPS/eip-8004
- Maw(intent-compiled DeFi agent):https://github.com/farouk-allani/agentvault
- LeafSheep/CDPM(Sui Cetus DLMM Position Manager agent):https://app.leafsheep.xyz/skills/README.md
- LI.FI(cross-chain routing / agent integration):https://docs.li.fi/ | https://docs.li.fi/agents/overview
- deBridge(cross-chain execution / hooks):https://docs.debridge.com/ | https://docs.debridge.com/home/use-cases/hooks
- Hyperliquid API wallets / perps venue: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- Sui Stack CRM(Seal + Walrus + Sui shared-object ACL reference):https://github.com/abhinavg6/sui-stack-crm

外部资料评估:
- Sui data / agent stack assessment:[`docs/08-sui-data-agent-stack-assessment.md`](08-sui-data-agent-stack-assessment.md)
- Market product / frontend roadmap:[`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md)

以上外部资源在进入实现前必须重新核验最新官方文档;本 PRD 只锁定产品意图和 MVP 范围。
