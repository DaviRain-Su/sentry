# Sentry Post-MVP Multivenue Roadmap v0.1

状态：Planning
日期：2026-06-02
范围：Post-hackathon / production expansion

## 1. Scope Guardrails

This roadmap does not change the hackathon MVP.

Verified Sui Testnet scope remains:

- Sui Testnet only.
- MoveGate Mandate + SentryPolicyWrapper.
- Deepbook as the only live executor adapter.
- Worker demo path with Local Agent production direction.
- No mainnet funds, no CEX custody, no multi-chain arbitrage promise.

The long-term product can become a cross-chain, cross-venue autonomous execution network, but it must be built as a separate expansion layer. The safe framing is:

> Sentry is a unified control plane for policy-constrained autonomous execution across venue-specific accounts.

Current production target slice:

- Solana chain integration through native delegation, delegated PDA, Sigil/Squads-style guardrails or OWS-mediated local signing.
- Ethereum chain integration through Safe/account-abstraction module, guard or session-key constraints.
- Hyperliquid perps/spot venue integration through API wallet / agent wallet, subaccount/vault scope and venue-side order controls.
- OKX as the first exchange integration through read + trade API key, subaccount, IP allowlist and venue-side limits.
- Sui Testnet remains the verified demo path, not part of the production target count.

It is not:

- one universal wallet that magically holds all assets everywhere;
- a bridge itself;
- a custody layer for user funds;
- a promise of atomic arbitrage across chains, CEXs and perps venues.

## 2. Core Thesis

The product should unify strategy, policy, risk and execution interfaces, not force every chain and exchange into one account model.

Users should see one Sentry Account, but internally it maps to many venue-specific accounts:

```text
SentryAccount
  owner identities
    wallet / passkey / oauth / hardware signer
  agent modes
    local daemon first / optional Worker bridge
  venue accounts
    sui policy object
    solana delegated account
    ethereum smart account
    hyperliquid api wallet + subaccount
    okx trade-only api key + subaccount
  local custody services
    OWS wallet vault
    Sentry secret store
    normalized inventory store
    Worker bridge client
  strategy mandates
    risk response / DCA / grid / hedge / rebalance / arbitrage
  activity ledger
    on-chain events / exchange order ids / bridge status / runtime logs
```

The product value is a consistent operator experience:

- one portfolio view;
- one policy language;
- one Guardian risk engine;
- one activity trail;
- one emergency stop surface;
- venue-specific execution and settlement behind adapters.
- local-first wallet signing and exchange key management.

## 3. Account Model

### Sentry Account

The Sentry Account is a control-plane identity. It owns metadata, strategy mandates, risk preferences, linked venue accounts and audit history. It is not the canonical custody address for every asset.

Required fields:

- `account_id`
- `owner_identities`
- `agent_modes`
- `venue_accounts`
- `mandates`
- `global_risk_limits`
- `emergency_state`
- `local_vault_refs`
- `inventory_sources`

### VenueAccount

Every execution venue must be represented explicitly.

```ts
type VenueAccount = {
  id: string;
  venue_kind: 'chain' | 'dex' | 'perps' | 'cex' | 'bridge';
  venue_id: string;              // sui:testnet, solana:mainnet, eip155:1, hyperliquid, okx
  custody_model: 'self_custody' | 'smart_account' | 'subaccount' | 'api_key' | 'vault';
  authority_model: string;       // MoveGate, Safe module, Solana delegate, Hyperliquid agent wallet, OKX trade key
  authorization_model: AuthorizationModel;
  enforcement_layer: 'local' | 'chain' | 'venue' | 'hybrid';
  authorization_ref?: string;    // wrapper id, safe address, delegate id, API key handle, OWS wallet id
  constraint_support: ConstraintSupport;
  chain_enforced: boolean;
  budget_enforcement: BudgetEnforcement;
  funds_custodied: boolean;
  owner_address?: string;
  agent_address?: string;
  account_ref?: string;          // wrapper id, safe address, subaccount id, API key handle
  capabilities: string[];
  limits: RiskLimits;
  status: 'active' | 'paused' | 'revoked' | 'expired' | 'needs_reauth';
};
```

