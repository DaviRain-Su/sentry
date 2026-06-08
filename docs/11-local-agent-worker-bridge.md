# Local Agent, CLI, Agent Dispatch, and Worker Bridge v0.1

状态：Planning
日期：2026-06-03 · 更新：2026-06-04
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
       agent_id
       agent_public_key
       device_name
       supported_capabilities
       pairing_proof_issued_at
       signed_nonce
  <- agent_id, websocket_url, relay_token, relay_token_expires_at

Daemon
  -> connect websocket_url with relay_token
  -> send hello envelope signed by relay-token-bound HMAC + daemon Ed25519 identity signature
  <- session_accepted
```

Rules:

- pairing code expires quickly, recommended 5 minutes.
- pairing code is single-use.
- `owner_control_token` is short-lived and belongs to the Dashboard/session side for command submission until real user auth replaces it.
- daemon generates or loads a local Ed25519 identity key and stores it in `~/.sentry/identity.json`
  with 600 permissions. The current implementation uses this key to sign the pairing proof.
- Worker stores only public key and metadata.
- `relay_token` is short-lived and belongs only to the daemon WebSocket connection; it must not be shown to or stored by the browser.
- token refresh uses a signed Worker challenge from the daemon identity key: daemon requests a
  challenge, signs it with the local Ed25519 identity, Worker verifies the stored public key, rotates
  the short-lived relay token, closes the old WebSocket and lets daemon reconnect.
- User can revoke a paired agent from Dashboard; daemon should observe `session_revoked` and stop remote control.

## 5. Message protocol

WebSocket messages use a signed JSON envelope. The implemented v0 signature is relay-token-bound
HMAC-SHA256: both sides derive `sha256(relay_token)` and sign bridge envelopes. AgentSession
verifies daemon `hello`, `heartbeat`, `agent.status` and `command_result` messages before mutating
session state; the daemon verifies Worker `session_accepted`, `session_revoked` and `command`
messages before acting on them. The daemon sends the relay token through
`Sec-WebSocket-Protocol: sentry-rt.<token>` by default; query-string `token` remains only as a
compatibility fallback.

Long-lived daemon Ed25519 identity now exists for pairing proof and Worker-side device public-key
binding. The same identity signs relay-token refresh challenges and daemon-origin WebSocket business
envelopes. For paired sessions, AgentSession requires daemon-origin envelopes to include
`agent_public_key_id`, `agent_signature_alg: "Ed25519"` and `agent_signature` over the canonical
bridge payload, in addition to the relay-token-bound HMAC. AgentSession also persists a Worker
bridge Ed25519 identity, includes the Worker public key metadata in the signed `session_accepted`
envelope, and signs Worker-origin messages with `worker_public_key_id`,
`worker_signature_alg: "Ed25519"` and `worker_signature`. The daemon caches that Worker key after
`session_accepted` and rejects later Worker-origin messages if the key id or signature does not
match.
Replay protection is currently relay-session scoped: each side adds a positive monotonic `seq` to
signed envelopes and rejects missing, repeated or lower sequence numbers for the same relay token.
Worker sequence state is stored in the AgentSession Durable Object; daemon sequence state is stored
locally in `~/.sentry/bridge-sequences.json` under a derived relay-token key, not under the raw relay
token or HMAC key. Both sides also reject envelopes whose `issued_at` is stale or too far in the
future. Worker `command` envelopes must include `expires_at`; the daemon blocks expired commands
before dispatch and returns a `command_result` error for Dashboard polling. AgentSession keeps a
bounded pending queue for low-risk read/status commands when daemon is offline and replays them on
reconnect; dispatch/control commands still fail fast instead of being replayed. If reconnect happens
after `command_ack` but before `command_result`, AgentSession sends an internal `command.resume`
probe for the acknowledged command. The daemon answers from its bounded local
`~/.sentry/command-results.json` cache when it has already produced a result, returns `pending` if
the original command is still in-flight in the daemon process, or finalizes the original command as
`COMMAND_RESUME_NOT_FOUND` without replaying it when no stored result exists.

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
  agent_public_key_id?: string; // daemon-origin: paired Ed25519 key id
  agent_signature_alg?: 'Ed25519'; // daemon-origin
  agent_signature?: string; // daemon-origin: Ed25519 over canonical envelope without signature fields
  worker_public_key_id?: string; // Worker-origin: AgentSession bridge key id
  worker_signature_alg?: 'Ed25519'; // Worker-origin
  worker_signature?: string; // Worker-origin: Ed25519 over canonical envelope without signature fields
  signature: string; // v0: HMAC-SHA256 over canonical envelope without signature fields
};
```

