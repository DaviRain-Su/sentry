# Local Agent, CLI, Agent Dispatch, and Worker Bridge v0.1

状态：Planning
日期：2026-06-03 · 更新：2026-06-03
范围：Sentry 守护程序 CLI、Agent 调度协议、Cloudflare Worker relay/control plane 的连接设计

## 1. 结论

Sentry 是一个 Agent 调度平台。守护程序负责策略管理、Guardian 风控和 Agent 调度，但**不自行执行交易**。交易执行委托给外部 Agent（Claude Code、Codex、Kimi 等），它们使用本机已有的钱包/OWS/CLI 环境完成签名和执行。

推荐形态：

```text
Dashboard
  -> Cloudflare Worker API
     -> AgentSession Durable Object
        -> outbound WebSocket held by Sentry daemon
           -> Sentry Daemon
              -> PolicyManager / TickLoop / Guardian
              -> AgentRegistry / AgentDispatcher
                 -> External Agent (Claude Code / Codex / Kimi / ...)
                    -> Local environment (OWS / Solana CLI / wallets / chain RPCs)
```

关键原则：

- Sentry 守护程序主动向 Worker 建立 outbound WebSocket，不要求用户开放本机端口。
- Worker + Durable Object 是 relay/control plane，不是 custody 或执行面。
- 守护程序不碰私钥或 API secret。签名和执行由外部 Agent 在本机环境完成。
- 所有远程命令都必须经过本地 Guardian、policy scope 和 credential scope 检查。

## 2. 为什么需要 Worker bridge

纯 localhost daemon 只能服务同一台机器上的 Dashboard。如果后续需要:

- web dashboard 查看本地 agent 是否在线;
- 用户在浏览器里点击 start / pause / sync / deploy;
- 移动端或另一台机器查看状态;
- 策略 marketplace 生成 policy draft 后发给本机执行;
- 本地 agent 离线后云端展示 stale / queued / expired 状态;

就需要一个云端 relay/control plane。Cloudflare Worker + Durable Object 适合作这个层:

- Worker 负责认证、HTTP API、WebSocket upgrade 校验。
- Durable Object 负责每个 local agent session 的单点协调、连接状态、命令队列和心跳。
- WebSocket 负责 daemon 与 DO 的实时双向通讯。

Cloudflare Workers 官方支持 WebSocket;如果需要协调多个连接,Durable Objects 是推荐的单点协调方式。DO 也支持 WebSocket hibernation,适合长连接但低频消息的 local agent。

## 3. 组件

### `sentry` CLI

职责:

- 安装、初始化、配对、运行和管理 Local Agent daemon。
- 创建本地 agent identity key。
- 检查 OWS vault、Sentry home、SecretStore、InventoryStore。
- 启动 Claude Code / Codex / 自定义 agent 子进程,并通过 stdio 下发任务、读取结果。
- 启动 loopback API，供本机 Dashboard 使用。
- 建立到 Worker 的 outbound WebSocket。
- 通过 subprocess/stdio 调度外部 Agent，向它们分发结构化任务。
- 提供本地 emergency stop，不依赖 Worker 在线。
- 注册和管理外部 Agent（`sentry agent register`）。

命令草案:

```bash
# 守护程序生命周期
sentry agent init
sentry agent pair <pairing-code>
sentry agent run
sentry agent run --agent claude-code    # 指定默认外部 Agent
sentry agent install-service
sentry agent status
sentry agent logs --tail
sentry agent disconnect
sentry agent doctor

# Agent 管理
sentry agent register <agent-type>      # 注册外部 Agent（claude-code, codex, kimi, ...）
sentry agent list                        # 列出已注册 Agent
sentry agent capabilities <agent-type>   # 查看 Agent 能力
sentry agent unregister <agent-type>    # 注销 Agent

# 钱包 / venue（由外部 Agent 使用，守护程序校验 scope）
sentry wallet link --ows <wallet-id-or-name>
sentry venue add binance
sentry venue list
sentry venue revoke <venue-id>

# 策略和监控
sentry inventory sync
sentry policy list
sentry policy deploy <strategy.json>
sentry policy pause <policy-id>
sentry policy resume <policy-id>
sentry emergency-stop
```

### Sentry 守护程序（Sentry Daemon）

职责:

- 长期运行 tick loop。
- 管理策略（Policy）运行状态和生命周期。
- 执行 Guardian 风险检查。
- **调度外部 Agent**：守护程序不自行执行交易。它通过 subprocess/stdio 向注册的外部 Agent 分发结构化任务（AgentTask），接收执行结果（AgentTaskResult）。
- 暴露 loopback-only API，例如 `http://127.0.0.1:<port>`.
- 连接 Worker bridge 实现远程状态和命令中继。
- 执行 Worker 投递的 remote command，但只在本地校验通过后执行。
- 写 `~/.sentry/logs/activity.jsonl` 和本地状态库。

