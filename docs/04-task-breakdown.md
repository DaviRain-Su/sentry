# Sentry Task Breakdown v1.0

状态：Draft
日期：2026-06-01
定位：Sentry：自主 DeFi 风险响应 Agent

任务类型：

- `Commit`：进入主线的生产或项目文档工作，必须保持规格一致。
- `Explore`：验证外部依赖或不确定实现，不能直接当作可发布代码；探索结论进入规格后再转 Commit。

## Phase A - Docs Foundation

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| A1 | Commit | 1h | 固化 PRD | `docs/01-prd.md` 明确 MVP、non-goals、演示闭环 |
| A2 | Commit | 1h | 固化架构 | `docs/02-architecture.md` 明确 Dashboard、Worker、Durable Object、Move、Runtime Core、ExecutorAdapter、Deepbook 边界 |
| A3 | Commit | 2h | 固化技术规格 | `docs/03-technical-spec.md` 明确 Move surface、API、状态机、Guardian、adapter contract |
| A4 | Commit | 1h | 固化任务拆解 | `docs/04-task-breakdown.md` 把后续实现切成 ≤4h 任务 |
| A5 | Commit | 1h | 固化测试规格 | `docs/05-test-spec.md` 明确每个核心行为的测试和 demo 验收 |

## Phase B - External Feasibility Checks

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| B0 | Explore | 3h | 核验 MoveGate 合约稳定性、SDK/PTB 适配性和 Mandate 访问模型 | 确认 contract ABI 稳定、live creation fee 可读取、TypeName/allowed_coin_types 可构造、agent 可在无 owner co-sign 的 PTB 中访问 Mandate，否则触发独立 Policy 回退 |
| B1 | Explore | 2h | 核验 Sui Testnet Deepbook 可用 pool | 记录 pool id、资产、精度、测试资金获取方式 |
| B2 | Explore | 3h | 最小 Deepbook Testnet 下单脚本 | 能完成一笔测试交易或明确 Testnet 阻塞项 |
| B3 | Explore | 2h | 核验 zkLogin 最新接入流程 | 记录 dashboard 登录最小链路和 SDK 版本 |
| B4 | Explore | 2h | 核验 Cloudflare Durable Object alarm/runtime 限制 | 记录 tick 周期、持久状态、部署配置 |
| B5 | Explore | 2h | 验证 MoveGate AuthToken + Deepbook + SentryPolicyWrapper + ActionReceipt 同一 PTB 可组合性 | 仅当 B0 结论为 MoveGate 可用时执行；最小脚本能构建包含 authorize_action → Deepbook swap → record_agent_trade/create_success_receipt 的 PTB |
| B6 | Explore | 1h | pi-worker 快速浏览 | 已产出 [`docs/07-pi-worker-assessment.md`](07-pi-worker-assessment.md)：可作为 operator/agent-session layer，不替换 MVP deterministic Worker hot path |
| B7 | Explore | 2h | pi-worker 深度验证 | 仅当需要 operator console 或 local/cloud agent parity 时运行 terminal-agent 示例；验收为读策略状态和 proposal-only strategy draft，不接触 `AGENT_KEY` |
| B8 | Explore | 2h | LeafSheep/CDPM adapter feasibility note | 明确它只能作为 Post-MVP Sui mainnet PositionManager adapter 参考，不进入 MVP critical path |

## Phase C - Move Package

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| C1 | Commit | 1h | 初始化 Sui Move package + MoveGate 依赖 | `sui move build` 通过，MoveGate 作为外部依赖正确引入 |
| C2 | Commit | 2h | 实现 shared `SentryPolicyWrapper` object 和 events | 字段（含 `mandate_id` 引用）、share object 行为和事件与技术规格一致 |
| C3 | Commit | 3h | 实现 create policy PTB/helper 和 `revoke_policy` | 单笔 PTB 创建 MoveGate Mandate + Wrapper 并确保 Mandate 可被 agent 后续访问；若 PTB 无法稳定构造 MoveGate `TypeName`，用薄 Move helper 负责创建；撤销通过 MoveGate revoke；单元测试覆盖 happy/error path |
| C4 | Commit | 1.5h | 实现 `assert_policy_valid` | 测试覆盖 pool_id、budget、slippage 校验（agent/expiry/revoked 由 MoveGate 覆盖） |
| C5 | Commit | 3h | 实现 `record_agent_trade`（通过 MoveGate receipt 消费 AuthToken） | 测试覆盖 AuthToken 单次消费、ActionReceipt 创建、spent_amount 递增、错误 token 拒绝 |
| C6 | Commit | 1h | Move 单元测试全量通过 | `sui move test` 通过，失败测试覆盖关键 abort |
| C7 | Commit | 2h | Testnet publish script | 可以部署并输出 package id 和 wrapper object id |

