// Shared venue catalog for the Local Agent-first multivenue target.
// Pure data + helpers so frontend, Worker and the future daemon can import it.

export const BUDGET_ENFORCEMENT = {
  NONE: 'none',
  LOCAL_ACCOUNTING: 'local_accounting',
  CHAIN_ACCOUNTING: 'chain_accounting',
  CUSTODY: 'custody',
  VENUE_LIMIT: 'venue_limit',
};

export const TARGET_VENUE_IDS = ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx'];

export const TARGET_EXECUTION_VENUES = ['OKX', 'Raydium', 'Uniswap', 'Hyperliquid'];

export const TARGET_VENUES = [
  {
    id: 'solana-mainnet',
    name: 'Solana',
    short_name: 'Solana',
    kind: 'chain',
    chain_id: 'solana:mainnet',
    role: 'on-chain execution',
    color: '#9945FF',
    status: 'read-only',
    adapter_status: 'trade-task-and-receipt-skeleton',
    custody_model: 'self_custody',
    authority_model: 'native delegation / PDA guard',
    authorization_model: 'native_delegation',
    enforcement_layer: 'chain',
    chain_enforced: false,
    budget_enforcement: BUDGET_ENFORCEMENT.NONE,
    funds_custodied: false,
    capabilities: ['read', 'sign', 'submit_tx', 'place_order', 'cancel_order'],
    permissions: 'read balances · submit tx · place/cancel DEX orders',
    assets: 'SOL · USDC · SPL tokens',
    signer: 'OWS Solana account or Solana CLI',
    default_adapters: ['Jupiter', 'Raydium', 'Orca'],
    required_next: [
      'define delegate/PDA authority shape',
      'connect wallet/account discovery beyond env-based read config',
      'add transaction construction, simulation and signing handoff',
      'run live RPC receipt dry-run against a real signature',
    ],
  },
  {
    id: 'ethereum-mainnet',
    name: 'Ethereum',
    short_name: 'Ethereum',
    kind: 'chain',
    chain_id: 'eip155:1',
    role: 'on-chain execution',
    color: '#7B8BFF',
    status: 'read-only',
    adapter_status: 'trade-task-and-receipt-skeleton',
    custody_model: 'smart_account',
    authority_model: 'Safe module / ERC-4337 session key',
    authorization_model: 'smart_account_module',
    enforcement_layer: 'chain',
    chain_enforced: false,
    budget_enforcement: BUDGET_ENFORCEMENT.NONE,
    funds_custodied: false,
    capabilities: ['read', 'sign', 'submit_tx'],
    permissions: 'read balances · submit tx · scoped DeFi calls',
    assets: 'ETH · USDC · ERC-20',
    signer: 'OWS EVM account or smart account signer',
    default_adapters: ['Safe', 'Uniswap', 'Aave'],
    required_next: [
      'choose Safe/session-key guard model',
      'connect wallet/account discovery beyond env-based read config',
      'add transaction build/simulation and signing handoff',
      'run live RPC receipt dry-run against a real transaction hash',
    ],
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    short_name: 'Hyperliquid',
    kind: 'perps',
    chain_id: 'hyperliquid:mainnet',
    role: 'perps and spot venue',
    color: '#2EE6CE',
    status: 'read-only',
    adapter_status: 'trade-task-skeleton',
    custody_model: 'subaccount',
    authority_model: 'API wallet / agent wallet + subaccount',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    chain_enforced: false,
    budget_enforcement: BUDGET_ENFORCEMENT.VENUE_LIMIT,
    funds_custodied: false,
    capabilities: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    permissions: 'read · place/cancel orders · set leverage · no withdrawals',
    assets: 'USDC · spot · perps positions',
    signer: 'OS keychain agent wallet handle',
    default_adapters: ['Hyperliquid perps', 'Hyperliquid account read'],
    required_next: [
      'implement agent wallet import flow',
      'run live agent wallet userRole dry-run against a real account',
      'run live submit verification with nonce store enabled',
      'wire production UI dispatch readiness',
    ],
  },
  {
    id: 'okx',
    name: 'OKX',
    short_name: 'OKX',
    kind: 'cex',
    chain_id: null,
    role: 'centralized exchange venue',
    color: '#AEB7C2',
    status: 'linked',
    adapter_status: 'trade-task-skeleton',
    custody_model: 'exchange_subaccount',
    authority_model: 'trade-only API key + subaccount',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    chain_enforced: false,
    budget_enforcement: BUDGET_ENFORCEMENT.VENUE_LIMIT,
    funds_custodied: false,
    capabilities: ['read', 'place_order', 'cancel_order'],
    permissions: 'read · place/cancel orders · no withdrawals',
    assets: 'USDC · BTC · ETH · SOL',
    signer: 'OS keychain API key handle',
    default_adapters: ['OKX spot', 'OKX account read'],
    required_next: [
      'verify live read+trade scope and withdrawal disabled',
      'harden venue-side proof and production UI wiring',
      'promote trade task schema to dispatch-ready execution adapter',
    ],
  },
];

