# Sentry Test Spec v1.0

状态：Draft
日期：2026-06-01
定位：Sentry：自主 DeFi 风险响应 Agent
原则：测试先于生产实现；实现偏离本文件时，先改规格再改测试和代码。

## 1. Test Layers

- Move unit tests：Mandate + Wrapper 创建、撤销、授权、预算、滑点、过期、事件。
- Worker API tests：intent parse、preview、policy API、activity API、agent tick。
- Guardian tests：各类 block reason 和允许路径。
- AuthorizationAdapter tests：授权模型、enforcement layer、capability scope、chain-enforced claim conformance。
- ExecutorAdapter tests：adapter registry、ExecutionPlan、preview、PTB build conformance。
- Integration tests：Worker + Sui Testnet package + Deepbook execution。
- Browser QA：Dashboard 登录、确认、状态展示、撤销。
- Demo acceptance：完整 create -> autonomous execute -> activity log -> revoke -> blocked-after-revoke 闭环。

## 2. Move Tests

### `create_policy`

Happy path:

- owner 创建有效 Policy（同时创建 MoveGate Mandate + SentryPolicyWrapper），事件 `PolicyCreated` 包含 `mandate_id` 和 `wrapper_id`。
- `budget_ceiling > 0` 且 `max_slippage_bps <= MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- 创建后的 `SentryPolicyWrapper` 是 shared object，MoveGate Mandate 也必须可被授权 agent 后续无 owner co-sign 引用。
- `mandate_id` 在 Wrapper 中正确关联。
- MoveGate creation fee payment、FeeConfig、ProtocolTreasury、MandateRegistry、AgentRegistry 和 AgentPassport 参数全部正确传入。

Boundary:

- `max_slippage_bps == MAX_ALLOWED_SLIPPAGE_BPS` 创建成功。
- `expires_at_ms` 恰好等于最大生命周期边界时创建成功。
- MoveGate Mandate expiry 采用 `now_ms < expires_at_ms`，因此执行时 `now_ms == expires_at_ms` 必须被视为 expired。

Error / attack:

- `budget_ceiling == 0` abort。
- `max_slippage_bps > MAX_ALLOWED_SLIPPAGE_BPS` abort。
- `expires_at_ms <= now_ms` abort。
- `expires_at_ms` 超过最大生命周期 abort。
- `agent == @0x0` abort。

### `revoke_policy`

Happy path:

- owner 撤销未撤销 Policy，调用 MoveGate `revoke_mandate`，发出 `PolicyRevoked`。
- MoveGate Mandate 的 `revoked` 标志被设置。

Boundary:

- 临近过期但未过期的 Policy 仍可撤销。

Error / attack:

- 非 owner 撤销 abort。
- 重复撤销 abort（MoveGate 层拒绝）。

### `assert_policy_valid`

Happy path:

- 正确 pool_id、预算、滑点、agent 匹配时通过。
- 注意：agent/revoked/expiry 由 MoveGate `authorize_action` 层检验，`assert_policy_valid` 只检查 Sentry 特有约束。

Boundary:

- `spent_amount + amount == budget_ceiling` 通过。
- `slippage_bps == max_slippage_bps` 通过。

Error / attack:

- 错误 pool abort。
- 错误 agent abort。
- `spent_amount + amount > budget_ceiling` abort。
- `slippage_bps > max_slippage_bps` abort。
- `spent_amount + amount` 溢出 abort。

### `record_agent_trade`

Happy path:

- 成功记录交易后 `spent_amount` 增加。
- MoveGate AuthToken 通过 `movegate::receipt::create_success_receipt` 被正确消费（PTB 结束后无法再使用）。
- MoveGate ActionReceipt 被创建并 freeze。
- 事件 `AgentTradeExecuted` 包含 `mandate_id`、`wrapper_id`、agent、pool、spent after、budget、slippage、client order id、timestamp。
- Dashboard 从事件 metadata 读取 transaction digest。

Boundary:

- 最后一笔交易刚好花完预算。

Error / attack:

- `quote_amount_spent == 0` abort。
- 非授权 agent abort。
- 超预算 abort。
- 撤销后记录 abort（MoveGate AuthToken 无法从已撤销 Mandate 获得）。
- AuthToken 来源不是当前 Policy 关联的 Mandate abort。
- AuthToken protocol 不是 `SENTRY_PROTOCOL_ADDRESS` abort。
- AuthToken amount 不等于 `quote_amount_spent` abort。

### Guardian block runtime log

Happy path:

- Guardian block 写入 Worker runtime activity log。
- 不提交 Deepbook transaction。
- 不创建 MoveGate ActionReceipt。
- 不改变 `spent_amount`。

## 3. Worker API Tests

### `POST /api/intents/parse`

Happy path:

- 输入“当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”返回 `status=ok`。
- 响应包含 `strategy`、`strategy_hash`、`guardian_warnings`、`ptb_preview`。
- `strategy.strategy_type` 必须等于 `risk_response`。
- `strategy.executor_kind` 必须等于 `deepbook`。
- 响应包含部署配置中的 `agent_address`，且 preview 明确展示该 address。
- preview 必须包含 owner、agent、executor、pool、budget、slippage、expiry。

Boundary:

- 用户省略滑点时使用 `DEFAULT_MAX_SLIPPAGE_BPS`。
- 用户省略过期时间时使用默认有效期，但不超过最大生命周期。
- `strategy_hash` canonicalization 覆盖空输入、中文输入和大数字 decimal string；必须匹配 `docs/03-technical-spec.md` 的 hash vectors。

Error:

- 缺失预算返回 `INTENT_AMBIGUOUS`。
- 不支持 chain 返回 `UNSUPPORTED_CHAIN`。
- 不支持 strategy 返回 `UNSUPPORTED_STRATEGY`。
- 不支持 executor 返回 `UNSUPPORTED_EXECUTOR`。
- 滑点超过硬上限返回 `GUARDIAN_STATIC_BLOCK`。

### `POST /api/policies`

Happy path:

- `confirmed=true` 且 strategy hash 匹配时创建 Policy。
- 成功响应包含 `policy_id`、`mandate_id`、`wrapper_id`、`tx_digest`、`agent_address`。
- Durable Object 被激活。

Error:

- `confirmed=false` 拒绝。
- `strategy.agent` 不等于部署配置 `SENTRY_AGENT_ADDRESS` 时拒绝。
- strategy hash 不匹配拒绝。
- 活跃 Policy 数达到 `MAX_ACTIVE_POLICIES_PER_DEPLOYMENT` 时返回 `ACTIVE_POLICY_LIMIT_REACHED`。
- Sui transaction 失败时不激活 Durable Object。

### `POST /api/policies/:wrapper_id/revoke`

Happy path:

- owner 确认撤销，返回 tx digest 和 `runtime_state=Revoked`。

Error:

- 非 owner 请求拒绝。
- 已撤销 Policy 返回 `ALREADY_REVOKED`，且不提交第二笔 revoke transaction。

### `GET /api/policies/:wrapper_id/activity`

Happy path:

- 返回 MoveGate Mandate snapshot、SentryPolicyWrapper snapshot、runtime state、events。
- budget 数字以字符串返回，避免 JS integer loss。
- 当链上状态与 Durable Object runtime state 冲突时，链上状态优先，`runtime_state_stale=true`。

Error:

- 不存在的 policy 返回 `NOT_FOUND`。
- 链读取失败返回 `CHAIN_READ_FAILED`。

### `POST /api/agent/tick`

Happy path:

- trigger false 返回 `action=no_op`。
- trigger true 且检查通过返回 `action=executed` 和 tx digest。
- tick 必须通过 adapter registry 选择 `deepbook` adapter；不能直接调用 Deepbook-specific runtime code。
- 内部 token 有效且 `SENTRY_DEMO_MODE=true` 时，`force_trigger=true` 可以绕过自然市场触发条件。

Blocked:

- revoked 返回 `stopped_revoked`。
- expired 返回 `stopped_expired`。
- 滑点超限返回 `blocked`。
- 预算超限返回 `blocked`。
- pool mismatch 返回 `blocked`。

Error:

- market read failed 返回 `error`，不提交交易。
- adapter plan failed 返回 `error`，不提交交易。
- unknown executor 返回 `UNSUPPORTED_EXECUTOR`，不提交交易。
- Deepbook transaction failed 返回 `error`，不更新成功状态。
- 缺失或错误 internal token 时返回 `401` 或 `403`，不运行 tick。
- 生产部署或 `SENTRY_DEMO_MODE=false` 时提交 `force_trigger=true` 返回 `FORCE_TRIGGER_DISABLED`。

### `GET /api/venues/catalog`

Happy path:

- 返回 `target_venue_ids`，且包含 `solana-mainnet`、`ethereum-mainnet`、`hyperliquid`、`okx`。
- `target_chains.length == 2`，`target_perps.length == 1`，`target_exchanges.length == 1`。
- OKX 条目必须为 `authorization_model=venue_api_key`、`enforcement_layer=venue`、`budget_enforcement=venue_limit`、`funds_custodied=false`。
- OKX 默认 capabilities 不得包含 `withdraw`。
- Solana 条目必须声明 `authorization_model=native_delegation`，且未实现前不得标记 `chain_enforced=true`。
- Ethereum 条目必须声明 `authorization_model=smart_account_module`，且未实现前不得标记 `chain_enforced=true`。
- Hyperliquid 条目必须使用 perps/spot venue 语义，`authorization_model=venue_api_key`，`enforcement_layer=venue`，`budget_enforcement=venue_limit`，且默认 capabilities 不得包含 `withdraw`。
- Sui Testnet DeepBook 只能出现在 `legacy_demo_venue_ids` 或 legacy demo venue 列表里，不得算入当前 production target count。

Error / privacy:

- 响应不得包含 OWS token、wallet passphrase、wallet private key、exchange raw API secret 或完整本地数据库行。

### `GET /api/authorization/registry`

Happy path:

- 返回每个 target venue 的 authorization ref:Solana、Ethereum、Hyperliquid、OKX。
- 返回 Sui Testnet legacy demo authorization ref,但不得计入 production target。
- Hyperliquid 和 OKX 必须显示 `authorization_model=venue_api_key`、`enforcement_layer=venue`、`budget_enforcement=venue_limit`、`funds_custodied=false`。
- Solana 必须显示 `authorization_model=native_delegation`，Ethereum 必须显示 `authorization_model=smart_account_module`。
- `ready_for_dispatch` 当前只能包含 Sui Testnet demo;Solana、Ethereum、Hyperliquid、OKX 不得被全局 registry 标为 ready。
- `validateTaskAuthorization` 对 OKX/Hyperliquid 默认返回 `ADAPTER_NOT_DISPATCH_READY`,但在 daemon 传入当前任务对应的 `local_dispatch_ready_venues=['okx']` 或 `['hyperliquid']` 时可对当前 task 返回 `dispatch_ready_source='local_daemon'`。

Error / privacy:

- 响应不得包含 OWS token、wallet passphrase、wallet private key、exchange raw API secret 或完整本地数据库行。

## 4. Guardian Tests

Happy path:

- Mandate 未撤销/未过期，Wrapper 剩余额度足够、滑点在范围内、pool 匹配时 allow。

Boundary:

- proposed amount 等于 remaining budget 时 allow。
- estimated slippage 等于 max slippage 时 allow。

Block cases:

- proposed amount 大于 remaining budget。
- estimated slippage 大于 max slippage。
- MoveGate Mandate revoked。
- MoveGate Mandate expired。
- Wrapper mandate_id 与 Mandate id 不一致。测试构造方式：创建两个有效 Mandate/Wrapper fixture，故意把 Wrapper A 与 Mandate B 传入 Guardian；预期返回 `MANDATE_MISMATCH`，不提交交易。
- pool mismatch。
- remaining budget 为 0。

Advisory:

- concentration risk score 高时 UI 显示 warning，但 MVP 不因此自动 abort，除非后续技术规格升级为强制检查。
- UI warning 断言方式：显示包含 “Concentration risk” 的文本标签、severity badge 和解释文案；不能只依赖颜色变化。

## 5. AuthorizationAdapter Tests

### Registry

- Shared `core/authorization.js` registry resolves all target venues and legacy demo venues.
- Every executable `VenueAccount` resolves to exactly one active AuthorizationAdapter.
- Unknown `authorization_model` returns `UNSUPPORTED_AUTHORIZATION_MODEL`.
- Missing `authorization_ref` blocks AgentTask dispatch.
- Adapter declarations include `authorization_model`, `enforcement_layer`, `capabilities`, `constraint_support` and `chain_enforced`.
- Adapter declarations include `budget_enforcement` and `funds_custodied`.

### Enforcement conformance

- `ows_policy_only` must set `enforcement_layer=local`, `chain_enforced=false` and `must_not_claim_chain_enforced=true`.
- `venue_api_key` must set `enforcement_layer=venue` or `hybrid`; withdrawal is absent from default capabilities.
- `sentry_contract`, `smart_account_module` or sufficiently strong `native_delegation` are the only models allowed to set `chain_enforced=true`.
- If a strategy requires chain-enforced budget decrement and no native chain primitive can express it, preview returns `requires_contract_deploy=true` or blocks with `CHAIN_ENFORCEMENT_UNAVAILABLE`.
- Current Sui demo reports `budget_enforcement=chain_accounting` and `funds_custodied=false`; UI must not claim real funds are physically capped by the wrapper.
- Claims that real funds cannot exceed the policy budget require `budget_enforcement=custody`, `budget_enforcement=venue_limit` or an equivalent native spending guard.

### AgentTask authorization

- Every dispatched AgentTask includes `authorization_ref`, `authorization_model`, `enforcement_layer`, `budget_enforcement`, `funds_custodied`, `capabilities_required`, `constraint_support` and `must_not_claim_chain_enforced`.
- Local Agent rejects tasks whose required capabilities are not covered by the authorization ref.
- Local Agent rejects stale, revoked or expired authorization refs before subprocess dispatch.
- Local Agent rejects target venue tasks with `ADAPTER_NOT_DISPATCH_READY` until the corresponding adapter is executable.
- UI/spec snapshots cannot label `ows_policy_only` or `venue_api_key` flows as chain-enforced.

### AgentTask dispatch

- `agent/src/local-agent-registry.mjs` persists registered external Agent metadata to `~/.sentry/agents.json` or `--agent-registry <path>` with `0600` permissions.
- `agent/src/local-agent-capability-probe.mjs` probes registered Agent command availability with `--version`, detects Codex / Claude Code / Kimi profiles where possible, flags missing baseline dispatch capabilities, handles disabled or missing Agents as blocked, and redacts secret-shaped probe output.
- `sentry-daemon agent register/list/remove` can add, show and remove external Agent command metadata. Command args containing raw token/secret/password/passphrase/API-key/private-key material are rejected.
- `agent.dispatch` may resolve `target_agent` through the local registry. Unknown or disabled agents return `AGENT_NOT_REGISTERED` / `AGENT_DISABLED` before subprocess spawn.
- `core/agent-task.js` rejects malformed tasks, expired tasks and any task/result containing raw secret-shaped fields such as `api_secret`, `private_key`, `passphrase`, `seed`, `mnemonic`, `password` or `token`.
- `agent/src/agent-dispatcher.mjs` parses quoted command lines, spawns one subprocess per `agent.dispatch`, writes sanitized AgentTask JSON to stdin and parses the last JSON AgentTaskResult line from stdout.
- Dispatcher tests must prove a valid Sui demo AgentTask can complete a real subprocess round trip with `status=done` and `tx_digest` evidence.
- Dispatcher tests must prove target venue tasks such as OKX are rejected with `ADAPTER_NOT_DISPATCH_READY` before subprocess spawn by default until local readiness has been proven.
- Dispatcher tests may use an explicit development-only `allowPlanned` path to exercise planned-venue verifier code without changing global dispatch-readiness.
- Dispatcher tests must prove `done` / `submitted` results without tx/order/simulation/receipt evidence are rejected.
- Dispatcher results must not echo arbitrary stdout logs or raw secret values back to Worker.

### CEX safety

- CEX adapter rejects API keys with withdrawal permission.
- CEX preview displays subaccount, trade-only permission, IP allowlist status and daily/per-order cap.
- CEX order results require venue order id or equivalent status evidence before activity is marked `done`.

### Local SecretStore and InventoryStore

- `core/local-secrets.js` rejects metadata containing raw secret-shaped fields such as `api_secret`, `private_key`, `passphrase`, `seed` or `mnemonic`.
- OKX and Hyperliquid key metadata store only key handle, display handle, venue id, subaccount/account ref, permissions, IP allowlist status, rotation interval and storage location.
- Any metadata with `withdraw` permission returns `WITHDRAW_NOT_ALLOWED`.
- OKX dispatch receipt verification must fail before credential use when metadata is missing `read`, missing `place_order`, has `withdraw`, is not linked or has `ip_allowlist=false`.
- OKX local dispatch readiness must fail before subprocess spawn when metadata is missing, IP allowlist proof is false, permissions are incomplete or local env/keychain credentials cannot be resolved.
- `agent/src/local-venue-store.mjs` persists metadata-only records to `~/.sentry/venues.json` or `--venue-config <path>` with `0600` permissions.
- `sentry-daemon venue add/list/remove` can add, show and remove OKX/Hyperliquid key metadata without accepting raw secrets.
- `sentry-daemon venue credentials status/store` supports OKX macOS Keychain checks and interactive storage without accepting raw secret values as CLI flags.
- `core/inventory.js` exposes adapter metadata for Solana, Ethereum, Hyperliquid, OKX and Sui demo.
- OKX and Hyperliquid inventory sources become `configured_readonly` only when a local key handle exists.
- Solana and Ethereum inventory sources are `read_adapter_ready` for metadata-only registry reads and require wallet/RPC env variables only for explicit live sync.
- Inventory skeleton must not invent balances; `positions=[]` is expected until a real adapter supplies observed data.
- Missing OKX/Hyperliquid key handle returns `VENUE_KEY_MISSING`; unknown scope returns `UNKNOWN_VENUE`.

### OKX read-only adapter

- `agent/src/okx-readonly-adapter.mjs` signs OKX API v5 requests as `Base64(HMAC_SHA256(timestamp + method + requestPath + body, secretKey))`.
- `GET /api/v5/account/balance` request construction supports optional `ccy` query.
- Auth headers include `OK-ACCESS-KEY`, `OK-ACCESS-SIGN`, `OK-ACCESS-TIMESTAMP` and `OK-ACCESS-PASSPHRASE`, but tests must prove the raw secret is never echoed.
- Adapter preflight accepts only `venue_id=okx`, requires `read`, and rejects `withdraw`.
- Balance responses are normalized into asset, equity, USD equity, cash balance, available balance and frozen balance rows.
- Mock-fetch tests cover success, OKX API errors and missing local credentials.
- `local-credential-resolver` resolves OKX live-read credentials from `SENTRY_OKX_*` env vars or key-handle-specific env vars first, then macOS Keychain generic-password entries. Redacted result objects must not contain raw secret values.
- Keychain tests cover service/account naming, `security find-generic-password` args, non-macOS unsupported status, missing keychain fields, and interactive `security add-generic-password ... -w` args with no secret value embedded.
- `live-inventory-sync` only calls OKX when explicitly requested with `live: true`; default `inventory.sync` remains metadata-only.
- Live OKX inventory sync converts normalized balances into `positions` rows and returns `OKX_CREDENTIAL_SOURCE_MISSING` without making a fetch call when local env/keychain credentials are absent.

### OKX trade-task skeleton

- `core/okx-trade.js` validates OKX trade key metadata for `venue_id=okx`, requires both `read` and `place_order` permissions and rejects any `withdraw` permission.
- `buildOkxPlaceOrderTask` creates a `venue_id=okx` AgentTask with `action.type=place_order`, endpoint `/api/v5/trade/order`, `tdMode=cash`, `capabilities_required=['read','place_order']`, `budget_enforcement=venue_limit`, `funds_custodied=false`, `require_receipt=true`, `no_withdraw=true` and `constraints.idempotency_key` equal to `clOrdId`.
- OKX task validation accepts `instId` / `inst_id`, `ordType` / `order_type`, `sz` / `size`, rejects invalid side/order type/size, requires `clOrdId`, and does not require price for market orders.
- `normalizeOkxOrderResponse` turns an OKX accepted order response into `AgentTaskResult{status='submitted', evidence.venue_order_id, evidence.client_order_id}` and rejects API-level or order-level OKX errors.
- `verifyOkxAgentTaskResult` rejects submitted/done OKX results without venue order evidence and rejects mismatched `client_order_id`.
- `buildOkxOrderStatusQuery` builds a status query for `GET /api/v5/trade/order` using `instId` plus `ordId` and/or `clOrdId`.
- `normalizeOkxOrderStatusResponse` normalizes OKX `live`, `partially_filled`, `filled`, `canceled` and `mmp_canceled` states into sanitized status evidence and rejects unknown order states.
- `verifyOkxOrderStatusForTask` rejects instrument mismatch, missing idempotency evidence and mismatched `client_order_id`.
- `agent/src/okx-order-status-adapter.mjs` signs and fetches OKX order status with mock-fetch tests that prove raw secrets are not echoed and mismatched `clOrdId` is rejected.
- `agent/src/okx-rate-limit.mjs` retries OKX HTTP 429 / 5xx and retryable OKX API codes with bounded backoff, honors bounded `Retry-After`, and returns sanitized retry summaries. Balance and order-status adapter tests must prove retry-then-success behavior.
- `agent/src/dispatch-receipt-verifier.mjs` wires OKX order status into daemon dispatch receipt verification: submitted/done OKX dispatch results load local key metadata, require local permission/IP allowlist operational proof, resolve local credentials, fetch order status, enrich `agent_result.evidence`, and fail with `receipt_verification_failed` when key metadata, proof, credentials or order evidence are missing/mismatched.
- `agent/src/local-dispatch-readiness.mjs` must let daemon `agent.dispatch` pass `local_dispatch_ready_venues=['okx']` only after local metadata proof and env/keychain credential resolution succeed; returned readiness metadata must not include raw credentials.
- Dispatcher tests must prove an OKX place-order task can complete a subprocess round trip without `allowPlanned` when `localDispatchReadyVenues=['okx']`, and that mismatched OKX client order evidence is rejected.
- OKX remains non-global-dispatch-ready in the Worker registry until production UI wiring and stronger venue-side proof hardening are complete.

### Hyperliquid read-only adapter

- `agent/src/hyperliquid-readonly-adapter.mjs` builds public `POST https://api.hyperliquid.xyz/info` requests for `clearinghouseState`, `spotClearinghouseState` and `frontendOpenOrders`.
- Adapter preflight accepts only `venue_id=hyperliquid`, requires `read`, and rejects `withdraw`.
- Account reads require the actual master/subaccount 42-character user address from `read_account_address`, `account_ref` when address-shaped, or `SENTRY_HYPERLIQUID_USER_ADDRESS`; agent wallet handles must return `HYPERLIQUID_USER_ADDRESS_REQUIRED`.
- Perp positions normalize coin, signed size, position value, entry price, unrealized PnL, margin used, liquidation price and leverage.
- Spot balances normalize coin, total quantity, available quantity, locked quantity and notional value.
- Open orders normalize order id, client order id, asset, side, order type, price, quantity, reduce-only flag and timestamp.
- `agent/src/hyperliquid-rate-limit.mjs` retries network errors and Hyperliquid HTTP 429 / 5xx with bounded backoff, honors bounded `Retry-After`, and returns sanitized retry summaries. Read-only adapter tests must prove retry-then-success behavior.
- `live-inventory-sync` converts Hyperliquid read state into `positions` rows and includes open-order count in `live_reads`.

