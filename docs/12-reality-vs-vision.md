# 代码现实 vs 文档愿景 — 对照表 v0.1

状态：Reference
日期：2026-06-03
范围：盘点「文档声称的 Agent 调度平台」与「仓库里真正能跑的代码」之间的差距
目的：给评委 / 协作者 / 未来的自己一张诚实的地图，避免按文档去测一个还没建出来的东西

> 一句话：**文档已经全面转向「Agent 调度平台」，但代码主体仍是上一版「云端自执行 Agent」。
> 仓库里现在并存两套执行模型——而唯一真正能执行交易的，是文档说「我们不做」的那一套。**

---

## 0. 背景

`63dd8a7`（2026-06-03）把项目从「Cloud-first 自执行 Agent」转向「本地 daemon 调度外部 Agent」。
转向当天重写了 `01-prd.md` / `02-architecture.md`，新增 `10`/`11` 两篇规划。
但实现只落地了 daemon + bridge 的骨架，导致**文档愿景跑在代码现实前面一大截**。
`STATUS.md` 的 ledger 已诚实标注了 🟡/🔴，本文档补充它**没有显式点破的矛盾**。

---

## 1. 头号矛盾：两套执行模型并存

| | 旧模型（文档说「不做」） | 新模型（文档说「这是生产方向」） |
|---|---|---|
| 谁执行 | Cloudflare Worker DO 自己持 `AGENT_KEY`，建 PTB、签名、上链 | 本地 daemon 调度外部 Agent，外部 Agent 用本机钱包执行 |
| 代码状态 | ✅ **完整存在，是唯一能执行的路径** | 🔴 **dispatch 协议一行未实现** |
| 证据 | `worker/src/tick.js:405`（`executionEnabled = EXECUTION_ENABLED==='true' && AGENT_KEY`）→ `:437-450`（`buildExecutionTx` + `signAndExecuteTransaction`） | 见 §2 多行「散文 only」 |

**后果**：`docs/02-architecture.md:18` 写「守护程序不碰私钥」「Worker 不代理执行」，
但 Worker 至今保留着一条会用自己持有的密钥上链的执行腿。声明的生产路径执行不了任何东西，
被标「legacy demo」的路径反而是唯一能执行的。`STATUS.md` Known-gap #0 已承认这块清理未做。

---

## 2. 能力对照表

状态图例：🟢 文档与代码一致 · 🟡 文档超前于代码（gap）· 🔴 文档与代码/文档相互矛盾（contradiction）

