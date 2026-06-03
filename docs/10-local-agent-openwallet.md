# Local Agent and Open Wallet Plan v0.1

状态:Planning
日期:2026-06-03
范围:把 Sentry 从 Cloud-first / hybrid 方向调整为 Local Agent-first

## 1. 结论

Open Wallet Standard(OWS)适合作为 Sentry Local Agent 的本地钱包签名层,但不能直接替代完整的 Sentry 本地运行时。

采用方式:

- 用 OWS 管理链上钱包:本地加密 vault、CAIP-2 / CAIP-10 账户、policy-gated signing、audit log、agent API token。
- 用 Sentry Local Agent 管理策略运行:tick loop、Guardian、venue adapters、资产归一化、交易所 API key、activity ledger。
- 用 Sentry 本地 secret store 管理 CEX / perps API key。不要把 OWS 的 agent API token 和交易所 API key 混为一类。
- 生产默认使用 Local Agent。Cloudflare Worker 保留为 Sui Testnet demo、远程只读面、或者可选的非托管 bridge/control plane。
- Local Agent daemon 主动连 Worker / Durable Object bridge;Worker 不主动连用户本机,也不保存本地 secrets。

OWS 是"怎么安全签名"的标准;Sentry 守护程序是"什么时候、在哪个 venue、以什么限制执行"的产品。守护程序不直接调用 OWS - OWS 由外部 Agent 使用。

## 2. 守护程序与 OWS 的关系

Sentry 守护程序不代理 OWS。它不持有 OWS token、不调用 OWS sign、不管理 OWS vault。

OWS 的使用者是**外部 Agent**(Claude Code、Codex、Kimi 等)。当守护程序分发任务给外部 Agent 时,外部 Agent 使用本机已配置的 OWS vault 完成签名。

守护程序对 OWS 的唯一交互:
- 通过 `sentry wallet link --ows <wallet>` 记录 OWS wallet reference(wallet id、CAIP accounts),用于 inventory 归集和 policy scope 校验。
- 不在本地存储 OWS token 或 passphrase。

## 2. OWS 适配点

OWS 文档当前提供了这些对 Sentry 有价值的能力:

- `~/.ows/` 本地 vault:wallets、keys、policies、logs 分目录,wallet/key 文件要求 600 权限,目录要求 700 权限。
- 钱包文件:加密 mnemonic 或 private key,支持多链账户派生,账户使用 CAIP 标识。
- API key 文件:OWS token 只显示一次,token scope 到 wallet ids 和 policy ids,agent 请求必须经过 policy 检查。
- 签名接口:`sign`、`signAndSend`、`signMessage`、`signTypedData`、`signHash` 等。
- Policy engine:owner passphrase 是 sudo 模式;`ows_key_...` agent token 必须执行 policy,且 policy 在解密 secret 前运行。
- Agent access profiles:in-process binding、local subprocess、local service 都可以,但必须保持 wallet lookup、policy order、error code、audit side effects 一致。
- Key isolation:当前模型是进程内 hardening + zeroize;文档也建议未来 per-request subprocess enclave,减少 agent 进程拿到解密 secret 的窗口。
- Supported chains:EVM、Solana、Bitcoin、Cosmos、Tron、TON、Sui、XRPL、Filecoin、NEAR 等链族,统一走 CAIP。

对 Sentry 的默认选择:

- Sentry 守护程序通过 loopback-only local API 展示 OWS wallet references,不代理签名请求。
- Dashboard 不直接调用 OWS 签名,不把 OWS token、passphrase、exchange API key 放进浏览器 localStorage。
- Sentry policy preview 展示 OWS wallet id、CAIP account、chain id、交易所 key scope - 这些由外部 Agent 在执行时使用。
- 所有本地签名和交易所私有 API 操作由外部 Agent 完成,写其自身的 audit log;守护程序汇总摘要进 Sentry activity log。

## 3. 不适合直接交给 OWS 的部分

### 交易所 API key