### Hyperliquid trade-task skeleton

- `core/hyperliquid-trade.js` validates Hyperliquid key metadata for `venue_id=hyperliquid`, requires both `read` and `place_order`, and rejects `withdraw` / `transfer`.
- `buildHyperliquidPlaceOrderTask` creates a `venue_id=hyperliquid` AgentTask with `action.type=place_order`, endpoint `/exchange`, `capabilities_required=['read','place_order']`, `budget_enforcement=venue_limit`, `funds_custodied=false`, `require_receipt=true`, `no_withdraw=true` and `constraints.idempotency_key` equal to a 128-bit `cloid`.
- Hyperliquid task validation accepts `coin` / `asset`, `side` / `isBuy`, `orderType`, `sz` / `size`, `limitPx` / `price`, `tif`, `reduceOnly` and rejects invalid side/order type/size/price/tif/cloid.
- `normalizeHyperliquidOrderResponse` turns resting order responses into `AgentTaskResult{status='submitted'}` and filled responses into `status='done'`, with venue order id and cloid evidence.
- `verifyHyperliquidAgentTaskResult` rejects submitted/done Hyperliquid results without venue order evidence and rejects mismatched `cloid`, `coin` or `venue_id`.
- `buildHyperliquidOrderStatusQuery` creates a public `info` `orderStatus` request from `oid` or
  `cloid`, and `normalizeHyperliquidOrderStatusResponse` converts `open` / terminal order states
  into sanitized order-status evidence.
