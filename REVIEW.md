# Sentry 全面代码审查报告

**审查日期**: 2026-06-02  
**审查范围**: Worker (Cloudflare Workers + Hono + Durable Objects) / 前端 (Vite+React) / Move 合约 / 共享逻辑  
**审查者**: Reviewer Agent  
**基线提交**: dfe2def  

---

## 执行摘要

Sentry 项目整体架构清晰，Worker/前端/合约的分层合理，MoveGate 集成正确，安全模式（Worker 不持有 owner 密钥、zkLogin 签名、Guardian 多层检查）设计良好。但存在 **1 个 P0 严重缺陷**（Durable Object 可能因异常永久停止）、**多个 P1 安全隐患和可靠性问题**，以及代码重复、测试缺失等结构性债务。

---

## 🔴 严重问题 (P0)

### P0-1: AgentRuntime.alarm() 未捕获异常 → DO 永久停止运行
**文件**: `worker/src/index.ts`  
**行号**: `AgentRuntime.alarm()` (~第 290-298 行)

```typescript
async alarm(): Promise<void> {
  const result = await this.tickOnce()        // ← 若抛出异常，下方代码永不执行
  const terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired'
  if (!terminal) {
    await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
  }
}
```

**影响**: 若 `tickOnce()` 内部发生任何未捕获异常（如 RPC 超时、`JSON.parse` 失败、`undefined` 属性访问），`setAlarm` 不会被调用，该策略的 Durable Object 将**永久停止 tick**，Agent 不再监控价格，用户策略形同虚设。Cloudflare DO 的 alarm 不会自动重试。

**修复建议**:
```typescript
async alarm(): Promise<void> {
  let terminal = false
  try {
    const result = await this.tickOnce()
    terminal = result.action === 'stopped_revoked' || result.action === 'stopped_expired'
  } catch (e) {
    const errCount = ((await this.state.storage.get<number>('errorCount')) ?? 0) + 1
    await this.state.storage.put('errorCount', errCount)
    await this.state.storage.put('lastAction', 'error')
    await this.state.storage.put('lastError', String(e?.message || e))
    // 非终端错误，继续重试；连续多次错误后可考虑指数退避
  }
  if (!terminal) {
    await this.state.storage.setAlarm(Date.now() + DEFAULT_TICK_INTERVAL_SECONDS * 1000)
  }
}
```

---

## 🟠 高危问题 (P1)

### P1-1: runTick 将 executionEnabled 硬编码为 true，绕过执行开关检查
**文件**: `worker/src/tick.js`  
**行号**: ~第 246 行

```javascript
const executionEnabled = env?.EXECUTION_ENABLED === 'true' && !!env?.AGENT_KEY
// ...
const decision = decideTick({
  wrapper, mandate, triggerMet, proposed, nowMs,
  executionEnabled: true,  // ← BUG: 应该是 executionEnabled（变量）
  expectedAgentId: DEPLOYMENT.agent.address, expectedPoolId
})
```

**影响**: `decideTick` 内部的 `EXECUTION_DISABLED` 提前拦截被绕过。虽然后续 `checkFunding()` 仍会因为 `executionEnabled` 为 false 而添加 blocker，但存在两条代码路径维护同一逻辑的风险，且若 `checkFunding` 被意外修改或 RPC 失败，可能导致交易在非预期条件下提交。

**修复建议**: 将 `executionEnabled: true` 改为 `executionEnabled`（变量）。

---

### P1-2: 前端 deployLive 静默忽略 activatePolicy 失败
**文件**: `src/App.jsx`  
**行号**: ~第 390 行

```javascript
if (wrapperId) await activatePolicy(wrapperId).catch(() => {})
```

**影响**: 策略已成功上链，但 Durable Object 运行时未激活（可能因 Worker 故障或网络问题）。用户看到 "Policy created" 提示，但 Agent 实际上不会监控和执行。错误被完全吞掉，用户和开发者都无从得知。

**修复建议**:
```javascript
if (wrapperId) {
  try {
    await activatePolicy(wrapperId)
  } catch (e) {
    showToast(`Policy on-chain but runtime activation failed: ${String(e?.message || e).slice(0, 80)}`, 'var(--warn)')
    pushNotif('guardian', 'Policy created but agent runtime not activated')
  }
}
```