守护程序进程边界：

```text
Sentry daemon
  ├── PolicyManager
  ├── TickLoop
  ├── Guardian
  ├── AgentRegistry（已注册的外部 Agent 列表）
  ├── AgentDispatcher（subprocess/stdio → 外部 Agent）
  ├── InventoryStore
  ├── ActivityWriter
  ├── LoopbackAPI
  └── WorkerBridgeClient
```

守护程序**不包含**：
- OWS signer / wallet 签名 → 由外部 Agent 调 OWS
- VenueAdapters / ExecutorAdapter → 由外部 Agent 使用其自带工具链
- 交易所 API secret → 由外部 Agent 通过 OS keychain 读取

### Cloudflare Worker

职责:

- Web API:pairing、agent status、command submit、activity summary、dashboard read model。
- WebSocket upgrade:校验 local agent 连接请求,然后转发到 AgentSession Durable Object。
- 鉴权:用户 session、agent identity、pairing token、signed envelopes。
- 不保存本地 secrets。

### AgentSession Durable Object

一个 local agent 对应一个 `AgentSession` DO。

职责:

- 存储 `agent_id`、owner、device public key、capabilities、last heartbeat、session state。
- 接受 local daemon 的 WebSocket。
- 接受 Dashboard/Worker 的 command submit。
- 向 daemon 投递 command,等待 ack/result。
- 维护 bounded command queue。
- 处理重连、序号、幂等和超时。

## 4. 配对流程

目标:让浏览器账户、云端 AgentSession 和本机 daemon 建立可信绑定,但不把本地 secret 发给 Worker。

```text
Dashboard
  -> POST /api/local-agents/pairing
  <- pairing_code, expires_at, relay_url

CLI
  -> sentry agent pair <pairing_code>
  -> generate or load local agent identity key
  -> POST /api/local-agents/pair
       pairing_code
       agent_public_key
       device_name
       supported_capabilities
       signed_nonce
  <- agent_id, session_id, websocket_url, relay_token

Daemon
  -> connect websocket_url with relay_token
  -> send hello envelope signed by agent_private_key
  <- session_accepted
```

Rules:

- pairing code expires quickly, recommended 5 minutes.
- pairing code is single-use.
- daemon generates a local Ed25519 identity key and stores it in OS keychain or `~/.sentry/identity` with 600 permissions.
- Worker stores only public key and metadata.
- `relay_token` is short-lived; daemon should refresh by signing a challenge with its local identity key.
- User can revoke a paired agent from Dashboard; daemon should observe `session_revoked` and stop remote control.

## 5. Message protocol

所有 WebSocket messages 使用 signed JSON envelope。

```ts
type BridgeEnvelope = {
  version: 1;
  session_id: string;
  agent_id: string;
  message_id: string;
  seq: number;
  kind:
    | 'hello'
    | 'heartbeat'
    | 'capabilities'
    | 'inventory_summary'
    | 'activity_summary'
    | 'command'
    | 'command_ack'
    | 'command_result'
    | 'error';
  issued_at: string;
  expires_at?: string;
  idempotency_key?: string;
  payload: unknown;
  signature: string;
};
```

Requirements:

- `message_id` is unique.
- `seq` is monotonic per session.
- `issued_at` must be close to Worker time; tolerate small clock drift.
- command messages must include `expires_at`.
- command result must include original `message_id` / `idempotency_key`.
- messages must not include OWS token, wallet passphrase, private key, exchange raw API secret or full local DB rows.

## 5a. Agent Dispatch Protocol（守护程序 → 外部 Agent）

守护程序不自行执行交易。Agent 调度是守护程序的核心职责。

### Agent Registry

守护程序维护一个 Agent registry。用户通过 CLI 注册可用的外部 Agent：

```bash
sentry agent register claude-code    # 注册 Claude Code
sentry agent register codex          # 注册 Codex
sentry agent register kimi           # 注册 Kimi
sentry agent list                    # 列出已注册 Agent
```

每个注册的 Agent 声明其能力：

```ts
type AgentCapability = {
  agent_type: 'claude-code' | 'codex' | 'kimi' | string;
  supported_chains: string[];       // ['sui', 'solana', 'ethereum', ...]
  supported_actions: string[];      // ['swap', 'place_order', 'cancel_order', 'transfer', ...]
  tools: string[];                  // ['jupiter', 'deepbook', 'uniswap', 'ows', ...]
  requires_approval: string[];      // actions that need user confirmation
  max_budget_action: string;        // max notional per action
};
```

