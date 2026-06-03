/* ===========================================================
   Sentry — extra mock data for Markets / Strategy catalog /
   Risk center / Active strategy / Data sources pages.
   Ported verbatim from the Claude Design handoff bundle
   (agentc-web/project/data.js). Real-data wiring lives in the
   page components; these are the demo defaults + taxonomies.
   =========================================================== */
export function attachMarketData(RG) {
  /* ===== executable market strategies (intent → policy templates) ===== */

  // delta-neutral perp funding-rate arbitrage (cross-venue, cross-chain)
  RG.parsedFundingArb = {
    intent: 'Delta-neutral funding arbitrage',
    summary:
      'Capture the funding-rate spread on a perp: long the venue with the cheapest funding and short an equal-size position on the most expensive, staying market-neutral. The agent rebalances both legs every funding window and bridges collateral across chains automatically.',
    params: [
      { k: 'Pair', v: 'SUI-PERP' },
      { k: 'Legs', v: 'Long Hyperliquid · Short Aevo' },
      { k: 'Edge', v: '+13.6% APR' },
      { k: 'Notional', v: '≤ 1,000 USDC / leg' },
      { k: 'Rebalance', v: 'every 8h funding' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=2000, spent=Σ',
        note: 'budget ceiling across both legs',
      },
      {
        op: 'MoveCall',
        fn: 'bluefin::open_position',
        args: 'mkt=SUI-PERP, side=short, sz=Δ',
        note: 'short the high-funding venue (Sui)',
      },
      {
        op: 'Bridge',
        fn: 'debridge::send',
        args: 'to=Hyperliquid, asset=USDC, amt=col',
        note: 'auto cross-chain collateral for the long leg',
      },
      {
        op: 'MoveCall',
        fn: 'policy::assert_delta_neutral',
        args: 'net_delta ≈ 0',
        note: 'aborts if the two legs drift off-neutral',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="funding-arb"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Delta neutrality',
        detail: 'Long and short notionals match within 2% — directional price moves net to ~zero.',
      },
      {
        level: 'pass',
        label: 'Funding edge positive',
        detail: 'Spread +13.6% APR comfortably clears est. fees + bridge cost (~3% APR).',
      },
      {
        level: 'warn',
        label: 'Cross-chain settlement',
        detail:
          'Bridging via deBridge adds latency; the agent holds a buffer and re-checks the spread after the bridge confirms.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy hard-caps total collateral at 2,000 USDC on-chain.',
      },
    ],
    meta: {
      name: 'SUI-PERP Funding Arb',
      strategy: 'funding-arb',
      budget: 2000,
      scope: 'SUI-PERP',
      slip: 0.5,
    },
    backtest: {
      curve: [
        100, 100.4, 100.9, 101.1, 101.6, 102.0, 102.3, 102.9, 103.2, 103.8, 104.1, 104.6, 105.0,
        105.4, 105.9, 106.4,
      ],
      stats: [
        { k: 'Spread captured', v: '+13.6%' },
        { k: 'Max drawdown', v: '−0.8%' },
        { k: 'Net APR', v: '+10.7%' },
      ],
      verdict:
        'Holding the neutral pair for 30 days would have earned the funding spread with near-zero directional risk, net of fees and bridge cost.',
    },
  };

  // concentrated LP position manager (auto re-center)
  RG.parsedLP = {
    intent: 'Concentrated LP manager',
    summary:
      'Provide liquidity to a Cetus pool in a tight range and let the agent re-center the position as price drifts — compounding fees and rewards while capping impermanent-loss exposure.',
    params: [
      { k: 'Pool', v: 'Cetus SUI/USDC' },
      { k: 'Range', v: '±6% band' },
      { k: 'APY', v: '~28% fees+rwd' },
      { k: 'Budget', v: '1,000 USDC' },
      { k: 'Rebalance', v: 'on ±4% drift' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=1000, spent=Σ',
        note: 'budget ceiling',
      },
      {
        op: 'MoveCall',
        fn: 'cetus::open_position',
        args: 'pool=SUI/USDC, lower=-6%, upper=+6%',
        note: 'concentrated range position',
      },
      {
        op: 'MoveCall',
        fn: 'cetus::collect_and_compound',
        args: 'position=#, compound=true',
        note: 'auto-compound fees + CETUS rewards',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="lp"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'IL exposure',
        detail:
          '±6% band limits impermanent loss; the agent re-centers before the range is exited.',
      },
      {
        level: 'warn',
        label: 'Rebalance frequency',
        detail:
          'Choppy markets trigger more re-centers — each costs a small fee (gas is sponsored).',
      },
      {
        level: 'pass',
        label: 'Pool liquidity',
        detail: 'Cetus SUI/USDC TVL $22.8M — deep enough for clean entries and exits.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy caps LP capital at 1,000 USDC on-chain.',
      },
    ],
    meta: {
      name: 'Cetus SUI/USDC LP',
      strategy: 'lp-manage',
      budget: 1000,
      scope: 'SUI/USDC',
      slip: 1.0,
    },
    backtest: {
      curve: [
        100, 100.6, 101.3, 101.0, 101.9, 102.6, 102.2, 103.1, 103.8, 103.4, 104.3, 105.0, 104.7,
        105.6, 106.3, 107.0,
      ],
      stats: [
        { k: 'Fees earned', v: '+5.9%' },
        { k: 'Impermanent loss', v: '−1.4%' },
        { k: 'Net 30d', v: '+4.5%' },
      ],
      verdict:
        'Auto-re-centering captured fee income through volatility, ending ~4.5% ahead net of impermanent loss.',
    },
  };

  // stablecoin yield router across money markets
  RG.parsedLendYield = {
    intent: 'Stablecoin yield router',
    summary:
      'Park idle USDC where it earns the most across Sui money markets (Suilend, Scallop, NAVI) and let the agent migrate the position whenever another venue offers a meaningfully higher risk-adjusted rate.',
    params: [
      { k: 'Asset', v: 'USDC' },
      { k: 'Best rate', v: 'Scallop 7.4%' },
      { k: 'Migrate', v: 'if +0.5% better' },
      { k: 'Budget', v: '5,000 USDC' },
      { k: 'Check', v: 'hourly' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=5000, spent=Σ',
        note: 'budget ceiling',
      },
      {
        op: 'MoveCall',
        fn: 'scallop::supply',
        args: 'asset=USDC, amt=5000',
        note: 'route to the top-rate money market',
      },
      {
        op: 'MoveCall',
        fn: 'policy::assert_rate_improved',
        args: 'min_delta=0.5%',
        note: 'only migrates when materially better',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="lend"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Principal safety',
        detail: 'Supply-only into audited money markets — no leverage, no borrowing.',
      },
      {
        level: 'pass',
        label: 'Migration cost',
        detail:
          'The agent only moves when the +0.5% edge beats withdraw + supply cost (gas sponsored).',
      },
      {
        level: 'warn',
        label: 'Protocol risk',
        detail: 'Funds sit in third-party lending contracts; the agent caps per-venue exposure.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy caps deployed stablecoins at 5,000 USDC on-chain.',
      },
    ],
    meta: {
      name: 'USDC Yield Router',
      strategy: 'lending',
      budget: 5000,
      scope: 'USDC',
      slip: 0.2,
    },
    backtest: {
      curve: [
        100, 100.1, 100.2, 100.3, 100.4, 100.5, 100.6, 100.7, 100.8, 100.9, 101.0, 101.1, 101.2,
        101.3, 101.4, 101.6,
      ],
      stats: [
        { k: 'Avg APY', v: '7.1%' },
        { k: 'Migrations', v: '4' },
        { k: 'Net 30d', v: '+0.6%' },
      ],
      verdict:
        'Routing idle USDC to the best money-market rate would have earned ~7.1% APY, beating a static single-venue deposit.',
    },
  };

  // cross-venue spot arbitrage (CEX + on-chain DEX, cross-chain)
  RG.parsedSpotArb = {
    intent: 'Cross-venue spot arbitrage',
    summary:
      'Buy an asset on the cheapest venue and sell it on the richest across centralized exchanges and on-chain DEXes, capturing the price spread. The agent pre-positions inventory on both sides and bridges between chains so each leg is funded.',
    params: [
      { k: 'Asset', v: 'SUI spot' },
      { k: 'Legs', v: 'Buy OKX · Sell Raydium' },
      { k: 'Spread', v: '+0.19%' },
      { k: 'Size', v: '≤ 2,000 USDC' },
      { k: 'Trigger', v: 'spread > 0.10%' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=2000, spent=Σ',
        note: 'budget ceiling',
      },
      {
        op: 'CEX',
        fn: 'okx::market_buy',
        args: 'SUI, sz=Δ',
        note: 'buy the cheap venue (off-chain leg)',
      },
      {
        op: 'Bridge',
        fn: 'wormhole::transfer',
        args: 'SUI → Solana',
        note: 'route inventory to the rich venue',
      },
      {
        op: 'MoveCall',
        fn: 'raydium::market_sell',
        args: 'SUI/USDC, sz=Δ',
        note: 'sell the rich venue',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="spot-arb"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Spread vs cost',
        detail:
          '+0.19% spread vs ~0.12% fees + transfer — positive; the agent only fires above 0.10%.',
      },
      {
        level: 'warn',
        label: 'Inventory & latency',
        detail:
          'Cross-venue legs are not atomic; the agent pre-positions inventory on both sides to avoid one-leg risk.',
      },
      {
        level: 'warn',
        label: 'CEX custody',
        detail:
          'Off-chain legs hold funds on the exchange briefly — capped per-venue and swept on a schedule.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy hard-caps per-cycle size at 2,000 USDC on-chain.',
      },
    ],
    meta: {
      name: 'SUI Spot Arb',
      strategy: 'spot-arb',
      budget: 2000,
      scope: 'SUI spot',
      slip: 0.2,
    },
    backtest: {
      curve: [
        100, 100.1, 100.05, 100.2, 100.15, 100.3, 100.28, 100.4, 100.38, 100.5, 100.48, 100.6,
        100.58, 100.7, 100.72, 100.85,
      ],
      stats: [
        { k: 'Cycles', v: '46' },
        { k: 'Avg spread', v: '+0.17%' },
        { k: 'Net 30d', v: '+0.85%' },
      ],
      verdict:
        'Firing only when the spread cleared fees, the strategy compounded many small cross-venue captures into ~0.85% over 30 days, market-neutral.',
    },
  };

  // risk badge taxonomy — shared across cards and detail surfaces
  RG.riskTax = {
    market: { label: 'Market', c: '#5AA6FF' },
    liquidity: { label: 'Liquidity', c: '#2EE6CE' },
    liq: { label: 'Liquidation', c: '#FF5470' },
    oracle: { label: 'Oracle', c: '#FFC24B' },
    contract: { label: 'Smart-contract', c: '#9DABBA' },
    venue: { label: 'Venue / custody', c: '#FF9F45' },
    funding: { label: 'Funding flip', c: '#A78BFA' },
  };

  // status: available (deployable now) · testnet · soon
  RG.catalog = [
    {
      id: 'risk-grid',
      name: 'Risk Response Grid',
      cat: 'Risk Response',
      status: 'available',
      scenario: 'safe',
      icon: 'shield',
      blurb:
        'Auto-deploy a buy ladder, pause or reduce exposure when price drops, volatility spikes, or liquidity thins.',
      metric: { l: 'Trigger', v: '−8% / 1h' },
      adapters: ['DeepBook'],
      risks: ['market', 'liquidity'],
      capital: '500+ USDC',
    },
    {
      id: 'funding-harvest',
      name: 'Funding Rate Harvest',
      cat: 'Arbitrage',
      status: 'available',
      scenario: 'funding-arb',
      icon: 'swap',
      blurb:
        'Long the cheap-funding venue, short the expensive one. Market-neutral carry with funding-flip and liquidation guards.',
      metric: { l: 'Net carry', v: '+13.6% APR' },
      adapters: ['Bluefin', 'Hyperliquid', 'Aevo'],
      risks: ['funding', 'liq', 'venue'],
      capital: '2,000+ USDC',
    },
    {
      id: 'perp-basis',
      name: 'Perp DEX Basis Arb',
      cat: 'Arbitrage',
      status: 'testnet',
      scenario: 'funding-arb',
      icon: 'scale',
      blurb:
        'Compare mark / index / funding across perp venues and capture the basis spread when it clears fees and slippage.',
      metric: { l: 'Spread', v: '+17.2% APR' },
      adapters: ['Bluefin', 'Hyperliquid', 'Drift'],
      risks: ['liquidity', 'liq', 'venue'],
      capital: '2,000+ USDC',
    },
    {
      id: 'spot-arb',
      name: 'Spot Arbitrage',
      cat: 'Arbitrage',
      status: 'available',
      scenario: 'spot',
      icon: 'scale',
      blurb:
        'Buy the cheapest venue and sell the richest across CEX and on-chain DEXes, with inventory pre-positioned on both sides.',
      metric: { l: 'Spread', v: '+0.58%' },
      adapters: ['Binance', 'OKX', 'Cetus', 'Raydium'],
      risks: ['venue', 'liquidity'],
      capital: '2,000+ USDC',
    },
    {
      id: 'lend-optimizer',
      name: 'Lending Rate Optimizer',
      cat: 'Lending',
      status: 'available',
      scenario: 'lend',
      icon: 'percent',
      blurb:
        'Route idle stablecoins to the best supply rate across money markets, migrating only when the edge beats the move cost.',
      metric: { l: 'Best APY', v: '7.4%' },
      adapters: ['Scallop', 'NAVI', 'Suilend'],
      risks: ['contract', 'liquidity'],
      capital: '5,000 USDC',
    },
    {
      id: 'borrow-guardian',
      name: 'Borrow Health Guardian',
      cat: 'Lending',
      status: 'testnet',
      scenario: null,
      icon: 'shield',
      blurb:
        'Watch your health factor and auto-repay or deleverage before liquidation when LTV worsens.',
      metric: { l: 'Action', v: 'auto-repay' },
      adapters: ['Suilend', 'NAVI'],
      risks: ['liq', 'oracle'],
      capital: 'collateral',
    },
    {
      id: 'lp-range',
      name: 'LP Range Manager',
      cat: 'LP',
      status: 'available',
      scenario: 'lp',
      icon: 'droplet',
      blurb:
        'Place a concentrated CLMM range, compound fees and auto re-center as price drifts, exiting on volatility.',
      metric: { l: 'Fee APR', v: '~28%' },
      adapters: ['Cetus'],
      risks: ['market', 'liquidity'],
      capital: '1,000+ USDC',
    },
    {
      id: 'dca',
      name: 'DCA / Accumulation',
      cat: 'Automation',
      status: 'available',
      scenario: 'dca',
      icon: 'target',
      blurb:
        'Schedule recurring buys by time, volatility band or drawdown level to average your entry over time.',
      metric: { l: 'Cadence', v: 'daily ×N' },
      adapters: ['DeepBook'],
      risks: ['market'],
      capital: '100+ / run',
    },
    {
      id: 'tpsl',
      name: 'Take-Profit / Stop-Loss',
      cat: 'Automation',
      status: 'testnet',
      scenario: 'hedge',
      icon: 'activity',
      blurb:
        'Trailing stop, take-profit and stop-loss automation on a position — the pattern users grasp instantly.',
      metric: { l: 'Type', v: 'trailing' },
      adapters: ['DeepBook', 'Bluefin'],
      risks: ['market', 'liquidity'],
      capital: 'position',
    },
    {
      id: 'peg-rescue',
      name: 'Stablecoin / Peg Rescue',
      cat: 'Risk Response',
      status: 'soon',
      scenario: null,
      icon: 'shield',
      blurb:
        'On depeg, pool imbalance or oracle mismatch: reduce exposure, swap to safer collateral, or pause the strategy.',
      metric: { l: 'Trigger', v: 'depeg' },
      adapters: ['Cetus', 'DeepBook'],
      risks: ['oracle', 'liquidity'],
      capital: '—',
    },
    {
      id: 'rebalancer',
      name: 'Portfolio Rebalancer',
      cat: 'Rebalance',
      status: 'soon',
      scenario: null,
      icon: 'scale',
      blurb:
        'Hold target weights across SUI, stables, LP, lending and perp collateral; rebalance when drift exceeds a band.',
      metric: { l: 'Trigger', v: 'drift > 5%' },
      adapters: ['Cetus', 'Scallop'],
      risks: ['market', 'liquidity'],
      capital: '—',
    },
    {
      id: 'inventory',
      name: 'Cross-Venue Inventory Rebalancer',
      cat: 'Rebalance',
      status: 'soon',
      scenario: null,
      icon: 'globe',
      blurb:
        'Move inventory between chains and venues via bridge adapters, with async settlement, ETA and reclaim states.',
      metric: { l: 'Settle', v: 'async' },
      adapters: ['deBridge', 'Wormhole'],
      risks: ['venue', 'contract'],
      capital: '—',
    },
    {
      id: 'fixed-yield',
      name: 'Fixed Yield',
      cat: 'Lending',
      status: 'soon',
      scenario: null,
      icon: 'percent',
      blurb: 'Lock a fixed rate via yield tokenization once a Sui-native primitive is available.',
      metric: { l: 'Rate', v: 'fixed' },
      adapters: ['Pendle'],
      risks: ['contract'],
      capital: '—',
    },
    {
      id: 'vault-index',
      name: 'Vault Copy / Strategy Index',
      cat: 'Rebalance',
      status: 'soon',
      scenario: null,
      icon: 'layers',
      blurb:
        'Browse and follow curated strategies vault-style, once enough native strategies exist to compare.',
      metric: { l: 'Mode', v: 'copy' },
      adapters: ['Sentry'],
      risks: ['venue'],
      capital: '—',
    },
    {
      id: 'watchtower',
      name: 'Alert-Only Watchtower',
      cat: 'Watchtower',
      status: 'available',
      scenario: null,
      watch: true,
      icon: 'eye',
      blurb:
        'Monitor any market or position with zero execution authority — then upgrade to an autonomous policy when ready.',
      metric: { l: 'Authority', v: 'none' },
      adapters: ['all venues'],
      risks: [],
      capital: 'free',
    },
  ];

  // deep detail per strategy (legs, yield/risk decomposition, permissions, timeline)
  // authored for flagship strategies; others derive generically in the UI.
  RG.detail = {
    'funding-harvest': {
      thesis:
        'Perpetual funding is paid between longs and shorts every few hours. When one venue’s funding is far above another’s, you can short the expensive venue and long the cheap one in equal size — collecting the spread while staying market-neutral, so the asset’s price barely matters.',
      legs: [
        {
          venue: 'Hyperliquid',
          asset: 'SUI-PERP',
          side: 'Long',
          size: '1,000 USDC',
          collateral: '1,000 USDC',
          exp: 'pays 5.1% funding',
          expC: 'var(--danger)',
        },
        {
          venue: 'Aevo',
          asset: 'SUI-PERP',
          side: 'Short',
          size: '1,000 USDC',
          collateral: '1,000 USDC',
          exp: 'earns 18.7% funding',
          expC: 'var(--safe)',
        },
      ],
      yield: [
        { label: 'Funding earned (short leg)', v: '+18.7%', c: 'var(--safe)' },
        { label: 'Funding paid (long leg)', v: '−5.1%', c: 'var(--danger)' },
        { label: 'Trading fees', v: '−0.4%', c: 'var(--t1)' },
        { label: 'Bridge cost', v: '−0.3%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Net carry', v: '+10.7% APR' },
      risk: [
        {
          key: 'funding',
          level: 'warn',
          note: 'Funding can flip — if the short leg starts paying, carry inverts. The agent unwinds when net carry turns negative.',
        },
        {
          key: 'liq',
          level: 'warn',
          note: 'Each leg is leveraged; a fast move can liquidate one side. The agent holds a 40% margin buffer and rebalances each window.',
        },
        {
          key: 'venue',
          level: 'warn',
          note: 'Two venues hold collateral simultaneously; exposure is capped per-venue and reconciled every funding window.',
        },
        {
          key: 'liquidity',
          level: 'pass',
          note: 'Both order books are deep enough for this size at under 0.5% slippage.',
        },
      ],
      permissions: [
        'Open / close perps on Bluefin, Hyperliquid, Aevo (scoped)',
        'Bridge USDC via deBridge between legs',
        'Read Pyth + venue funding feeds',
        'Never withdraw to an external address',
      ],
      timeline: [
        { t: 't0', d: 'Detect spread above threshold, size both legs equally' },
        { t: 't0 + 2s', d: 'Open short on the high-funding venue' },
        { t: 't0 + 40s', d: 'Bridge collateral, open long on the low-funding venue' },
        { t: 'every 8h', d: 'Collect funding, re-check spread, rebalance to neutral' },
        { t: 'on flip', d: 'Unwind both legs and return to monitoring' },
      ],
    },
    'lp-range': {
      thesis:
        'A concentrated liquidity position earns the most fees when price stays inside a tight band — but stops earning (and accrues impermanent loss) once price leaves it. The agent keeps the band centered on price, compounding fees and stepping out of the way of large moves.',
      legs: [
        {
          venue: 'Cetus',
          asset: 'SUI/USDC',
          side: 'LP ±6%',
          size: '1,000 USDC',
          collateral: '50 / 50',
          exp: 'fees + CETUS',
          expC: 'var(--safe)',
        },
      ],
      yield: [
        { label: 'Swap fees', v: '+14.2%', c: 'var(--safe)' },
        { label: 'CETUS incentives', v: '+14.2%', c: 'var(--safe)' },
        { label: 'Impermanent loss', v: '−1.4%', c: 'var(--danger)' },
        { label: 'Rebalance cost', v: '−0.3%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Net fee APR (after IL)', v: '~26.7%' },
      risk: [
        {
          key: 'market',
          level: 'warn',
          note: 'Price leaving the ±6% band stops fee income; the agent re-centers before the range is exited.',
        },
        {
          key: 'liquidity',
          level: 'pass',
          note: 'Cetus SUI/USDC TVL $22.8M — deep enough for clean entries and exits.',
        },
      ],
      permissions: [
        'Open / adjust Cetus CLMM positions (scoped pool)',
        'Collect and compound fees',
        'Re-center range within ±6%',
        'Never withdraw to an external address',
      ],
      timeline: [
        { t: 't0', d: 'Open a concentrated range around the current mid' },
        { t: 'on ±4% drift', d: 'Withdraw and re-deposit around the new mid' },
        { t: 'continuous', d: 'Collect and compound swap fees + rewards' },
        { t: 'on high vol', d: 'Widen the range or exit to stablecoins' },
      ],
    },
    'lend-optimizer': {
      thesis:
        'Stablecoin supply rates drift apart across money markets. Instead of parking USDC in one venue, the agent always holds it where the risk-adjusted rate is highest, migrating only when the edge clears the cost of moving.',
      legs: [
        {
          venue: 'Scallop',
          asset: 'USDC',
          side: 'Supply',
          size: '5,000 USDC',
          collateral: '—',
          exp: '7.4% APY',
          expC: 'var(--safe)',
        },
      ],
      yield: [
        { label: 'Supply APY', v: '+5.9%', c: 'var(--safe)' },
        { label: 'Reward APY', v: '+1.5%', c: 'var(--safe)' },
        { label: 'Migration cost', v: '−0.2%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Net APY', v: '7.2%' },
      risk: [
        {
          key: 'contract',
          level: 'warn',
          note: 'Funds sit in a third-party lending contract; the agent caps per-venue exposure.',
        },
        {
          key: 'liquidity',
          level: 'pass',
          note: 'Withdrawal liquidity is healthy across Scallop, NAVI and Suilend at this size.',
        },
      ],
      permissions: [
        'Supply / withdraw on Scallop, NAVI, Suilend (scoped)',
        'Migrate between money markets',
        'Read rate + utilization feeds',
        'No borrowing, no withdrawal off-app',
      ],
      timeline: [
        { t: 't0', d: 'Supply to the top-rate market' },
        { t: 'hourly', d: 'Compare risk-adjusted rates across venues' },
        { t: 'on +0.5% edge', d: 'Withdraw and re-supply to the better venue' },
      ],
    },
    'risk-grid': {
      thesis:
        'When the market dislocates, humans freeze or panic. This policy pre-authorizes the agent to buy a laddered grid into a sharp drop — strictly within a budget cap — so dips are bought mechanically and within limits, then logged on-chain.',
      legs: [
        {
          venue: 'DeepBook',
          asset: 'SUI/USDC',
          side: 'Buy ladder',
          size: '500 USDC',
          collateral: 'USDC',
          exp: 'avg −6% vs market',
          expC: 'var(--safe)',
        },
      ],
      yield: [
        { label: 'Avg entry vs market', v: '−6.2%', c: 'var(--safe)' },
        { label: 'Trading fees', v: '−0.4%', c: 'var(--t1)' },
        { label: 'Gas', v: 'sponsored', c: 'var(--t2)' },
      ],
      net: { label: 'Dip captured', v: '≈6% under market' },
      risk: [
        {
          key: 'market',
          level: 'warn',
          note: 'A continued fall buys deeper into a downtrend; the budget cap hard-limits total exposure on-chain.',
        },
        {
          key: 'liquidity',
          level: 'warn',
          note: 'Books thin mid-crash; the agent re-quotes and respects the slippage cap, never chasing.',
        },
      ],
      permissions: [
        'Place / cancel limit orders on DeepBook (scoped pair)',
        'Read Pyth price feed',
        'Never exceed budget or withdraw funds',
      ],
      timeline: [
        { t: 'trigger', d: 'SUI −8% / 1h breaches the reference price' },
        { t: 't0', d: 'Deploy rung #1 of the rescue grid' },
        { t: 'laddered', d: 'Fill lower rungs as price falls, within budget' },
        { t: 'recovery', d: 'Hold the position and log on-chain; await the next trigger' },
      ],
    },
  };

  /* ===== Markets monitor — multi-protocol DeFi radar ===== */

  // chains to aggregate — all live; the monitor filters by chain
  RG.chains = [
    { id: 'sui', name: 'Sui', live: true, c: '#5AA6FF' },
    { id: 'aptos', name: 'Aptos', live: true, c: '#11C3A6' },
    { id: 'solana', name: 'Solana', live: true, c: '#9945FF' },
    { id: 'ethereum', name: 'Ethereum', live: true, c: '#7B8BFF' },
    { id: 'base', name: 'Base', live: true, c: '#3C7DFF' },
  ];

  // protocol metadata (monogram color + category)
  RG.protocols = {
    // Sui
    cetus: { name: 'Cetus', kind: 'AMM DEX', c: '#2FD9E6' },
    suilend: { name: 'Suilend', kind: 'Lending', c: '#8C7BFF' },
    navi: { name: 'NAVI', kind: 'Lending', c: '#34E0A1' },
    scallop: { name: 'Scallop', kind: 'Lending', c: '#5AA6FF' },
    aftermath: { name: 'Aftermath', kind: 'AMM · LST', c: '#FF9F45' },
    bluefin: { name: 'Bluefin', kind: 'Perp · Spot', c: '#3E7BFF' },
    deepbook: { name: 'DeepBook', kind: 'CLOB', c: '#2EE6CE' },
    haedal: { name: 'Haedal', kind: 'Liquid staking', c: '#22C7B8' },
    volo: { name: 'Volo', kind: 'Liquid staking', c: '#6E8BFF' },
    kai: { name: 'Kai', kind: 'Yield vault', c: '#46D39A' },
    // Aptos
    aries: { name: 'Aries', kind: 'Lending', c: '#00C2A8' },
    thala: { name: 'Thala', kind: 'AMM · CDP', c: '#7B6CF6' },
    amnis: { name: 'Amnis', kind: 'Liquid staking', c: '#43E0C0' },
    echelon: { name: 'Echelon', kind: 'Lending', c: '#F2A33C' },
    // Solana
    kamino: { name: 'Kamino', kind: 'Lending · LP', c: '#4B6FFF' },
    raydium: { name: 'Raydium', kind: 'AMM DEX', c: '#C200FB' },
    marginfi: { name: 'marginfi', kind: 'Lending', c: '#1AC7E9' },
    jito: { name: 'Jito', kind: 'Liquid staking', c: '#14F195' },
    orca: { name: 'Orca', kind: 'AMM DEX', c: '#FFC93C' },
    // Ethereum
    aave: { name: 'Aave', kind: 'Lending', c: '#B6509E' },
    lido: { name: 'Lido', kind: 'Liquid staking', c: '#46A6FF' },
    pendle: { name: 'Pendle', kind: 'Yield', c: '#1FC7A6' },
    curve: { name: 'Curve', kind: 'Stable AMM', c: '#5BD15B' },
    uniswap: { name: 'Uniswap', kind: 'AMM DEX', c: '#FF4DA6' },
    // Base
    aerodrome: { name: 'Aerodrome', kind: 'AMM DEX', c: '#2D7DFF' },
    moonwell: { name: 'Moonwell', kind: 'Lending', c: '#F4B731' },
    morpho: { name: 'Morpho', kind: 'Lending', c: '#2B6EF2' },
  };

  // yield opportunities across chains — base APY + reward APY, TVL ($M), 7d trend, risk
  RG.yields = [
    // ---- Sui ----
    {
      proto: 'suilend',
      market: 'USDC',
      type: 'Lending',
      chain: 'sui',
      tvl: 48.2,
      base: 5.1,
      reward: 1.7,
      risk: 'low',
      trend: [6.2, 6.3, 6.1, 6.5, 6.6, 6.4, 6.8],
    },
    {
      proto: 'navi',
      market: 'SUI',
      type: 'Lending',
      chain: 'sui',
      tvl: 61.5,
      base: 3.4,
      reward: 0.8,
      risk: 'low',
      trend: [4.0, 4.1, 4.0, 4.2, 4.1, 4.3, 4.2],
    },
    {
      proto: 'scallop',
      market: 'USDC',
      type: 'Lending',
      chain: 'sui',
      tvl: 33.1,
      base: 5.9,
      reward: 1.5,
      risk: 'low',
      trend: [7.0, 7.1, 7.3, 7.2, 7.4, 7.3, 7.4],
    },
    {
      proto: 'cetus',
      market: 'SUI/USDC',
      type: 'LP',
      chain: 'sui',
      tvl: 22.8,
      base: 14.2,
      reward: 14.2,
      risk: 'med',
      trend: [25, 26, 24, 29, 27, 30, 28.4],
    },
    {
      proto: 'cetus',
      market: 'DEEP/SUI',
      type: 'LP',
      chain: 'sui',
      tvl: 6.4,
      base: 31.0,
      reward: 33.1,
      risk: 'high',
      trend: [52, 58, 49, 66, 61, 70, 64.1],
    },
    {
      proto: 'bluefin',
      market: 'SUI/USDC',
      type: 'LP',
      chain: 'sui',
      tvl: 14.2,
      base: 18.4,
      reward: 13.3,
      risk: 'med',
      trend: [28, 30, 29, 33, 31, 34, 31.7],
    },
    {
      proto: 'aftermath',
      market: 'afSUI/SUI',
      type: 'LST',
      chain: 'sui',
      tvl: 18.9,
      base: 9.6,
      reward: 0.0,
      risk: 'low',
      trend: [9.4, 9.5, 9.5, 9.6, 9.5, 9.7, 9.6],
    },
    {
      proto: 'haedal',
      market: 'haSUI',
      type: 'LST',
      chain: 'sui',
      tvl: 120.3,
      base: 3.1,
      reward: 0.0,
      risk: 'low',
      trend: [3.0, 3.1, 3.0, 3.1, 3.2, 3.1, 3.1],
    },
    {
      proto: 'volo',
      market: 'vSUI',
      type: 'LST',
      chain: 'sui',
      tvl: 52.0,
      base: 3.3,
      reward: 0.0,
      risk: 'low',
      trend: [3.2, 3.3, 3.2, 3.4, 3.3, 3.3, 3.3],
    },
    {
      proto: 'kai',
      market: 'USDC looped',
      type: 'Vault',
      chain: 'sui',
      tvl: 9.8,
      base: 11.0,
      reward: 7.2,
      risk: 'high',
      trend: [16, 17, 15, 19, 18, 20, 18.2],
    },
    {
      proto: 'deepbook',
      market: 'SUI/USDC',
      type: 'CLOB',
      chain: 'sui',
      tvl: 40.0,
      base: 0.0,
      reward: 11.5,
      risk: 'med',
      trend: [10, 11, 10.5, 12, 11, 12, 11.5],
    },
    // ---- Aptos ----
    {
      proto: 'aries',
      market: 'USDC',
      type: 'Lending',
      chain: 'aptos',
      tvl: 22.4,
      base: 5.4,
      reward: 1.8,
      risk: 'low',
      trend: [6.8, 7.0, 6.9, 7.1, 7.0, 7.3, 7.2],
    },
    {
      proto: 'echelon',
      market: 'USDT',
      type: 'Lending',
      chain: 'aptos',
      tvl: 14.7,
      base: 6.2,
      reward: 1.9,
      risk: 'low',
      trend: [7.6, 7.8, 7.7, 8.0, 7.9, 8.2, 8.1],
    },
    {
      proto: 'thala',
      market: 'APT/USDC',
      type: 'LP',
      chain: 'aptos',
      tvl: 9.1,
      base: 10.0,
      reward: 9.6,
      risk: 'med',
      trend: [17, 18, 16, 20, 19, 21, 19.6],
    },
    {
      proto: 'amnis',
      market: 'amAPT',
      type: 'LST',
      chain: 'aptos',
      tvl: 31.0,
      base: 7.1,
      reward: 0.0,
      risk: 'low',
      trend: [7.0, 7.1, 7.0, 7.2, 7.1, 7.2, 7.1],
    },
    // ---- Solana ----
    {
      proto: 'kamino',
      market: 'USDC',
      type: 'Lending',
      chain: 'solana',
      tvl: 88.0,
      base: 6.8,
      reward: 2.5,
      risk: 'low',
      trend: [8.8, 9.0, 8.9, 9.2, 9.1, 9.4, 9.3],
    },
    {
      proto: 'marginfi',
      market: 'USDC',
      type: 'Lending',
      chain: 'solana',
      tvl: 120.0,
      base: 6.4,
      reward: 2.3,
      risk: 'low',
      trend: [8.2, 8.4, 8.3, 8.6, 8.5, 8.8, 8.7],
    },
    {
      proto: 'raydium',
      market: 'SOL/USDC',
      type: 'LP',
      chain: 'solana',
      tvl: 41.0,
      base: 15.0,
      reward: 19.2,
      risk: 'med',
      trend: [30, 32, 29, 36, 33, 37, 34.2],
    },
    {
      proto: 'orca',
      market: 'SOL/USDC',
      type: 'LP',
      chain: 'solana',
      tvl: 33.0,
      base: 13.5,
      reward: 15.2,
      risk: 'med',
      trend: [25, 27, 24, 30, 28, 31, 28.7],
    },
    {
      proto: 'jito',
      market: 'jitoSOL',
      type: 'LST',
      chain: 'solana',
      tvl: 1600.0,
      base: 8.4,
      reward: 0.0,
      risk: 'low',
      trend: [8.2, 8.3, 8.3, 8.4, 8.3, 8.5, 8.4],
    },
    // ---- Ethereum ----
    {
      proto: 'aave',
      market: 'USDC',
      type: 'Lending',
      chain: 'ethereum',
      tvl: 980.0,
      base: 4.6,
      reward: 0.0,
      risk: 'low',
      trend: [4.4, 4.5, 4.4, 4.6, 4.5, 4.7, 4.6],
    },
    {
      proto: 'lido',
      market: 'stETH',
      type: 'LST',
      chain: 'ethereum',
      tvl: 22000.0,
      base: 3.2,
      reward: 0.0,
      risk: 'low',
      trend: [3.1, 3.2, 3.1, 3.2, 3.2, 3.3, 3.2],
    },
    {
      proto: 'pendle',
      market: 'USDe PT',
      type: 'Vault',
      chain: 'ethereum',
      tvl: 210.0,
      base: 17.5,
      reward: 0.0,
      risk: 'med',
      trend: [15, 16, 15.5, 18, 17, 18, 17.5],
    },
    {
      proto: 'curve',
      market: '3pool',
      type: 'LP',
      chain: 'ethereum',
      tvl: 320.0,
      base: 3.8,
      reward: 1.3,
      risk: 'low',
      trend: [4.8, 5.0, 4.9, 5.1, 5.0, 5.2, 5.1],
    },
    {
      proto: 'uniswap',
      market: 'ETH/USDC',
      type: 'LP',
      chain: 'ethereum',
      tvl: 180.0,
      base: 12.4,
      reward: 10.0,
      risk: 'med',
      trend: [19, 21, 18, 24, 22, 24, 22.4],
    },
    // ---- Base ----
    {
      proto: 'aerodrome',
      market: 'AERO/USDC',
      type: 'LP',
      chain: 'base',
      tvl: 36.0,
      base: 8.0,
      reward: 33.5,
      risk: 'high',
      trend: [34, 38, 33, 44, 40, 45, 41.5],
    },
    {
      proto: 'moonwell',
      market: 'USDC',
      type: 'Lending',
      chain: 'base',
      tvl: 48.0,
      base: 5.2,
      reward: 1.7,
      risk: 'low',
      trend: [6.6, 6.8, 6.7, 6.9, 6.8, 7.0, 6.9],
    },
    {
      proto: 'morpho',
      market: 'USDC',
      type: 'Lending',
      chain: 'base',
      tvl: 96.0,
      base: 6.1,
      reward: 1.7,
      risk: 'low',
      trend: [7.4, 7.6, 7.5, 7.7, 7.6, 7.9, 7.8],
    },
  ];

  // perp venues — on-chain DEXes + centralized exchanges (for funding arb)
  RG.perpVenues = {
    bluefin: { name: 'Bluefin', kind: 'dex', tag: 'Sui', c: '#3E7BFF' },
    typus: { name: 'Typus', kind: 'dex', tag: 'Sui', c: '#22C7B8' },
    drift: { name: 'Drift', kind: 'dex', tag: 'Solana', c: '#9945FF' },
    hyperliquid: { name: 'Hyperliquid', kind: 'dex', tag: 'HL L1', c: '#7CF5D0' },
    aevo: { name: 'Aevo', kind: 'dex', tag: 'Ethereum', c: '#7B8BFF' },
    binance: { name: 'Binance', kind: 'cex', tag: 'CEX', c: '#F0B90B' },
    bybit: { name: 'Bybit', kind: 'cex', tag: 'CEX', c: '#F7A600' },
    okx: { name: 'OKX', kind: 'cex', tag: 'CEX', c: '#AEB7C2' },
  };

  // perp instruments — funding shown as ANNUALIZED %. positive = longs pay shorts.
  RG.perps = [
    {
      sym: 'SUI',
      mark: 4.182,
      venues: [
        { v: 'bluefin', funding: 12.4, oi: 8.2, px: 4.183 },
        { v: 'binance', funding: 8.2, oi: 96.0, px: 4.181 },
        { v: 'bybit', funding: 15.6, oi: 54.0, px: 4.184 },
        { v: 'hyperliquid', funding: 5.1, oi: 142.0, px: 4.179 },
        { v: 'aevo', funding: 18.7, oi: 21.4, px: 4.19 },
      ],
    },
    {
      sym: 'DEEP',
      mark: 0.1043,
      venues: [
        { v: 'bluefin', funding: 22.1, oi: 2.4, px: 0.1045 },
        { v: 'aevo', funding: 14.6, oi: 1.1, px: 0.1041 },
        { v: 'hyperliquid', funding: 31.8, oi: 6.7, px: 0.1047 },
      ],
    },
    {
      sym: 'BTC',
      mark: 68420,
      venues: [
        { v: 'binance', funding: 6.2, oi: 4200.0, px: 68415 },
        { v: 'bybit', funding: 9.8, oi: 1900.0, px: 68435 },
        { v: 'okx', funding: 7.1, oi: 1400.0, px: 68410 },
        { v: 'hyperliquid', funding: 11.9, oi: 820.0, px: 68455 },
        { v: 'bluefin', funding: 8.4, oi: 12.0, px: 68440 },
      ],
    },
    {
      sym: 'ETH',
      mark: 3290,
      venues: [
        { v: 'binance', funding: 9.8, oi: 2100.0, px: 3290 },
        { v: 'bybit', funding: 4.3, oi: 980.0, px: 3289 },
        { v: 'okx', funding: 7.6, oi: 760.0, px: 3291 },
        { v: 'hyperliquid', funding: 9.1, oi: 410.0, px: 3292 },
      ],
    },
  ];

  // spot venues — CEX + on-chain DEX (for cross-venue spot arbitrage)
  RG.spotVenues = {
    binance: { name: 'Binance', kind: 'cex', tag: 'CEX', c: '#F0B90B' },
    okx: { name: 'OKX', kind: 'cex', tag: 'CEX', c: '#AEB7C2' },
    bybit: { name: 'Bybit', kind: 'cex', tag: 'CEX', c: '#F7A600' },
    cetus: { name: 'Cetus', kind: 'dex', tag: 'Sui', c: '#2FD9E6' },
    deepbook: { name: 'DeepBook', kind: 'dex', tag: 'Sui', c: '#2EE6CE' },
    raydium: { name: 'Raydium', kind: 'dex', tag: 'Solana', c: '#C200FB' },
    uniswap: { name: 'Uniswap', kind: 'dex', tag: 'Ethereum', c: '#FF4DA6' },
  };

  // spot order books across venues — best bid / ask. arb = buy lowest ask, sell highest bid.
  RG.spots = [
    {
      sym: 'SUI',
      venues: [
        { v: 'binance', bid: 4.181, ask: 4.183 },
        { v: 'okx', bid: 4.18, ask: 4.182 },
        { v: 'deepbook', bid: 4.178, ask: 4.185 },
        { v: 'cetus', bid: 4.176, ask: 4.186 },
        { v: 'raydium', bid: 4.19, ask: 4.196 },
      ],
    },
    {
      sym: 'DEEP',
      venues: [
        { v: 'binance', bid: 0.104, ask: 0.1042 },
        { v: 'deepbook', bid: 0.1048, ask: 0.105 },
        { v: 'cetus', bid: 0.1044, ask: 0.1051 },
      ],
    },
    {
      sym: 'BTC',
      venues: [
        { v: 'binance', bid: 68410, ask: 68430 },
        { v: 'bybit', bid: 68480, ask: 68500 },
        { v: 'okx', bid: 68400, ask: 68420 },
      ],
    },
    {
      sym: 'ETH',
      venues: [
        { v: 'binance', bid: 3289, ask: 3291 },
        { v: 'okx', bid: 3296, ask: 3298 },
        { v: 'uniswap', bid: 3288, ask: 3297 },
      ],
    },
  ];

  /* ===== Risk Center ===== */

  // global risk budget — aggregate ceiling across all policies
  RG.riskBudget = {
    authorized: 10500, // total USDC the agent may put at risk across policies
    atRisk: 6480, // currently deployed/exposed
    dailyLossCap: 800, // hard daily stop-loss
    dailyLossUsed: 142,
  };

  // per-venue exposure caps (the agent can never exceed these)
  RG.venueLimits = [
    { venue: 'DeepBook', kind: 'dex', exposure: 2750, cap: 4000 },
    { venue: 'Cetus', kind: 'dex', exposure: 1000, cap: 3000 },
    { venue: 'Bluefin', kind: 'dex', exposure: 980, cap: 2500 },
    { venue: 'Scallop', kind: 'lend', exposure: 1750, cap: 3000 },
    { venue: 'Binance', kind: 'cex', exposure: 0, cap: 2000 },
    { venue: 'Hyperliquid', kind: 'cex', exposure: 0, cap: 2000 },
  ];

  // liquidation watch — leveraged legs and their distance to liquidation
  RG.liquidations = [
    {
      policy: 'SUI-PERP Funding Arb',
      venue: 'Aevo',
      side: 'Short',
      liqPx: 5.21,
      markPx: 4.18,
      buffer: 24.6,
      health: 'safe',
    },
    {
      policy: 'SUI-PERP Funding Arb',
      venue: 'Hyperliquid',
      side: 'Long',
      liqPx: 3.41,
      markPx: 4.18,
      buffer: 18.4,
      health: 'safe',
    },
    {
      policy: 'WAL Downside Hedge',
      venue: 'Bluefin',
      side: 'Short',
      liqPx: 0.71,
      markPx: 0.63,
      buffer: 12.7,
      health: 'warn',
    },
  ];

  // oracle health — feeds the agent relies on
  RG.oracles = [
    { feed: 'Pyth · SUI/USD', status: 'ok', age: '0.4s', dev: '0.02%' },
    { feed: 'Pyth · BTC/USD', status: 'ok', age: '0.3s', dev: '0.01%' },
    { feed: 'Pyth · DEEP/USD', status: 'ok', age: '0.6s', dev: '0.05%' },
    { feed: 'Switchboard · WAL/USD', status: 'stale', age: '14s', dev: '0.31%' },
  ];

  // signer / executor health
  RG.signers = [
    {
      name: 'zkLogin session key',
      kind: 'zklogin',
      status: 'ok',
      detail: 'epoch 612 / 614 · ~36h left',
    },
    {
      name: 'Cloud agent executor',
      kind: 'cloud',
      status: 'ok',
      detail: '0x7a3f…c91e · sponsored gas',
    },
    {
      name: 'Local daemon',
      kind: 'local',
      status: 'offline',
      detail: 'not running · cloud handling all policies',
    },
  ];

  // capability matrix — what the agent CAN and CANNOT do (the moat)
  RG.capabilities = {
    can: [
      'Trade only on venues each policy scopes',
      'Stay within every budget & per-venue cap',
      'Open / close / rebalance positions it created',
      'Bridge collateral between its own legs',
      'Read price, rate and funding feeds',
      'Pause itself when Guardian checks fail',
    ],
    cannot: [
      'Withdraw or transfer funds to any external address',
      'Exceed a budget, leverage or slippage limit',
      'Touch assets or venues outside policy scope',
      'Change its own policy or raise its own limits',
      'Approve token spend beyond the scoped amount',
      'Act after you revoke the on-chain Policy Object',
    ],
  };

  /* ===== Data sources registry ===== */
  // honest map of where each feed would come from in production.
  // live = browser can fetch a public CORS-open API directly (we actually test DefiLlama).
  // proxy = needs a backend (keys / signing / non-CORS venue).
  RG.dataFeeds = [
    {
      id: 'llama',
      group: 'Market data',
      name: 'DeFi yields & TVL',
      provider: 'DefiLlama',
      endpoint: 'yields.llama.fi/pools',
      type: 'REST',
      access: 'live',
      cadence: '60s',
      powers: 'Yield monitor · Opportunities',
      test: 'https://yields.llama.fi/pools',
    },
    {
      id: 'pyth',
      group: 'Market data',
      name: 'Spot & oracle prices',
      provider: 'Pyth · Hermes',
      endpoint: 'hermes.pyth.network',
      type: 'REST · SSE',
      access: 'live',
      cadence: '400ms',
      powers: 'Prices · risk gauge · Guardian',
      test: 'https://hermes.pyth.network/v2/price_feeds?query=sui&asset_type=crypto',
    },
    {
      id: 'cg',
      group: 'Market data',
      name: '24h change & volume',
      provider: 'CoinGecko',
      endpoint: 'api.coingecko.com',
      type: 'REST',
      access: 'live',
      cadence: '60s',
      powers: 'Tickers · sparklines',
      test: 'https://api.coingecko.com/api/v3/ping',
    },
    {
      id: 'suirpc',
      group: 'On-chain',
      name: 'Sui full-node RPC',
      provider: 'Sui · Mysten',
      endpoint: 'fullnode.mainnet.sui.io',
      type: 'JSON-RPC',
      access: 'live',
      cadence: 'realtime',
      powers: 'Balances · pool objects · checkpoints',
      test: null,
    },
    {
      id: 'deepbook',
      group: 'On-chain',
      name: 'DeepBook order book',
      provider: 'DeepBook indexer',
      endpoint: 'deepbook-indexer.mainnet',
      type: 'REST · WS',
      access: 'live',
      cadence: 'realtime',
      powers: 'Spot books · CLOB depth',
      test: null,
    },
    {
      id: 'funding',
      group: 'Derivatives',
      name: 'Perp funding rates',
      provider: 'Bluefin · Hyperliquid · Aevo',
      endpoint: 'per-venue public APIs',
      type: 'REST · WS',
      access: 'mixed',
      cadence: '5s',
      powers: 'Perp arbitrage',
      test: null,
    },
    {
      id: 'cexmkt',
      group: 'Derivatives',
      name: 'CEX market data',
      provider: 'Binance · OKX · Bybit',
      endpoint: 'public market endpoints',
      type: 'REST · WS',
      access: 'live',
      cadence: '1s',
      powers: 'Spot/perp cross-venue spreads',
      test: null,
    },
    {
      id: 'cextrade',
      group: 'Execution',
      name: 'CEX account & trading',
      provider: 'Binance · OKX · Bybit',
      endpoint: 'signed private endpoints',
      type: 'REST · WS',
      access: 'proxy',
      cadence: 'on demand',
      powers: 'Balances · order placement',
      test: null,
    },
    {
      id: 'bridge',
      group: 'Execution',
      name: 'Cross-chain bridge',
      provider: 'deBridge · Wormhole',
      endpoint: 'relayer + on-chain',
      type: 'REST · on-chain',
      access: 'proxy',
      cadence: 'on demand',
      powers: 'Inventory rebalancing',
      test: null,
    },
    {
      id: 'signer',
      group: 'Execution',
      name: 'Agent signer / executor',
      provider: 'zkLogin + Cloudflare',
      endpoint: 'durable object + KMS',
      type: 'internal',
      access: 'proxy',
      cadence: 'on demand',
      powers: 'Policy execution · gas sponsor',
      test: null,
    },
  ];

  /* ===== Agent runtime (local-first vs cloud) ===== */
  RG.runtimes = {
    cloud: {
      mode: 'cloud',
      label: 'Cloud agent',
      icon: 'cloud',
      status: 'online',
      host: 'Cloudflare Worker + Durable Object',
      region: 'auto · nearest edge',
      uptime: '14d 06h',
      llm: 'Claude · server-side',
      heartbeat: '2s ago',
      loopMs: 850,
      tick: 'every 8s',
      watching: 3,
      gas: { station: 'Sentry Gas Station', bal: 4.81, unit: 'SUI' },
      privacy: 'Decision logic runs on our edge; only signed txns hit chain.',
      tags: ['always-on', 'zero-setup', 'sponsored gas'],
      health: [
        { k: 'Worker', v: 'healthy', ok: true },
        { k: 'Durable Object', v: 'persistent state synced', ok: true },
        { k: 'RPC connection', v: 'fullnode.mainnet · 41ms', ok: true },
        { k: 'Signer (zkLogin)', v: 'epoch 612 · ~36h left', ok: true },
      ],
      log: [
        { t: '14:39:58', d: 'Heartbeat · 3 policies evaluated · no action' },
        { t: '14:39:02', d: 'Funding-arb rebalance executed · tx 0x9d22…41ac' },
        { t: '14:38:20', d: 'deBridge transfer confirmed · 480 USDC → Hyperliquid' },
        { t: '14:31:50', d: 'Risk re-evaluated · SUI vol ↑ · within policy' },
      ],
    },
    local: {
      mode: 'local',
      label: 'Local agent',
      icon: 'cpu',
      status: 'offline',
      host: 'Your machine · daemon',
      region: 'localhost:8787',
      uptime: '—',
      llm: 'Ollama / Claude Desktop · BYO',
      heartbeat: 'never',
      loopMs: null,
      tick: 'every 8s',
      watching: 0,
      gas: { station: 'Sentry Gas Station', bal: 4.81, unit: 'SUI' },
      privacy: 'Decision logic never leaves your machine — maximum privacy.',
      tags: ['private', 'BYO LLM', 'self-hosted'],
      health: [
        { k: 'Daemon process', v: 'not running', ok: false },
        { k: 'Local LLM', v: 'no endpoint detected', ok: false },
        { k: 'RPC connection', v: 'would use your RPC', ok: null },
        { k: 'Signer (zkLogin)', v: 'shared session key', ok: true },
      ],
      log: [
        { t: '—', d: 'Daemon offline · cloud is currently handling all policies' },
        { t: 'setup', d: 'Run: npx sentry-agent --local to start the daemon' },
      ],
    },
  };

  // editable Guardian rules — the agent's pre-execution checks
  RG.guardianRules = [
    {
      id: 'slip',
      label: 'Max slippage',
      kind: 'pct',
      val: 1.2,
      min: 0.2,
      max: 3,
      step: 0.1,
      on: true,
      desc: 'Abort an order if expected slippage exceeds this.',
    },
    {
      id: 'liq',
      label: 'Min pool liquidity',
      kind: 'usd',
      val: 250000,
      min: 50000,
      max: 1000000,
      step: 50000,
      on: true,
      desc: 'Skip venues thinner than this depth.',
    },
    {
      id: 'lev',
      label: 'Max leverage',
      kind: 'x',
      val: 4,
      min: 1,
      max: 10,
      step: 0.5,
      on: true,
      desc: 'Cap notional per leg across perp venues.',
    },
    {
      id: 'buffer',
      label: 'Min liq. buffer',
      kind: 'pct',
      val: 15,
      min: 5,
      max: 50,
      step: 1,
      on: true,
      desc: 'Deleverage before margin gets this close to liquidation.',
    },
    {
      id: 'depeg',
      label: 'Pause on stable depeg',
      kind: 'pct',
      val: 0.5,
      min: 0.1,
      max: 3,
      step: 0.1,
      on: true,
      desc: 'Halt if a stablecoin drifts past this from $1.',
    },
    {
      id: 'oracle',
      label: 'Max oracle staleness',
      kind: 'sec',
      val: 10,
      min: 2,
      max: 60,
      step: 1,
      on: false,
      desc: 'Block execution if the price feed is older than this.',
    },
  ];

  // simulation scenarios for the "what would trigger?" tester
  RG.simScenarios = [
    {
      id: 'crash',
      label: 'SUI −15% flash crash',
      hits: {
        slip: 'trigger',
        liq: 'trigger',
        buffer: 'block',
        lev: 'pass',
        depeg: 'pass',
        oracle: 'pass',
      },
    },
    {
      id: 'depeg',
      label: 'USDC depeg to $0.97',
      hits: {
        depeg: 'block',
        slip: 'trigger',
        liq: 'pass',
        lev: 'pass',
        buffer: 'pass',
        oracle: 'pass',
      },
    },
    {
      id: 'thin',
      label: 'Liquidity drains 80%',
      hits: {
        liq: 'block',
        slip: 'trigger',
        lev: 'pass',
        buffer: 'pass',
        depeg: 'pass',
        oracle: 'pass',
      },
    },
    {
      id: 'oracle',
      label: 'Oracle feed stalls 30s',
      hits: {
        oracle: 'block',
        slip: 'pass',
        liq: 'pass',
        lev: 'pass',
        buffer: 'pass',
        depeg: 'pass',
      },
    },
    {
      id: 'calm',
      label: 'Normal market conditions',
      hits: {
        slip: 'pass',
        liq: 'pass',
        lev: 'pass',
        buffer: 'pass',
        depeg: 'pass',
        oracle: 'pass',
      },
    },
  ];

  // named Guardian rule presets (apply a whole risk posture at once)
  RG.guardianPresets = [
    {
      id: 'conservative',
      name: 'Conservative',
      desc: 'Tight limits — capital preservation first.',
      vals: { slip: 0.4, liq: 500000, lev: 2, buffer: 30, depeg: 0.3, oracle: 8 },
      on: { slip: true, liq: true, lev: true, buffer: true, depeg: true, oracle: true },
    },
    {
      id: 'balanced',
      name: 'Balanced',
      desc: 'Default posture — sensible risk/return.',
      vals: { slip: 1.2, liq: 250000, lev: 4, buffer: 15, depeg: 0.5, oracle: 10 },
      on: { slip: true, liq: true, lev: true, buffer: true, depeg: true, oracle: false },
    },
    {
      id: 'aggressive',
      name: 'Aggressive',
      desc: 'Loose limits — chase edge, accept more risk.',
      vals: { slip: 2.5, liq: 100000, lev: 8, buffer: 8, depeg: 1.5, oracle: 30 },
      on: { slip: true, liq: false, lev: true, buffer: true, depeg: false, oracle: false },
    },
  ];
}
