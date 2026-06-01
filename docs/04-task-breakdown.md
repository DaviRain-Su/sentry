# RescueGrid Task Breakdown v1.0

状态：Draft
日期：2026-06-01

任务类型：

- `Commit`：进入主线的生产或项目文档工作，必须保持规格一致。
- `Explore`：验证外部依赖或不确定实现，不能直接当作可发布代码；探索结论进入规格后再转 Commit。

## Phase A - Docs Foundation

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| A1 | Commit | 1h | 固化 PRD | `docs/01-prd.md` 明确 MVP、non-goals、演示闭环 |
| A2 | Commit | 1h | 固化架构 | `docs/02-architecture.md` 明确 Dashboard、Worker、Durable Object、Move、Deepbook 边界 |
| A3 | Commit | 2h | 固化技术规格 | `docs/03-technical-spec.md` 明确 Move surface、API、状态机、Guardian |
| A4 | Commit | 1h | 固化任务拆解 | `docs/04-task-breakdown.md` 把后续实现切成 ≤4h 任务 |
| A5 | Commit | 1h | 固化测试规格 | `docs/05-test-spec.md` 明确每个核心行为的测试和 demo 验收 |

## Phase B - External Feasibility Checks

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| B1 | Explore | 2h | 核验 Sui Testnet Deepbook 可用 pool | 记录 pool id、资产、精度、测试资金获取方式 |
| B2 | Explore | 3h | 最小 Deepbook Testnet 下单脚本 | 能完成一笔测试交易或明确 Testnet 阻塞项 |
| B3 | Explore | 2h | 核验 zkLogin 最新接入流程 | 记录 dashboard 登录最小链路和 SDK 版本 |
| B4 | Explore | 2h | 核验 Cloudflare Durable Object alarm/runtime 限制 | 记录 tick 周期、持久状态、部署配置 |
| B5 | Explore | 2h | 验证共享 Move Policy + Deepbook PTB 可组合性 | 最小脚本能构建一笔包含 shared policy mutation 和 Deepbook call 的 PTB |
| B6 | Explore | 1h | pi-worker 快速浏览 | 判断是否值得深度验证 |
| B7 | Explore | 2h | pi-worker 深度验证 | 仅当 B6 结论为可复用时运行示例或测试，决定直接复用、参考实现或不引入 |

## Phase C - Move Package

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| C1 | Commit | 2h | 初始化 Sui Move package | `sui move build` 通过 |
| C2 | Commit | 3h | 实现 shared `RescuePolicy` object 和 events | 字段、share object 行为和事件与技术规格一致 |
| C3 | Commit | 3h | 实现 `create_policy` 和 `revoke_policy` | 单元测试覆盖 happy path 和错误 path |
| C4 | Commit | 3h | 实现 `assert_agent_authorized` | 测试覆盖 agent、pool、budget、slippage、expiry、revoked |
| C5 | Commit | 3h | 实现 `record_agent_trade` 和 `record_guardian_block` | 测试覆盖预算更新和 block event |
| C6 | Commit | 1h | Move 单元测试全量通过 | `sui move test` 通过，失败测试覆盖关键 abort |
| C7 | Commit | 2h | Testnet publish script | 可以部署并输出 package id |

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
| E2 | Commit | 3h | 实现 `/api/intents/parse` | 支持 rescue_grid 模板和错误响应 |
| E3 | Commit | 3h | 实现 `/api/policies` | 能提交 create policy 或生成签名请求 |
| E4 | Commit | 2h | 实现 `/api/policies/:id/activity` | 能聚合 chain event 和 runtime state |
| E5 | Commit | 3h | 实现 Durable Object policy runtime | 每个 policy 独立状态，支持 alarm tick |
| E6 | Commit | 3h | 实现 Guardian checks | 按技术规格顺序执行并返回 blocked reason |
| E7 | Commit | 3h | 实现 `/api/agent/tick` | 支持 no-op、blocked、executed、stopped 状态 |
| E8 | Commit | 2h | 状态同步与恢复 | activity API 以链上状态为准，runtime stale 时自动纠正 |

## Phase F - Deepbook Execution

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| F1 | Commit | 3h | 固化 Deepbook adapter | 基于 Phase B 结论实现选定 pool 的下单封装 |
| F2 | Commit | 3h | 集成 Deepbook SDK/Transaction Builder | Worker 能构建交易 payload |
| F3 | Commit | 3h | 把 Policy 校验和 Deepbook call 放入同一执行链路 | 成功交易会产生 `AgentTradeExecuted` |
| F4 | Commit | 2h | 失败恢复和幂等处理 | 重试不会重复扣预算或重复展示成功 |

## Phase G - Demo Hardening

| ID | Type | Estimate | Task | Acceptance |
| --- | --- | --- | --- | --- |
| G1 | Commit | 2h | Demo seed/config | 一条命令输出所需 env、package id、agent address |
| G2 | Commit | 2h | Demo script | 覆盖 create -> monitor -> execute -> revoke |
| G3 | Commit | 2h | README quickstart | 新用户能按步骤跑起演示 |
| G4 | Commit | 3h | Final docs + QA pass | PRD/架构/规格与实际实现保持一致，并用浏览器和链上查询验证完整闭环 |

## Dependency Order

1. Phase A must be complete before implementation.
2. Phase B must complete before committing Deepbook or zkLogin production code.
3. Move Package should land before Worker execution code.
4. Worker parse/preview can start before Move publish, but must use the technical spec types.
5. Dashboard can mock API until Worker endpoints exist.
6. Demo Hardening starts only after one Testnet transaction is confirmed.

## Stop Conditions

- Deepbook Testnet pool is unavailable：stop before Phase C; either find another documented Testnet-compatible Deepbook route, or downgrade the demo to simulated execution and mark Sub-track 2 as blocked in PRD/test spec.
- Move package cannot enforce the required check in the same PTB：pause and redesign the Policy execution path.
- zkLogin setup blocks demo：allow temporary wallet connect only if PRD marks zkLogin as delayed and demo still proves Policy autonomy.
- Any implementation needs Mainnet funds：stop; MVP scope is Testnet.