- `agent/src/hyperliquid-order-status-adapter.mjs` fetches Hyperliquid order status with bounded
  retry/backoff, requires the actual master/subaccount user address, and rejects mismatched `cloid`
  or `coin`.
- `agent/src/dispatch-receipt-verifier.mjs` wires Hyperliquid order status into daemon dispatch
  receipt verification: submitted/done Hyperliquid dispatch results load local key metadata, require
  local `read` + `place_order` proof with no withdrawal permission, fetch public order status, enrich
  `agent_result.evidence`, and fail with `receipt_verification_failed` when metadata, user address,
  order evidence or order-status evidence are missing/mismatched.
- `validateHyperliquidSignedExchangePayload` must accept only external-Agent-produced pre-signed
  `/exchange` payloads with `action`, safe-integer `nonce`, optional future `expiresAfter`, public
  `signature.{r,s,v}`, optional valid `vaultAddress`, no raw secret-shaped fields, and a task-bound
  `cloid`.
- `agent/src/hyperliquid-exchange-submit-adapter.mjs` must POST the pre-signed payload to
  Hyperliquid `/exchange`, use bounded retry/backoff, normalize the accepted/fill response, reject
  mismatched `cloid`, and never require or expose raw private keys.
- `agent/src/hyperliquid-nonce-store.mjs` must persist local `authorization_ref + nonce` claims with
  `0600` file writes, finalize submit status after the adapter response, and reject duplicate claims
  before any network request.