Requirements:

- `message_id` is unique.
- `seq` is monotonic per relay session.
- `issued_at` must be close to Worker time; tolerate small clock drift.
- stale or far-future `issued_at` values must be rejected before command/session side effects.
- command messages must include `expires_at`, and expired commands must be blocked before dispatch.
- command result must include original `message_id` / `idempotency_key`.
- command submit must deduplicate caller-provided `idempotency_key`: same key + same command type
  returns the existing safe command record; same key + different command type returns
  `IDEMPOTENCY_KEY_CONFLICT`.
- command records must persist the lifecycle: `queued` when created/sent, `acknowledged` when
  `command_ack` arrives, and `result` for terminal daemon result, expiry or ack timeout.
- sent commands without timely `command_ack` must terminate as `COMMAND_ACK_TIMEOUT` so Dashboard
  does not mistake an unreceived high-risk command for an in-flight dispatch.
- acknowledged commands that reconnect before `command_result` must use `command.resume` lookup
  semantics. Resume may return a stored result or explicit `COMMAND_RESUME_NOT_FOUND`; it must not
  replay `agent.dispatch`, policy control or other high-risk commands.
- Worker must reject unsigned or tampered daemon envelopes before mutating session state.
- daemon must reject unsigned or tampered Worker command/session envelopes before executing a
  command or treating the session as accepted/revoked.
- both sides must reject missing, repeated or lower `seq` values for the same relay session.
- messages must not include OWS token, wallet passphrase, private key, exchange raw API secret or full local DB rows.

## 5a. Agent Dispatch Protocol（守护程序 → 外部 Agent）

守护程序不自行执行交易。Agent 调度是守护程序的核心职责。

### Agent Registry

守护程序维护一个 Agent registry。用户通过 CLI 注册可用的外部 Agent：

```bash
sentry-daemon agent register claude-code --command "claude-code" \
  --task-capabilities okx:place_order,hyperliquid:place_order,solana-mainnet:submit_tx,ethereum-mainnet:submit_tx
sentry-daemon agent register codex --command "codex" \
  --task-capabilities okx:place_order,hyperliquid:place_order,solana-mainnet:submit_tx,ethereum-mainnet:submit_tx
sentry-daemon agent register kimi --command "kimi" \
  --task-capabilities okx:place_order,hyperliquid:place_order
sentry-daemon agent list
```