export const LEGACY_DEMO_VENUES = [
  {
    id: 'sui-testnet-demo',
    name: 'Sui Testnet Demo',
    short_name: 'Sui',
    kind: 'chain',
    chain_id: 'sui:testnet',
    role: 'legacy demo path',
    color: '#5AA6FF',
    status: 'live',
    adapter_status: 'demo-runtime',
    custody_model: 'self_custody',
    authority_model: 'MoveGate wrapper + SentryPolicyWrapper',
    authorization_model: 'sentry_contract',
    enforcement_layer: 'chain',
    chain_enforced: true,
    budget_enforcement: BUDGET_ENFORCEMENT.CHAIN_ACCOUNTING,
    funds_custodied: false,
    capabilities: ['read', 'sign', 'submit_tx'],
    permissions: 'sign PTB · read balances · record accounting receipt',
    assets: 'SUI · DBUSDC · DEEP',
    signer: 'Worker demo signer / OWS future signer',
    default_adapters: ['DeepBook'],
    required_next: [
      'keep as demo until target venues ship',
      'do not present as custody budget',
      'separate from production local-agent path',
    ],
  },
];

export function getTargetVenues() {
  return TARGET_VENUES.map((v) => ({ ...v, target: true }));
}

export function getLegacyDemoVenues() {
  return LEGACY_DEMO_VENUES.map((v) => ({ ...v, target: false }));
}

export function getAllVenues() {
  return [...getTargetVenues(), ...getLegacyDemoVenues()];
}

export function getVenueById(id) {
  return getAllVenues().find((v) => v.id === id) || null;
}

export function buildVenueAccounts() {
  return getAllVenues().map((v) => ({
    id: v.id,
    name: v.name,
    kind: v.kind,
    authority: v.authority_model,
    custody: v.custody_model,
    assets: v.assets,
    status: v.status,
    permissions: v.permissions,
    capabilities: v.capabilities,
    authorization_model: v.authorization_model,
    enforcement_layer: v.enforcement_layer,
    budget_enforcement: v.budget_enforcement,
    funds_custodied: v.funds_custodied,
    target: v.target,
  }));
}

export function buildExchangeAccounts() {
  return TARGET_VENUES.filter((v) => v.kind === 'cex').map((v) => ({
    id: v.id,
    name: v.name,
    c: v.color,
    status: v.status === 'linked' ? 'connected' : v.status,
    balance: v.id === 'okx' ? 3180.0 : 0,
    perms: 'Read · Trade',
    withdraw: false,
    key: v.id === 'okx' ? 'okx_••••1f90' : null,
    authorization_model: v.authorization_model,
    budget_enforcement: v.budget_enforcement,
  }));
}

export function buildAssetSources() {
  return [
    {
      source: 'OWS wallets',
      detail: 'CAIP-10 accounts for Solana and Ethereum',
      cadence: 'on demand',
      status: 'ready',
    },
    {
      source: 'Solana RPC',
      detail: 'SPL balances, token accounts, signatures',
      cadence: '15s',
      status: 'read-only',
    },
    {
      source: 'Ethereum RPC',
      detail: 'ETH/ERC-20 balances, Safe/account state',
      cadence: '15s',
      status: 'read-only',
    },
    {
      source: 'Hyperliquid API',
      detail: 'subaccount balances, positions, open orders, fills',
      cadence: '15s',
      status: 'read-only',
    },
    {
      source: 'OKX private API',
      detail: 'balances, open orders, fills, permissions',
      cadence: '15s',
      status: 'read-only',
    },
    {
      source: 'Sui RPC demo',
      detail: 'legacy policy objects and DeepBook readiness',
      cadence: '5s',
      status: 'live',
    },
  ];
}

export function getVenueCatalogSnapshot() {
  const target = getTargetVenues();
  const legacy = getLegacyDemoVenues();
  return {
    status: 'ok',
    production_default: 'local_agent',
    target_venues: target,
    target_chains: target.filter((v) => v.kind === 'chain'),
    target_perps: target.filter((v) => v.kind === 'perps'),
    target_exchanges: target.filter((v) => v.kind === 'cex'),
    legacy_demo: legacy,
    target_venue_ids: TARGET_VENUE_IDS,
    readiness: {
      target_count: target.length,
      linked_count: target.filter((v) => ['linked', 'live'].includes(v.status)).length,
      planned_count: target.filter((v) => v.status === 'planned').length,
      custody_ready_count: target.filter((v) => v.funds_custodied).length,
    },
  };
}