### Agent Dispatch Task

当 tick loop 决定需要执行时，守护程序构建结构化任务：

```ts
type AgentTask = {
  task_id: string;
  policy_id: string;
  target_agent: string;            // e.g. 'claude-code'
  policy_context: {
    chain: string;
    venue: string;
    budget_remaining: string;
    spent_amount: string;
    max_slippage_bps: number;
    strategy_type: string;
    expires_at_ms: number;
  };
  action: {
    type: 'swap' | 'place_order' | 'cancel_order' | 'check_health' | 'monitor';
    params: {
      pool_id?: string;
      token_in?: string;
      token_out?: string;
      amount_in?: string;
      min_amount_out?: string;
      order_type?: string;
    };
  };
  constraints: {
    budget_cap: string;
    slippage_cap_bps: number;
    venue_scope: string[];
    require_simulation: boolean;
    require_receipt: boolean;
  };
  issued_at_ms: number;
  expires_at_ms: number;
};
```

### Agent Dispatch Result

外部 Agent 执行后返回结构化结果：

```ts
type AgentTaskResult = {
  task_id: string;
  status: 'executed' | 'blocked' | 'failed' | 'needs_approval' | 'expired';
  tx_digest?: string;
  venue_order_id?: string;
  evidence?: {
    simulation_result?: string;
    quote?: Record<string, unknown>;
    tx_json?: string;
  };
  reason?: string;                   // required when blocked or failed
  amount_spent?: string;
  amount_received?: string;
  executed_at_ms: number;
};
```

### Dispatch 流程

```text
tick → trigger met + Guardian passed
  → select target agent from registry (match chain + action capabilities)
  → build AgentTask
  → dispatch via subprocess/stdio
     sentry dispatch --agent claude-code --task <task.json>
  → external Agent starts:
     reads task context
     uses local tools (OWS, Solana CLI, etc.) to execute
     returns AgentTaskResult
  → daemon validates result:
     check tx_digest on-chain if chain action
     check order status if CEX action
     verify amount spent ≤ budget
  → daemon writes activity log
  → daemon updates policy spent_amount
```

MVP 实现方式：守护程序通过 subprocess 调用外部 Agent CLI，用 stdin 传入 task JSON，stdout 读取 result JSON。后续升级到 MCP（Model Context Protocol）或其他 IPC 机制。

## 6. Command model

Allowed remote commands:

```ts
type RemoteCommand =
  | { type: 'agent.status' }
  | { type: 'agent.start'; command?: string }
  | { type: 'agent.stop' }
  | { type: 'inventory.sync'; scope?: string[] }
  | { type: 'policy.preview'; strategy: StructuredStrategy }
  | { type: 'policy.deploy'; strategy_hash: string; policy_ref: string }
  | { type: 'policy.pause'; policy_id: string }
  | { type: 'policy.resume'; policy_id: string }
  | { type: 'policy.revoke'; policy_id: string }
  | { type: 'venue.recheck'; venue_id: string }
  | { type: 'orders.cancel'; policy_id: string; venue_id?: string }
  | { type: 'emergency.stop'; scope: 'global' | 'policy' | 'venue'; target_id?: string };
```

Default rule:

- Worker may request.
- Local Agent decides.
- Local Agent may downgrade a command to `requires_local_approval`.
- Local Agent may reject with `POLICY_SCOPE_DENIED`, `CREDENTIAL_SCOPE_DENIED`, `STALE_INVENTORY`, `VENUE_OFFLINE`, `OWNER_APPROVAL_REQUIRED`, `SESSION_REVOKED`, or `COMMAND_EXPIRED`.

High-risk commands:

- withdrawal: not supported.
- export wallet/key: not supported remotely.
- import exchange key: local-only.
- reveal OWS token/passphrase/API secret: not supported.
- raise policy limit: local approval required and usually requires owner wallet signing.

External Agent rules:

- Worker may request `agent.start` / `agent.stop`; daemon owns the actual process lifecycle.
- External Agent stdout/stderr is treated as untrusted output and must be size-bounded before relay.
- External Agent cannot receive OWS token, wallet passphrase, exchange raw API secret or local DB rows over stdio.
- Trading/execution output from an external Agent is only a proposal until Local Agent Guardian and policy checks pass.

## 7. Connection lifecycle

### Startup

```text
sentry agent run
  -> load config
  -> lock local state DB
  -> start loopback API
  -> connect Worker bridge if paired
  -> send hello
  -> send capabilities
  -> send inventory summary
  -> start tick loop
```

### Heartbeat