`task_capabilities` 是本地 Agent capability manifest 的第一版。格式是
`<venue_id>:<action_type>`，例如 `okx:place_order`、`hyperliquid:place_order`、
`solana-mainnet:submit_tx`、`ethereum-mainnet:submit_tx`。守护程序在
`policy.local.run_once dispatch=true` 和 remote `agent.dispatch` 中会先检查目标任务是否被
注册 Agent 明确声明支持；不匹配时返回 `AGENT_TASK_CAPABILITY_DENIED`，不会进入 readiness
或 spawn 外部进程。`agent.probe` 会展示这些声明，但 `--version` 探测仍只是命令可用性证明，
不是实际交易执行证明。

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
  | { type: 'agent.dispatch'; task: AgentTask; target_agent?: string; command?: string; timeout_ms?: number; verify_live_grant?: boolean; verify_okx_live_read?: boolean; require_signer_probe?: boolean; signer_probe_timeout_ms?: number }
  | { type: 'venue.catalog' }
  | { type: 'authorization.registry' }
  | { type: 'authorization.revoke'; authorization_ref?: string; venue_id?: string; key_handle?: string; wallet_id?: string; reason?: string; confirm: true }
  | { type: 'authorization.rotate'; authorization_ref?: string; venue_id?: string; key_handle?: string; rotated_at?: string; reason?: string; confirm: true }
  | { type: 'authorization.state'; scope?: string[] }
  | { type: 'authorization.validate'; task: AgentTask }
  | { type: 'secret.store' }
  | { type: 'wallet.refs' }
  | { type: 'inventory.adapters' }
  | { type: 'inventory.sync'; scope?: string[]; live?: boolean; okx_ccy?: string; simulated?: boolean }
  | { type: 'signer.probe'; scope?: string[]; timeout_ms?: number }
  | { type: 'activity.tail'; limit?: number }
  | { type: 'policy.local.add'; policy?: object }
  | { type: 'policy.local.list' }
  | { type: 'policy.local.tick'; limit?: number; mark?: boolean }
  | { type: 'policy.local.plan'; limit?: number; simulated?: boolean }
  | { type: 'policy.local.run_once'; limit?: number; check_readiness?: boolean; check_inventory?: boolean; live_inventory?: boolean; live_market?: boolean; dispatch?: boolean; mark?: boolean; timeout_ms?: number; verify_receipt?: boolean; verify_live_grant?: boolean; verify_okx_live_read?: boolean; simulated?: boolean; market_snapshot?: object; market_venues?: string[]; market_symbols?: string[] }
  | { type: 'policy.local.loop.status' }
  | { type: 'policy.local.loop.start'; interval_ms?: number; limit?: number; check_readiness?: boolean; check_inventory?: boolean; live_inventory?: boolean; live_market?: boolean; dispatch?: boolean; mark?: boolean; verify_okx_live_read?: boolean; run_immediately?: boolean; market_snapshot?: object; market_venues?: string[]; market_symbols?: string[] }
  | { type: 'policy.local.loop.stop'; reason?: string }
  | { type: 'policy.local.loop.run_now'; limit?: number; check_readiness?: boolean; check_inventory?: boolean; live_inventory?: boolean; live_market?: boolean; dispatch?: boolean; mark?: boolean; verify_okx_live_read?: boolean; market_snapshot?: object; market_venues?: string[]; market_symbols?: string[] }
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
- Worker may request `agent.probe`; daemon runs bounded local `--version` probes against registered Agent commands and checks declared baseline plus task-level venue/action capabilities. This is command availability and manifest proof, not execution proof.
- Worker may request `agent.dispatch`; daemon validates AgentTask authorization before spawn, resolves `target_agent` from the local registry, writes sanitized task JSON to stdin, parses the final JSON result line from stdout and returns only sanitized result metadata.
- Worker may request `wallet.refs`; daemon returns metadata-only OWS wallet references (wallet id, vault path, CAIP-10 accounts, policy ids and capabilities). It must never return OWS API tokens, passphrases, private keys, seeds or mnemonics.
- OKX `place_order` AgentTasks have a schema/result verifier skeleton plus a daemon local dispatch-readiness gate, signed live-read proof, order-status adapter, bounded retry/backoff and dispatch receipt verifier. Before spawning an OKX external Agent, daemon `agent.dispatch` checks linked local key metadata, `read` + `place_order`, no `withdraw`, `ip_allowlist=true`, non-expired local rotation metadata, local env/keychain credential resolution and, by default, a signed OKX balance-read proof that returns only sanitized `live_read_proof` metadata. `verify_okx_live_read=false` exists only for offline tests/demos. When the external Agent returns `submitted` / `done`, daemon checks order status by `ordId` / `clOrdId` and returns sanitized `receipt_verification` metadata unless `verify_receipt=false` is explicitly set. The Worker registry must still keep OKX out of global `ready_for_dispatch`; production UI wiring, complete permission enumeration, live key revoke and live venue rotation remain pending.
- Hyperliquid `place_order` AgentTasks have a schema/result verifier skeleton plus a local dispatch-readiness gate, local agent-wallet grant metadata proof, public `userRole` live grant checker, pre-signed `/exchange` submit adapter, default local nonce store, public `orderStatus` adapter and daemon dispatch receipt verifier. Before spawning a Hyperliquid external Agent, daemon `agent.dispatch` checks linked local metadata, `read` + `place_order`, no `withdraw` / `transfer`, non-expired local rotation metadata, a real master/subaccount read address, active agent-wallet grant metadata, and by default public `info.userRole` evidence that the agent wallet is still linked to the expected master/subaccount. It can validate task shape, reject mismatched `cloid`, `coin`, `venue_id` or missing order evidence, submit an external Agent's pre-signed payload without seeing private keys, persist `authorization_ref + nonce` claims by default with `SENTRY_HYPERLIQUID_NONCE_STORE` / `--hyperliquid-nonce-store` as overrides, and enrich accepted results with sanitized order state after dispatch. `verify_live_grant=false` exists only for offline tests/demos. It does not yet sign exchange actions itself or run live submit verification. Hyperliquid must therefore stay outside global `ready_for_dispatch`.
- Solana swap AgentTasks have a `submit_tx` schema/result verifier skeleton. Before spawning a Solana external Agent, daemon `agent.dispatch` can create a task-local dispatch-ready override when the task owner matches either `SENTRY_SOLANA_WALLET_ADDRESS` / `SENTRY_SOLANA_OWNER` or a linked OWS `solana:mainnet:<address>` wallet reference, and the task requires `read/sign/submit_tx`. `signer.probe` and `require_signer_probe=true` can add separate non-signing local address proof through `SENTRY_SOLANA_SIGNER_ADDRESS` or `SENTRY_SOLANA_SIGNER_PROBE_COMMAND`. The daemon can validate swap task shape, Jupiter unsigned transaction proposals from `sentry-daemon solana prepare-swap`, returned transaction signature / quote id / venue evidence, then poll Solana `getSignatureStatuses` with bounded JSON-RPC retry/backoff and attach sanitized receipt verification metadata plus retry summaries. It still does not sign, submit, perform real signature probing or pass OWS API tokens to Agents. Solana must therefore stay outside global `ready_for_dispatch`.
- Ethereum swap AgentTasks have a `submit_tx` schema/result verifier skeleton. Before spawning an Ethereum external Agent, daemon `agent.dispatch` can create a task-local dispatch-ready override when the task account matches either `SENTRY_ETHEREUM_WALLET_ADDRESS` / `SENTRY_ETHEREUM_OWNER` or a linked OWS `eip155:1:<address>` wallet reference, and the task requires `read/sign/submit_tx`. `signer.probe` and `require_signer_probe=true` can add separate non-signing local address proof through `SENTRY_ETHEREUM_SIGNER_ADDRESS` or `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND`. The daemon can validate swap task shape, Uniswap V3 calldata proposals from `sentry-daemon ethereum prepare-swap`, returned transaction hash / quote id / venue / chain evidence, then poll `eth_getTransactionReceipt` with bounded JSON-RPC retry/backoff and attach sanitized receipt verification metadata plus retry summaries. It still does not install Safe/session-key grants, sign, submit, perform real signature probing or pass OWS API tokens to Agents. Ethereum must therefore stay outside global `ready_for_dispatch`.
- Trading/execution output from an external Agent is only a proposal until Local Agent Guardian and policy checks pass.
- AgentTask without authorization metadata is rejected before subprocess dispatch.
- `authorization.validate` is a preflight command only; it cannot grant new authority or import secrets.
- `authorization.state` is a metadata-only read-state command. The daemon loads local venue key
  handles and OWS wallet refs, returns sanitized grant/read/revoke status for Solana, Ethereum,
  Hyperliquid, OKX and Sui demo, and exposes planned grant gaps such as Solana native delegation or
  Ethereum smart-account/session-key installation. It also returns venue-key `rotation_state`;
  expired local rotation metadata blocks dispatch, while due-soon metadata is a warning. Each state
  includes machine-readable `readiness`, and the top-level response includes `readiness_summary`
  with blocked/planned/metadata-ready target venue ids plus next steps for production UI surfaces. It
  cannot create grants, revoke live venue keys, rotate live venue keys, sign transactions, read raw
  API secrets or import wallet credentials.
