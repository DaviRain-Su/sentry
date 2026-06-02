# Product Market and Frontend Roadmap

Date: 2026-06-02

Purpose: turn market research into concrete RescueGrid product and frontend design work.

## 1. Market map

RescueGrid should not position itself as a generic DeFi dashboard. The stronger positioning is:

> policy-constrained autonomous execution for DeFi strategies that are too time-sensitive, multi-step, or risk-sensitive to manage manually.

Comparable products fall into six buckets.

| Bucket | Examples | What they prove | Gap RescueGrid can own |
| --- | --- | --- | --- |
| AI trading agents | Cod3x, HeyAnon, Mode AI Terminal | Users want natural-language DeFi/trading workflows and live execution feeds. | Safer execution, explicit on-chain policy, Guardian, revocation. |
| Automation / risk managers | DeFi Saver | Liquidation protection, stop-loss, take-profit and leverage automation are proven user needs. | Bring this to Sui + agent policy objects + strategy templates. |
| Yield aggregators / vaults | Beefy, Yearn, Sommelier | Users accept automated strategy vaults when yield, risk and fees are easy to inspect. | Let users own the policy instead of blindly depositing into a vault. |
| On-chain asset management | Enzyme, Morpho Vaults | Configurable vault policies, caps, asset/protocol allow-lists and curator controls matter. | Convert these controls into RescueGrid mandates and Guardian rules. |
| Perps / funding / basis products | Hyperliquid vaults, Ethena, Bluefin, funding-arb vaults | Delta-neutral and funding/basis strategies are a major demand area. | Strategy builder + net exposure proof + funding flip guard + venue caps. |
| Sui DeFi primitives | DeepBook, Cetus DLMM, Scallop, NAVI, Suilend, Bluefin | Sui has spot liquidity, LP, lending and perps components. | A unified policy-constrained agent layer across those protocols. |

## 2. Strategy templates to show

The frontend should evolve from one "rescue grid" demo into a strategy catalog.

### Must design first

1. **Risk Response Grid**
   - Current product.
   - Trigger: price drop, volatility spike, peg/depeg, liquidity thinning.
   - Actions: buy ladder, pause, revoke, reduce exposure.

2. **Funding Rate Harvest**
   - User idea: funding-rate arbitrage.
   - Typical shape: long spot or low-funding venue, short high-funding perp venue.
   - UI must show: funding spread, net delta, borrow cost, expected carry, funding flip risk, liquidation buffer.

3. **Perp DEX Spread / Basis Arbitrage**
   - User idea: perp DEX arbitrage between venues.
   - Typical shape: compare mark/index/orderbook/funding across Bluefin, Hyperliquid, dYdX/Drift-style venues later.
   - UI must show: venue spread matrix, fees, slippage, open interest, liquidity depth, execution latency and partial-fill risk.

4. **Lending Rate Optimizer**
   - User idea: lending.
   - Typical shape: route idle stablecoins/SUI across Scallop, NAVI, Suilend, or future venues.
   - UI must show: supply APY, borrow APY, utilization, liquidation risk, collateral factor, withdrawal liquidity.

5. **Borrow Health Guardian**
   - Adjacent to lending.
   - Typical shape: if LTV / health factor worsens, repay, deleverage, withdraw from LP, or alert.
   - UI must show: liquidation price, health factor, debt/collateral chart, automated repay threshold.

6. **LP Range Manager**
   - User idea: LP.
   - Typical shape: Cetus CLMM/DLMM range placement, collect fees, rebalance bins/ranges, exit on volatility.
   - UI must show: price range, current price, in-range status, fee APR, impermanent loss, rebalance threshold.

### Add after the first batch

7. **Stablecoin / Peg Rescue**
   - Trigger: stablecoin depeg, pool imbalance, oracle mismatch.
   - Action: reduce exposure, swap, pause strategy, route to safer collateral.

8. **Portfolio Rebalancer**
   - Target weights across SUI, stablecoins, LP, lending and perps collateral.
   - Action: rebalance when drift exceeds threshold.

9. **DCA / Accumulation Agent**
   - Simple and useful for consumer UX.
   - Trigger: time schedule, volatility bands, drawdown levels.

10. **Take-Profit / Stop-Loss / Trailing Stop**
    - DeFi Saver-style automation.
    - Should be a basic template because users understand it immediately.

11. **Fixed Yield / Yield Tokenization**
    - Pendle-like mental model.
    - Later, not Sui MVP unless a Sui-native yield-tokenization primitive exists.

12. **Vault Copy / Strategy Index**
    - Enzyme/Morpho/Hyperliquid-vault-style browseable strategies.
    - Later, once RescueGrid has enough native strategies to compare.