| 能力 | 文档声称 | 代码现实 | 证据 | 状态 |
|---|---|---|---|---|
| Sui Move 链上约束 | MoveGate Mandate + SentryPolicyWrapper | 已部署，`sui move test` 8/8 | `STATUS.md:25` · `move/sentry/` | 🟢 |
| create/revoke 闭环 | owner 创建/撤销 policy | **链上真实验证过** | `STATUS.md:54-59` | 🟢 |
| Worker 只读 API | policies / activity 聚合 | 全端点可用 | `STATUS.md:26` | 🟢 |
| Web Dashboard | 登录→策略→预览→撤销 | `npm run build` 通过 | `STATUS.md:24` | 🟢 |
| Sui budget enforcement | 文档容易读成「真实资金不可超额」 | 当前是链上授权 + 链上金额记账,不是资金托管 | `move/sentry/sources/policy.move:56-67,275-331` | 🟡 |
| Worker 自执行 Deepbook | （新文档说**不该有**） | 仍在，且 `EXECUTION_ENABLED=false` 门控 | `worker/src/tick.js:405-450` · `worker/src/deepbook.js` | 🔴 |
| Worker bridge pairing/WS | pairing→pair→connect(WS)→commands | 端点真实存在，可中继;command allowlist 已包含 `agent.registry`、`agent.probe`、`agent.dispatch`、catalog/auth/secret/inventory、`signer.probe`、`activity.tail` | `worker/src/index.ts` · `worker/src/local-agent-commands.ts` | 🟡 |
| daemon 连接/心跳 | outbound WS + heartbeat | 已实现 | `agent/src/index.mjs:244-278` | 🟢 |
| daemon 启停子进程 | 调度外部 Agent | `agent.start/stop` 仍是进程生命周期;新增 `agent.dispatch` 一次性 stdio task round trip | `agent/src/index.mjs` · `agent/src/agent-dispatcher.mjs` | 🟡 |
| **AgentTask 调度协议** | §5a 完整 task→result→链上核验 | 已有最小 AgentTask/AgentTaskResult 校验 + subprocess round trip;OKX/Hyperliquid/Solana/Ethereum 都已有 mock-tested receipt verification skeleton;Solana/Ethereum 也有 env-account task-local dispatch-ready gate;但交易构建、仿真、签名 handoff 和真实账户 dry-run 仍未完成 | `core/agent-task.js` · `agent/src/agent-dispatcher.mjs` · `agent/src/dispatch-receipt-verifier.mjs` · `agent/src/local-dispatch-readiness.mjs` · `agent/test/agent-dispatcher-test.mjs` | 🟡 |
| OKX trade/status task | 第一条 CEX 下单任务骨架 | 已有 `place_order` AgentTask builder、local permission/IP allowlist proof gate、local daemon dispatch-ready override、no-withdraw scope 校验、`clOrdId` idempotency、OKX order response/status normalization、daemon dispatch receipt verifier;Worker 全局 registry 仍非 dispatch-ready | `core/okx-trade.js` · `core/local-secrets.js` · `agent/src/local-dispatch-readiness.mjs` · `agent/src/dispatch-receipt-verifier.mjs` | 🟡 |
| Hyperliquid trade/status task | 第一条 perps 下单 + 状态核验骨架 | 已有 `place_order` AgentTask builder、local metadata/read-address proof gate、local agent-wallet grant metadata gate、public `userRole` live grant checker、local daemon dispatch-ready override、no-withdraw/no-transfer scope、128-bit `cloid` idempotency、pre-signed `/exchange` submit adapter、默认本地 `authorization_ref + nonce` store、resting/filled response normalization、dispatcher result verifier、public `orderStatus` adapter 和 daemon receipt verifier;尚无真实账户 dry-run、live submit 测试和生产 UI wiring | `core/hyperliquid-trade.js` · `core/local-secrets.js` · `agent/src/local-dispatch-readiness.mjs` · `agent/src/hyperliquid-agent-wallet-adapter.mjs` · `agent/src/hyperliquid-exchange-submit-adapter.mjs` · `agent/src/hyperliquid-nonce-store.mjs` · `agent/src/hyperliquid-order-status-adapter.mjs` · `agent/src/dispatch-receipt-verifier.mjs` | 🟡 |
| Solana swap task | 第一条链上 swap 任务骨架 | 已有 `submit_tx` AgentTask builder、`read/sign/submit_tx` scope、quote id idempotency、Solana signature evidence、dispatcher verifier、env wallet 匹配 local dispatch-ready gate、非签名 signer/address probe 和 `getSignatureStatuses` receipt polling skeleton;尚无交易构建/仿真、OWS account discovery、真实 signature probing、签名 handoff 和真实账户 dry-run | `core/solana-trade.js` · `agent/src/agent-dispatcher.mjs` · `agent/src/local-dispatch-readiness.mjs` · `agent/src/local-signer-probe.mjs` · `agent/src/solana-receipt-adapter.mjs` | 🟡 |
| Ethereum swap task | 第一条 EVM swap 任务骨架 | 已有 `submit_tx` AgentTask builder、`read/sign/submit_tx` scope、quote id idempotency、EVM `tx_hash` evidence、dispatcher verifier、env wallet 匹配 local dispatch-ready gate、非签名 signer/address probe 和 `eth_getTransactionReceipt` receipt polling skeleton;尚无 Safe/session-key grant、account discovery、真实 signature probing、calldata 构建/仿真、签名 handoff 和真实账户 dry-run | `core/ethereum-trade.js` · `agent/src/agent-dispatcher.mjs` · `agent/src/local-dispatch-readiness.mjs` · `agent/src/local-signer-probe.mjs` · `agent/src/ethereum-receipt-adapter.mjs` | 🟡 |
| daemon「大脑」 | PolicyManager / TickLoop / Guardian / AgentRegistry / AgentDispatcher / InventoryStore / ActivityWriter / LoopbackAPI | AgentRegistry、Agent command/version probe、Inventory metadata、AgentDispatcher skeleton、本地脱敏 activity JSONL writer、本地 policy store、due-tick 选择器、显式 task-template -> planned AgentTask、一次性 guard/readiness/dispatch runner 和 daemon policy loop controller 已有;生产级 Guardian/inventory loop 和 LoopbackAPI 仍缺 | `agent/src/local-agent-registry.mjs` · `agent/src/local-agent-capability-probe.mjs` · `agent/src/local-policy-store.mjs` · `agent/src/local-policy-task-planner.mjs` · `agent/src/local-policy-runner.mjs` · `agent/src/local-policy-loop.mjs` · `agent/src/live-inventory-sync.mjs` · `agent/src/agent-dispatcher.mjs` · `agent/src/local-activity-log.mjs` | 🟡 |
| `sentry` CLI 命令面 | `init`/`pair`/`run`/`register`/`wallet link`/`venue`/`policy`/`emergency-stop` | daemon 已有 pairing/relay flags、`venue add/list/remove`、OKX `venue credentials status/store`;但还没有完整 `sentry agent init/run/register/wallet/policy` 命令族 | `agent/src/index.mjs` | 🟡 |
| OWS 集成 | 外部 Agent 用 OWS vault 签名 | 未接入 | `STATUS.md:35`（🔴 planned） | 🟡 |
| 签名信封 (Ed25519) | `docs/11` 承诺 signed hello / signed envelope | envelope **无 signature 字段**；鉴权是查询串里的 sha256 bearer token | `agent/src/index.mjs:71-79` · `worker/src/daemon-auth.ts:13-52` | 🔴 |
| Agent 结果链上核验 | daemon 校验 tx_digest / 预算 | 结果类型和 evidence presence 校验已有;OKX/Hyperliquid venue status verification、Solana `getSignatureStatuses` 和 Ethereum `eth_getTransactionReceipt` 已接到 daemon dispatch;真实链账户 dry-run、预算 proof 和 Sui tx_digest 深度核验仍未做 | `core/agent-task.js` · `agent/src/dispatch-receipt-verifier.mjs` | 🟡 |
| 多链 policy (Solana/EVM) | Sigil / ERC-8004 | 未开始 | `docs/02-architecture.md:317-322` | 🟡 |
| CEX / perps key store | venue secret store + scope 校验 | metadata store + OKX macOS Keychain status/store/read resolver 已有;OKX 下单 task scope/evidence/status/receipt verifier 已有;Hyperliquid 有 metadata/read address、agent-wallet grant metadata gate、public `userRole` live grant checker + public orderStatus receipt verifier,但轮换 UX、真实账户 dry-run 和生产 UI wiring 未做 | `STATUS.md`（Exchange API key store） | 🟡 |