---

### P1-3: hexToBytes 未验证输入 → 无效 hex 被静默截断
**文件**: `worker/src/sui-tx.js`  
**行号**: ~第 23-28 行

```javascript
function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '')
  const a = new Uint8Array(h.length / 2)   // ← 奇数长度时最后一位被丢弃
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}
```

**影响**: 若 `strategy_hash` 传入奇数长度或包含非十六进制字符，`parseInt` 返回 `NaN`，数组元素变为 0 或错误值。策略 hash 上链后可能无法与前端重新计算的 hash 匹配，导致验证失败。

**修复建议**:
```javascript
function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('Invalid hex string')
  if (h.length % 2 !== 0) throw new Error('Hex string must have even length')
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}
```

---

### P1-4: 全局 parseCache 无界增长 → 内存泄漏
**文件**: `worker/src/index.ts`  
**行号**: ~第 21 行

```typescript
const parseCache = new Map<string, Record<string, unknown>>()
```

**影响**: Worker 进程长期存活，每次不同的 owner+text 组合都会向 Map 中写入条目，没有 TTL 清理机制或最大容量限制。在遭受定向请求攻击或自然流量增长时，Worker 内存持续增长直至被 Cloudflare 终止。

**修复建议**: 使用 LRU 缓存（如 `lru-cache` 包或简单的 200 条目上限 + TTL）。

---

### P1-5: Worker API 缺少请求体大小限制
**文件**: `worker/src/index.ts`  
**影响**: `/api/intents/parse` 等 POST 端点未限制请求体大小。攻击者可发送超大 JSON 消耗 Worker CPU/内存。

**修复建议**: Hono 内置 `bodyLimit` 中间件：
```typescript
import { bodyLimit } from 'hono/body-limit'
app.use('/api/*', bodyLimit({ maxSize: 50 * 1024 })) // 50KB
```

---

### P1-6: 前端 fetch 调用缺少超时/AbortController
**文件**: `src/api.js`, `src/chain-read.js`  
**影响**: 所有 fetch 调用均使用默认超时（浏览器通常 300s）。在网络不佳时 UI 会长时间挂起，用户体验极差。

**修复建议**: 封装带超时的 fetch helper：
```javascript
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}
```

---

### P1-7: 前端 "Emergency Stop" 仅为 UI 状态，不触链上操作
**文件**: `src/App.jsx`  
**行号**: `emergencyStop` 函数 (~第 335 行)

**影响**: 用户点击 Emergency Stop 后，UI 显示 "all agents frozen on-chain"，但实际上**没有任何链上交易发生**。政策仍然在链上处于 active 状态，Agent 仍可执行。这是严重的用户期望与安全现实不符的问题。

**修复建议**: 
- 短期：将 UI 文案改为 "Emergency pause (UI only) — to fully revoke, use the revoke button on each policy"，并添加明确提示。
- 长期：实现链上批量撤销或全局暂停机制。

---

### P1-8: listPoliciesByOwner N+1 RPC 查询
**文件**: `worker/src/chain.js`  
**行号**: `listPoliciesByOwner` (~第 77-98 行)

**影响**: 对每个 PolicyCreated 事件依次调用 `readWrapper` 和 `readMandate`（各一次 RPC）。若用户有 20 个政策，会产生 40+ 次串行 RPC 调用，极易触发限流或超时。

**修复建议**: 使用 `Promise.all` 并行化：
```javascript
const policies = await Promise.all(
  ev.map(async (e) => {
    const wrapper = await readWrapper(client, e.parsedJson.wrapper_id)
    const mandate = wrapper ? await readMandate(client, wrapper.mandate_id) : null
    return enrichPolicyFromChain({ ... })
  })
)
```

---

### P1-9: runTick 每次执行都重建 keypair
**文件**: `worker/src/tick.js`  
**行号**: ~第 267 行

```javascript
const kp = keypairFromWorkerEnv(env)
```