OWS 的 `ApiKey` 是访问本地钱包 secret 的 capability，不是 Binance / OKX / Hyperliquid API key。交易所 API key 由外部 Agent 直接通过 OS keychain/keyring 管理。

- `~/.sentry/venues.json`:只存 venue metadata、key handle、权限、IP allowlist 状态、subaccount id、能力矩阵,不存 raw secret。
- OS keychain / keyring:存 raw exchange secret、passphrase、refresh token。
- `~/.sentry/state/portfolio.sqlite` 或等价本地状态库:缓存 balances、positions、open orders、order fills、venue health、asset prices。
- `~/.sentry/logs/activity.jsonl`:记录 agent action、Guardian decision、order id、tx digest、API request summary、denial reason。

默认规则:

- 只接受 read + trade 权限。
- 拒绝 withdrawal 权限 key。
- 优先要求 subaccount。
- 支持 IP allowlist 检查。
- 支持 per-venue notional cap、daily loss cap、reduce-only mode。
- key rotation、disable、recheck scopes 必须是一等操作。

### 资产信息

Local Agent 需要一个统一 inventory layer,而不是让每个 adapter 临时读资产。

输入源:

- OWS wallets:CAIP-10 accounts、chain-native addresses。
- Chain RPC/indexer:balances、coin objects、policy objects、tx events。
- CEX private APIs:balances、positions、open orders、fills。
- Perps venues:margin balance、position legs、funding、liquidation price。
- Public market data:price、depth、funding、APY、oracle freshness。

输出模型:

```ts
type AssetPosition = {
  venue_id: string;
  account_ref: string;
  asset_id: string;          // CAIP asset id when possible
  symbol: string;
  free: string;
  locked: string;
  borrowed?: string;
  notional_usd: string;
  source: 'ows' | 'chain_rpc' | 'cex_api' | 'perps_api' | 'manual';
  observed_at: string;
  stale_after_ms: number;
};
```

Guardian 只消费这个归一化后的 inventory snapshot。

## 4. Agent 调度架构

```text
Dashboard
  -> localhost Sentry API (守护程序 loopback)
     -> Sentry Daemon
        -> PolicyManager / TickLoop / Guardian
        -> AgentRegistry / AgentDispatcher
           -> External Agent (Claude Code / Codex / Kimi ...)
              -> OWS signer (由外部 Agent 调用)
              -> OS keychain (由外部 Agent 读取)
              -> Venue APIs / chain RPCs (由外部 Agent 调用)
        -> InventoryStore
        -> ActivityWriter
        -> WorkerBridgeClient
           -> Cloudflare Worker / AgentSession Durable Object
```

核心进程:

- `sentry agent init`:初始化守护程序配置,生成 identity key(用于 Worker bridge 签名)。
- `sentry agent register <agent-type>`:注册外部 Agent(Claude Code / Codex / Kimi),验证可用性。
- `sentry agent pair <pairing-code>`:把本机守护程序与浏览器账户 / Worker AgentSession 配对。
- `sentry wallet link --ows <wallet>`:记录 OWS wallet reference(外部 Agent 执行时使用)。
- `sentry venue add binance`:记录 venue key handle + 权限(raw secret 存 OS keychain,外部 Agent 读取)。
- `sentry agent run`:启动守护程序 tick loop、loopback API、Agent 调度。
- `sentry agent disconnect`:撤销 Worker bridge session,守护程序仍可 local-only 运行。
- `sentry inventory sync`:通过外部 Agent 刷新资产快照,守护程序归一化后写 InventoryStore。
- `sentry policy deploy`:创建链上 policy 或 venue mandate。
- `sentry emergency-stop`:暂停守护程序调度;如有需要,通过外部 Agent 发送 revoke/cancel。

注意:`inventory sync` 实际上是守护程序分发 `check_health` 类型的 AgentTask 给外部 Agent,外部 Agent 读取链上/CEX 状态后回报。守护程序不直接调 chain RPC。