- `agent/src/dispatch-receipt-verifier.mjs` must submit a Hyperliquid proposed result containing
  `evidence.signed_exchange_payload`, then continue through public `orderStatus` receipt
  verification. Daemon `agent.dispatch` must pass the default Hyperliquid nonce-store path into the
  signed-submit adapter, while direct verifier tests may pass an explicit temp path.
- `agent/src/local-dispatch-readiness.mjs` must let daemon `agent.dispatch` pass
  `local_dispatch_ready_venues=['hyperliquid']` only after linked Hyperliquid metadata proves `read`
  + `place_order`, no `withdraw` / `transfer`, a real master/subaccount read address, and an active
  agent-wallet grant metadata record. When `verifyHyperliquidLiveGrant=true`, it must first call the
  Hyperliquid public `info.userRole` live checker and include sanitized `agent_wallet_live_grant`
  evidence; role mismatch, missing owner or owner mismatch must block dispatch before subprocess
  spawn. Returned readiness metadata must not include raw agent-wallet secrets.
- `agent/src/dispatch-receipt-verifier.mjs` must also require active Hyperliquid agent-wallet grant
  metadata before marking submitted/done Hyperliquid dispatch results as receipt-verified. When live
  grant verification is enabled, it must check `userRole` before public `orderStatus`.
