# Sentry Architecture v1.0

状态：Draft
日期：2026-06-01 · 更新：2026-06-03
定位：Sentry：Agent 调度平台（Local Daemon × Agent Dispatch × Authorization Adapters）
当前实现：Sui Testnet MVP（保留）
默认模式：Local daemon + Agent dispatch（生产）；Cloud Worker 保留为 demo path

## 1. 架构目标

Sentry 是一个 **Agent 调度平台**，不是自己执行交易的 Agent。架构拆成四个层次：

- **授权适配层（AuthorizationAdapter）**：每个 venue 显式声明授权模型和 enforcement layer。当前 Sui demo 用 MoveGate + SentryPolicyWrapper 做链上授权、撤销、receipt 和金额记账,但不是资金托管；Solana/Ethereum 优先使用 delegation、smart account、session key 或原生 program；Hyperliquid 使用 API wallet / agent wallet + subaccount / vault；OKX 使用 trade-only API key + subaccount。OWS-only 只能算本地约束，不能宣称链上强约束。
- **守护程序（Sentry daemon）**：策略管理、Tick 监控、Guardian 风险检查、Agent 调度、Activity 日志。不自行执行交易。
- **Agent 调度层**：守护程序向外部 Agent（Claude Code、Codex、Kimi 等）分发结构化任务。外部 Agent 使用本机已有工具链（OWS、Solana CLI、钱包等）完成执行。
- **Worker bridge**：可选的 Cloudflare Worker relay，用于远程状态展示、命令中继和 pairing。不代理执行，不保存 secrets。

核心原则：Sentry 是"大脑"（策略 + 风控 + 调度），外部 Agent 是"手"（执行 + 签名）。守护程序不碰私钥。

当前生产目标 slice:Solana、Ethereum、Hyperliquid、OKX。Sui Testnet 作为已验证 demo path 保留,不计入生产目标 venue 数。

## 2. 系统边界

```
User
  |
  v
Web Dashboard
  | login / configure / confirm / revoke / inspect
  | optional remote status and commands through Worker bridge
  v
Sentry Daemon API (localhost loopback-only)
  | policy management / tick loop / Guardian / AuthorizationAdapter / Agent dispatch / activity log
  | outbound WebSocket to Cloudflare Worker bridge when paired
  v
Agent Dispatch Layer
  | Agent registry: claude-code, codex, kimi, ...
  | dispatch protocol: structured task + authorization_ref → external Agent → execution result
  v
External Agents (on user's machine)
  | Claude Code / Codex / Kimi / ...
  | use local environment: OWS vault, Solana CLI, wallets, chain RPCs
  v
Venues
  | Sui Testnet demo / Solana / Ethereum / Hyperliquid / OKX API
```

Optional remote bridge:

```text
Web Dashboard
  -> Cloudflare Worker Bridge API
     -> AgentSession Durable Object
        <-> outbound WebSocket held by Sentry CLI daemon
            -> Sentry Daemon API
```

### In scope

- zkLogin 登录和 owner identity。
- **Sentry 守护程序（sentry daemon）**：CLI + loopback API + tick loop + Guardian + Agent dispatch + activity log。
- **Agent registry & dispatch protocol**：注册外部 Agent，向它们分发结构化任务，接收执行结果。
- **AuthorizationAdapter registry**：按 venue/account 选择 `ows_policy_only`、`native_delegation`、`smart_account_module`、`sentry_contract` 或 `venue_api_key`，并记录约束在哪里执行。
- OWS wallet vault、OS keychain/keyring — 由外部 Agent 使用，Sentry 守护程序不代理这些。
- InventoryStore 守护程序归一化资产信息供 Guardian 消费。
- Cloudflare Worker API 作为可选 Sui Testnet demo/read path。
- Cloudflare Worker bridge 用于守护程序配对、远程状态展示和命令中继。
- AgentSession Durable Object 用于 daemon WebSocket 协调。
- Move 合约（MoveGate + SentryPolicyWrapper）— Sui Testnet demo 的链上授权/记账约束,不是 custody vault。
- Dashboard 展示和撤销。

### Out of scope for MVP

- Mainnet 资金执行。
- 完整多链执行闭环。
- 守护程序自行构建或签名交易。
- 任意自然语言到任意交易。
- 自动收益优化。

## 3. 组件

### Web Dashboard

职责：

- 提供 zkLogin 登录入口。
- 收集自然语言策略和显式确认。
- 展示结构化策略、Guardian warnings。
- 展示 Policy 状态、预算、风险分数、activity log。
- 发起 owner revoke。
- 展示守护程序在线状态、已注册 Agent 列表、Agent 能力矩阵。
- 通过 Worker bridge 发送远程命令（仅 typed command，不代理本地 API）。