**影响**: `Ed25519Keypair.fromSecretKey` 涉及密码学运算，每次 tick（默认 60s）都重建是不必要的开销。更关键的是，如果密钥解析逻辑有缺陷，每次调用都增加了失败面。

**修复建议**: 在 Worker 启动时或首次 tick 时缓存 keypair，存储在模块级变量或 DO 状态中。

---

### P1-10: Worker API `/activate` 端点缺少所有权验证
**文件**: `worker/src/index.ts`  
**行号**: `/api/policies/:wrapper_id/activate` (~第 207 行)

**影响**: 任何人都可以为任意 wrapper_id 调用 activate，虽然 DO 只保存监控状态而不能修改链，但可能被滥用创建大量无意义的 DO 实例，消耗 Cloudflare 配额。

**修复建议**: 在 activate 前读取链上 wrapper，验证请求方（或 at least 提供的 owner）与 wrapper.owner 匹配。

---

### P1-11: validateExecutionPlan 中假 mandate 逻辑风险
**文件**: `worker/src/tick.js`  
**行号**: ~第 165-180 行

当传入的 `mandateId` 与链上 wrapper 的 mandate_id 不匹配时，代码构造一个假的 mandate 对象（`expires_at_ms: String(clockMs + 1)`）继续验证。这会导致该路径下 mandate 几乎总是被认为 "即将过期"，行为不可预测，且没有文档说明此设计的意图。

**修复建议**: 明确此代码路径的用途（调试 API？），或移除/隔离到专门的 debug 端点，避免生产逻辑混乱。

---

### P1-12: buildCreatePolicyTx / buildExecutionTx 未设置 gas budget
**文件**: `worker/src/sui-tx.js`  
**影响**: 依赖 SDK 默认 gas budget。在网络拥堵或复杂 PTB 场景下，默认预算可能不足，导致交易失败。

**修复建议**: 显式设置合理的 gas budget：
```javascript
tx.setGasBudget(50_000_000) // 0.05 SUI，根据实际消耗调整
```

---

### P1-13: monitorPrice 仅支持 SUI 且静默失败
**文件**: `worker/src/index.ts`  
**行号**: `AgentRuntime.monitorPrice()` (~第 302-309 行)

```typescript
async monitorPrice(asset: string): Promise<number> {
  const pool = asset === 'SUI' ? 'SUI_DBUSDC' : null
  if (!pool) return 0
  // ...
}
```

**影响**: 非 SUI 资产（DEEP、WAL）的策略价格监控永远返回 0，`drawdownPct` 计算会异常（`peak = 0` 时 `((peak - price) / peak)` 为 NaN），策略永远不会触发或行为不可预测。

**修复建议**: 
- 支持所有配置的资产池映射
- 添加错误日志，非 SUI 资产不应静默返回 0

---

### P1-14: 测试完全缺失
**文件**: 全局

- **Worker**: 零测试（没有找到任何 `*.test.*`）
- **前端**: 零测试
- **Move**: 仅有 6 个测试，缺少 `record_agent_trade` 的错误路径（AuthToken 不匹配、预算超支重入等）

**修复建议**: 至少为以下路径添加测试：
- `decideTick` 所有分支
- `runTick` 的 funding block、执行成功、执行失败路径
- `AgentRuntime.alarm` 和 `tickOnce`
- Move: `record_agent_trade` 的 EAuthTokenMismatch、EBudgetExceeded、EPoolMismatch
- 前端: `parseIntent` 的输入边界

---

## 🟡 中等问题 (P2)