- `agent/src/hyperliquid-agent-wallet-adapter.mjs` must build `info` requests with
  `type='userRole'` and the agent wallet address, normalize `role='agent'` responses, verify the
  returned owner/master user against the configured master/subaccount read address, reject non-agent
  roles, reject owner mismatch, retry HTTP 429 / 5xx with bounded backoff, and never require raw
  private keys.
- Dispatcher tests must prove a Hyperliquid place-order task can complete a subprocess round trip
  without `allowPlanned` when `localDispatchReadyVenues=['hyperliquid']`, and that mismatched
  Hyperliquid cloid evidence is rejected.
- Hyperliquid remains non-global-dispatch-ready until end-to-end live-account dry-runs, live submit
  verification and production UI wiring are implemented.

### Solana and Ethereum read-only inventory adapters

- `agent/src/solana-readonly-adapter.mjs` requires `SENTRY_SOLANA_WALLET_ADDRESS` or `SENTRY_SOLANA_OWNER`, builds `getBalance` and `getTokenAccountsByOwner` JSON-RPC requests, and normalizes native SOL plus SPL token-account balances.
- Missing Solana wallet address returns `SOLANA_WALLET_ADDRESS_REQUIRED` and `live-inventory-sync` must not call fetch.
- `agent/src/ethereum-readonly-adapter.mjs` requires `SENTRY_ETHEREUM_WALLET_ADDRESS` or `SENTRY_ETHEREUM_OWNER`, builds `eth_getBalance` plus optional ERC-20 `eth_call balanceOf` requests, and normalizes native ETH plus configured token balances.
- `SENTRY_ETHEREUM_TOKENS` accepts `SYMBOL:ADDRESS:DECIMALS,...` or a JSON array of token metadata; invalid token entries are ignored.
- Missing Ethereum wallet address returns `ETHEREUM_WALLET_ADDRESS_REQUIRED` and `live-inventory-sync` must not call fetch.
- Both adapters are read-only; tests must prove they do not require or expose private keys, wallet passphrases, OWS tokens or raw venue secrets.