---

## 3. 文档内部也不自洽

转向只改了一半，`01-prd.md` 自己就前后打架：

- §1 概述（`01-prd.md:13`）：「**守护程序不自行执行交易**……调度外部 Agent 去执行」。← 新模型
- §4 MVP 成功标准（`01-prd.md:63-65`）：「**Cloud Agent** 在无需 owner 每次签名的情况下监控价格……Agent 在 Mandate + Wrapper 限制内**执行至少一笔 Deepbook 交易**」。← 旧模型
- §6 用户流程（`01-prd.md:147`）：「系统创建 Mandate + Wrapper 并**绑定 Cloud Agent address**」。← 旧模型

也就是说：同一篇 PRD，开头讲新方案，验收标准和用户流程还停在旧方案。

---

## 4. 安全声明 vs 实现

三点需要在对外材料里如实降级，别声明还没有的东西：

1. **「签名信封」是 aspirational**。`docs/11` 描述 Ed25519 signed hello + per-message signature，
   实际 `makeEnvelope`（`agent/src/index.mjs:71`）没有 `signature` 字段，
   daemon 鉴权 = 查询串里一个 sha256 bearer token（`worker/src/daemon-auth.ts`）。query-string token 还更容易进日志。
2. **安全模型相对原方案是退步**。Sui-only 时越权由**链上 Mandate 强制**；
   新方案一旦外部 Agent（通用编码 Agent）拿到钱包 + task，真正拦住超额/超滑点的只有
   (a) Agent「乖」、(b) 该链**恰好接了** Mandate 等价物。对没接链上 policy 的链，
   Guardian 只是**链下预检**，最终防线约等于「好声好气嘱咐 LLM 一句」。文档对这点轻描淡写。
3. **Sui 当前不是 custody budget**。`SentryPolicyWrapper` 不持有 `Balance` / `Coin`,只持有
   `budget_ceiling` 和 `spent_amount` 数字。`record_agent_trade` 接收 `quote_amount_spent`
   / `base_amount_received` 入参,检查后累加记账并创建 receipt,但不转移任何资金。
   MoveGate 的 `authorize_action` 会按传入 amount 做 spend cap / daily limit 检查,所以它不是纯链下 honor-system;
   但该 amount 没有和真实 DeepBook 扣款、fill 或 BalanceManager 资金流做链上绑定。对外只能说
   **可授权、可撤销、可审计、对授权记录金额有限额**,不能说**资金被托管或真实支出不可能超额**。

---

## 5. 托管 vs 记账：要不要 Vault

当前 Sui Move 层的实际模型是 **chain-authorized accounting**:

- `SentryPolicyWrapper` 字段全是 policy metadata 和数字,没有 `Balance<BudgetCoin>` / `Coin<BudgetCoin>`。
- `record_agent_trade` 对 `quote_amount_spent` 做 wrapper budget 检查,并把 AuthToken 交给 MoveGate 创建 ActionReceipt。
- 真正可用于下单的资金在 agent 钱包 / DeepBook BalanceManager 中;当前 wrapper 不控制这部分资金。

这带来一个产品决策分叉:

| 自主姿态 | 当前模型是否够用 | 需要 Vault/custody 吗 |
| --- | --- | --- |
| Demo / hackathon / confirm-each | 基本够用 | 不需要,但必须诚实标注为授权+记账+审计 |
| 无人值守 + 小额测试网 | 勉强可用 | 可以先用专用 agent 账户/BalanceManager 限额注资 |
| 无人值守 + 真实资金 | 不够 | 需要 custody、smart account guard、原生 delegation 或 venue subaccount 来限制真实资金流 |

如果以后要做 Sui 真实资金无人值守,不要另起一个通用多链 Vault。最小路线应是一个 Sui custody wrapper v2:

1. 让 policy/custody 对象持有或控制预算资金,或控制 DeepBook BalanceManager 中的可用资金。
2. 下单路径必须把真实扣款/fill 与 `record_agent_trade` 绑定,不能继续只信 `quote_amount_spent` 入参。
3. 增加 owner-only withdraw / revoke / emergency withdraw。
4. 保留 MoveGate AuthToken / ActionReceipt,但 receipt 只能在真实资金流完成或可验证失败后创建。

当前优先级仍然不是马上写 Vault。真正挡住产品闭环的是 Agent dispatch 没有真实 task/result round trip,以及新旧执行模型并存。Vault/custody 应该作为"无人值守动真钱"前的 gating milestone,不是当前 skeleton 阶段的 P0。

---

## 6. 今天真能跑的 vs 只存在于散文里的

**今天真能 demo（且部分链上验证过）：**
- Sui Move package（部署 + 8/8 测试）
- create / list / activity / revoke 闭环（testnet 链上验证，`STATUS.md:54`）
- Worker 只读 API + 活动聚合
- Dashboard 构建与交互
- Worker bridge 的 pairing + WS 中继管道
- daemon 连上 bridge、心跳、起一个子进程、转发它的 stdout
- daemon 记录脱敏 `agent.dispatch.blocked` / `agent.dispatch` activity JSONL,并可通过 `activity.tail` 读取最近事件
- daemon 保存本地 policy metadata,支持 pause/resume/revoke,并能计算 due ticks

**仍主要存在于文档散文里（代码未完成）：**
- daemon 侧生产级 Guardian/inventory TickLoop / deep task-level Agent capability discovery / LoopbackAPI
- `sentry` CLI 全部子命令（init/pair/run/register/wallet/venue/policy/emergency-stop）
- OWS 签名集成
- Ed25519 signed envelope
- 外部 Agent 结果的链上核验
- 多链（Solana/EVM）链上约束、CEX/perps key store

---

## 7. 收口建议（详见对话评审，这里只列动作）

1. **二选一并让文档对齐**：要么承认 Worker 自执行是 Sui demo 的执行腿、把 dispatch 标「next」；
   要么打通**最小真实 dispatch** 一条链路（daemon 建 `AgentTask` → spawn agent → 收 `AgentTaskResult{tx_digest}` → daemon 链上核验）。
2. **消除两套执行模型并存**：隔离或显式标注 Worker 自执行路径为 legacy。
3. **修 PRD 内部矛盾**：§4/§6 改成与 §1 一致的 daemon-dispatch 叙事，或显式标「demo path 仍走 Cloud Agent」。
4. **安全声明降级到现实**：实现 Ed25519 signed envelope，或把 `docs/11` 改成 bearer-token 的真实说法。
5. **把 Sui budget 文案降级**：当前只能叫 chain-authorized accounting,不能叫 custody budget 或不可超额资金约束。
6. **在 daemon 能完成一次真实 round-trip 调度之前，冻结文档扩张。**

---

## 附：本表如何复核

- `worker/src/tick.js:405-450` — Worker 仍自执行
- `agent/src/index.mjs` / `agent/src/agent-dispatcher.mjs` / `agent/src/local-agent-capability-probe.mjs` / `agent/src/local-policy-store.mjs` / `agent/src/local-policy-task-planner.mjs` / `agent/src/local-policy-runner.mjs` / `agent/src/local-policy-loop.mjs` / `agent/src/local-activity-log.mjs` — daemon 能力面（status/start/stop/dispatch/probe + inventory/secret/auth + policy store/tick/plan/run-once/loop + sanitized activity tail）
- `worker/src/daemon-auth.ts` — bearer token 鉴权（非签名信封）
- `rg "AgentTask|agent.dispatch|agent-dispatcher|local-dispatch-readiness|dispatch-receipt-verifier" agent/ worker/ core/` — 验证最小 dispatch 协议、OKX/Hyperliquid local ready gate、Solana/Ethereum env-account local ready gate、RPC receipt polling 和 venue receipt verification 已落地,但真实账户 dry-run、交易构建/签名 handoff 和预算 proof 仍缺
- `STATUS.md` — 官方 ledger（🟡 skeleton / 🔴 planned 标注）