- `authorization.revoke` is an online-only local safety stop. It requires `confirm=true`; for
  OKX/Hyperliquid it marks the local key handle `revoked`, strips trading permissions and marks the
  Hyperliquid agent-wallet grant revoked in metadata; for OWS wallet refs it marks the wallet ref
  revoked and strips `sign/submit_tx` capability. It writes sanitized activity and makes later local
  dispatch readiness fail, but returns `live_authority_revoked=false` because real OKX key revoke,
  Hyperliquid agent-wallet revoke, Solana delegation revoke or Ethereum smart-account/session-key
  revoke still needs venue/chain proof. It must not be queued for offline replay.
- `authorization.rotate` is an online-only local rotation proof update. It requires `confirm=true`;
  for OKX/Hyperliquid key handles it updates local `rotated_at` / `rotation_reason`, writes sanitized
  activity and refreshes the metadata used by `authorization.state` and local dispatch readiness. It
  returns `live_authority_rotated=false` because real venue key material must be rotated outside
  Sentry first. It must not be queued for offline replay.
- `secret.store`, `wallet.refs` and `inventory.adapters` return metadata only. They cannot reveal raw venue API secrets, OWS tokens or wallet passphrases.
- `inventory.sync` defaults to metadata-only. When `live=true`, OKX/Hyperliquid/Solana/Ethereum read-only adapters may perform local reads, but missing local credentials or wallet address env must return blocked access without falling back to demo data. Solana/Ethereum live RPC reads use bounded retry/backoff and return sanitized retry summaries only.
- `activity.tail` returns recent sanitized local activity events from the configured daemon activity JSONL path. It is read-only, bounded by `limit`, and must not expose raw secret-shaped fields.
- `policy.local.add` upserts sanitized local policy metadata into the daemon policy store. It reuses
  local policy validation, rejects raw secret-shaped fields, validates target venues and writes
  `0600` metadata. It does not grant authority, start a loop, mark ticks or dispatch.