### Solana swap task skeleton

- `core/solana-trade.js` validates Solana account metadata, requires `read`, `sign` and `submit_tx`, rejects `withdraw`, and requires a valid local wallet address.
- `buildSolanaSwapTask` creates a `venue_id=solana-mainnet` AgentTask with `action.type=submit_tx`, `intent=swap`, adapter `jupiter` / `raydium` / `orca` / `custom`, owner, input/output mint, base-unit amount, slippage bps, `quote_id`, `require_simulation=true`, `require_receipt=true`, `no_withdraw=true` and `constraints.idempotency_key` equal to the quote id.
- Solana task validation rejects missing owner, same input/output mint, invalid amount, invalid adapter, invalid slippage and incomplete capability scope.
- `normalizeSolanaExecutionResult` requires a valid Solana transaction signature and converts submitted/confirmed/finalized responses into sanitized AgentTaskResult evidence.
- `verifySolanaAgentTaskResult` rejects submitted/done Solana results without signature evidence, mismatched `venue_id`, mismatched `quote_id`, or reported transaction errors.
- `agent/src/solana-receipt-adapter.mjs` must build `getSignatureStatuses` JSON-RPC requests with
  `searchTransactionHistory=true`, reject missing/invalid signatures, reject unobserved signatures,
  reject returned transaction errors, and normalize observed signature status into sanitized
  `receipt_verification` metadata.
- `agent/src/dispatch-receipt-verifier.mjs` must poll Solana receipt status for submitted/done
  Solana dispatch results and fail with `receipt_verification_failed` when RPC does not observe the
  signature or reports an error.
- `agent/src/local-dispatch-readiness.mjs` must create a Solana task-local dispatch-ready override
  only when the task owner matches `SENTRY_SOLANA_WALLET_ADDRESS` / `SENTRY_SOLANA_OWNER`; missing
  env returns `SOLANA_WALLET_ADDRESS_REQUIRED`, mismatches return `SOLANA_LOCAL_ACCOUNT_MISMATCH`,
  and no raw secret-shaped fields may appear in the proof.
- `agent/src/local-signer-probe.mjs` must support Solana non-signing address proof from
  `SENTRY_SOLANA_SIGNER_ADDRESS` or `SENTRY_SOLANA_SIGNER_PROBE_COMMAND`, reject signer/task account
  mismatches with `SOLANA_SIGNER_ACCOUNT_MISMATCH`, avoid echoing command failure secrets, and let
  `local-dispatch-readiness` block only when `requireSignerProbe=true`.
- Dispatcher tests must prove a Solana swap task can complete a subprocess round trip without
  `allowPlanned` when `localDispatchReadyVenues=['solana-mainnet']`, and that mismatched quote id
  evidence is rejected.
- Solana remains non-global-dispatch-ready until transaction build/simulation/signing handoff, OWS
  account discovery, real signature probing and live-account dry-runs are implemented.

### Ethereum swap task skeleton

- `core/ethereum-trade.js` validates Ethereum wallet or smart-account metadata, requires `read`,
  `sign` and `submit_tx`, rejects `withdraw`, and requires a valid EVM account address.
- `buildEthereumSwapTask` creates a `venue_id=ethereum-mainnet` AgentTask with
  `action.type=submit_tx`, `intent=swap`, adapter `uniswap` / `safe` / `erc4337` / `custom`,
  account, input/output ERC-20 token addresses, base-unit amount, slippage bps, `quote_id`,
  `require_simulation=true`, `require_receipt=true`, `no_withdraw=true` and
  `constraints.idempotency_key` equal to the quote id.
- Ethereum task validation rejects missing account, same input/output token, invalid amount,
  invalid adapter, invalid slippage and incomplete capability scope.
- `normalizeEthereumExecutionResult` requires a valid EVM transaction hash and converts submitted
  or confirmed responses into sanitized AgentTaskResult evidence with `tx_hash` /
  `transaction_hash`.
- `verifyEthereumAgentTaskResult` rejects submitted/done Ethereum results without transaction hash
  evidence, mismatched `venue_id`, mismatched `chain_id`, mismatched `quote_id`, or reverted/error
  receipt evidence.
- `agent/src/ethereum-receipt-adapter.mjs` must build `eth_getTransactionReceipt` JSON-RPC requests,
  reject missing/invalid transaction hashes, reject unobserved receipts, reject mismatched
  `transactionHash`, reject `status=0x0`, and normalize observed receipts into sanitized
  `receipt_verification` metadata.
- `agent/src/dispatch-receipt-verifier.mjs` must poll Ethereum receipts for submitted/done Ethereum
  dispatch results and fail with `receipt_verification_failed` when RPC does not observe the receipt
  or reports revert.
- `agent/src/local-dispatch-readiness.mjs` must create an Ethereum task-local dispatch-ready override
  only when the task account matches `SENTRY_ETHEREUM_WALLET_ADDRESS` / `SENTRY_ETHEREUM_OWNER`;
  missing env returns `ETHEREUM_WALLET_ADDRESS_REQUIRED`, mismatches return
  `ETHEREUM_LOCAL_ACCOUNT_MISMATCH`, and no raw secret-shaped fields may appear in the proof.
- `agent/src/local-signer-probe.mjs` must support Ethereum non-signing address proof from
  `SENTRY_ETHEREUM_SIGNER_ADDRESS` or `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND`, reject signer/task
  account mismatches with `ETHEREUM_SIGNER_ACCOUNT_MISMATCH`, avoid echoing command failure secrets,
  and let `local-dispatch-readiness` block only when `requireSignerProbe=true`.
