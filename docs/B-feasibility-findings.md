# Phase B — Feasibility Findings

状态：Done
日期：2026-06-01
环境：Sui Testnet
执行人：实测 against live testnet（非纸面推断）

工具链（实测版本）：

- `sui` CLI `1.68.1`
- `@mysten/sui` `2.17.0`
- `@mysten/deepbook-v3` `1.4.1`
- Testnet fullnode RPC：`https://fullnode.testnet.sui.io:443`（HTTP 200）
- DeepBook indexer：`https://deepbook-indexer.testnet.mystenlabs.com`

测试地址（dev agent 占位）：`0xb908f724ae9fd9f3859df7b42d1192649217bc4a677c99b58ec838db2ff6ec41` · gas 余额 0.33 SUI。

---

## 总结论：GO（继续复用 MoveGate，不触发独立 RescuePolicy 回退）

| Task | 结论 | 备注 |
| --- | --- | --- |
| B0 MoveGate 适配 + Mandate 访问模型 | ✅ PASS | Mandate 可共享给 agent，无需 owner co-sign |
| B1 Deepbook testnet pool | ✅ PASS | 三种策略对应 pool 均为 live shared object |
| B2 最小下单路径 | ✅ 路径确认，无架构阻塞 | 需 BalanceManager；DBUSDC faucet 待 F1 确认 |
| B5 同一 PTB 可组合性 | ✅ 结构性确认 | 完整编译验证随 Phase C（C5）落地 |

`docs/04-task-breakdown.md` 的 Stop Conditions **均未触发**。

---

## B0 — MoveGate 合约稳定性 + Mandate 访问模型

MoveGate package（来自 `docs/03-technical-spec.md`）：

- Package ID：`0xec91e604714e263ad43723d43470f236607bd0b13f64731aad36b00a61cf884a`
- 模块（实测）：`errors`、`events`、`mandate`、`passport`、`receipt`、`treasury`

验证方法：`sui_getObject`（确认 package）、`sui_getNormalizedMoveModulesByPackage`（核 ABI）、`sui_getObject` 读共享对象。

| 验收项 | 结果 |
| --- | --- |
| Package + 6 模块在链上 | ✅ |
| **Mandate 可被 agent 在无 owner co-sign 的 PTB 中访问** | ✅ `Mandate` abilities = `[Store, Key]`；`create_mandate` 按值返回 Mandate，owner 创建 PTB 内即可 `transfer::public_share_object` 共享 |
| AuthToken hot-potato | ✅ `AuthToken` abilities = `[]`（编译器强制同一 PTB 消费） |
| `authorize_action<BudgetCoin>` → AuthToken | ✅ Public，1 个 type param，返回 `AuthToken` |
| `create_mandate` ABI（16 参数） | ✅ 与技术规格逐项一致 |
| Mandate 公共 accessor | ✅ `mandate_owner / mandate_agent / mandate_expires_at_ms / mandate_revoked / mandate_spent_this_epoch / mandate_total_actions` 全部存在 |
| `treasury::creation_fee` 可读 + live 读取 | ✅ live `FeeConfig` = `10_000_000` MIST（0.01 SUI），与 spec 默认一致；`update_creation_fee` 存在 → 必须 live 读取 |
| `receipt::create_success_receipt` | ✅ 存在（另有 `create_failure_receipt`，供 F4 失败处理） |
| 共享基础设施对象 | ✅ MandateRegistry / AgentRegistry / ProtocolTreasury / FeeConfig 均为 `Shared` |

`create_mandate` 实测参数顺序（16）：
`&mut MandateRegistry, &mut AgentRegistry, &mut AgentPassport, &mut ProtocolTreasury, &FeeConfig, address(agent), u64(spend_cap), u64(daily_limit), vector<address>(allowed_protocols), vector<0x1::type_name::TypeName>(allowed_coin_types), vector<u8>(allowed_actions), u64(expires_at_ms), Option<u64>(min_agent_score), &mut Coin<SUI>(payment), &Clock, &mut TxContext` → 返回 `Mandate`。

MoveGate 基础设施对象（实测均 `Shared`，`initial_shared_version` 349181443）：

| Object | ID |
| --- | --- |
| MandateRegistry | `0x26a66d91fef324b833d07d134e5ab6e796e0dfd77f670c27da099479d939b0d3` |
| AgentRegistry | `0xb2fadc7ccf9c7b578ba3b1adb8ebfd73191563e536b6b2cc18aa14dac6c7ba46` |
| ProtocolTreasury | `0xf0714bd816e595cacfc9e5921d1754cca0205f6b65867eab6183d0b0a98fc82c` |
| FeeConfig | `0x5c92c420f4b3801eb4126fcab6cb4b98212b31f591b4b3d0a025b4e4957120f3` |

**B0 决策**：MoveGate 可用，继续 Phase C 的 MoveGate 集成路线。