- daemon sends heartbeat every 15-30 seconds.
- heartbeat includes version, uptime, active policies, blocked count, last inventory sync time and capabilities hash.
- DO marks session stale if no heartbeat for 90 seconds.
- Dashboard shows `online`, `stale`, `offline`, `revoked`, or `local-only`.

### Reconnect

- daemon reconnects with exponential backoff and jitter.
- after reconnect, daemon sends last seen `seq` and receives only missing queued commands.
- DO must expire stale commands before replay.
- daemon must deduplicate by `idempotency_key`.

### Deploy/restart behavior

Cloudflare Worker/DO deploys can disconnect WebSockets. Daemon must treat disconnects as expected and reconnect. Local tick loop continues even while Worker bridge is offline.

## 8. Local loopback API

The CLI daemon should expose a local API for same-machine Dashboard and CLI commands.

Default:

- bind only `127.0.0.1`.
- random high port unless configured.
- require local auth token stored under `~/.sentry`.
- CORS allow only local dashboard origins.

Example endpoints:

```text
GET  /v1/health
GET  /v1/agent/status
POST /v1/inventory/sync
GET  /v1/inventory
GET  /v1/venues
POST /v1/venues/:id/recheck
GET  /v1/policies
POST /v1/policies/preview
POST /v1/policies/:id/pause
POST /v1/policies/:id/resume
POST /v1/policies/:id/revoke
POST /v1/emergency-stop
GET  /v1/activity
```

Cloud Worker should not proxy arbitrary local API calls. It should send typed commands through the bridge protocol.

## 9. Storage layout

```text
~/.sentry/
  config.json
  identity.json              # daemon public metadata; private key in keychain or 600 file
  pairing.json               # agent_id, owner, relay endpoint, public metadata
  agents.json                # registered external Agent list + capabilities
  venues.json                # venue metadata and key handles only (no raw secrets)
  policies.json              # local policy state cache
  state/
    inventory.sqlite
    runtime.sqlite
  logs/
    activity.jsonl
    dispatch.jsonl           # Agent dispatch task/result log
    bridge.jsonl
```

Rules:

- raw exchange secret never appears in files.
- bridge logs must redact payload fields that may include addresses or order ids when privacy mode is high.
- activity log includes command id, local decision, Guardian result and venue result summary.

## 10. Worker API sketch

```text
POST /api/local-agents/pairing
POST /api/local-agents/pair
GET  /api/local-agents
GET  /api/local-agents/:agent_id
POST /api/local-agents/:agent_id/revoke
GET  /api/local-agents/:agent_id/connect   # WebSocket upgrade
POST /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands/:command_id
GET  /api/local-agents/:agent_id/activity
```

Security:

- `connect` requires WebSocket upgrade.
- Worker validates owner/session before Durable Object fetch.
- Durable Object validates signed hello before marking the agent online.
- command submit requires owner auth and command type allowlist.
- commands expire by default within 30-120 seconds depending on risk.

## 11. Failure modes

- daemon offline: Worker returns `AGENT_OFFLINE`; safe commands may queue with expiry, high-risk commands fail fast.
- Worker offline: Local Agent keeps running local policies and logs locally.
- WebSocket disconnected during command: command remains pending until ack timeout, then expires or replays after reconnect.
- duplicate command: daemon returns prior result by idempotency key.
- stale inventory: daemon rejects execution and asks for sync.
- revoked pairing: daemon closes bridge and refuses remote commands.
- Worker compromised: attacker cannot obtain wallet/venue secrets; local agent still applies signed envelope, owner/session and local policy checks.
- local machine compromised: outside Sentry's full mitigation; user must revoke venue keys and chain policies.

## 12. Implementation phases

P0 design lock:

- protocol types;
- CLI command surface;
- AgentSession Durable Object storage shape;
- local storage layout;
- failure modes and tests.

P1 minimal bridge:

- `sentry agent init`;
- `sentry agent pair`;
- `sentry agent run`;
- external Agent child process manager over stdio;
- Worker pairing endpoints;
- WebSocket connect to AgentSession DO;
- heartbeat/status and `agent.start` / `agent.stop`, no trading commands.

P2 local read model:

- inventory summary;
- venue/account summary;
- activity summary;
- Dashboard online/stale/offline states.

P3 command bridge:

- inventory sync;
- policy preview;
- pause/resume/revoke;
- emergency stop.

P4 execution:

- OWS signer integration;
- exchange SecretStore;
- per-venue adapters;
- command result audit;
- replay/idempotency tests.

## 13. References

- Cloudflare Workers WebSockets:https://developers.cloudflare.com/workers/runtime-apis/websockets/
- Cloudflare Durable Objects WebSocket best practices:https://developers.cloudflare.com/durable-objects/best-practices/websockets/
