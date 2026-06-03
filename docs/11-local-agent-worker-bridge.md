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
- 每个可执行任务都必须带 `authorization_ref` 和 enforcement metadata。OWS-only 是本地约束,CEX API key 是 venue 约束,不能包装成链上强约束。

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
sentry-daemon agent register <agent-type> --command "<cmd>"  # 当前实现
sentry-daemon agent list                                      # 列出已注册 Agent
sentry-daemon agent probe <agent-type> --json                 # 当前实现：命令/version + 声明能力探测
sentry agent register <agent-type>      # 未来统一 CLI
sentry agent list                       # 未来统一 CLI
sentry agent probe <agent-type>          # 未来统一 CLI
sentry agent unregister <agent-type>    # 注销 Agent

# 钱包 / venue（由外部 Agent 使用，守护程序校验 scope）
sentry wallet link --ows <wallet-id-or-name>
sentry-daemon venue add --venue okx --key-handle okx_key_xxxx --account-ref okx:subaccount:name --permissions read,place_order,cancel_order --ip-allowlist true
sentry-daemon venue add --venue hyperliquid --key-handle hl_agent_xxxx --account-ref hyperliquid:subaccount:name --read-account-address 0x... --agent-wallet-address 0x... --permissions read,place_order,cancel_order,set_leverage
sentry-daemon venue list
sentry-daemon venue remove --venue okx --key-handle okx_key_xxxx
sentry-daemon venue credentials status --venue okx --key-handle okx_key_xxxx
sentry-daemon venue credentials store --venue okx --key-handle okx_key_xxxx
sentry-daemon signer probe --scope solana-mainnet,ethereum-mainnet --json
sentry-daemon activity tail --limit 50 --json

# 策略和监控
sentry inventory sync
sentry-daemon policy add --policy-id funding-arb-1 --target-venues hyperliquid,okx --target-agent codex
sentry-daemon policy list
sentry-daemon policy tick --limit 50 --json
sentry-daemon policy pause <policy-id>
sentry-daemon policy resume <policy-id>
sentry-daemon policy revoke <policy-id>
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
- 写当前默认 `~/.sentry/activity.jsonl` activity log 和本地状态库。

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
  <- pairing_code, expires_at, owner_control_token, owner_control_token_expires_at

CLI
  -> sentry agent pair <pairing_code>
  -> generate or load local agent identity key
  -> POST /api/local-agents/pair
       pairing_code
       agent_public_key
       device_name
       supported_capabilities
       signed_nonce
  <- agent_id, websocket_url, relay_token, relay_token_expires_at

Daemon
  -> connect websocket_url with relay_token
  -> send hello envelope signed by agent_private_key
  <- session_accepted