- `policy.local.list` returns local policy metadata; `policy.local.tick` returns due local policies and may mark tick timestamps when `mark=true`. `policy.local.plan` turns due local policies with explicit task templates into planned AgentTasks. `policy.local.run_once` applies local policy guard, local trigger guard from `market_snapshot` or `live_market=true` public OKX/Hyperliquid market reads, configured inventory/risk guard when `check_inventory=true` or readiness/dispatch is requested, and optional readiness/dispatch. Missing trigger data blocks readiness/dispatch; unsatisfied triggers return no-op/skipped and do not spawn an external Agent. `live_inventory=true` may trigger local OKX/Hyperliquid/Solana/Ethereum read adapters; otherwise inventory checks use metadata-only snapshots and block policies that require balances or exposure proof. `policy.local.loop.*` starts, stops, inspects or immediately runs the daemon-owned periodic loop. These are scheduling/readiness surfaces unless `dispatch=true`, and dispatch still requires a registered local Agent plus local readiness.
- Dashboard exposes `policy.local.run_once` controls as Plan, Preflight and an explicitly armed
  Dispatch action, plus no-dispatch `policy.local.add` seed, `policy.local.list` policy-store
  visibility, metadata-only `authorization.state`, confirm-gated local `authorization.revoke`,
  confirm-gated local `authorization.rotate` and `policy.local.loop.status/start/run_now/stop`
  controls. The UI can set `live_market=true` with
  bounded OKX/Hyperliquid venue and symbol lists, opt into `live_inventory=true` for Preflight/loop
  runs, require signer probe evidence and set local signer handoff timeout. Dispatch stays `false`
  unless the operator checks `dispatch armed`; armed run-once/loop commands send `dispatch=true` and
  still rely on daemon-side local readiness, registered Agent task capability and any configured
  signer command. UI `authorization.revoke` and `authorization.rotate` remain local metadata-only
  actions and refresh `authorization.state`; they must not claim live venue/chain authority has been
  revoked or live venue key material has been rotated.
- New Strategy Local Agent mode may call `policy.local.add` after review/configure/deploy for
  venue-scoped policies. The command writes metadata only; the UI must still require paired daemon
  control and must show a blocked state when the Worker bridge is not configured. The Dashboard and
  `npm run local-bridge:smoke` must share the same local policy metadata builder to prevent frontend
  payload drift from the repeatable bridge smoke.
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
- replay protection is relay-session scoped: reconnects with the same relay token must keep the last
  seen sequence values instead of starting at 0.
- token refresh is challenge-based and rotates to a new relay token before reconnecting. Missing
  relay tokens are not reused.
- DO expires stale pending commands before replaying them; only low-risk read/status commands are
  replayed.
- acknowledged non-read-only commands are resumed by lookup only: Worker sends `command.resume`,
  daemon returns a stored local result, `pending`, or `COMMAND_RESUME_NOT_FOUND`; daemon must not
  execute the original high-risk command again.
- owner command submit is idempotent by `idempotency_key`; resume preserves the original command id
  and idempotency key when it returns a stored result.

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
POST /api/local-agents/:agent_id/relay-token/challenge
POST /api/local-agents/:agent_id/relay-token/refresh
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
- Durable Object validates relay-token-bound signed daemon envelopes before accepting hello,
  heartbeat, status or command-result messages. If a daemon public key is paired, those daemon-origin
  messages must also carry a valid Ed25519 device signature for the paired key id.