## Phase D - Web Dashboard

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| D1 | Commit | 2h | 初始化前端 app | 本地 dev server 可打开 dashboard |
| D2 | Commit | 3h | 实现 zkLogin 登录 UI | 能显示 owner address |
| D3 | Commit | 3h | 实现 intent input + preview panel | 能展示结构化策略、warnings、PTB preview |
| D4 | Commit | 3h | 实现 policy status view | 展示 budget、spent、risk score、runtime state |
| D5 | Commit | 2h | 实现 revoke flow | 用户确认后发起 revoke API |
| D6 | Commit | 2h | 前端错误和空状态 | parse、policy、activity 失败有明确 UI 状态 |

## Phase E - Worker and Durable Object

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| E1 | Commit | 2h | 初始化 Cloudflare Worker project | 本地 wrangler dev 可运行 |
| E2 | Commit | 3h | 实现 `/api/intents/parse` | 支持 risk_response 模板和错误响应 |
| E3 | Commit | 3h | 实现 `/api/policies` | 能提交 create policy 或生成签名请求 |
| E4 | Commit | 2h | 实现 `/api/policies/:wrapper_id/activity` | 能聚合 Mandate、Wrapper、chain event 和 runtime state |
| E5 | Commit | 3h | 实现 Durable Object policy runtime | 每个 policy 独立状态，支持 alarm tick |
| E6 | Commit | 3h | 实现 Guardian checks | 按技术规格顺序检查 `ExecutionPlan` 并返回 blocked reason |
| E7 | Commit | 3h | 实现 `/api/agent/tick` | 支持 no-op、blocked、executed、stopped 状态 |
| E8 | Commit | 2h | 状态同步与恢复 | activity API 以链上状态为准，runtime stale 时自动纠正 |
| E9 | Commit | 3h | 实现 Runtime Core + adapter registry | Runtime Core 能选择 `deepbook` adapter；未知 `executor_kind` 返回 `UNSUPPORTED_EXECUTOR` |

## Phase F - Protocol Execution Adapter

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| F1 | Commit | 3h | 固化 `deepbook` ExecutorAdapter | 基于 Phase B 结论实现选定 pool 的 market read、plan、preview、PTB build |
| F2 | Commit | 3h | 集成 Deepbook SDK/Transaction Builder | Worker 能构建交易 payload |
| F3 | Commit | 3h | 把 authorize_action、Deepbook call、ActionReceipt 和 Wrapper record 放入同一执行链路 | 成功交易会产生 MoveGate ActionReceipt 和 `AgentTradeExecuted` |
| F4 | Commit | 2h | 失败恢复和幂等处理 | 重试不会重复扣预算或重复展示成功 |

## Phase G - Demo Hardening

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| G1 | Commit | 2h | Demo seed/config | 一条命令输出所需 env、package id、agent address |
| G2 | Commit | 2h | Demo script | 覆盖 create -> monitor -> execute -> revoke |
| G3 | Commit | 2h | README quickstart | 新用户能按步骤跑起演示 |
| G4 | Commit | 3h | Final docs + QA pass | 子验收 1：PRD/架构/规格与实际实现保持一致；子验收 2：用浏览器、Worker 日志和链上查询验证完整闭环 |

## Phase H - Post-MVP Composability

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| H1 | Explore | 3h | Local CLI daemon design spike | 明确 `sentry daemon run/status/tick/logs` 命令、key storage、外部 signer 和 activity sync |
| H2 | Commit | 4h | 抽出 Runtime Core package | Worker 和 CLI daemon 可复用 PolicyReader、Guardian、ExecutorAdapter registry、ActivityWriter 接口 |
| H3 | Explore | 4h | CDPM/Cetus DLMM adapter design | 明确 PositionManager id、bin range、fee collection、rebalance、agent delegation 风险和 wrapper 扩展需求 |
| H4 | Explore | 3h | Scallop/Kai adapter design | 明确 lending market/vault target constraints、stale-state pre-step、redeem sizing 和 hot-potato ticket 约束 |
| H5 | Commit | 4h | Adapter SDK skeleton | 新 adapter 必须提供 readMarket、planExecution、buildPtb、parseExecutionResult 和 conformance tests |

## Phase I - Post-MVP Multivenue Expansion

