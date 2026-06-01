# RescueGrid PRD v1.0

状态：Draft
日期：2026-06-01
项目名称：RescueGrid - Autonomous Risk Rescue Agent
赛道：Agentic Web, Sui Overflow 2026
主要对齐：Sub-track 2 - Autonomous Agent Wallet
次要融合：Sub-track 3 - Intent Engine；Sub-track 1 - Risk Guardian 部分特性

## 1. 概述

RescueGrid 是一个 Cloud-first、Local-extensible 的自主风险救援 Agent。它让用户通过一次 Move Policy Object 授权，把有限预算、允许交易范围、滑点、过期时间和撤销能力写入链上约束，然后允许 Agent 在这些约束内自主监控、风控、构建 PTB 并在 Deepbook 上执行救援交易。

MVP 的核心叙事是：用户无需把钱包私钥交给 Agent，也无需每笔交易手动签名；Agent 只能在用户明确授权的 Policy 范围内行动，所有执行都有链上日志，并且 owner 可以随时撤销。

## 2. 问题与机会

当前 AI + DeFi 产品常见问题：

- Agent 只能给建议，真实交易仍需要用户每次签名，无法在快速下跌或脱钩时自主响应。
- 风险规则通常停留在中心化后端或静态参数里，用户难以验证 Agent 是否越权。
- 自然语言交易意图容易产生误解，缺少可读 PTB 预览和系统化 Guardian 检查。

Sui 的对象模型、PTB、zkLogin 和 Deepbook 让 RescueGrid 可以把“安全授权”和“自主执行”放在同一个可演示闭环里。

## 3. 目标用户

- DeFi 活跃用户：希望在 Sui DeFi 中运行网格、DCA、救援买入或对冲，但不想持续盯盘。
- AI + Crypto 爱好者：希望用自然语言描述策略，并让 Agent 自动执行。
- 高级隐私用户：长期希望使用本地 LLM；MVP 架构为 Local Mode 预留扩展点，但不实现本地 LLM runtime。

## 4. MVP 成功标准

MVP 必须完成一个 Testnet 演示闭环：

1. 用户通过 Web Dashboard 登录并输入自然语言策略。
2. 系统解析策略并展示 human-readable PTB preview 和 Guardian 风险提示。
3. 用户确认后创建链上 Move Policy Object。
4. Cloud Agent 在无需 owner 每次签名的情况下监控价格和 Policy 状态。
5. Agent 在 Policy 限制内执行至少一笔 Deepbook Testnet 交易。
6. 链上产生可追溯 activity log。
7. owner 在 Dashboard 撤销 Policy。
8. Dashboard 通过轮询 activity API 同步显示 revoked 状态。
9. 撤销后 Agent 后续执行被链上或执行前检查拒绝。

Hackathon 视角的成功指标：

- 覆盖 Sub-track 2 的所有 must-have：真实 Deepbook 执行、自主预算检查、链上 activity log、owner revocation。
- 融合 Sub-track 3 的 Intent + Guardian：自然语言到 PTB preview，用户确认，至少两类风险检查。
- 清晰体现 Why Sui：Policy Object 是 Agent 自主但受限执行的核心。

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

- Move Policy Object
  - 记录 owner、agent、Deepbook pool、预算上限、已花费、最大滑点、过期时间、撤销状态。
  - 支持 owner 创建和撤销。
  - 支持 Agent 在 Policy 范围内记录交易。
  - 超预算、过期、撤销、非授权 agent 必须失败。

- Cloud Agent
  - 使用 Cloudflare Worker + Durable Object 管理 Policy 运行状态。
  - MVP 使用团队部署时预设的 Testnet agent address；用户不能自选 agent，但 Dashboard 必须展示该 address。
  - 定时 tick：读取市场状态、检查 Guardian、构建 PTB、提交交易、记录执行结果。
  - 自主检查剩余额度，避免提交明显越权交易。

- Deepbook execution
  - MVP 面向 Sui Testnet。
  - 至少完成一次真实 Deepbook 下单或 swap 风格执行。
  - 每次执行必须关联 Policy 并写入链上事件。

- Guardian
  - MVP 必须阻止滑点超限。
  - MVP 必须阻止预算超限。
  - MVP 必须阻止过期或已撤销 Policy。
  - 资金集中风险作为 dashboard score 展示，首版不强制链上阻断。

### Non-goals

- 不在 MVP 承诺 Mainnet 资金执行。
- 不在 MVP 承诺完整本地 LLM 产品化。
- 不在 MVP 承诺多交易所、多链或复杂组合保证金管理。
- 不在 MVP 承诺自动生成任意 PTB；仅支持 RescueGrid 已知策略模板。
- 不在 MVP 承诺法律、投资建议或收益保证。

## 6. 用户流程

### 策略创建流程

1. 用户打开 Dashboard。
2. 用户通过 zkLogin 登录，获得 owner address。
3. 用户输入自然语言策略，例如：“当 SUI 下跌超过 8% 时启动 500 USDC 救援网格。”
4. 系统解析为结构化策略：触发条件、预算、交易池、最大滑点、过期时间。
5. 系统展示 PTB preview、Guardian 风险提示和即将创建的 Policy 参数。
6. 用户明确确认。
7. 系统创建 Move Policy Object 并绑定 Cloud Agent address。
8. Dashboard 展示 PolicyActive 状态。

### Agent 执行流程

1. Durable Object 定时触发 agent tick。
2. Agent 读取 Policy、价格和 Deepbook pool 状态。
3. Agent 执行 Guardian 检查。
4. 如果触发条件未满足，记录 no-op 状态。
5. 如果 Guardian 阻止执行，Dashboard activity feed 展示 blocked reason、observed value 和 threshold。
6. 如果触发条件满足且检查通过，Agent 构建 PTB。
7. Agent 提交交易并调用 Policy 记录函数。
8. Dashboard 展示交易哈希、预算变化和 activity log。

### 撤销流程

1. owner 在 Dashboard 点击 revoke。
2. 系统提交 revoke PTB。
3. Policy 状态变为 revoked。
4. 后续 agent tick 必须停止执行；若仍提交交易，链上 Policy 校验必须拒绝。

## 7. 非功能需求

- 安全性：Policy 限制必须在链上表达；Cloud Agent 只作为提前检查和自动化执行层。
- 可演示性：所有核心状态必须能在 Dashboard 和链上事件中看到。
- 可恢复性：Agent tick 失败不能破坏 Policy 状态；失败结果应进入 activity log 或 worker log。
- 隐私：MVP Cloud Mode 不上传私钥；未来 Local Mode 允许本地策略推理。
- Agent 权限透明：MVP 的 agent address 来自部署配置，创建 Policy 前必须在 PTB preview 中展示。
- 可扩展性：策略模板应支持后续加入 DCA、网格、止损、对冲。

## 8. 参考资源

- pi-worker：https://github.com/qaml-ai/pi-worker
- Sui Agentic Web ideas：https://github.com/DaviRain-Su/Overflow2026-CNNo1/tree/main/ideas/agentic-web
- Move Policy / Capability example：https://blog.stackademic.com/ai-safe-smart-contracts-on-sui-move-02c382bb05d9
- Sui zkLogin docs：https://docs.sui.io/sui-stack/zklogin-integration/
- Deepbook V3 SDK：https://docs.sui.io/onchain-finance/deepbookv3-sdk/
- Cloudflare Durable Objects + AI Agent：https://developers.cloudflare.com/workflows/get-started/durable-agents/

以上外部资源在进入实现前必须重新核验最新官方文档；本 PRD 只锁定产品意图和 MVP 范围。
