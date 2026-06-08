# Authorization Adapter Model v0.1

状态:Planning
日期:2026-06-03
范围:Local Agent-first 架构下的链、钱包、交易所授权模型

## 1. 结论

OWS 适合作为本地钱包签名层,但不能替代每条链或每个 venue 的授权模型。

Sentry 需要一个显式的 `AuthorizationAdapter` 层:

- OWS 解决"本机怎样安全签名"。
- `AuthorizationAdapter` 解决"这个 Agent 凭什么权限能做这件事,权限在哪里被强制执行"。
- `ExecutorAdapter` 解决"在某个协议或 venue 上怎么把计划变成交易、订单或 API 请求"。

因此,不是所有链都必须先写 Sentry 自己的合约/program。默认顺序是:

1. 先使用链或 venue 已有的 delegation、account guard、smart account、session key、API key/subaccount 机制。
2. 这些机制无法表达预算、范围、过期、撤销或审计时,再写 Sentry 自己的合约/program。
3. OWS-only 可以用于本地 MVP、观察、低风险自用或人工确认流,但不能对外宣称"链上强约束"。

当前实现状态:`core/authorization.js` 已提供共享 registry skeleton、AgentTask preflight 校验和
metadata-only authorization state snapshot,并被 Worker `/api/authorization/registry` 与 daemon
`authorization.registry` / `authorization.validate` / `authorization.state` command 复用。daemon 还提供
online-only `authorization.revoke` 作为本地 metadata safety stop:它可以把 OKX/Hyperliquid key handle
或 OWS wallet ref 标记为本地 revoked,阻断后续本地 dispatch readiness。它只处理授权元数据、capability
scope、claim conformance 和本地 grant/read/revoke 可见状态,不保存或读取任何 secret,也不会创建或证明撤销了真实
venue/chain 授权。

## 2. 授权模型

```ts
type AuthorizationModel =
  | 'ows_policy_only'
  | 'native_delegation'
  | 'smart_account_module'
  | 'sentry_contract'
  | 'venue_api_key';

type EnforcementLayer = 'local' | 'chain' | 'venue' | 'hybrid';

type BudgetEnforcement =
  | 'none'
  | 'local_accounting'
  | 'chain_accounting'
  | 'custody'
  | 'venue_limit';

type AuthCapability =
  | 'read'
  | 'sign'
  | 'submit_tx'
  | 'place_order'
  | 'cancel_order'
  | 'transfer'
  | 'withdraw'
  | 'set_leverage'
  | 'settle';

type ConstraintSupport = {
  budget: 'none' | 'local' | 'chain' | 'venue';
  expiry: 'none' | 'local' | 'chain' | 'venue';
  revoke: 'none' | 'local' | 'chain' | 'venue';
  venue_scope: 'none' | 'local' | 'chain' | 'venue';
  audit_log: 'none' | 'local' | 'chain' | 'venue';
};
```

| Model | Enforcement | 用途 | 不能宣称 |
| --- | --- | --- | --- |
| `ows_policy_only` | local | OWS policy-gated signing、本地小额 MVP、人工确认 | 链上强约束、第三方可验证预算 |
| `native_delegation` | chain / venue | Solana token delegate、Cosmos authz、Hyperliquid agent wallet 等原生授权 | 超出原生授权表达能力的约束 |
| `smart_account_module` | chain | EVM Safe module、guard、ERC-4337/session key | 无合约模块时的链上预算强制 |
| `sentry_contract` | chain | Move/Anchor/Solidity 自定义策略合约或 program | 所有 venue 都天然需要 |
| `venue_api_key` | venue | CEX read + trade API key、subaccount、IP allowlist | 非托管链上执行、链上事件审计 |

## 3. 什么时候需要合约或 program

需要写 Sentry 自己的 Move/Anchor/Solidity 合约或 program,当且仅当目标产品承诺需要链上强制并且现有机制不够:

- 预算必须在链上递减,不能只靠本地日志。
- Agent 的可操作 protocol、pool、vault、asset 或 action type 必须被链上检查。
- 过期、撤销、emergency stop 必须在链上阻止后续交易。
- 需要链上事件、receipt 或第三方可验证审计。
- 多个 Agent 或多个进程会竞争同一个 policy state,必须用链上共享状态仲裁。
- 用户/合作方需要非托管、链上可验证的安全声明。

如果只是本地用户自用、人工确认、观察/预警、CEX 子账户内交易,或者 venue 本身已经提供足够的 delegation/subaccount 权限,就不应该先写自定义合约。

注意:链上预算记账不等于资金托管。`chain_accounting` 可以证明某个 policy 记录了多少授权金额,但不能证明真实资金不可能被绕过花掉。只有 `custody`、强 smart-account guard、原生 delegation 真实限制资金流,或 CEX/venue 自身的 `venue_limit`,才可以宣称真实资金爆炸半径被强制限制。

## 4. Per-Venue 默认策略

| Venue | 默认授权方式 | 是否需要 Sentry 合约/program |
| --- | --- | --- |
| Sui | 当前 demo: MoveGate Mandate + SentryPolicyWrapper 做授权/撤销/receipt/金额记账,OWS 负责本地签名 | 已有 Sui demo 是 `chain_accounting`,不是 custody;真实资金无人值守需 custody wrapper v2 或等价资金约束 |
| EVM | Safe module/guard、ERC-4337 session key、EIP-7702 授权账户 | 只有现有 smart account 不能表达约束时才写 |
| Solana | token delegate、PDA、Squads/Sigil、协议原生 delegation | 需要自定义共享状态、预算递减或 receipt 时写 Anchor program |
| Cosmos | authz、feegrant、链/模块原生授权 | 原生授权不足时再写模块/合约 |
| Bitcoin | PSBT、policy wallet、受限 UTXO、人工确认 | 不适合作为通用 autonomous account control |
| OKX | read + trade API key + subaccount + IP allowlist | 第一交易所目标;不写链上合约;绝不宣称链上强约束 |
| Hyperliquid | API wallet/agent wallet + subaccount/vault | 当前 perps/spot 目标;不写链上合约;按 venue 规则限制 |
| Binance | read + trade API key + subaccount + IP allowlist | 后续交易所候选;OKX 完成前不进入当前 target catalog |

当前代码状态:OKX 已有 read-only adapter、`place_order` AgentTask/result verifier、local
permission/IP allowlist metadata proof gate、order-status adapter 和 daemon dispatch receipt verifier
skeleton。daemon 可以在本机 metadata、IP allowlist 和 env/keychain 凭据都通过后,为当前 OKX
task 传入 `dispatch_ready_source='local_daemon'`;在 dispatch 路径上还可以默认执行一次 signed
OKX balance read,用 sanitized `live_read_proof` 证明该 key 当前能被 OKX 接受为 signed read。
但这仍只是 venue-enforced task/status schema + local credential-auth proof,不是完整 OKX
permission export、不是链上强约束,也不代表 Worker 全局 registry 已把 OKX 标为 ready。
`authorization.state` 可以读取 OKX metadata key handle、read scope、withdraw absence、IP allowlist
状态和本地 `rotation_state`,返回 `metadata_ready` / `partial` / `blocked` 等状态。过期 rotation
metadata 会阻断 dispatch,临近到期会成为 warning;但它不会读取 raw API secret 或调用 OKX 创建/撤销/
轮换 key。