Phase I is a product expansion track, not a hackathon dependency. Planning baseline: [`docs/06-post-mvp-multivenue-roadmap.md`](06-post-mvp-multivenue-roadmap.md).

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| I1 | Explore | 4h | VenueAccount data model spike | 明确 Sui policy、EVM smart account、Solana delegate、Hyperliquid API wallet、CEX subaccount/API key 的统一字段和差异字段 |
| I2 | Explore | 4h | Hyperliquid adapter feasibility | 核验 API wallet、subaccount/vault、nonce、expiresAfter、TWAP、leverage/margin、revocation UX，产出 paper-trade adapter spec |
| I3 | Explore | 4h | OKX/Binance CEX adapter safety model | 明确 trade-only key、IP allow-list、subaccount、no-withdraw 默认、order id evidence、local signer 或 signer service 边界 |
| I4 | Explore | 4h | LI.FI settlement adapter feasibility | 核验 quote/status/chains/tokens/tools endpoints、Sui/Solana/EVM 覆盖、失败恢复和 API rate limits；只作为再平衡/settlement adapter |
| I5 | Explore | 4h | deBridge settlement adapter feasibility | 核验 DLN route、order tracking、cancel/reclaim、hooks、success-required/non-atomic 行为；只作为再平衡/settlement adapter |
| I6 | Commit | 4h | StrategyMandate v2 draft spec | 明确 `venue_scope`、`settlement_scope`、per-venue budget、bridge fee/ETA、human-confirm action set 和 mandate hash |
| I7 | Commit | 4h | ActivityEvent v2 draft spec | 支持 chain tx、CEX order id、Hyperliquid cloid、bridge order id、quote id、partial/recoverable 状态 |
| I8 | Explore | 4h | Cross-venue inventory model | 明确预置库存、再平衡阈值、桥不进 hot path、套利只从 paper/tiny-size 开始 |

## Phase J - Post-MVP Sui Data, Privacy and Signer Hardening

Phase J is based on [`docs/08-sui-data-agent-stack-assessment.md`](08-sui-data-agent-stack-assessment.md). It is not a hackathon dependency, but it should start before production because Sui JSON-RPC has a published deactivation deadline.

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| J1 | Explore | 3h | ChainDataProvider design | Worker reads are behind `ChainDataProvider`; current JSON-RPC/SuiClient path remains as `JsonRpcChainDataProvider` |
| J2 | Commit | 4h | GraphQL policy/activity read spike | Implement read-only GraphQL provider for policy list, wrapper snapshots and activity history; compare output against current Worker endpoints |
| J3 | Explore | 3h | gRPC monitoring spike | Decide whether agent tick should use gRPC streaming for price/event triggers or keep timer polling for MVP-like policies |
| J4 | Explore | 3h | Archival Store history/replay design | Define historical activity, performance replay and judge/demo replay queries that need archival-backed data |
| J5 | Explore | 4h | Seal + Walrus private policy record design | Define encrypted strategy snapshot, backtest, reasoning trace and incident report schema; explicitly exclude wallet/agent private keys |
| J6 | Explore | 3h | Sui Stack CRM pattern adaptation | Map shared-object ACL + Walrus blob id + version events into `PolicyPrivateRecord` or equivalent object design |
| J7 | Explore | 4h | WaaP/external signer adapter design | Draft `SignerAdapter` for `worker-secret`, `local-daemon`, `waap`, `hardware`, `remote-signer`; require security review before production submission |
| J8 | Commit | 1h | Sui Agent Skills setup note | Add recommended Sui skills to engineering setup for data access, PTBs, Move tests, publish and frontend dApp Kit workflows |

## Phase K - Post-MVP Product Breadth and Frontend Design

Phase K is based on [`docs/09-market-product-and-frontend-roadmap.md`](09-market-product-and-frontend-roadmap.md). It turns market research into design and implementation backlog. It is not a hackathon dependency, but it should guide the next product demo because the current UI still reads as one rescue strategy rather than a composable DeFi agent platform.

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| K1 | Explore | 2h | Competitor/product matrix | Confirm comparable products and extract UI patterns for AI agents, automation, vaults, perps funding, lending and LP managers |
| K2 | Commit | 4h | Strategy Marketplace shell | Add category tabs, strategy cards, adapter badges, risk badges and availability status; unsupported templates must be clearly marked coming soon |
| K3 | Commit | 4h | Opportunity Scanner shell | Add funding heatmap, perp spread matrix, lending APY table, LP opportunity table and stablecoin peg monitor using mock or read-only data |
| K4 | Commit | 4h | Strategy detail templates | Add detail views for Funding Rate Harvest, Lending Optimizer and LP Range Manager with capital flow, yield decomposition, risk decomposition and Guardian rules |
| K5 | Explore | 3h | Strategy Builder v2 design | Specify multi-leg template selection, venue/adapters, capital constraints, PTB/action preview, Guardian checks and signer/agent mode |
| K6 | Commit | 4h | Active Strategy Detail v2 | Show live legs, net exposure, PnL/carry attribution, open orders, last tick, next tick, pending approvals and pause/resume/revoke actions |
| K7 | Commit | 3h | Risk Center | Show global budget, venue caps, liquidation watch list, oracle/source health, signer status, stale-data warnings and emergency-stop controls |
| K8 | Commit | 3h | Agent Ledger v2 | Add strategy/venue/status filters plus expandable rows for reason, input snapshot, execution plan, Guardian result, tx/order id and budget impact |