```

Rules:

- pairing code expires quickly, recommended 5 minutes.
- pairing code is single-use.
- `owner_control_token` is short-lived and belongs to the Dashboard/session side for command submission until real user auth replaces it.
- daemon generates a local Ed25519 identity key and stores it in OS keychain or `~/.sentry/identity` with 600 permissions.
- Worker stores only public key and metadata.
- `relay_token` is short-lived and belongs only to the daemon WebSocket connection; it must not be shown to or stored by the browser.
- token refresh should eventually use a signed Worker challenge from the daemon identity key.
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
sentry-daemon agent register claude-code --command "claude-code"
sentry-daemon agent register codex --command "codex"
sentry-daemon agent register kimi --command "kimi"
sentry-daemon agent list
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
  authorization: {
    authorization_ref: string;
    authorization_model: 'ows_policy_only' | 'native_delegation' | 'smart_account_module' | 'sentry_contract' | 'venue_api_key';
    enforcement_layer: 'local' | 'chain' | 'venue' | 'hybrid';
    chain_enforced: boolean;
    budget_enforcement: 'none' | 'local_accounting' | 'chain_accounting' | 'custody' | 'venue_limit';
    funds_custodied: boolean;
    capabilities_required: string[];
    constraint_support: {
      budget: 'none' | 'local' | 'chain' | 'venue';
      expiry: 'none' | 'local' | 'chain' | 'venue';
      revoke: 'none' | 'local' | 'chain' | 'venue';
      venue_scope: 'none' | 'local' | 'chain' | 'venue';
      audit_log: 'none' | 'local' | 'chain' | 'venue';
    };
    must_not_claim_chain_enforced: boolean;
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
  → resolve AuthorizationAdapter (match venue account + required capabilities)
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
     verify authorization evidence according to enforcement_layer
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
  | { type: 'agent.registry' }
  | { type: 'agent.probe'; agent_id?: string; timeout_ms?: number }
  | { type: 'agent.dispatch'; task: AgentTask; target_agent?: string; command?: string; timeout_ms?: number; verify_live_grant?: boolean; require_signer_probe?: boolean; signer_probe_timeout_ms?: number }
  | { type: 'venue.catalog' }
  | { type: 'authorization.registry' }
  | { type: 'authorization.validate'; task: AgentTask }
  | { type: 'secret.store' }
  | { type: 'inventory.adapters' }
  | { type: 'inventory.sync'; scope?: string[]; live?: boolean; okx_ccy?: string; simulated?: boolean }
  | { type: 'signer.probe'; scope?: string[]; timeout_ms?: number }
  | { type: 'activity.tail'; limit?: number }
  | { type: 'policy.local.list' }
  | { type: 'policy.local.tick'; limit?: number; mark?: boolean }
  | { type: 'policy.local.plan'; limit?: number; simulated?: boolean }
  | { type: 'policy.local.run_once'; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean; timeout_ms?: number; verify_receipt?: boolean; simulated?: boolean }
  | { type: 'policy.local.loop.status' }
  | { type: 'policy.local.loop.start'; interval_ms?: number; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean; run_immediately?: boolean }
  | { type: 'policy.local.loop.stop'; reason?: string }
  | { type: 'policy.local.loop.run_now'; limit?: number; check_readiness?: boolean; dispatch?: boolean; mark?: boolean }
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
- Worker may request `agent.registry`; daemon returns local registered Agent metadata but does not allow remote registry writes.
- Worker may request `agent.probe`; daemon runs bounded local `--version` probes against registered Agent commands and checks declared baseline capabilities. This is command availability proof, not execution proof.
- Worker may request `agent.dispatch`; daemon validates AgentTask authorization before spawn, resolves `target_agent` from the local registry, writes sanitized task JSON to stdin, parses the final JSON result line from stdout and returns only sanitized result metadata.
- OKX `place_order` AgentTasks have a schema/result verifier skeleton plus a daemon local dispatch-readiness gate, order-status adapter, bounded retry/backoff and dispatch receipt verifier. Before spawning an OKX external Agent, daemon `agent.dispatch` checks linked local key metadata, `read` + `place_order`, no `withdraw`, `ip_allowlist=true` and local env/keychain credential resolution. When the external Agent returns `submitted` / `done`, daemon checks order status by `ordId` / `clOrdId` and returns sanitized `receipt_verification` metadata unless `verify_receipt=false` is explicitly set. The Worker registry must still keep OKX out of global `ready_for_dispatch`; production UI wiring and stronger venue-side proof hardening remain pending.
- Hyperliquid `place_order` AgentTasks have a schema/result verifier skeleton plus a local dispatch-readiness gate, local agent-wallet grant metadata proof, public `userRole` live grant checker, pre-signed `/exchange` submit adapter, default local nonce store, public `orderStatus` adapter and daemon dispatch receipt verifier. Before spawning a Hyperliquid external Agent, daemon `agent.dispatch` checks linked local metadata, `read` + `place_order`, no `withdraw` / `transfer`, a real master/subaccount read address, active agent-wallet grant metadata, and by default public `info.userRole` evidence that the agent wallet is still linked to the expected master/subaccount. It can validate task shape, reject mismatched `cloid`, `coin`, `venue_id` or missing order evidence, submit an external Agent's pre-signed payload without seeing private keys, persist `authorization_ref + nonce` claims by default with `SENTRY_HYPERLIQUID_NONCE_STORE` / `--hyperliquid-nonce-store` as overrides, and enrich accepted results with sanitized order state after dispatch. `verify_live_grant=false` exists only for offline tests/demos. It does not yet sign exchange actions itself or run live submit verification. Hyperliquid must therefore stay outside global `ready_for_dispatch`.
- Solana swap AgentTasks have a `submit_tx` schema/result verifier skeleton. Before spawning a Solana external Agent, daemon `agent.dispatch` can create a task-local dispatch-ready override only when the task owner matches `SENTRY_SOLANA_WALLET_ADDRESS` / `SENTRY_SOLANA_OWNER` and the task requires `read/sign/submit_tx`. `signer.probe` and `require_signer_probe=true` can add non-signing local address proof through `SENTRY_SOLANA_SIGNER_ADDRESS` or `SENTRY_SOLANA_SIGNER_PROBE_COMMAND`. The daemon can validate swap task shape and returned transaction signature / quote id / venue evidence, then poll Solana `getSignatureStatuses` and attach sanitized receipt verification metadata. It still does not build transactions, run simulation, sign, submit, perform real signature probing or discover OWS accounts. Solana must therefore stay outside global `ready_for_dispatch`.
- Ethereum swap AgentTasks have a `submit_tx` schema/result verifier skeleton. Before spawning an Ethereum external Agent, daemon `agent.dispatch` can create a task-local dispatch-ready override only when the task account matches `SENTRY_ETHEREUM_WALLET_ADDRESS` / `SENTRY_ETHEREUM_OWNER` and the task requires `read/sign/submit_tx`. `signer.probe` and `require_signer_probe=true` can add non-signing local address proof through `SENTRY_ETHEREUM_SIGNER_ADDRESS` or `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND`. The daemon can validate swap task shape and returned transaction hash / quote id / venue / chain evidence, then poll `eth_getTransactionReceipt` and attach sanitized receipt verification metadata. It still does not install Safe/session-key grants, build calldata, simulate, sign, submit, perform real signature probing or discover OWS accounts. Ethereum must therefore stay outside global `ready_for_dispatch`.
- Trading/execution output from an external Agent is only a proposal until Local Agent Guardian and policy checks pass.
- AgentTask without authorization metadata is rejected before subprocess dispatch.
- `authorization.validate` is a preflight command only; it cannot grant new authority or import secrets.
- `secret.store` and `inventory.adapters` return metadata only. They cannot reveal raw venue API secrets or wallet tokens.
- `inventory.sync` defaults to metadata-only. When `live=true`, OKX/Hyperliquid/Solana/Ethereum read-only adapters may perform local reads, but missing local credentials or wallet address env must return blocked access without falling back to demo data.
- `activity.tail` returns recent sanitized local activity events from the configured daemon activity JSONL path. It is read-only, bounded by `limit`, and must not expose raw secret-shaped fields.
- `policy.local.list` returns local policy metadata; `policy.local.tick` returns due local policies and may mark tick timestamps when `mark=true`. `policy.local.plan` turns due local policies with explicit task templates into planned AgentTasks. `policy.local.run_once` applies local policy guard and optional readiness/dispatch. `policy.local.loop.*` starts, stops, inspects or immediately runs the daemon-owned periodic loop. These are scheduling/readiness surfaces unless `dispatch=true`, and dispatch still requires a registered local Agent plus local readiness.
- `policy.pause`, `policy.resume` and `policy.revoke` update local policy state and write sanitized activity. They do not create new authority, raise limits, or bypass local approval.
- AgentTask with `budget_enforcement='chain_accounting'` must be displayed as authorization/accounting only, not custody.

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
  policies.json              # local policy metadata + tick cadence
  state/
    inventory.sqlite
    runtime.sqlite
  activity.jsonl             # current daemon default; sanitized dispatch activity
  logs/
    activity.jsonl           # future organized logs layout
    dispatch.jsonl           # Agent dispatch task/result log
    bridge.jsonl
```