| ID | 问题 | 文件 | 说明 |
|---|---|---|---|
| P2-1 | Worker 缺少速率限制 | `worker/src/index.ts` | 建议添加基于 IP 的限流 |
| P2-2 | validateTickAuthorization 非常量时间比较 | `worker/src/tick-auth.js` | Bearer token 字符串比较可能被时序攻击，内部 API 风险较低 |
| P2-3 | 策略解析器缺少输入长度限制 | `core/strategy.js` | 超长文本可能导致正则回溯 |
| P2-4 | clientOrderId 使用 nowMs 可能重复 | `worker/src/tick.js` | 同一毫秒内多次 tick 会产生重复 ID |
| P2-5 | nowMs 回退到 Date.now() | `worker/src/tick.js` | 链下时间不可靠，建议强制使用链上 Clock |
| P2-6 | Move 测试覆盖不足 | `move/sentry/tests/` | 仅 happy path + 4 个 assert_policy_valid 错误 |
| P2-7 | getOwnerSummary 中 BigInt→Number 精度丢失 | `worker/src/chain.js` | `Number(p[k])` 对大 budget 可能丢失精度 |
| P2-8 | api.js URL 参数未编码 | `src/api.js` | `owner` 直接拼接到 URL，虽然地址格式已验证但仍不安全 |
| P2-9 | chain-read.js 的 rpc 错误未统一处理 | `src/chain-read.js` | `j.error` 时 throw，但调用侧 catch 不一致 |
| P2-10 | readOnlyLiveMode 显示 agent 地址为 owner | `src/App.jsx` | 只读模式下 `owner` 变量被设为 agent 地址，UI 显示混淆 |
| P2-11 | getSuiPriceHistory 并发 30 个请求 | `src/chain-read.js` | 可能对 indexer 造成压力，应减少并发或添加缓存 |
| P2-12 | AgentRuntime 状态读取未批处理 | `worker/src/index.ts` | `/state` 端点 9 次独立 storage.get()，应使用 get() 数组形式 |

---

## 🟢 建议改进 (P3)

| ID | 建议 | 文件 |
|---|---|---|
| P3-1 | 前端状态管理过于集中 | `src/App.jsx` | 400+ 行，包含所有业务逻辑；建议拆分为 hooks 或 Zustand store |
| P3-2 | Worker/前端 chain 读取代码高度重复 | `worker/src/chain.js` vs `src/chain-read.js` | getMarket、getBalances、listPolicies 等逻辑几乎相同，应尽可能复用 |
| P3-3 | toUnits 未验证输入格式 | `core/strategy.js` | `"abc"` 输入会产生 NaN/异常 |
| P3-4 | parseIntent 的正则表达式可优化 | `core/strategy.js` | 使用更严格的模式，避免误匹配 |
| P3-5 | Worker 端点缺少结构化日志 | `worker/src/index.ts` | 建议添加 request_id、trace 信息 |
| P3-6 | App.jsx 演示模式与实时模式状态混用 | `src/App.jsx` | `activity` / `liveActivity` 切换逻辑易出错 |
| P3-7 | buildAgentSetupTx 可能使用旧 DeepBook API | `worker/src/sui-tx.js` | 需确认 `pool::swap_exact_base_for_quote` 签名与最新 DeepBook 一致 |
| P3-8 | AgentRuntime.monitorPrice 应使用更可靠的价格源 | `worker/src/index.ts` | DeepBook indexer 是测试网源，应考虑 Pyth 或主网聚合 |
| P3-9 | 添加 CI/CD 流水线 | `.github/workflows/` | 自动运行 Move 测试和 lint |
| P3-10 | 类型定义分散 | 多处 | JSDoc 类型和 TS 类型混用，建议统一为 `.ts` |

---

## ✅ 做得好的部分

1. **Worker 不持有 owner 密钥**: 创建/撤销交易都在前端签名（zkLogin），Worker 只构建未签名 PTB，安全模型正确。
2. **Guardian 多层检查**: 链上（MoveGate + SentryPolicyWrapper）+ 链下（runGuardian）双重检查，Guardian 顺序与文档一致。
3. **AuthToken 一次性消费**: Move 合约中 `record_agent_trade` 通过 `create_success_receipt` 消耗 AuthToken，防止重放。
4. **执行结果严格验证**: `classifyExecutionResolution` 要求成功 effects + AgentTradeExecuted 事件 + spent_amount 增加三重验证，避免 false positive。
5. **意图解析缓存**: `parseIntentWithStability` 使用确定性缓存键，避免重复解析。
6. **Worker/前端读取降级**: `api.js` 的 `read()` 函数在 Worker 不可用时自动回退到直接链读取。
7. **Move 合约错误代码清晰**: 每个错误条件都有独立错误码和断言。

---

*报告结束*