- daemon validates relay-token-bound signed Worker envelopes before accepting session state changes
  or remote commands. After `session_accepted`, daemon also requires Worker-origin messages to carry
  a valid Ed25519 Worker bridge signature for the accepted key id.
- relay-token refresh requires a Worker-issued challenge signed by the paired daemon Ed25519
  identity; the AgentSession rotates token hashes, resets token-scoped sequence counters and closes
  the old WebSocket after successful verification.
- command submit requires owner auth and command type allowlist.
- AgentSession keeps the latest bounded command records so Dashboard can poll command results by
  command `message_id` or idempotency key. Stored records use safe payload summaries, not full
  AgentTask payloads or local DB rows. Summaries may include dispatch/readiness/receipt booleans,
  signer-probe booleans, signer timeout numbers and whether a Solana/Ethereum signer command was
  configured, but must not store the signer command string, raw market snapshots, task params or
  secret-shaped fields. Daemon command results are also recursively sanitized before Worker storage
  and API return: secret-shaped result fields are redacted and oversized nested structures are
  bounded. This is a last-resort Worker defense; the daemon and external Agent still must avoid
  sending wallet secrets, API keys, tokens or passphrases in command results.
- AgentSession directory keeps a bounded list of paired daemon sessions for Dashboard listing.
- owner revoke closes the session WebSocket, marks the session `revoked`, and invalidates both relay
  and owner-control token hashes.
- daemon treats `session_revoked` and WebSocket close code `1008` with a revoked reason as terminal:
  heartbeat/reconnect is stopped, a remote-started child process is stopped, the policy loop is
  stopped, and the daemon does not retry with the invalidated relay token.
- commands expire by default within 30-120 seconds depending on risk.

## 11. Failure modes

- daemon offline: low-risk read/status commands are stored in a bounded pending replay queue with
  expiry; high-risk commands return `AGENT_OFFLINE` and fail fast.
- Worker offline: Local Agent keeps running local policies and logs locally.
- WebSocket disconnected before a high-risk command is sent: command fails with `AGENT_OFFLINE`.
- WebSocket disconnected after send but before `command_ack`: command finalizes as
  `COMMAND_ACK_TIMEOUT`.
- WebSocket disconnected after `command_ack` but before `command_result`: on reconnect Worker sends
  `command.resume`; daemon returns a stored local result from `~/.sentry/command-results.json`,
  reports `pending` if the original command is still in-flight, or finalizes the original command as
  `COMMAND_RESUME_NOT_FOUND`. It never replays the original high-risk command.
- Low-risk read/status commands queued while daemon is offline can replay after reconnect until
  expiry.
- duplicate command: same `idempotency_key` and command type returns the existing safe command record
  instead of sending a second command; reusing a key for a different command type conflicts.
- stale inventory: daemon rejects execution and asks for sync.
- revoked pairing: Worker marks the AgentSession `revoked`; daemon closes bridge, refuses remote
  commands and does not reconnect with the old relay token.
- relay token refreshed: Worker closes the old WebSocket, daemon suppresses retry with the stale
  token and reconnects using the newly issued short-lived relay token.
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
- heartbeat/status, session directory listing, owner revoke, command-result polling, `agent.start` /
  `agent.stop`, guarded `agent.dispatch` skeleton, local policy store/due-tick/planning/run-once/loop
  skeletons, configured inventory/risk guards and sanitized local `activity.tail`. OKX has a `place_order` task/result verifier, local
  dispatch-readiness gate, order-status adapter and daemon receipt verifier skeleton; Hyperliquid has
  a `place_order` task/result verifier, public `userRole` live grant checker, pre-signed
  exchange-submit adapter, default local nonce store plus public order-status receipt verifier; Solana
  and Ethereum have task/result verifier, env-or-OWS-account local dispatch-ready gates, non-signing
  signer/address probe, metadata-only authorization state snapshots and RPC receipt polling skeletons
  but remain blocked for global dispatch until real OWS/Safe signer grant installation and live-account
  dry-runs exist.

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

- OWS signer/API token handoff;
- exchange SecretStore;
- per-venue adapters;
- command result audit;
- replay/idempotency tests.

## 13. References

- Cloudflare Workers WebSockets:https://developers.cloudflare.com/workers/runtime-apis/websockets/
- Cloudflare Durable Objects WebSocket best practices:https://developers.cloudflare.com/durable-objects/best-practices/websockets/