Dashboard 不直接保存用户私钥，不直接替代链上 Policy 校验。

### Sentry 守护程序（Sentry Daemon）

职责：

- 以 `sentry agent run` 形式长期运行。
- 管理策略（Policy）运行状态和生命周期。
- 执行 tick loop：读资产状态 → Guardian 检查 → 若触发则构建 dispatch task。
- 选择并校验 AuthorizationAdapter，确认当前任务的权限来源、capabilities 和 enforcement layer。
- **向外部 Agent 分发任务**：守护程序不自行执行交易。它构建结构化任务（policy context + constraints + expected action），发送给注册的外部 Agent。
- 接收外部 Agent 的执行结果，写入 activity log。当前实现已有脱敏 `~/.sentry/activity.jsonl` writer、`activity.tail`、本地 `~/.sentry/policies.json` policy store 和 due-tick 计算;自动 Guardian dispatch loop 仍未接入。
- 管理本地 inventory snapshot 供 Guardian 使用。
- 提供 loopback-only HTTP API 给本机 Dashboard。
- 管理 Agent registry：注册、验证、列出可用外部 Agent。
- 通过 Worker bridge 连接云端（配对后），同步状态摘要和接收远程命令。

```
Sentry daemon
  ├── PolicyManager
  ├── TickLoop
  ├── Guardian
  ├── AuthorizationAdapterRegistry
  ├── AgentRegistry
  ├── AgentDispatcher（结构化任务 → 外部 Agent）
  ├── ActivityWriter
  ├── InventoryStore
  ├── LoopbackAPI（localhost HTTP）
  └── WorkerBridgeClient（outbound WebSocket）
```

### Agent 调度层（Agent Dispatch Layer）

职责：

- **Agent Registry**：守护程序维护已注册的外部 Agent 列表。每个 Agent 注册时声明其能力（supported chains、actions、tools）。
- **Agent Dispatch Protocol**：守护程序构建结构化任务，通过 subprocess/stdio 发送给外部 Agent。外部 Agent 返回结构化执行结果。
- **Agent 不绑定**：守护程序不捆绑特定 Agent。用户可选择 Claude Code、Codex、Kimi 或任何兼容的 Agent 工具。

Agent dispatch task 结构：

```ts
type AgentTask = {
  id: string;
  policy_id: string;
  policy_context: {
    chain: string;
    venue: string;
    budget_remaining: string;
    max_slippage_bps: number;
    strategy_type: string;
  };
  action: {
    type: 'swap' | 'place_order' | 'cancel_order' | 'check_health' | 'monitor';
    params: Record<string, unknown>;
  };
  constraints: {
    budget_cap: string;
    slippage_cap_bps: number;
    venue_scope: string[];
    require_simulation: boolean;
  };
  authorization: {
    authorization_ref: string;
    authorization_model: 'ows_policy_only' | 'native_delegation' | 'smart_account_module' | 'sentry_contract' | 'venue_api_key';
    enforcement_layer: 'local' | 'chain' | 'venue' | 'hybrid';
    chain_enforced: boolean;
    budget_enforcement: 'none' | 'local_accounting' | 'chain_accounting' | 'custody' | 'venue_limit';
    funds_custodied: boolean;
    capabilities_required: string[];
    must_not_claim_chain_enforced: boolean;
  };
  expires_at_ms: number;
};
```

Agent dispatch result:

```ts
type AgentTaskResult = {
  task_id: string;
  status: 'executed' | 'blocked' | 'failed' | 'needs_approval';
  tx_digest?: string;
  venue_order_id?: string;
  evidence?: Record<string, unknown>;
  reason?: string;
  executed_at_ms: number;
};
```

MVP 阶段先支持 CLI-based 调度（守护程序通过 subprocess 调用 Agent CLI）。后续可扩展 MCP（Model Context Protocol）。

### AuthorizationAdapter Registry

职责：

- 为每个 `VenueAccount` 声明授权模型、enforcement layer、capabilities 和 constraint support。
- 在 policy preview 阶段告诉用户权限在哪里被强制执行：本地、链上、venue，或 hybrid。
- 在 AgentTask 调度前校验授权引用，防止任务缺少 signer/account/API key scope。
- 在 AgentTaskResult 返回后读取链上 receipt、venue order status 或本地 audit summary，作为 activity evidence。

授权模型：