Rules:

- raw exchange secret never appears in files.
- OKX macOS Keychain store uses interactive prompts; raw secret values must not be accepted as CLI flags.
- bridge logs must redact payload fields that may include addresses or order ids when privacy mode is high.
- activity log includes command id, local decision, Guardian result and venue result summary.
- current implementation appends sanitized `agent.dispatch.blocked`, `agent.dispatch` and policy run-once loop summaries; full production Guardian/inventory provenance is still pending.
- current implementation stores local policy metadata and computes due ticks, but does not yet transform due policies into AgentTasks or run Guardian dispatch automatically.

## 10. Worker API sketch

```text
POST /api/local-agents/pairing
POST /api/local-agents/pair
GET  /api/local-agents
GET  /api/local-agents/:agent_id
POST /api/local-agents/:agent_id/revoke
GET  /api/local-agents/:agent_id/connect   # WebSocket upgrade
POST /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands
GET  /api/local-agents/:agent_id/commands/:command_id
GET  /api/local-agents/:agent_id/activity
GET  /api/venues/catalog
GET  /api/authorization/registry
```

Security:

- `connect` requires WebSocket upgrade.
- Worker validates owner/session before Durable Object fetch.
- Durable Object validates signed hello before marking the agent online.
- command submit requires owner auth and command type allowlist.
- AgentSession keeps the latest bounded command records so Dashboard can poll command results by
  command `message_id` or idempotency key. Stored records use safe payload summaries, not full
  AgentTask payloads or local DB rows.
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
- heartbeat/status, `agent.start` / `agent.stop`, guarded `agent.dispatch` skeleton, local policy store/due-tick skeleton and sanitized local `activity.tail`. OKX has a `place_order` task/result verifier, local dispatch-readiness gate, order-status adapter and daemon receipt verifier skeleton; Hyperliquid has a `place_order` task/result verifier, public `userRole` live grant checker, pre-signed exchange-submit adapter, default local nonce store plus public order-status receipt verifier; Solana and Ethereum have task/result verifier, env-account local dispatch-ready gates, non-signing signer/address probe and RPC receipt polling skeletons but remain blocked for global dispatch until executable transaction-build adapters exist.

P2 local read model:

- inventory summary;
- local policy summary and due tick summary;
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