Hyperliquid 已有 read-only `info` adapter、`place_order` AgentTask/result verifier skeleton、
local dispatch-readiness gate、local agent-wallet grant metadata proof、public `userRole` live grant
checker、pre-signed `/exchange` submit adapter、本地 nonce store、public `orderStatus` receipt verifier:
它能校验 `read` + `place_order`、拒绝 `withdraw`/`transfer`、要求 128-bit `cloid` 并验证订单
evidence,在本机 metadata + read address proof + active agent-wallet grant metadata 通过后为当前 task 传入
`dispatch_ready_source='local_daemon'`,可提交外部 Agent 生成的预签名 `/exchange` payload,默认
持久记录 `authorization_ref + nonce` 并阻断重复提交,且可用
`SENTRY_HYPERLIQUID_NONCE_STORE` 或 `--hyperliquid-nonce-store` 覆盖路径,并能在 dispatch
成功后按 `oid` / `cloid` 查询订单状态;daemon `agent.dispatch` 默认在 dispatch/receipt 前用
public `info.userRole` 确认 agent wallet 仍指向预期 master/subaccount;但还没有 daemon 内部签名、
live submit proof、完整 grant/revoke 管理 UI 或真实账户 dry-run。
因此 Hyperliquid 也不能进入 Worker 全局 `ready_for_dispatch`。
`authorization.state` 可以读取 Hyperliquid key handle、master/subaccount read address、agent wallet
address、本地 grant metadata 和 `rotation_state`,并把缺失 grant/read scope/no-transfer/过期 rotation
约束暴露成 access issue;它不会替用户创建 agent wallet、签署 exchange action 或完成 live grant
revoke / live key rotation。

Solana 已有 read-only RPC adapter、swap `submit_tx` AgentTask/result verifier skeleton、
metadata-only OWS wallet references、非签名 signer/address probe 和 `getSignatureStatuses` receipt
polling skeleton:它能校验本地 wallet address、`read/sign/submit_tx` scope、quote
id、mint/amount/slippage、待签 unsigned transaction + simulation evidence 和返回的
transaction signature evidence,可在 task owner 匹配
`SENTRY_SOLANA_WALLET_ADDRESS` / `SENTRY_SOLANA_OWNER` 或已链接 OWS
`solana:mainnet:<address>` wallet reference 时创建任务级 local dispatch-ready override,并可用
`SENTRY_SOLANA_SIGNER_ADDRESS` 或 `SENTRY_SOLANA_SIGNER_PROBE_COMMAND` 做独立的非签名地址证明,
可通过 `sentry-daemon solana prepare-swap` 调 Jupiter quote/swap 生成待签 unsigned transaction,
可通过 `SENTRY_SOLANA_SIGNER_COMMAND` 或 `--solana-signer-cmd` 把 accepted `proposed` 结果交给
本地 signer command,再在 dispatch 后通过 RPC 观察 signature status;但还没有 native delegation
grant/read/revoke、OWS signing/API token handoff、真实 signer probing、Raydium/Orca transaction
builder 或真实账户 dry-run。因此 Solana 也不能进入 Worker 全局
`ready_for_dispatch`。
`authorization.state` 可以读取 OWS wallet ref 中的 `solana:mainnet` account metadata,确认本地
`read/sign/submit_tx` capability,并显式返回 `NATIVE_DELEGATION_GRANT_NOT_INSTALLED` planned issue;
这表示目前只有本地 wallet metadata,还没有 Solana native delegation grant/read/revoke。

Ethereum 已有 read-only RPC adapter、swap `submit_tx` AgentTask/result verifier skeleton、
metadata-only OWS wallet references、非签名 signer/address probe 和 `eth_getTransactionReceipt`
receipt polling skeleton:它能校验本地
wallet/smart-account address、`read/sign/submit_tx` scope、quote id、ERC-20 token/amount/slippage 和
待签 EVM transaction request + simulation evidence、返回的 EVM transaction hash evidence,可在 task account 匹配
`SENTRY_ETHEREUM_WALLET_ADDRESS` / `SENTRY_ETHEREUM_OWNER` 或已链接 OWS
`eip155:1:<address>` wallet reference 时创建任务级 local dispatch-ready override,并可用
`SENTRY_ETHEREUM_SIGNER_ADDRESS` 或 `SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND` 做独立的非签名
地址证明,可通过 `sentry-daemon ethereum prepare-swap` 生成 Uniswap V3 exactInputSingle calldata,
可通过 `SENTRY_ETHEREUM_SIGNER_COMMAND` 或 `--ethereum-signer-cmd` 把 accepted `proposed` 结果交给
本地 signer command,再在 dispatch 后通过 RPC 观察 matching receipt;但还没有 Safe/session-key
grant/read/revoke、OWS signing/API token handoff、真实 signer probing 或真实账户 dry-run。因此
Ethereum 也不能进入 Worker 全局 `ready_for_dispatch`。
`authorization.state` 可以读取 OWS wallet ref 中的 `eip155:1` account metadata,确认本地
`read/sign/submit_tx` capability,并显式返回 `SMART_ACCOUNT_GRANT_NOT_INSTALLED` planned issue;这表示
目前只有本地 wallet metadata,还没有 Safe/session-key/smart-account grant/read/revoke。

