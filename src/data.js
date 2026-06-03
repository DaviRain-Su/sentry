/* ===========================================================
   Sentry — mock data layer
   =========================================================== */
import { attachMarketData } from './market-data.js';

export const RG = {
  user: {
    handle: 'ywang.sui',
    addr: '0x7a3f…c91e',
    provider: 'Google · zkLogin',
    avatar: 'YW',
  },

  // base prices (live ticker will jitter these)
  prices: {
    SUI: { sym: 'SUI', usd: 4.182, chg: -2.31 },
    USDC: { sym: 'USDC', usd: 1.0, chg: 0.0 },
    DEEP: { sym: 'DEEP', usd: 0.1043, chg: 1.84 },
    WAL: { sym: 'WAL', usd: 0.6271, chg: -0.92 },
  },

  portfolio: {
    total: 48230.55,
    chg24h: -3.84,
    available: 12480.0,
    deployed: 35750.55,
  },

  positions: [
    {
      pair: 'SUI/USDC',
      side: 'Rescue Grid',
      size: 21450.0,
      entry: 4.31,
      pnl: -612.4,
      pnlPct: -2.78,
      risk: 'med',
    },
    {
      pair: 'DEEP/USDC',
      side: 'DCA Ladder',
      size: 8600.0,
      entry: 0.099,
      pnl: 224.1,
      pnlPct: 2.67,
      risk: 'low',
    },
    {
      pair: 'WAL/USDC',
      side: 'Hedge',
      size: 5700.55,
      entry: 0.641,
      pnl: -118.9,
      pnlPct: -2.04,
      risk: 'med',
    },
  ],

  // policies = on-chain Move Policy Objects
  policies: [
    {
      id: '0x9c2a…41bf',
      name: 'SUI Crash Rescue Grid',
      strategy: 'rescue-grid',
      status: 'active',
      mode: 'cloud',
      budgetCap: 500,
      budgetUsed: 142.5,
      scope: ['SUI/USDC'],
      maxSlippage: 1.2,
      expires: '2026-06-14T00:00:00Z',
      created: '2026-05-28',
      execs: 3,
    },
    {
      id: '0x4d81…7a02',
      name: 'DEEP Accumulation DCA',
      strategy: 'dca',
      status: 'active',
      mode: 'local',
      budgetCap: 1200,
      budgetUsed: 740,
      scope: ['DEEP/USDC'],
      maxSlippage: 0.8,
      expires: '2026-07-01T00:00:00Z',
      created: '2026-05-20',
      execs: 11,
    },
    {
      id: '0x1f60…c8d4',
      name: 'WAL Downside Hedge',
      strategy: 'hedge',
      status: 'paused',
      mode: 'cloud',
      budgetCap: 800,
      budgetUsed: 312,
      scope: ['WAL/USDC'],
      maxSlippage: 1.5,
      expires: '2026-06-09T00:00:00Z',
      created: '2026-05-25',
      execs: 5,
    },
  ],

  // activity log — autonomous on-chain executions
  activity: [
    {
      t: '14:22:08',
      date: 'Today',
      kind: 'exec',
      policy: 'SUI Crash Rescue Grid',
      title: 'Bought 12.0 SUI @ 4.18',
      detail: 'Grid rung #3 filled on Deepbook · slippage 0.4%',
      amount: -50.16,
      tx: '0xa4f9…2b71',
      risk: 38,
      mode: 'cloud',
    },
    {
      t: '13:47:51',
      date: 'Today',
      kind: 'monitor',
      policy: 'SUI Crash Rescue Grid',
      title: 'Risk re-evaluated',
      detail: 'SUI volatility ↑ · risk score 38 → 41 · no action',
      amount: 0,
      tx: null,
      risk: 41,
      mode: 'cloud',
    },
    {
      t: '11:09:33',
      date: 'Today',
      kind: 'exec',
      policy: 'DEEP Accumulation DCA',
      title: 'Bought 1,010 DEEP @ 0.099',
      detail: 'Scheduled DCA tranche · slippage 0.2%',
      amount: -100.0,
      tx: '0x7c12…9e0a',
      risk: 22,
      mode: 'local',
    },
    {
      t: '09:15:00',
      date: 'Today',
      kind: 'guardian',
      policy: 'WAL Downside Hedge',
      title: 'Guardian blocked execution',
      detail: 'Pool liquidity below threshold · order deferred',
      amount: 0,
      tx: null,
      risk: 64,
      mode: 'cloud',
    },
    {
      t: '08:48:21',
      date: 'Today',
      kind: 'retry',
      policy: 'DEEP Accumulation DCA',
      title: 'Retry succeeded · 2nd attempt',
      detail: 'First submit failed (book moved) · re-quoted and filled 1,010 DEEP @ 0.099',
      amount: -100.0,
      tx: '0x2b7f…aa10',
      risk: 24,
      mode: 'local',
    },
    {
      t: '08:48:09',
      date: 'Today',
      kind: 'fail',
      policy: 'DEEP Accumulation DCA',
      title: 'Order failed · price moved',
      detail: 'Book shifted past limit before settlement · no funds spent · auto-retry queued',
      amount: 0,
      tx: '0x6c41…0d92',
      risk: 24,
      mode: 'local',
    },
    {
      t: '22:40:12',
      date: 'Yesterday',
      kind: 'exec',
      policy: 'SUI Crash Rescue Grid',
      title: 'Bought 11.4 SUI @ 4.39',
      detail: 'Grid rung #2 filled on Deepbook · slippage 0.6%',
      amount: -50.04,
      tx: '0x33de…5fa1',
      risk: 35,
      mode: 'cloud',
    },
    {
      t: '18:02:44',
      date: 'Yesterday',
      kind: 'policy',
      policy: 'SUI Crash Rescue Grid',
      title: 'Policy Object created',
      detail: 'Budget 500 USDC · scope SUI/USDC · expires Jun 14',
      amount: 0,
      tx: '0x88ac…1d20',
      risk: null,
      mode: 'cloud',
    },
  ],

  // example NL strategies (chips)
  examples: [
    'When SUI drops more than 8%, deploy a 500 USDC rescue grid',
    'DCA 100 USDC into DEEP every day for 2 weeks',
    'Hedge my WAL position if it falls below $0.55',
  ],

  // a deliberately risky intent — Guardian will BLOCK it
  riskyExample: 'Put my entire balance into one SUI grid and ignore slippage',

  // the headline scenario — parsed result for the rescue grid intent
  parsed: {
    intent: 'Conditional rescue grid',
    summary:
      'Deploy a 5-rung buy grid on SUI/USDC, funded up to 500 USDC, triggered when SUI falls ≥ 8% from a 1h reference price.',
    params: [
      { k: 'Trigger', v: 'SUI −8% / 1h' },
      { k: 'Action', v: 'Buy grid · 5 rungs' },
      { k: 'Budget cap', v: '500 USDC' },
      { k: 'Venue', v: 'Deepbook v3 · SUI/USDC' },
      { k: 'Per-rung', v: '100 USDC' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=500, spent=Σ',
        note: 'self-enforced budget ceiling',
      },
      {
        op: 'MoveCall',
        fn: 'deepbook::place_limit_order',
        args: 'pool=SUI/USDC, qty=23.9, px=3.85',
        note: 'rescue rung #1',
      },
      {
        op: 'MoveCall',
        fn: 'deepbook::place_limit_order',
        args: 'pool=SUI/USDC, qty=24.6, px=3.74',
        note: 'rescue rung #2',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="rescue"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Slippage bound',
        detail: 'Worst-case fill 0.9% — under your 1.2% cap.',
      },
      {
        level: 'warn',
        label: 'Capital concentration',
        detail: '64% of free budget routes to a single pair (SUI/USDC).',
      },
      {
        level: 'pass',
        label: 'Pool freshness',
        detail: 'Deepbook SUI/USDC pool active · last trade 2s ago.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy hard-caps spend at 500 USDC on-chain.',
      },
    ],
    meta: {
      name: 'SUI Crash Rescue Grid',
      strategy: 'rescue-grid',
      budget: 500,
      scope: 'SUI/USDC',
      slip: 1.2,
    },
    backtest: {
      curve: [
        100, 99.4, 98.1, 99.0, 97.2, 95.0, 96.8, 98.9, 100.6, 99.2, 101.4, 103.1, 102.0, 104.2,
        105.9, 107.3,
      ],
      stats: [
        { k: 'Triggers fired', v: '3' },
        { k: 'Avg entry vs mkt', v: '−6.2%' },
        { k: 'Hypothetical PnL', v: '+7.3%' },
      ],
      verdict:
        'Over 30 days the grid would have caught all 3 major dips and bought ~6% under market each time.',
    },
  },

  // risk gauge history (sparkline)
  riskHistory: [28, 30, 27, 31, 33, 30, 34, 36, 35, 38, 37, 41, 39, 38],

  // recurring DCA ladder
  parsedDCA: {
    intent: 'Recurring DCA ladder',
    summary:
      'Buy 100 USDC of DEEP every day for 14 days on Deepbook — regardless of price — to average your entry over time.',
    params: [
      { k: 'Trigger', v: 'daily · 14×' },
      { k: 'Action', v: 'Buy · scheduled' },
      { k: 'Budget cap', v: '1,400 USDC' },
      { k: 'Venue', v: 'Deepbook · DEEP/USDC' },
      { k: 'Per-tranche', v: '100 USDC' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=1400, spent=Σ',
        note: 'self-enforced budget ceiling',
      },
      {
        op: 'MoveCall',
        fn: 'deepbook::place_limit_order',
        args: 'pool=DEEP/USDC, qty=1010, px=0.099',
        note: 'today’s tranche',
      },
      {
        op: 'MoveCall',
        fn: 'clock::schedule_next',
        args: 'interval=24h, runs_left=13',
        note: 'recurring trigger',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="dca"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Slippage bound',
        detail: 'Limit orders at mid — fills within your 0.8% cap.',
      },
      {
        level: 'pass',
        label: 'Schedule integrity',
        detail: 'Interval anchored to on-chain Clock — no missed or double runs.',
      },
      {
        level: 'warn',
        label: 'Budget runway',
        detail: '14 tranches need 1,400 USDC; ensure the budget covers the full ladder.',
      },
      {
        level: 'pass',
        label: 'Pool freshness',
        detail: 'Deepbook DEEP/USDC pool active · last trade 5s ago.',
      },
    ],
    meta: {
      name: 'DEEP Accumulation DCA',
      strategy: 'dca',
      budget: 1400,
      scope: 'DEEP/USDC',
      slip: 0.8,
    },
    backtest: {
      curve: [
        100, 100.5, 101.0, 100.7, 101.4, 102.0, 101.6, 102.5, 103.0, 102.7, 103.6, 104.1, 103.9,
        104.7, 105.2, 105.8,
      ],
      stats: [
        { k: 'Tranches', v: '14' },
        { k: 'Avg cost basis', v: '$0.094' },
        { k: 'vs lump-sum', v: '+2.8%' },
      ],
      verdict:
        'Spreading 14 daily tranches would have beaten a single lump-sum entry by ~2.8% and smoothed volatility.',
    },
  },

  // conditional downside hedge
  parsedHedge: {
    intent: 'Conditional downside hedge',
    summary:
      'If WAL falls below $0.55, open a short hedge funded up to 800 USDC on Deepbook to offset your spot exposure.',
    params: [
      { k: 'Trigger', v: 'WAL < $0.55' },
      { k: 'Action', v: 'Open hedge' },
      { k: 'Budget cap', v: '800 USDC' },
      { k: 'Venue', v: 'Deepbook · WAL/USDC' },
      { k: 'Max size', v: '800 USDC' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=800, spent=Σ',
        note: 'self-enforced budget ceiling',
      },
      {
        op: 'MoveCall',
        fn: 'oracle::assert_price_below',
        args: 'pair=WAL/USDC, px=0.55',
        note: 'trigger guard',
      },
      {
        op: 'MoveCall',
        fn: 'deepbook::place_limit_order',
        args: 'pool=WAL/USDC, side=sell, qty=Δ',
        note: 'open hedge leg',
      },
      {
        op: 'MoveCall',
        fn: 'policy::log_activity',
        args: 'agent=0x7a3f, action="hedge"',
        note: 'on-chain activity log',
      },
    ],
    guardian: [
      {
        level: 'pass',
        label: 'Slippage bound',
        detail: 'Worst-case fill 1.1% — under your 1.5% cap.',
      },
      {
        level: 'warn',
        label: 'Directional risk',
        detail: 'A hedge can lose if WAL recovers above trigger — sized to offset, not speculate.',
      },
      {
        level: 'pass',
        label: 'Pool freshness',
        detail: 'Deepbook WAL/USDC pool active · last trade 9s ago.',
      },
      {
        level: 'pass',
        label: 'Budget ceiling',
        detail: 'Policy hard-caps hedge spend at 800 USDC on-chain.',
      },
    ],
    meta: {
      name: 'WAL Downside Hedge',
      strategy: 'hedge',
      budget: 800,
      scope: 'WAL/USDC',
      slip: 1.5,
    },
    backtest: {
      curve: [
        100, 98.8, 97.0, 95.2, 96.4, 95.0, 96.1, 97.5, 96.9, 98.2, 97.6, 98.9, 99.4, 98.7, 99.8,
        100.6,
      ],
      stats: [
        { k: 'Trigger hits', v: '2' },
        { k: 'Offset captured', v: '71%' },
        { k: 'vs unhedged', v: '+5.3%' },
      ],
      verdict:
        'The hedge would have fired twice and offset 71% of downside, ending 5.3% ahead of an unhedged position.',
    },
  },

  // seed notifications shown in the bell dropdown
  notifications: [
    { id: 1, kind: 'exec', title: 'Agent bought 1,010 DEEP', time: '11:09', read: false },
    { id: 2, kind: 'guardian', title: 'Guardian blocked a WAL order', time: '09:15', read: false },
    { id: 3, kind: 'retry', title: 'DCA order retried and filled', time: '08:48', read: true },
    {
      id: 4,
      kind: 'policy',
      title: 'Rescue Grid policy expires in 13 days',
      time: 'Yesterday',
      read: true,
    },
  ],

  // risk-score factor breakdown (agent reasoning) — weights sum to the score
  riskFactors: {
    idle: {
      score: 38,
      rationale:
        'Markets are calm. Volatility and liquidity are within normal bands; no policy trigger is near. The agent is monitoring and holding.',
      factors: [
        { k: 'Volatility (1h)', w: 13, lv: 'warn' },
        { k: 'Liquidity depth', w: 8, lv: 'safe' },
        { k: 'Concentration', w: 11, lv: 'warn' },
        { k: 'Trend / momentum', w: 6, lv: 'safe' },
      ],
    },
    crashing: {
      score: 82,
      rationale:
        'SUI is in free-fall (−8.4% / 6m) and the order book is thinning. Volatility dominates the score. The rescue-grid trigger has been breached — the agent is authorized to act.',
      factors: [
        { k: 'Volatility (1h)', w: 41, lv: 'danger' },
        { k: 'Liquidity depth', w: 18, lv: 'danger' },
        { k: 'Concentration', w: 15, lv: 'warn' },
        { k: 'Trend / momentum', w: 8, lv: 'warn' },
      ],
    },
    rescued: {
      score: 46,
      rationale:
        'Rescue rungs filled and price is stabilising. Volatility is decaying; the agent spent 184 of 500 USDC and is back to monitoring with budget in reserve.',
      factors: [
        { k: 'Volatility (1h)', w: 19, lv: 'warn' },
        { k: 'Liquidity depth', w: 10, lv: 'safe' },
        { k: 'Concentration', w: 12, lv: 'warn' },
        { k: 'Trend / momentum', w: 5, lv: 'safe' },
      ],
    },
  },

  // parsed result for the RISKY intent — Guardian blocks it
  parsedRisky: {
    intent: 'Unbounded all-in grid',
    summary:
      'Route the entire 12,480 USDC free balance into a single SUI/USDC grid with no slippage limit. This exceeds safe concentration and removes execution protection.',
    params: [
      { k: 'Trigger', v: 'immediate' },
      { k: 'Action', v: 'Buy grid · 8 rungs' },
      { k: 'Budget cap', v: '12,480 USDC' },
      { k: 'Venue', v: 'Deepbook v3 · SUI/USDC' },
      { k: 'Slippage', v: 'unbounded' },
    ],
    ptb: [
      {
        op: 'MoveCall',
        fn: 'policy::assert_within_budget',
        args: 'cap=12480, spent=0',
        note: 'budget = entire balance',
      },
      {
        op: 'MoveCall',
        fn: 'deepbook::place_market_order',
        args: 'pool=SUI/USDC, qty=ALL, slippage=∞',
        note: 'no slippage guard',
      },
    ],
    guardian: [
      {
        level: 'fail',
        label: 'Capital concentration',
        detail: '100% of your balance routes to one pair — a single depeg wipes the position.',
      },
      {
        level: 'fail',
        label: 'Slippage bound',
        detail: 'No slippage cap set — a thin book could fill orders far from market.',
      },
      {
        level: 'warn',
        label: 'Budget ceiling',
        detail: 'Budget equals your entire free balance; nothing reserved for other strategies.',
      },
      {
        level: 'pass',
        label: 'Pool freshness',
        detail: 'Deepbook SUI/USDC pool active · last trade 2s ago.',
      },
    ],
  },

  // price sparkline for SUI
  suiSpark: [
    4.61, 4.58, 4.55, 4.59, 4.52, 4.48, 4.51, 4.44, 4.4, 4.43, 4.38, 4.31, 4.27, 4.3, 4.24, 4.19,
    4.182,
  ],

  // wallet token holdings — values sum exactly to portfolio.total (demo)
  holdings: [
    { sym: 'USDC', amount: 12480.0, value: 12480.0, role: 'Free budget', state: 'free' },
    { sym: 'SUI', amount: 5129.6, value: 21450.0, role: 'Rescue Grid', state: 'deployed' },
    { sym: 'DEEP', amount: 82454.45, value: 8600.0, role: 'DCA Ladder', state: 'deployed' },
    { sym: 'WAL', amount: 9090.18, value: 5700.55, role: 'Hedge', state: 'deployed' },
  ],

  // account identity + session (demo persona)
  account: {
    handle: 'ywang.sui',
    addr: '0x7a3f…c91e',
    fullAddr: '0x7a3f2b9c14e0d8a6f5c3b1907e2d4a6c8b0f1e3d5a7c9b24e6f8a0c1d3e2c91e',
    provider: 'Google',
    email: 'yw•••••@gmail.com',
    avatar: 'YW',
    memberSince: 'May 2026',
    network: 'Sui Testnet',
    salt: '0x9f3c…a017',
    currentEpoch: 612,
    maxEpoch: 614,
    sessionExpires: '~36h',
    ephemeralKey: 'ed25519 · 0x4c8d…71ab',
    gas: { sponsored: 47, saved: 0.0421, station: 'Sentry Gas Station' },
    localAgent: {
      vault: {
        standard: 'Open Wallet Standard v1.3',
        path: '~/.ows',
        status: 'ready',
        wallets: 3,
        policies: 4,
        apiTokens: 2,
        audit: '~/.ows/logs/audit.jsonl',
      },
      secretStore: {
        path: 'OS keychain + ~/.sentry/secrets',
        status: 'locked',
        exchangeKeys: 2,
        rotation: '30d',
      },
      bridge: {
        status: 'paired',
        relay: 'Cloudflare Worker bridge',
        session: 'AgentSession DO',
        transport: 'outbound WebSocket',
        heartbeat: '30s',
        staleAfter: '90s',
        commandScope: 'typed requests only',
      },
      controls: [
        { k: 'Chain wallet signing', v: 'OWS policy token', status: 'ready' },
        { k: 'Worker bridge', v: 'paired outbound WebSocket', status: 'paired' },
        { k: 'Exchange key scope', v: 'read + trade only', status: 'safe' },
        { k: 'Withdrawals', v: 'never imported', status: 'blocked' },
        { k: 'Asset inventory', v: 'chain RPC + venue balances', status: 'syncing' },
      ],
      venues: [
        {
          id: 'sui-testnet',
          name: 'Sui Testnet',
          kind: 'chain',
          authority: 'MoveGate wrapper + OWS signer',
          custody: 'self-custody',
          assets: 'SUI · DBUSDC · DEEP',
          status: 'live',
          permissions: 'sign PTB · read balances',
        },
        {
          id: 'base',
          name: 'Base / EVM',
          kind: 'chain',
          authority: 'OWS EVM account',
          custody: 'self-custody',
          assets: 'ETH · USDC',
          status: 'planned',
          permissions: 'message/tx signing',
        },
        {
          id: 'hyperliquid',
          name: 'Hyperliquid',
          kind: 'perps',
          authority: 'agent wallet + subaccount',
          custody: 'venue subaccount',
          assets: 'USDC margin',
          status: 'planned',
          permissions: 'orders · TP/SL · reduce-only',
        },
        {
          id: 'binance',
          name: 'Binance',
          kind: 'cex',
          authority: 'trade-only API key',
          custody: 'exchange subaccount',
          assets: 'USDC · BTC · ETH',
          status: 'linked',
          permissions: 'read · place/cancel orders',
        },
        {
          id: 'okx',
          name: 'OKX',
          kind: 'cex',
          authority: 'trade-only API key',
          custody: 'exchange subaccount',
          assets: 'USDC · SUI',
          status: 'linked',
          permissions: 'read · place/cancel orders',
        },
      ],
      assetSources: [
        {
          source: 'OWS wallets',
          detail: 'CAIP-10 accounts',
          cadence: 'on demand',
          status: 'ready',
        },
        {
          source: 'Sui RPC',
          detail: 'coin objects + policy objects',
          cadence: '5s',
          status: 'live',
        },
        {
          source: 'CEX private APIs',
          detail: 'balances + open orders',
          cadence: '15s',
          status: 'scoped',
        },
        {
          source: 'Public market feeds',
          detail: 'prices + funding + depth',
          cadence: '1s-60s',
          status: 'mixed',
        },
      ],
    },
    // connected centralized exchanges (read + trade, never withdraw)
    exchanges: [
      {
        id: 'binance',
        name: 'Binance',
        c: '#F0B90B',
        status: 'connected',
        balance: 8420.0,
        perms: 'Read · Trade',
        withdraw: false,
        key: 'bnb_••••7c2a',
      },
      {
        id: 'okx',
        name: 'OKX',
        c: '#AEB7C2',
        status: 'connected',
        balance: 3180.0,
        perms: 'Read · Trade',
        withdraw: false,
        key: 'okx_••••1f90',
      },
      {
        id: 'bybit',
        name: 'Bybit',
        c: '#F7A600',
        status: 'disconnected',
        balance: 0,
        perms: '—',
        withdraw: false,
        key: null,
      },
    ],
  },
};

// attach the Markets / catalog / risk / active / datasources demo data + taxonomies
attachMarketData(RG);