## 5. 需要改的文档（已完成 2026-06-03）

- `README.md`:改为 Agent dispatch platform;Worker 变成 Testnet demo / optional remote bridge。
- `docs/01-prd.md`:目标用户、MVP 成功标准、范围、用户流程改为 Agent dispatch 模型。
- `docs/02-architecture.md`:系统边界加入 Agent dispatch layer、外部 Agent、AgentSession DO;删除自执行 VenueAdapter。
- `docs/03-technical-spec.md`:增加 AgentTask/AgentTaskResult 类型定义;保留 SignerRouter 仅用于 demo path。
- `docs/11-local-agent-worker-bridge.md`:加 Agent dispatch protocol §5a;CLI 命令加 `sentry agent register`。
- `docs/06-post-mvp-multivenue-roadmap.md`:agent mode 从 cloud/local/hybrid 改为 Agent dispatch;CEX key 管理由外部 Agent 处理。
- `docs/09-market-product-and-frontend-roadmap.md`:把 Venue Accounts / Integrations 提升为 P0。
- `docs/STATUS.md`:更新为 Agent dispatch platform 方向。

## 6. 前端改动方向

P0:

- 默认运行模式改成 Local Agent。
- Profile / Wallet 页面加入 Local Agent control plane:OWS vault、exchange secret store、venue accounts、asset sources。
- New Strategy 的运行模式选择改成本地优先,Remote Worker 标记为 Testnet / optional。
- Runtime drawer 展示 OWS vault、local secret store、exchange API key scope。
- Risk Center 的 signer section 改成 Local OWS signer + Remote Worker optional。

P1:

- 新增 Venue Accounts 页面或把 Profile 拆成 Integrations 页面。
- CEX key add flow:权限检查、withdrawal disabled proof、IP allowlist 状态。
- Inventory sync panel:chain/CEX/perps 来源、staleness、last sync、blocked reason。
- Policy preview:展示会调用哪个 signer、哪个 exchange key handle、哪些资产快照会进入 Guardian。
- Local Agent bridge 状态:显示 paired / local-only / online / stale / offline / revoked,并把远程命令标记为 request,而不是云端直接执行。

## 7. 仍需验证

- OWS 当前实现是否已经支持 `sui:testnet` 或只内置 `sui:mainnet`。若只内置 mainnet,需要新增 Sui Testnet chain config / signer mapping。
- Node SDK 是 in-process NAPI;对长期 autonomous agent,最好用 local service 或 subprocess signer,避免 agent 主进程和解密 secret 长期共享地址空间。
- OWS 当前并不提供 per-wallet nonce manager。EVM / CEX adapters 需要 Sentry 自己处理 nonce、client order id、idempotency。
- OWS declarative policy 目前很窄。Sentry 的预算、slippage、venue caps、simulation、inventory constraints 需要 executable policies 或 Sentry Guardian 在 OWS 之外执行。
- Worker bridge 的 WebSocket 长连接需要处理 Cloudflare deploy/restart 造成的断线重连、command replay、sequence 和 idempotency。

## 8. 参考

- Open Wallet Standard overview:https://docs.openwallet.sh/
- OWS Storage Format:https://docs.openwallet.sh/doc.html?slug=01-storage-format
- OWS Signing Interface:https://docs.openwallet.sh/doc.html?slug=02-signing-interface
- OWS Policy Engine:https://docs.openwallet.sh/doc.html?slug=03-policy-engine
- OWS Agent Access Layer:https://docs.openwallet.sh/doc.html?slug=04-agent-access-layer
- OWS Key Isolation:https://docs.openwallet.sh/doc.html?slug=05-key-isolation
- OWS Wallet Lifecycle:https://docs.openwallet.sh/doc.html?slug=06-wallet-lifecycle
- OWS Supported Chains:https://docs.openwallet.sh/doc.html?slug=07-supported-chains
- Local Agent, CLI and Worker Bridge:./11-local-agent-worker-bridge.md