## Hackathon Critical Path

MVP 任务清单约 76h（含 B8 feasibility note 和 E9 adapter registry），Phase H 约 18h 且不进入 hackathon critical path。单人 hackathon 应优先跑最小可演示闭环。Critical path 只保留证明 Sub-track 2 的必要任务：

1. A1-A5：锁定文档契约。
2. B0、B1、B2、B5：先验证 MoveGate 适配性与 Mandate 访问模型、Deepbook pool、最小下单和 AuthToken + Deepbook + Wrapper + ActionReceipt 同一 PTB 可组合性；B5 仅在 B0 通过后执行。
3. C1-C4、C6、C7：完成 Wrapper 合约、Policy 创建/撤销/授权校验和 Testnet publish；Guardian block 只写 runtime log，不写链上 block event。
4. E2、E3、E6、E7、E8、E9：实现 parse、policy create、Guardian、agent tick、状态同步和 adapter registry。
5. F1、F3：固化 Deepbook adapter，并把 MoveGate AuthToken + Deepbook + ActionReceipt + Wrapper record 接入同一执行链路。
6. D2-D5：Dashboard 只做登录、preview、status、revoke 的最小 UI。
7. G1、G2、G4：跑通配置、demo script 和最终验证。

Polish 可延后：D1 的完整视觉打磨、D6 的细粒度空状态、B7 pi-worker 深度验证、B8 LeafSheep/CDPM 深度验证、F4 幂等增强、Phase H、Phase I、Phase J、Phase K、Post-MVP browser QA。

如果 B0 发现 MoveGate 不适合，退回到独立实现 RescuePolicy Object（回退为旧版 Phase C 估计 14h）。

## Dependency Order

1. Phase A must be complete before implementation.
2. Phase B must complete before committing Deepbook or zkLogin production code.
3. B5 depends on B0 returning "MoveGate usable"; skip B5 and switch to the independent `RescuePolicy` fallback if B0 fails.
4. Move Package should land before Worker execution code.
5. Worker parse/preview can start before Move publish, but must use the technical spec types.
6. Dashboard D2 has no Worker dependency; it only needs the chosen zkLogin path.
7. Dashboard D3 can use mocked `/api/intents/parse` until E2 exists.
8. Dashboard D4 needs E3/E4 for real Policy data, but may start with fixtures.
9. Dashboard D5 needs E3 or the final revoke API shape before real-chain testing.
10. Demo Hardening starts only after one Testnet transaction is confirmed.
11. Post-MVP adapters depend on Runtime Core + adapter registry; they must not be implemented by branching Deepbook-specific runtime code.
12. Phase I depends on Phase H adapter boundaries and must not change hackathon MVP acceptance.
13. Phase J depends on Worker-first read semantics; GraphQL/gRPC migration must not move production reads directly into the frontend.
14. Phase K depends on the adapter registry and Worker-first API shape; frontend breadth must not imply real execution support until an adapter exists.

## Stop Conditions

- MoveGate 合约不可用、Mandate 无法被 agent 无 owner co-sign 访问，或与 Sentry 需求不兼容：退回到独立实现 shared RescuePolicy Object；Phase C 估时回到 14h。
- Deepbook Testnet pool is unavailable：stop before Phase C; either find another documented Testnet-compatible Deepbook route, or downgrade the demo to simulated execution and mark Sub-track 2 as blocked in PRD/test spec.
- MoveGate AuthToken + Deepbook + SentryPolicyWrapper + ActionReceipt 无法在同一 PTB 中组合：pause and redesign the Policy execution path.
- Any adapter requires signing or submitting before Guardian approves an `ExecutionPlan`：stop and redesign the adapter interface.
- zkLogin setup blocks demo：allow temporary wallet connect only if PRD marks zkLogin as delayed and demo still proves Policy autonomy.
- Any implementation needs Mainnet funds：stop; MVP scope is Testnet.