### Why Venue-Specific Accounts Are Required

Different venues enforce authority differently:

- Sui can enforce budget, pool and revocation through Move objects and PTBs.
- EVM can enforce execution through smart accounts, modules, guards and ERC-4337/EIP-7702 style account abstraction.
- Solana can use protocol-level delegation, PDAs or app-specific programs.
- Hyperliquid has API wallets / agent wallets, subaccounts, vaults and venue-side order controls.
- OKX uses API key permissions, subaccounts, IP allowlists and venue limits; there is no chain-enforced policy object.

Local Agent is the place where these differences are managed. OWS can normalize chain wallet signing, but it does not manage exchange API keys or venue subaccount semantics.

A single abstraction must expose these differences instead of hiding them.

### AuthorizationAdapter Matrix

Authorization is a separate adapter layer from execution.

| Venue family | Default authorization model | Enforcement layer | Contract/program decision |
| --- | --- | --- | --- |
| Sui | `sentry_contract` through MoveGate + SentryPolicyWrapper | chain | Current demo is chain-authorized accounting, not custody; unattended real funds require custody wrapper v2 or equivalent |
| EVM | `smart_account_module` through Safe module/guard or account abstraction session key | chain / hybrid | Write custom Solidity only if account modules cannot express constraints |
| Solana | `native_delegation` through token delegate, PDA/Sigil/Squads or protocol delegation | chain / hybrid | Write Anchor only when strategy needs shared state, budget decrement or receipt not available natively |
| Cosmos | `native_delegation` through authz/feegrant where available | chain / hybrid | Write chain-specific module/contract only if native grants are insufficient |
| Hyperliquid | `native_delegation` / `venue_api_key` through agent wallet and subaccount | venue | Target perps/spot venue; no Sentry chain contract; rely on venue scope plus local Guardian |
| OKX | `venue_api_key` through read + trade API key, subaccount and IP allowlist | venue | First exchange target; no chain contract; never claim chain-enforced safety |
| Binance | `venue_api_key` through read + trade API key, subaccount and IP allowlist | venue | Later exchange candidate, not in the current target slice |
| OWS local wallet only | `ows_policy_only` | local | No chain claim; suitable for local MVP, manual confirmation and low-risk flows |

Product rule:

- Use existing chain/venue authorization first.
- Build Sentry contracts/programs only when the product requires chain-enforced budget, scope, expiry, revoke or audit that existing primitives cannot provide.
- Distinguish chain accounting from custody. A receipt-backed accounting wrapper is not enough to claim real funds cannot exceed policy budget.
- UI must show local, chain, venue or hybrid enforcement explicitly.

## 4. Three Planes

### Control Plane

Owns user-facing product state:

- Sentry Account.
- StrategyMandate lifecycle.
- Global and per-venue limits.
- Guardian decisions.
- Emergency stop.
- Activity ledger.
- Human-readable previews.

Control Plane does not directly bypass venue constraints.

### Execution Plane

One adapter per venue/protocol:

- `sui-deepbook`
- `sui-cetus`
- `sui-scallop`
- `solana-raydium`
- `solana-jupiter-trigger`
- `ethereum-safe`
- `ethereum-uniswap`
- `hyperliquid-perps`
- `okx`
- `binance` (later candidate)

Each adapter must implement:

```ts
interface VenueExecutorAdapter {
  kind: string;
  readState(account: VenueAccount): Promise<VenueState>;
  planExecution(input: StrategyMandate, state: VenueState): Promise<ExecutionPlan>;
  preview(plan: ExecutionPlan): Promise<HumanPreview>;
  simulateOrPrecheck(plan: ExecutionPlan): Promise<PrecheckResult>;
  execute(plan: ExecutionPlan, signer: SignerRef): Promise<ExecutionResult>;
  parseResult(result: ExecutionResult): Promise<ActivityEvent[]>;
}
```