- `ows_policy_only`：OWS policy-gated signing。本地约束，适合 MVP/人工确认/小额自用，不可宣称链上强约束。
- `native_delegation`：链或 venue 原生 delegation，例如 Solana delegate、Cosmos authz、Hyperliquid agent wallet。
- `smart_account_module`：EVM Safe module、guard、ERC-4337/session key。
- `sentry_contract`：Sentry 自己的 Move/Anchor/Solidity 合约或 program。当前 Sui MoveGate + SentryPolicyWrapper 是链上授权/记账,不是 custody budget。
- `venue_api_key`：CEX read + trade API key、subaccount、IP allowlist。

详见 [`docs/13-authorization-adapters.md`](13-authorization-adapters.md)。

### PolicyReader / Guardian / InventoryStore（共享核心）

这些是守护程序内部的核心组件，从现有 `core/` 层复用：

- **PolicyReader**：读取链上 Policy（Mandate + Wrapper）和本地策略配置。
- **Guardian**：纯函数，基于策略约束、market snapshot 和 proposed action 返回 allow/block。
- **InventoryStore**：归一化 OWS wallets、chain RPC balances、CEX balances、perps positions 和 market data。Guardian 只消费此快照。

这些组件不依赖任何特定链的 SDK，是守护程序和可选 Worker demo 的共享内核。

### Worker Bridge API（可选远程 relay）

职责：

- 创建 pairing code，让本机 CLI daemon 与浏览器 owner session 绑定。
- 接受 daemon 的 outbound WebSocket upgrade。
- 将连接转发到对应 AgentSession Durable Object。
- 提供 paired agent 列表、online/stale/offline 状态。
- 接受 Dashboard 发出的 typed remote command。
- 校验 owner session、agent public key、relay token、signed envelope、command allowlist。

Worker Bridge API 是非托管通讯层。不代理任意 localhost API，不保存 OWS token、wallet passphrase、exchange raw API secret。

### AgentSession Durable Object（bridge 协调）

职责：

- 一个 paired daemon 对应一个 AgentSession DO。
- 保存 agent_id、owner id、device public key、capabilities、last heartbeat、session state。
- 接受 daemon WebSocket 并验证 signed hello。
- 接受命令投递，向 daemon 转发，等待 ack/result。
- 处理 heartbeat、stale/offline、reconnect、idempotency。

AgentSession DO 不保存本地 secrets。所有 remote command 最终仍由本地守护程序校验。

### Move 合约层（基于 MoveGate — Sui Testnet demo）

Sentry 复用 MoveGate 的 Mandate、AuthToken 和 ActionReceipt 基础设施，叠加 SentryPolicyWrapper 实现 DeFi 风险响应约束。当前 wrapper 只保存 policy metadata、预算数字和累计 `spent_amount`;它不持有 `Coin` / `Balance`,也不控制 DeepBook BalanceManager。详见 Sui 相关代码：`move/sentry/`、`worker/src/sui-tx.js`。

此合约层服务于 Sui Testnet demo。它可以证明 agent 被授权、撤销/过期检查、授权 amount、wrapper 记账和 receipt,但不能证明真实资金不可超额。对于 Solana / Ethereum 等 venue，默认先评估原生 delegation、smart account module、account guard 或 session key。对于 Hyperliquid 和 OKX，默认走 venue API key / agent wallet / subaccount 授权模型，不能宣称链上强约束。只有链上机制无法表达 Sentry 需要的预算、范围、过期、撤销和审计时，才进入自定义 Anchor/Solidity 合约设计。

## 4. 数据流

### Intent to Policy

```
Natural language
  -> supported strategy template
  -> structured strategy
  -> Guardian static checks
  -> select AuthorizationAdapter
  -> policy/action preview
  -> user confirm
  -> chain policy / venue mandate / local authorization ref created
  -> daemon registers policy in local state
```

### Agent Tick（守护程序内部）

```
tick(policy_id)
  -> refresh inventory snapshot
  -> read chain/venue policy state
  -> stop if revoked or expired
  -> evaluate trigger
  -> run Guardian checks on proposed action
  -> resolve AuthorizationAdapter and validate task capabilities
  -> if blocked: record blocked reason, wait next tick
  -> if triggered + allowed:
       build AgentTask (policy_context + action + constraints + authorization)
       dispatch to registered external Agent
       wait for AgentTaskResult
       write to activity log
       update local state
```

### Agent Dispatch

```
daemon
  -> AgentTask { policy_context, action, constraints, authorization_ref }
  -> external Agent (Claude Code / Codex / Kimi ...)
  -> Agent uses local environment (OWS / CLI / wallets) to execute
  <- AgentTaskResult { status, tx_digest, evidence, reason }
daemon
  -> write activity log
  -> sync summary to Dashboard / Worker bridge
```

### Revoke