13. **Cross-Venue Inventory Rebalancer**
    - Uses bridge/settlement adapters, not hot-path arbitrage.
    - UI must show asynchronous settlement, ETA, bridge fee, failure/reclaim state.

14. **Alert-Only Watchtower**
    - No execution authority.
    - Good onboarding: user can monitor first, then upgrade to autonomous policy.

## 3. Frontend gaps

Current UI proves one policy and one Sui/DeepBook flow. To present the larger product, design needs these missing surfaces.

### A. Strategy Marketplace

Purpose: show RescueGrid is a platform, not a single strategy.

Required components:

- strategy category tabs: Risk Response, Funding, Perps, Lending, LP, Rebalance, Watchtower;
- strategy cards with APY/risk/venues/capital required/status;
- "available now", "testnet", "coming soon" status badges;
- adapter badges: DeepBook, Cetus, Scallop, NAVI, Bluefin, Hyperliquid;
- risk badges: market, liquidity, liquidation, oracle, smart contract, venue/custody;
- one-click "Preview policy".

### B. Opportunity Scanner

Purpose: make the agent feel useful before a user creates a policy.

Required modules:

- funding-rate heatmap by asset and venue;
- cross-venue spread matrix;
- lending APY table with supply/borrow/utilization/liquidity;
- LP opportunity table with fee APR, range width, in-range probability and IL estimate;
- stablecoin peg monitor;
- "why this opportunity exists" explanation card;
- "agent can monitor this" action.

### C. Strategy Detail Page

Purpose: explain one template deeply enough for users to trust it.

Required modules:

- strategy thesis;
- capital flow diagram;
- legs table: venue, asset, side, size, collateral, expected yield/cost;
- yield decomposition: funding, borrow cost, LP fees, incentives, trading fees, gas;
- risk decomposition: liquidation, funding flip, slippage, oracle, bridge, smart contract, venue;
- historical chart: APY, spread, drawdown, utilization;
- required permissions;
- Guardian rules;
- execution timeline;
- "simulate with my wallet" CTA.

### D. Strategy Builder v2

Purpose: turn the current New Strategy flow into a multi-leg policy builder.

Required steps:

1. Select template.
2. Select venues/adapters.
3. Enter capital and constraints.
4. Show PTB / action preview.
5. Show Guardian checks.
6. Show signer/agent mode.
7. Confirm and deploy.

Required controls:

- budget cap;
- per-leg max size;
- max slippage;
- max leverage;
- max LTV / liquidation buffer;
- max venue exposure;
- funding flip threshold;
- rebalance threshold;
- emergency stop mode;
- human approval required for high-risk actions.

### E. Active Strategy Detail

Purpose: show the user what the agent is doing now.

Required modules:

- live position legs;
- net delta / net exposure;
- realized and unrealized PnL;
- carry earned vs costs paid;
- open orders;
- last tick result;
- next scheduled tick;
- pending approvals;
- active Guardian limits;
- action buttons: pause, resume, rebalance now, revoke, export activity.

### F. Risk Center

Purpose: make "safe autonomous execution" tangible.

Required modules:

- global risk budget;
- per-strategy and per-venue caps;
- liquidation watch list;
- oracle/source health;
- signer status;
- stale data warnings;
- emergency stop: global / strategy / venue;
- Guardian rule editor;
- "what the agent cannot do" capability matrix.

### G. Agent Activity Ledger v2

Purpose: replace a simple event list with an audit product.

Required filters:

- strategy;
- venue;
- event type;
- status;
- planned vs executed;
- Guardian block;
- human approval;
- tx/order id.

Required row details:

- reason;
- input data snapshot;
- execution plan;
- Guardian result;
- tx digest / venue order id;
- PnL impact;
- budget impact;
- retry/failure state.

### H. Venue Accounts / Integrations

Purpose: make future multi-venue work understandable.

Required modules:

- linked Sui wallet;
- MoveGate/RescueGrid policy object;
- cloud agent address;
- local daemon status;
- future Hyperliquid agent wallet;
- future CEX trade-only key;
- capability list per venue;
- reauth/revoke buttons.

## 4. Design brief

Ask design to produce these screens first:

1. **Strategy Marketplace**
   - grid/list view, filters, opportunity status, strategy cards.

2. **Opportunity Scanner**
   - funding heatmap, spread matrix, lending APY table, LP table.

3. **Funding Rate Harvest Detail**
   - the best candidate to make the product feel bigger than spot rescue.
   - include net delta proof and funding flip guard.

4. **Lending Optimizer Detail**
   - show supply/borrow, health factor, liquidation buffer, repay automation.

5. **LP Range Manager Detail**
   - price range chart, fee APR, IL, rebalance recommendation.

6. **Strategy Builder v2**
   - multi-leg builder with Guardian and policy preview.