Execution adapters never own policy decisions or authorization claims. They propose plans; Guardian approves or blocks; AuthorizationAdapter proves the authority and enforcement layer.

### Settlement and Rebalancing Plane

Moves inventory between venues when needed:

- same-chain swaps;
- cross-chain swaps;
- bridge transfers;
- CEX deposit/withdraw flows;
- Hyperliquid spot/perp transfers;
- portfolio rebalancing.

Settlement must be modeled as a saga, not a guaranteed atomic transaction. Cross-chain and CEX flows can partially complete.

## 5. Bridge and Routing Providers

Bridge providers should be integrated as settlement adapters, not as policy engines.

### LI.FI

Verified role:

- routing and execution layer for on-chain liquidity;
- same-chain swaps;
- cross-chain swaps and bridging;
- cross-chain contract calls;
- multi-step flows such as bridge -> swap -> zap -> deposit;
- documented AI-agent integration flow with quote, status, chains, tokens and tools endpoints;
- supports EVM, Solana, Bitcoin and Sui coverage according to current docs.

Fit for Sentry:

- route discovery for rebalancing;
- quote and status tracking;
- fallback routing;
- token/chain normalization;
- agent-facing API or MCP/CLI path.

Non-fit:

- not a substitute for Sentry policy;
- not sufficient for CEX withdrawal safety;
- not a guarantee that cross-venue arbitrage is atomic or risk-free.

### deBridge

Verified role:

- non-custodial same-chain and cross-chain execution layer;
- 0-TVL architecture with solver-provided liquidity;
- DLN order creation and fulfillment;
- cancel and reclaim path for unfulfilled orders;
- hooks for post-swap destination-chain contract calls;
- cross-chain messaging and workflows.

Fit for Sentry:

- cross-chain rebalancing;
- onboarding assets from one chain into another venue;
- bridge + destination action workflows;
- recovery-aware settlement states.

Non-fit:

- not the source of truth for user strategy limits;
- not an all-venue inventory manager;
- not a latency-arbitrage primitive across CEX and on-chain venues.

### Provider Abstraction

```ts
interface SettlementAdapter {
  provider: 'lifi' | 'debridge' | 'native-cex-transfer' | 'hyperliquid-transfer';
  quote(intent: SettlementIntent): Promise<SettlementQuote[]>;
  precheck(quote: SettlementQuote): Promise<SettlementPrecheck>;
  buildOrExecute(quote: SettlementQuote, signer: SignerRef): Promise<SettlementResult>;
  track(result: SettlementResult): Promise<SettlementStatus>;
  recover(status: SettlementStatus): Promise<RecoveryAction[]>;
}
```

Provider choice is a routing decision. Guardian still owns the product-level decision.

## 6. CEX and Later Perps Venues

### OKX First

OKX is the first exchange target. CEX adapters are useful but have weaker enforcement than chain-native policies.

Current implementation status: OKX has read-only balance request signing/normalization and a
`place_order` AgentTask/result verifier plus order-status adapter, local permission/IP allowlist
proof gate, local rotation proof, signed live-read credential proof, local daemon dispatch-ready
override and daemon receipt verifier skeleton. It is still not globally dispatch-ready in the Worker
registry; complete permission enumeration, live key revoke, live venue rotation and production UI
wiring remain pending.

Default safety model:

- use subaccounts where possible;
- use trade-only API keys;
- disable withdrawals by default;
- require IP allow-listing;
- cap daily notional and per-order notional in Sentry;
- store raw keys in OS keychain / keyring through the Sentry Local Agent;
- store only key handles, permissions, subaccount ids and rotation metadata in `~/.sentry`;
- keep OWS wallet tokens separate from exchange API keys;
- never claim chain-enforced non-custodial guarantees for CEX balances.

Allowed autonomous actions by default:

- read balances and positions;
- place/cancel/amend orders;
- manage TP/SL where supported;
- close/reduce risk;
- no withdrawals without explicit user confirmation or a separate high-risk mandate.

### Binance Later Candidate

Binance remains a later exchange candidate. It should not appear in the current target venue catalog until OKX read-only, trade-only, key-scope validation and activity evidence are working.

### Hyperliquid Target Venue

Hyperliquid is part of the current target slice because it already has primitives close to the Sentry model:

- API wallets / agent wallets;
- subaccounts and vaults;
- order, cancel, modify, trigger, TP/SL and TWAP actions;
- leverage and isolated margin updates;
- `expiresAfter` for stale-action rejection;
- agent-signed transfers between certain internal balance classes.

Fit for Sentry:

- first perps venue adapter;

Current implementation status: Hyperliquid has read-only account/position/open-order sync and a
`place_order` AgentTask/result verifier skeleton with `cloid` idempotency and no-withdraw/no-transfer
scope checks. Read-only `info` calls now have bounded retry/backoff for HTTP 429 / 5xx, and daemon
local readiness can approve a task-local dispatch override after metadata/read-address proof.
The daemon can submit external-Agent-produced pre-signed `/exchange` payloads, then receipt
verification can query public `orderStatus` by `oid` / `cloid` after dispatch. Nonce manager
hardening has started with a local persistent `authorization_ref + nonce` store. Local agent-wallet
grant metadata proof is now required before dispatch, and daemon `agent.dispatch` defaults to a
public `info.userRole` live check that confirms the agent wallet is still linked to the expected
master/subaccount before dispatch and receipt verification. Live-account dry-runs, live submit
verification and production UI wiring are still pending.
- strategy templates for reduce-only de-risking, TP/SL repair, TWAP unwind and basis monitoring;
- subaccount-per-strategy isolation.

Open risks:

- nonce management across agent wallets;
- liquidation/risk engine semantics;
- agent wallet revocation and replacement UX;
- clear separation between trade authority and withdrawal/transfer authority.

## 7. Cross-Venue Strategies

### Inventory Rebalancing

Most realistic first multivenue use case.

Example:

```text
If Solana USDC inventory < 20% target and Ethereum USDC inventory > 40% target:
  quote LI.FI/deBridge routes
  enforce max bridge fee and max ETA
  bridge limited amount
  track status
  resume Solana policy only after destination funds settle
```

This is not latency-sensitive. It is suitable for bridge providers.

### Risk Rescue Across Venues

Example:

```text
If Solana collateral drops and Hyperliquid hedge inventory is available:
  reduce Solana risk if local inventory exists
  otherwise place small reduce-only hedge on Hyperliquid subaccount
  do not bridge during the emergency path unless explicitly allowed
```

Emergency risk response should prefer pre-funded inventory over cross-chain movement.

### Cross-Venue Arbitrage

Possible, but should be late-stage.

Constraints:

- atomicity is usually unavailable across CEX, bridges and chains;
- bridge latency can erase edge;
- CEX withdrawal and deposit delays break fast loops;
- exchange API/rate limits create execution risk;
- strategy must tolerate partial fills and stranded inventory.

Arbitrage should start as:

- monitoring and alerting;
- paper trading;
- tiny-size inventory-based execution;
- no bridge in the hot path.

### CEX to On-Chain Settlement

CEX withdrawal automation is high risk.

Default product rule:

- CEX adapters can trade autonomously inside a subaccount.
- CEX withdrawals require explicit user confirmation unless the user creates a separate high-risk settlement mandate.
- Even when withdrawals are allowed, Sentry must cap amount, destination, asset and frequency.

## 8. StrategyMandate v2

The current MVP strategy shape is Sui-specific. A multivenue strategy should become:

```ts
type StrategyMandateV2 = {
  version: '2';
  owner_account_id: string;
  strategy_type: 'risk_response' | 'dca' | 'grid' | 'hedge' | 'rebalance' | 'arbitrage';
  venue_scope: VenueScope[];
  authorization_refs: string[];
  settlement_scope?: SettlementScope;
  budget: {
    asset: string;
    max_notional_usd: string;
    per_venue_caps: Record<string, string>;
    per_action_cap: string;
  };
  risk: {
    max_slippage_bps: number;
    max_bridge_fee_bps?: number;
    max_bridge_eta_seconds?: number;
    max_leverage?: string;
    reduce_only_required?: boolean;
  };
  execution: {
    allowed_actions: string[];
    requires_human_for: string[];
    mode: 'cloud' | 'local' | 'hybrid';
  };
  expiry: {
    expires_at_ms: number;
  };
  hash: string;
};
```

`venue_scope` says where the agent can act. `settlement_scope` says whether the agent can move funds between venues.

## 9. Guardian v2 Invariants

These checks must apply before any adapter signs or submits:

1. Venue is in mandate scope.
2. Action type is allowed.
3. Asset is allowed.
4. Destination address/account is allowed for settlement.
5. Amount is within per-action and cumulative budget.
6. Slippage and price impact are within limits.
7. Bridge fee and ETA are within limits.
8. Leverage and liquidation risk remain within limits.
9. CEX withdrawal is blocked unless explicitly allowed.
10. Plan has a recovery path for partial completion.

For on-chain venues, mirror as many checks as possible in smart contracts, account guards, session keys or native delegation.

For CEX venues, checks are off-chain and must be presented honestly as backend/local-daemon enforcement.

## 10. Activity Ledger

The activity model must support mixed evidence sources:

- on-chain transaction hash;
- Move event;
- EVM event/log;
- Solana signature;
- Hyperliquid order id / cloid / action hash;
- CEX order id;
- bridge order id;
- quote id;
- status polling history;
- local daemon log hash.

Every event should include:

```ts
type ActivityEventV2 = {
  account_id: string;
  mandate_hash: string;
  venue_id: string;
  action_kind: string;
  status: 'planned' | 'blocked' | 'submitted' | 'partial' | 'done' | 'failed' | 'recoverable';
  evidence: EvidenceRef[];
  amount?: string;
  asset?: string;
  reason?: string;
  created_at_ms: number;
};
```

## 11. Product Stages

### Stage 0 - Hackathon

Sui Testnet only. No change to current MVP.

### Stage 1 - Sui Mainnet-Ready Architecture

- Extract Runtime Core package.
- Add adapter conformance tests.
- Add Local Agent daemon.
- Add Worker bridge pairing, heartbeat and AgentSession Durable Object status relay.
- Add Sui protocol adapters after Deepbook.

### Stage 2 - OKX Exchange Adapter

- OKX read-only account and balance adapter is started; order-status request signing and normalization are started.
- OKX `place_order` AgentTask schema, `clOrdId` idempotency, local permission/IP allowlist/rotation proof gate, signed live-read proof, local dispatch-ready override, result/status verifier, daemon receipt verifier and bounded retry/backoff are started; production trade adapter still needs complete permission enumeration, live key revoke, live venue rotation and UI wiring.
- Subaccount-first setup UX.
- No autonomous withdrawals.

### Stage 3 - Solana, Ethereum and Hyperliquid Adapters

- Solana delegated/Raydium or Jupiter adapter. Current code has read-only inventory plus a swap
  `submit_tx` AgentTask/result verifier skeleton with quote id, prepared unsigned transaction,
  simulation and signature evidence checks, env-or-OWS-account local dispatch-ready gate and
  mock-tested `getSignatureStatuses` receipt polling with bounded JSON-RPC retry/backoff. It also
  has non-signing signer/address probe and a mock-tested Jupiter quote/swap unsigned transaction builder exposed through
  `sentry-daemon solana prepare-swap`, plus local signer command handoff for accepted `proposed`
  unsigned transactions; it still needs OWS signing/API-token handoff, Raydium/Orca builders, real
  signature probing and live-account dry-runs.