```
owner click revoke
  -> submit revoke transaction / revoke API key
  -> chain policy revoked or venue key cancelled
  -> daemon detects revoked state
  -> future ticks no-op
  -> Dashboard reflects revoked
```

### Pairing & Remote Command

```
Dashboard → POST /api/local-agents/pairing → pairing_code
CLI → sentry agent pair <code> → POST /api/local-agents/pair
Daemon → WebSocket connect → signed hello → session_accepted
Dashboard → POST /api/local-agents/:id/commands → Worker → AgentSession DO → daemon
Daemon → validates locally → executes → returns command_result
```

## 5. Trust Model

- Owner trusts the selected AuthorizationAdapter's actual enforcement layer: chain contract/module, native delegation, venue API scope, or local OWS policy.
- Owner trusts the local machine and the external Agent tools they choose.
- Owner does NOT need to trust Sentry daemon with wallet private keys or exchange API secrets — daemon doesn't touch them.
- Owner may optionally trust Cloudflare Worker/DO as a relay, but not as custody or execution.
- Worker bridge compromise cannot expose local secrets; daemon still validates all commands locally.
- Guardian + the selected authorization enforcement layer are the final safety boundary. OWS-only is local enforcement, not chain enforcement. CEX API keys are venue enforcement, not non-custodial chain enforcement. Current Sui is chain-authorized accounting, not a custody vault.
- External Agents (Claude Code / Codex / Kimi) are not trusted by default — they act within the policy constraints that the daemon provides.

## 6. Key Management

- 链上 wallet secret 存在 OWS vault（`~/.ows`），由外部 Agent 调用 OWS 签名。Sentry 守护程序不代理 OWS。
- 交易所 API key 存在 OS keychain/keyring，由外部 Agent 在需要时读取。守护程序保存 key handle + metadata（权限、subaccount）用于 scope 校验。
- AuthorizationAdapter 只保存 reference 和 metadata，例如 wrapper id、Safe address、delegate id、API key handle 或 OWS wallet id。
- 守护程序只持有自己的 identity key（用于 Worker bridge signed envelope），不持有任何资金相关密钥。
- Sui Testnet Worker demo 的 agent key 仅限 demo 路径，不与生产混淆。

## 7. Failure Modes

- Intent parse ambiguous：return warnings; block policy creation.
- Tick market read fails：retry next tick.
- Guardian blocks：record reason; no task dispatched.
- External Agent fails：record error; retry or escalate to owner.
- External Agent returns unverifiable result：daemon marks as unresolved; does not update spent_amount.
- Revoke succeeds but daemon misses update：next chain/policy read detects and stops.
- Worker bridge disconnects：daemon continues local tick; reconnects with backoff.
- Duplicate remote command：daemon deduplicates by idempotency key.

## 8. Deployment Shape

MVP deployment targets:

- Web Dashboard：single frontend app (Cloudflare Pages).
- Sentry daemon：CLI + loopback API + Agent dispatch.
- Worker bridge：optional Cloudflare Worker + AgentSession DO.
- External Agents：user-installed (Claude Code, Codex, Kimi, etc.).
- Chain/perps/exchange：Sui Testnet package (demo); Solana, Ethereum, Hyperliquid and OKX as target integrations.

Production hardening backlog:

- Agent dispatch protocol formalization (MCP).
- AuthorizationAdapter registry and conformance tests.
- Sui chain-authorized accounting hardening; custody wrapper v2 only if the product moves to unattended real funds.
- Shared target venue catalog across frontend, Worker and daemon; Solana/Ethereum inventory reads are wired as local read-only RPC adapters, and both have swap `submit_tx` task/result verifier, env-account local dispatch-ready gates, non-signing signer/address probe and RPC receipt polling skeletons while executable transaction-build adapters remain planned.
- Solana authorization feasibility: native delegation / Sigil / Squads / custom Anchor only if required.
- Ethereum authorization feasibility: Safe guard/module / account abstraction / custom contract only if required.
- Hyperliquid adapter: read-only inventory, `place_order` AgentTask/result verifier, local agent-wallet grant proof, public `userRole` live grant check, pre-signed `/exchange` submit adapter, default local nonce store and public `orderStatus` receipt verifier exist; next work is production UI wiring, live-account dry-runs and live submit verification.
- OKX adapter: read-only inventory plus `place_order` AgentTask/result verifier, local permission/IP allowlist proof gate, order-status adapter, bounded retry/backoff and daemon dispatch receipt verifier skeleton exists; next work is venue-side proof hardening, production UI wiring and production dispatch-readiness.
- Multi-agent concurrency and conflict resolution.
- Strategy Marketplace and multi-leg templates.
- Dedicated event indexer and GraphQL migration.