- Dispatcher tests must prove an Ethereum swap task can complete a subprocess round trip without
  `allowPlanned` when `localDispatchReadyVenues=['ethereum-mainnet']`, and that mismatched quote id
  evidence is rejected.
- Ethereum remains non-global-dispatch-ready until Safe/session-key grant installation, calldata
  construction, simulation/signing handoff, account discovery, real signature probing and live-account
  dry-runs are implemented.

## 6. ExecutorAdapter Tests

### Registry

- `deepbook` 是唯一 MVP registered adapter。
- unknown `executor_kind` 返回 `UNSUPPORTED_EXECUTOR`。
- Runtime Core 只能通过 registry 获取 adapter，不能直接 import Deepbook execution path。

### ExecutionPlan conformance

- Deepbook adapter returns `executor_kind=deepbook`、`target_id=pool_id`、`quote_amount`、`estimated_slippage_bps`、`action_type=ACTION_DEEPBOOK_RESCUE`。
- Guardian sees the same `quote_amount` and `estimated_slippage_bps` that later appear in PTB arguments。
- Adapter preview lines include executor, pool, budget impact, slippage and expected event。

### PTB build

- Adapter build fails if plan target differs from Wrapper `pool_id`。
- Adapter build fails if plan action type differs from `ACTION_DEEPBOOK_RESCUE`。
- Adapter does not sign or submit; signing belongs to Runtime Core signer boundary。

## 7. Integration Tests

### Policy lifecycle

1. Deploy Move package to Sui Testnet.
2. Create Policy with test owner and agent.
3. Read MoveGate Mandate and SentryPolicyWrapper, then verify linked fields.
4. Revoke Policy.
5. Confirm subsequent `authorize_action` + trade record aborts.

### Agent autonomous execution

1. Create active Policy with sufficient Testnet budget（MoveGate Mandate + SentryPolicyWrapper）。
2. Activate Durable Object runtime.
3. In automated tests, use a dev-only mock price feed or `force_trigger=true` test hook to satisfy the trigger condition; natural market movement is not required.
4. Run agent tick.
5. Confirm Deepbook transaction digest exists.
6. Confirm `AgentTradeExecuted` event exists with correct `mandate_id` and `wrapper_id`.
7. Confirm `spent_amount` increased in SentryPolicyWrapper.
8. Confirm MoveGate ActionReceipt was created（`freeze_object`）。
9. Confirm MoveGate Mandate `spent_this_epoch` and `total_actions` updated.

Production-like e2e tests must not depend on `force_trigger=true`; they must use a controlled mock market provider in non-production or a real trigger condition.

### Guardian block

1. Create Policy with low max slippage.
2. Force estimated slippage above limit.
3. Run tick.
4. Confirm no Deepbook transaction submitted.
5. Confirm block reason is visible in activity.

### Revoke enforcement

1. Create active Policy.
2. Revoke as owner.
3. Run agent tick.
4. Confirm action is `stopped_revoked`.
5. Attempt direct `authorize_action` + `record_agent_trade` as agent.
6. Confirm chain abort.

### Concurrent policy isolation

1. Create 10 active policies with distinct owners and wrapper ids.
2. Activate 10 Durable Object runtimes.
3. Run one tick for each policy.
4. Confirm each runtime reads only its own mandate id, wrapper id, budget, market snapshot and last action.
5. Confirm creating an 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.

## 8. Browser QA

MVP desktop viewport:

- Dashboard loads without console errors.
- Login shows owner address.
- Intent input accepts the sample strategy.
- Preview panel shows all critical policy parameters.
- Confirm flow creates Policy and updates state.
- Activity view shows events and budget within one 5 second polling interval after chain state changes.
- Revoke button changes state to revoked within one 5 second polling interval.
- Primary buttons have text labels and disabled/loading states.

Post-MVP mobile viewport:

- Strategy input, preview, status, activity and revoke controls do not overlap.
- Long addresses and tx digests truncate or wrap cleanly.
- Primary actions remain reachable.

Post-MVP accessibility:

- Buttons have clear labels.
- Risk warnings are not color-only.
- Loading and error states are visible.
- All primary actions are reachable by Tab and activatable by keyboard.

Concurrency:

- MVP supports at most 10 active policies per deployment.
- Creating the 11th active policy returns `ACTIVE_POLICY_LIMIT_REACHED`.
- Ten active Durable Object instances must not leak runtime state into each other.

## 9. Demo Acceptance Script

The final demo must prove this exact sequence:

1. Start with no active Policy.
2. Login with zkLogin on Sui Testnet.
3. Enter: “当 SUI 下跌超过 8% 时启动 500 USDC 风险响应策略。”
4. Show structured strategy and PTB preview.
5. Show `executor_kind=deepbook` in structured strategy.
6. Confirm and create Policy.
7. Show mandate id, wrapper id and budget ceiling.
8. Let Cloud Agent tick execute one Deepbook Testnet trade; demo may use a dev-only manual trigger or mock price feed if the real 8% price drop is not happening.
9. Show transaction digest and `AgentTradeExecuted` event.
10. Revoke Policy from Dashboard.
11. Run or wait for another tick.
12. Show Agent cannot execute after revoke.

Passing criteria:

- At least one real Sui Testnet transaction is visible.
- At least one real Deepbook-related execution is visible, or a documented Testnet blocker is explicitly shown with fallback approved before demo.
- Revocation is visible both in UI and chain state.
- No step requires exposing a user private key to the Agent.
- The deployed agent address shown in preview matches the agent recorded in the Mandate and Wrapper.

## 10. Local Agent CLI and Worker Bridge Tests

These tests are not MVP gates, but they define the composability target.