- Ethereum Safe/account-abstraction and Uniswap adapter. Current code has read-only inventory plus a
  swap `submit_tx` AgentTask/result verifier skeleton with quote id, chain id, prepared EVM
  transaction request, simulation and EVM tx-hash evidence checks, env-or-OWS-account local
  dispatch-ready gate plus mock-tested `eth_getTransactionReceipt` polling with bounded JSON-RPC
  retry/backoff. It also has non-signing signer/address probe and a mock-tested Uniswap V3 `exactInputSingle` calldata builder exposed
  through `sentry-daemon ethereum prepare-swap`, plus local signer command handoff for accepted
  `proposed` transaction requests; it still needs Safe/session-key grant installation, OWS
  signing/API-token handoff, real signature probing and live-account dry-runs.
- Hyperliquid API wallet / agent wallet, subaccount/vault scope and nonce/idempotency adapter. Task/result schema, local dispatch-ready gate, local agent-wallet grant metadata proof, public `userRole` live grant check, pre-signed `/exchange` submit adapter, default local nonce store, `cloid` verifier and public `orderStatus` receipt verifier are started; UI wiring, live-account dry-runs and live submit verification remain.
- Chain/venue-specific policy enforcement feasibility notes.
- Custom Solidity/Anchor only after proving native delegation or account modules cannot satisfy Sentry constraints.

### Stage 4 - Settlement Adapters

- LI.FI route/status adapter.
- deBridge DLN route/status/recovery adapter.
- Portfolio inventory target model.
- Manual-confirm settlement first.

### Stage 5 - Later Extra Exchanges

- Binance read-only, then trade-only adapter.
- Venue-specific emergency-stop propagation for perps and exchange subaccounts.

### Stage 6 - Cross-Venue Strategies

- Inventory rebalancing.
- Hedge repair.
- Tiny-size basis and arbitrage experiments.
- Bridge only for rebalance, not hot-path arbitrage.

## 12. Open Research Questions

- Which provider should be the primary bridge router per chain pair: LI.FI, deBridge or direct protocol integration?
- What is the minimum safe local signer architecture for CEX keys?
- Should Sentry run one agent key per strategy, per venue account, or per execution process?
- How should global emergency stop propagate to OKX subaccounts and later perps/exchange venues?
- Can EVM account guards express enough constraints for strategy mandates without making accounts unrecoverable?
- Should settlement mandates be separate from trading mandates by default?
- What evidence format is sufficient for CEX orders where no public chain event exists?

## 13. Stop Conditions

Stop and redesign if:

- a provider requires custody of user funds outside the venue account model;
- a bridge route has no recoverable failure state;
- CEX execution requires withdraw permission for a normal trading strategy;
- an adapter cannot produce a Guardian-readable `ExecutionPlan` before signing;
- an AuthorizationAdapter claims `chain_enforced=true` without a chain contract, account module, native delegation or verifiable receipt path;
- UI or docs claim real-fund overrun is impossible while the venue only has accounting metadata and no custody/native spending guard;
- a strategy depends on atomicity across CEX and chain venues;
- UI copy implies chain-enforced safety for off-chain API-key execution.

## 14. References To Re-Verify Before Implementation

- LI.FI docs: https://docs.li.fi/
- LI.FI agent integration: https://docs.li.fi/agents/overview
- deBridge docs: https://docs.debridge.com/
- deBridge hooks: https://docs.debridge.com/home/use-cases/hooks
- Solana docs: https://solana.com/docs
- Ethereum account abstraction docs: https://docs.erc4337.io/
- OKX API docs: https://www.okx.com/docs-v5/en/
- Hyperliquid API docs: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api
- Hyperliquid API wallets: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets
- Binance Spot API docs: https://developers.binance.com/docs/binance-spot-api-docs/

These references are planning inputs only. Before implementation, each integration needs a fresh feasibility pass against current official docs, sandbox/testnet behavior, rate limits, security model and legal constraints.