## 5. AuthorizationAdapter 接口

```ts
type AuthorizationRef = {
  id: string;
  venue_account_id: string;
  authorization_model: AuthorizationModel;
  enforcement_layer: EnforcementLayer;
  capabilities: AuthCapability[];
  constraint_support: ConstraintSupport;
  chain_enforced: boolean;
  budget_enforcement: BudgetEnforcement;
  funds_custodied: boolean;
  ref: string; // wrapper id, safe address, delegate id, api key handle, OWS wallet id
};

type AuthorizationPreview = {
  authorization_ref: AuthorizationRef;
  human_summary: string[];
  warnings: string[];
  requires_owner_signature: boolean;
  requires_contract_deploy: boolean;
  must_not_claim_chain_enforced: boolean;
};

interface AuthorizationAdapter {
  kind: AuthorizationModel;
  venue_id: string;
  describe(account: VenueAccount): AuthorizationRef;
  previewGrant(input: StrategyMandateV2): Promise<AuthorizationPreview>;
  validateTask(task: AgentTask): Promise<AuthValidationResult>;
  buildGrant?(input: StrategyMandateV2, signer: SignerRef): Promise<AuthorizationRef>;
  revoke(ref: AuthorizationRef): Promise<RevokeResult>;
  readState(ref: AuthorizationRef): Promise<AuthorizationState>;
}
```

当前代码没有逐 venue class 形式的 adapter 实例,而是先落成共享函数
`buildAuthorizationStateSnapshot({ secretStore, walletStore, scope })`:daemon `authorization.state`
加载本机 `~/.sentry/venues.json` 和 `~/.sentry/wallets.json`,返回 sanitized state snapshot 给 Worker /
Dashboard。这个 read-state surface 是为了让前端和 operator 看清楚"已有 metadata / 还缺 grant /
能否撤销",不是 grant builder,也不是 production dispatch enablement。

daemon `authorization.revoke` 目前只做本地 metadata revoke:OKX/Hyperliquid key handle 会被标记
`status='revoked'` 并移除 trade permissions;Hyperliquid agent-wallet grant metadata 同步标记 revoked;
OWS wallet ref 会被标记 `status='revoked'` 并移除 `sign/submit_tx` capability。这会让后续
`authorization.state` 和 local dispatch readiness 变成 blocked,但结果必须返回
`live_authority_revoked=false`。真实 OKX key revoke、Hyperliquid agent-wallet revoke、Solana
delegation revoke 或 Ethereum Safe/session-key revoke 仍是后续 per-venue adapter 工作。

daemon `venue rotate --confirm` 只更新本地 key metadata 的 `rotated_at` / `rotation_reason`,用于
让 `authorization.state` 和 dispatch readiness 计算 rotation proof。它必须在 operator 已经于 OKX /
Hyperliquid 外部完成真实 key material 轮换后使用;当前没有 live venue rotation API。

Rules:

- 每个 `VenueAccount` 必须声明 `authorization_model`、`enforcement_layer`、`constraint_support` 和 `chain_enforced`。
- 每个 `AgentTask` 必须带 `authorization_ref` 和 enforcement metadata。
- `chain_enforced=true` 只能用于 `sentry_contract`、`smart_account_module` 或足够强的 `native_delegation`,但它不自动代表资金被托管。
- `budget_enforcement='chain_accounting'` 只能说链上记录和限制授权金额;不能说真实资金流不可超额。
- 只有 `budget_enforcement='custody'`、强 smart account/native delegation 资金约束,或 `venue_limit`,才可以在 UI 中宣称真实资金爆炸半径被强制限制。
- `ows_policy_only` 的 `enforcement_layer` 必须是 `local`,并且 `must_not_claim_chain_enforced=true`。
- `venue_api_key` 的 `enforcement_layer` 必须是 `venue` 或 `hybrid`,withdraw 默认不在 capabilities 内。
- `AuthorizationAdapter` 只描述和校验权限;具体交易/订单构建仍属于 `ExecutorAdapter` 或外部 Agent 工具链。

### Sui 当前状态

当前 Sui demo 的正确标签:

- `authorization_model='sentry_contract'`
- `enforcement_layer='chain'`
- `chain_enforced=true`
- `budget_enforcement='chain_accounting'`
- `funds_custodied=false`

它强制的是:agent、revoked/expired、protocol/action/coin allowlist、每次授权 amount、daily limit、wrapper pool/slippage/recorded budget 和 ActionReceipt。它不强制的是:真实 DeepBook BalanceManager 资金必须来自 wrapper,也不证明 `base_amount_received` 是真实 fill。无人值守真实资金版本必须升级到 custody wrapper v2、smart account guard 或 venue-native 资金约束。

## 6. AgentTask 要求

```ts
type AgentTaskAuthorization = {
  authorization_ref: string;
  authorization_model: AuthorizationModel;
  enforcement_layer: EnforcementLayer;
  chain_enforced: boolean;
  budget_enforcement: BudgetEnforcement;
  funds_custodied: boolean;
  capabilities_required: AuthCapability[];
  constraint_support: ConstraintSupport;
  must_not_claim_chain_enforced: boolean;
};
```

AgentTask 缺少授权信息时,守护程序必须拒绝调度。外部 Agent 返回结果后,守护程序还必须按授权模型验证:

- 链上交易:读取 tx digest、event/receipt、policy state。
- OKX/CEX/Hyperliquid:读取订单状态、subaccount、API key permission proof。
- OWS-only:读取本地 OWS audit summary 和 Sentry local activity log,但记录为 local enforcement。

## 7. 前端展示规则

Dashboard 必须把授权边界说清楚:

- Chain-enforced:显示 policy contract/module/delegation ref、revoke path、receipt/event。
- Chain-accounting:显示链上授权金额/receipt,并明确"不是资金托管"。
- Custody-enforced:只有在 `funds_custodied=true` 或等价资金约束存在时显示真实资金限额。
- Local-enforced:显示 OWS policy、local daemon、需要本机在线、不是链上强约束。
- Venue-enforced:显示 subaccount/API key scope、withdraw disabled、IP allowlist、venue audit ref。
- Hybrid:同时显示链/venue 约束和本地 Guardian 约束。

UI copy 禁止把 `ows_policy_only` 或 `venue_api_key` 包装成链上非托管强约束。

## 8. Stop Conditions

停止实现并重新设计,如果:

- 某个 adapter 声称 `chain_enforced=true`,但没有链上合约、account guard、native delegation 或可验证 receipt。
- 某个 adapter 声称真实资金不可超额,但 `budget_enforcement` 只是 `chain_accounting` 或 `local_accounting`。
- CEX 正常交易策略需要 withdrawal 权限。
- 外部 Agent 需要 raw OWS token、wallet passphrase 或 exchange raw secret 才能完成任务。
- AgentTask 没有携带授权引用和约束来源。
- 前端无法向用户解释权限在哪里被执行、如何撤销、失败后如何审计。