- `sentry agent init` creates `~/.sentry`, local identity metadata, state DB and logs with strict file permissions.
- `sentry agent run` loads local agent config, starts loopback API and starts periodic ticks.
- `sentry agent status` shows agent id, bridge status, chain, registered adapters and watched policies.
- daemon uses the same Runtime Core and ExecutorAdapter registry as the optional Worker demo path.
- daemon refuses to run when the local agent address does not match the Policy Mandate agent.
- daemon writes local activity logs and can recover after restart without double-submitting an already confirmed action.
- `agent/src/local-activity-log.mjs` appends sanitized JSONL activity events, tails the newest events first, handles missing/corrupt log lines safely, and never writes or returns raw secret-shaped fields.
- `agent/src/local-policy-store.mjs` persists local policy metadata to `~/.sentry/policies.json` with `0600` permissions, rejects raw secret-shaped fields, validates target venues against the shared catalog, supports `sentry-daemon policy add/list/pause/resume/revoke`, and computes due policies for `policy tick` without executing orders.
- `agent/src/local-policy-task-planner.mjs` turns due policy `task_template(s)` into planned AgentTasks for OKX, Hyperliquid, Solana and Ethereum, requires local key/account metadata, blocks missing templates or missing key handles, rejects raw secret-shaped fields, and exposes `sentry-daemon policy plan` without dispatching.
- `agent/src/local-policy-runner.mjs` runs due planned tasks through local policy guard, blocks budget/agent/venue/action/capability violations before dispatch, supports `sentry-daemon policy run-once`, and only calls dispatcher when `--dispatch` is explicit and readiness/registered-agent resolution pass.
- `agent/src/local-policy-loop.mjs` manages periodic policy runs, rejects overlapping runs, exposes status/start/stop/run_now semantics, keeps last-run summaries and defaults to no dispatch.
- daemon supports external signer mode before any Mainnet policy is accepted.
- `sentry agent pair <pairing_code>` rejects expired, reused or owner-mismatched pairing codes.
- Worker stores only agent public key, owner binding, device metadata and capabilities after pairing.
- AgentSession Durable Object accepts a WebSocket only after a signed `hello` envelope validates.
- heartbeat marks an agent `online`, then `stale` after the configured heartbeat timeout, then `offline` after disconnect/expiry.
- Worker/DO deploy or WebSocket disconnect does not stop the local tick loop.
- reconnect sends last seen sequence and replays only non-expired queued commands.
- duplicate remote commands return the prior result by idempotency key.
- expired remote commands return `COMMAND_EXPIRED` and must not execute.
- remote `inventory.sync`, `policy.pause`, `policy.resume`, `policy.revoke` and `emergency.stop` commands produce `command_ack` and `command_result`.
- Worker bridge command records are bounded and pollable: after `POST /api/local-agents/:agent_id/commands`, `GET /api/local-agents/:agent_id/commands` lists safe command summaries, and `GET /api/local-agents/:agent_id/commands/:command_id` can resolve either command `message_id` or idempotency key after a daemon `command_result`.
- AgentSession command records must store only safe payload summaries and result metadata. They must not persist full AgentTask payloads, stdout/stderr logs, raw local DB rows, OWS tokens, wallet passphrases, private keys or exchange raw API secrets.
- remote `policy.local.list`, `policy.local.tick`, `policy.local.plan`, `policy.local.run_once` and `policy.local.loop.*` return local policy metadata, due-tick summaries, planned AgentTasks, guarded run-once results or loop state without raw secrets; `policy.local.tick mark=true` only advances local tick timestamps, `policy.local.plan` must not spawn an external Agent, and `policy.local.run_once` / `policy.local.loop.*` with `dispatch=true` still require local readiness plus a registered external Agent command.
- remote `secret.store`, `inventory.adapters` and `inventory.sync` commands return metadata only, never raw secrets.
- daemon `secret.store` and `inventory.sync` load local venue metadata from the configured venue file; missing OKX/Hyperliquid handles must surface as blocked inventory access, not silently fall back to demo keys.
- daemon `inventory.sync` with `payload.live=true` may perform an OKX read-only balance fetch only after local credential resolution succeeds; results must not include raw credential values.
- daemon `inventory.sync` with `payload.live=true` may perform Solana/Ethereum read-only RPC calls only after local wallet address env is configured; missing address must surface as blocked access without making a network call.
- remote `agent.start` launches the configured external Agent child process and relays bounded stdout/stderr as untrusted output.
- remote `agent.stop` terminates the external Agent child process without stopping the daemon bridge.
- remote `agent.dispatch` validates authorization, runs a one-task subprocess/stdio round trip and returns a sanitized AgentTaskResult; target venue execution remains blocked until adapter dispatch readiness is true.
- remote `activity.tail` returns bounded, sanitized local activity summaries and cannot reveal raw local secrets or arbitrary files.
- Worker command allowlist accepts `agent.registry`, `agent.probe`, `agent.dispatch`, `venue.catalog`, `authorization.registry`, `authorization.validate`, `secret.store`, `inventory.adapters`, `inventory.sync`, `signer.probe`, `activity.tail`, `policy.local.list`, `policy.local.tick`, `policy.local.plan`, `policy.local.run_once`, `policy.local.loop.status`, `policy.local.loop.start`, `policy.local.loop.stop`, `policy.local.loop.run_now`, `policy.pause`, `policy.resume` and `policy.revoke`, but rejects local-only credential storage, policy deployment/limit increases and withdrawal-like commands.
- remote commands never carry OWS token, wallet passphrase, private key, exchange raw API secret or full local DB rows.
- revoked pairing closes the bridge and daemon refuses future remote commands while allowing local-only status if configured.
- Worker compromised simulation cannot bypass local policy scope, credential scope, Guardian or owner approval checks.

## 11. Open Test Decisions

Before implementation starts, resolve and update `docs/03-technical-spec.md` if needed:

- Exact Sui Testnet pool id and coin decimals.
- Exact zkLogin SDK flow and test provider.
- Exact Deepbook call shape for the selected pool.
- Exact adapter package boundary between Worker and future CLI daemon.
- Exact Worker bridge pairing auth, relay token refresh and production AgentSession storage schema.