**B0 注意事项（进 Phase C）**：`allowed_coin_types` 是 `vector<0x1::type_name::TypeName>`。`create_mandate` 本身非泛型（0 type param），所以 TypeName 需作为值传入。建议采用技术规格的 **thin Move helper 路线**（在 Move 内用 `type_name::with_original_ids<BudgetCoin>()` 构造该 vector），比在裸 PTB 里拼 TypeName 更稳健。

---

## B1 — Deepbook V3 Testnet Pool

DeepBook V3 testnet package：`0xfb28c4cbc6865bd1c897d26aecbe1f8792d1509a20ffec692c800660cbec6982`
对象类型：`...::pool::Pool<Base, Quote>`，均为 `Shared`。

测试网 USDC = **DBUSDC**：`0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC`（设计稿里的 "USDC" 在 testnet 用 DBUSDC 代替）。

策略 → pool 映射（live shared object 实测确认）：

| 策略 | 设计 pair | Testnet pool | Pool ID | base/quote 精度 |
| --- | --- | --- | --- | --- |
| Rescue Grid | SUI/USDC | `SUI_DBUSDC` | `0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5` | 9 / 6 |
| DCA | DEEP/USDC | `DEEP_DBUSDC` | `0xe86b991f8632217505fd859445f9803967ac84a9d4a1219065bf191fcb74b622` | 6 / 6 |
| Hedge | WAL/USDC | `WAL_DBUSDC` | `0xeb524b6aea0ec4b494878582e0b78924208339d360b62aec4a8ecd4031520dbb` | 9 / 6 |

其余 testnet pool：`DEEP_SUI`、`SUI_DBUSDC`、`DBUSDT_DBUSDC`、`DBTC_DBUSDC`、`WAL_SUI`（共 7 个）。

**MVP 选定主 pool**：`SUI_DBUSDC`（对应闪崩救援 demo）。`budget_coin_type` 在 testnet 为 DBUSDC。

---

## B2 — 最小 Deepbook 下单路径

- **交易构建器**：`@mysten/deepbook-v3@1.4.1`（`DeepBookClient`）封装 pool 调用、BalanceManager、下单；配合 `@mysten/sui@2.17.0` 的 `Transaction`。
- **下单前置（关键）**：DeepBook v3 交易需要每个 trader 一个 **BalanceManager** 对象（`balance_manager::new`），先 deposit base/quote，下单时用 BalanceManager 生成的 `TradeProof` 调 `pool::place_limit_order`。Agent 钱包需要：BalanceManager + 已存入的 DBUSDC（+ gas SUI）。
- **测试资金**：testnet SUI 走 `sui client faucet`（当前 0.33 SUI）。DBUSDC 测试币的领取方式（DeepBook testnet faucet / DBUSDC mint）→ **唯一待确认项，留给 F1**，不阻塞架构。
- **结论**：路径清晰、SDK 与 pool 均就绪；本阶段不实际成交一笔（会提前进入 F 实现），按 B2 验收"明确 testnet 阻塞项"处理 —— 唯一阻塞项是 DBUSDC faucet，F1 解决。

---

## B5 — AuthToken + Deepbook + Wrapper + ActionReceipt 同一 PTB 可组合性

仅在 B0=可用 时执行；B0 已 PASS。

ABI 层结构性结论（实测）：

1. `authorize_action<BudgetCoin>(...)` 返回 `AuthToken`（abilities `[]`）。
2. DeepBook `pool::place_limit_order` 作为 PTB 中段普通 call。
3. `record_agent_trade(...)` 以值接收 `AuthToken`，转交 `receipt::create_success_receipt` 消费并 freeze ActionReceipt。
4. `AuthToken` 零 ability → Move 编译器强制其在获得它的 PTB 内被消费（结构性保证，非运行时检查）。

→ 命令顺序（auth 在前、deepbook 居中、record 收尾消费 token）与单 PTB 兼容，无需重排。

**未尽事项**：完整 compile-proof 需要 Sentry wrapper 本身存在（依赖 Phase C 的 `record_agent_trade` / `create_policy_wrapper`）。因此 B5 的"最小脚本编译验证"实质并入 **C5**（AuthToken 单次消费 + ActionReceipt 创建测试）。

---

## 对后续阶段的影响（进 spec 的探索结论）

1. **Phase C**：采用 thin Move helper 构造 `allowed_coin_types: vector<TypeName>`；wrapper 创建 PTB 末尾 `public_share_object` 共享 Mandate 与 wrapper。
2. **常量固化**：把 MoveGate package/registry/treasury/feeconfig id、DeepBook package、`SUI_DBUSDC` pool id、DBUSDC coin type 写入部署配置常量（对应 `docs/03-technical-spec.md §1` 的 `SENTRY_*` 与新增 MoveGate/DeepBook 地址）。
3. **creation fee**：提交创建交易前 live 读取 `FeeConfig.creation_fee`（当前 0.01 SUI），不硬编码。
4. **F1**：先解决 DBUSDC testnet faucet + agent BalanceManager 初始化。
5. **回退方案**：未触发；独立 RescuePolicy 路线封存。