7. **Active Strategy Detail**
   - live state, execution queue, last tick, PnL attribution.

8. **Risk Center**
   - global limits, venue caps, emergency stop, signer status.

9. **Agent Ledger v2**
   - filterable audit trail with expandable details.

10. **Venue Accounts / Integrations**
    - wallet, agent, signer, protocol adapters, future local daemon.

## 5. Prioritization

### P0: improve current demo

- Make activity counts and policy inspect use real live data.
- Make "real vs simulated" states obvious.
- Add "coming soon" strategy catalog section, even if only current strategy can deploy.
- Add real tx/order details to the transaction drawer.

### P1: show product breadth without overbuilding execution

- Strategy Marketplace.
- Funding Rate Harvest detail page.
- Lending Optimizer detail page.
- LP Range Manager detail page.
- Opportunity Scanner with mock/fetched data where available.

### P2: implement next real adapter

Recommended order:

1. Lending health guardian / repay automation.
2. LP manager for Cetus DLMM/CLMM.
3. Bluefin/Hyperliquid funding monitor in watch-only mode.
4. Funding Rate Harvest with tiny/paper execution.

Reasoning:

- Lending and LP management fit Sui-native adapters earlier.
- Funding/perp arbitrage needs perps venue accounts, margin, liquidation and funding flip handling, so it should be watch-only first.

### P3: production platform

- ChainDataProvider and GraphQL migration.
- Seal/Walrus private strategy records.
- SignerAdapter / local daemon / WaaP-style external signer.
- Cross-venue inventory rebalancing.
- Strategy marketplace with copy/follow and vault-like UX.

## 6. What to avoid

- Do not present funding arbitrage as "risk-free"; show funding flip, liquidation and basis risk.
- Do not show APY without yield decomposition and time window.
- Do not hide bridge/CEX/perps custody differences under a single "account" abstraction.
- Do not let strategy cards imply execution support before adapters exist.
- Do not make the UI all about charts; RescueGrid's moat is policy, Guardian and execution auditability.

## 7. Design handoff checklist

Design should treat these as concrete deliverables, not loose inspiration.

1. A clickable product map for Strategy Marketplace -> Strategy Detail -> Builder -> Active Strategy.
2. A card system that handles real, testnet, watch-only and coming-soon strategies without misleading users.
3. A risk badge taxonomy for market, liquidity, liquidation, oracle, smart-contract, signer and venue/custody risk.
4. A yield decomposition pattern that never shows one APY number without funding, borrow cost, LP fees, incentives, trading fees and gas.
5. A multi-leg position visualization that can show spot/perp, lending/borrow, LP ranges and bridge/settlement legs.
6. A Guardian rule editor pattern that is understandable to a non-technical user but maps cleanly to policy constraints.
7. A transaction/order detail drawer that can show Sui tx digest, venue order id, retry state, partial fills and budget impact.
8. A local/cloud agent status pattern for future CLI daemon support.

## 8. Source notes

- [Cod3x](https://www.cod3x.org/) and [Cod3x Terminal Overview](https://docs.cod3x.org/terminal-overview/terminal-overview) prove AI trading terminal patterns: chart, positions/orders, AI feed, goals and settings.
- [HeyAnon](https://docs.heyanon.ai/heyanon.ai) and [Mode AI Terminal](https://docs.mode.network/ai-agents/mode-ai-terminal) prove natural-language DeFi operations and transaction-preparation demand.
- [DeFi Saver Automation](https://defisaver.com/features/automation) and its [automation knowledge base](https://help.defisaver.com/features/automation) prove liquidation protection, stop-loss, take-profit, trailing-stop and leverage-management primitives.
- [Morpho Vault roles](https://legacy.docs.morpho.org/morpho-vaults/concepts/roles), [Morpho Vault overview](https://legacy.docs.morpho.org/morpho-vaults/contracts/overview/) and [Morpho Public Allocator](https://docs.morpho.org/get-started/resources/contracts/public-allocator/) prove cap, curator, allocator and Guardian patterns for controlled automated allocation.
- [Hyperliquid Vaults](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/vaults), [Bluefin Funding](https://learn.bluefin.io/bluefin/bluefin-perps-exchange/trading/funding), [Ethena overview](https://docs.ethena.fi/) and [Ethena funding risk](https://docs.ethena.fi/solution-overview/risks/funding-risk) prove perp/funding/basis demand, but also the need to show margin, funding-flip, venue and custody risks.
- [Cetus](https://cetus.click/), [Cetus CLMM SDK](https://github.com/CetusProtocol/cetus-clmm-sui-sdk), [Suilend SDK](https://docs.suilend.fi/ecosystem/suilend-sdk-guide) and [NAVI docs](https://docs.naviprotocol.io/) prove Sui-native LP and lending adapters are a natural next step.
