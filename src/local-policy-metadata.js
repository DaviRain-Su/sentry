import {
  ETHEREUM_MAINNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  getTokenBySymbol,
} from '../core/token-registry.js';

const SOLANA_USDC = getTokenBySymbol(SOLANA_MAINNET_CHAIN_ID, 'USDC');
const SOLANA_SOL = getTokenBySymbol(SOLANA_MAINNET_CHAIN_ID, 'SOL');
const ETHEREUM_USDC = getTokenBySymbol(ETHEREUM_MAINNET_CHAIN_ID, 'USDC');
const ETHEREUM_WETH = getTokenBySymbol(ETHEREUM_MAINNET_CHAIN_ID, 'WETH');

export const LOCAL_POLICY_SOLANA_OWNER = '11111111111111111111111111111111';
export const LOCAL_POLICY_SOLANA_USDC_MINT = SOLANA_USDC.address;
export const LOCAL_POLICY_SOLANA_SOL_MINT = SOLANA_SOL.address;
export const LOCAL_POLICY_ETHEREUM_ACCOUNT = '0x1111111111111111111111111111111111111111';
export const LOCAL_POLICY_ETHEREUM_USDC = ETHEREUM_USDC.address;
export const LOCAL_POLICY_ETHEREUM_WETH = ETHEREUM_WETH.address;
export const LOCAL_POLICY_TEMPLATE_VENUE_IDS = [
  'solana-mainnet',
  'ethereum-mainnet',
  'hyperliquid',
  'okx',
];
export const LOCAL_POLICY_SCENARIOS = ['funding-arb', 'spot'];

export function localPolicyTemplateVenueIds(values = {}) {
  const scenario = values.scenario || 'funding-arb';
  if (!LOCAL_POLICY_SCENARIOS.includes(scenario)) return [];
  const legs = Array.isArray(values.legs) ? values.legs : defaultLegsFor(scenario);
  return unique(
    legs
      .map((leg) => venueIdFor(leg.venue))
      .filter((venueId) => LOCAL_POLICY_TEMPLATE_VENUE_IDS.includes(venueId))
  );
}

export function hasLocalPolicyTemplates(values = {}) {
  return localPolicyTemplateVenueIds(values).length > 0;
}

export function localPolicyAuthorizationIssues(values = {}, authorizationContext = {}) {
  return localPolicyTemplateVenueIds(values).flatMap((venueId) => {
    if (venueId === 'okx' || venueId === 'hyperliquid') {
      const state = authorizationStateFor(authorizationContext, venueId);
      const stateIssue = venueAuthorizationStateIssue(state, venueId);
      if (stateIssue) return [stateIssue];
      const key = venueKeyContext(authorizationContext, venueId);
      if (key.key_handle) {
        if (venueId === 'hyperliquid') {
          if (!key.read_account_address) {
            return [
              {
                venue_id: venueId,
                code: 'HYPERLIQUID_READ_ADDRESS_REQUIRED',
                message:
                  'Hyperliquid local policy templates require the real master/subaccount read address from authorization.state.',
              },
            ];
          }
          if (!key.agent_wallet_address) {
            return [
              {
                venue_id: venueId,
                code: 'HYPERLIQUID_AGENT_WALLET_REQUIRED',
                message:
                  'Hyperliquid local policy templates require linked agent-wallet metadata from authorization.state.',
              },
            ];
          }
        }
        return [];
      }
      return [
        {
          venue_id: venueId,
          code: 'LOCAL_VENUE_KEY_REF_REQUIRED',
          message: `${venueId} local policy templates require a linked venue key handle from authorization.state.`,
        },
      ];
    }
    if (venueId === 'solana-mainnet') {
      const account =
        walletAccountFromState(authorizationContext, venueId) ||
        walletAccountFromRefs(authorizationContext, SOLANA_MAINNET_CHAIN_ID);
      if (account?.address) return [];
      return [
        {
          venue_id: venueId,
          code: 'LOCAL_WALLET_REF_REQUIRED',
          message:
            'Solana local policy templates require a linked OWS Solana account from wallet.refs.',
        },
      ];
    }
    if (venueId === 'ethereum-mainnet') {
      const account =
        walletAccountFromState(authorizationContext, venueId) ||
        walletAccountFromRefs(authorizationContext, ETHEREUM_MAINNET_CHAIN_ID);
      if (account?.address) return [];
      return [
        {
          venue_id: venueId,
          code: 'LOCAL_WALLET_REF_REQUIRED',
          message:
            'Ethereum local policy templates require a linked OWS Ethereum account from wallet.refs.',
        },
      ];
    }
    return [];
  });
}

export function defaultLegsFor(scenario) {
  if (scenario === 'spot') {
    return [
      { venue: 'OKX', side: 'long', pct: 50 },
      { venue: 'Raydium', side: 'short', pct: 50 },
    ];
  }
  if (scenario === 'funding-arb') {
    return [
      { venue: 'OKX', side: 'short', pct: 50 },
      { venue: 'Hyperliquid', side: 'long', pct: 50 },
    ];
  }
  return [
    { venue: 'Bluefin', side: 'short', pct: 50 },
    { venue: 'Hyperliquid', side: 'long', pct: 50 },
  ];
}

export function hashText(value) {
  let hash = 2166136261;
  for (const ch of String(value || '')) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeIdPart(value) {
  return String(value || 'policy')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function randomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(data);
  } else {
    for (let index = 0; index < data.length; index += 1) {
      data[index] = Math.floor(Math.random() * 256);
    }
  }
  return [...data].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function venueIdFor(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('hyperliquid')) return 'hyperliquid';
  if (text.includes('okx')) return 'okx';
  if (text.includes('ethereum') || text.includes('uniswap') || text.includes('safe')) {
    return 'ethereum-mainnet';
  }
  if (
    text.includes('solana') ||
    text.includes('raydium') ||
    text.includes('orca') ||
    text.includes('jupiter')
  ) {
    return 'solana-mainnet';
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stateList(context = {}) {
  return asArray(
    context.authorizationState?.states ||
      context.authorization_state?.states ||
      context.authorizationSnapshot?.states ||
      context.authorization_snapshot?.states
  );
}

function walletList(context = {}) {
  return asArray(
    context.walletRefs?.wallets ||
      context.wallet_refs?.wallets ||
      context.walletSnapshot?.wallets ||
      context.wallet_snapshot?.wallets
  );
}

function authorizationStateFor(context = {}, venueId) {
  return stateList(context).find((state) => state?.venue_id === venueId) || null;
}

function authorizationRefString(state) {
  return (
    state?.authorization_ref?.ref || state?.authorization_ref?.id || state?.authorization_ref || ''
  );
}

function blockingAccessIssue(state) {
  return asArray(state?.access_issues || state?.accessIssues).find(
    (issue) => issue?.severity === 'blocked' || issue?.severity === 'error'
  );
}

function venueAuthorizationStateIssue(state, venueId) {
  if (!state) {
    return {
      venue_id: venueId,
      code: 'LOCAL_VENUE_KEY_REF_REQUIRED',
      message: `${venueId} local policy templates require a linked venue key handle from authorization.state.`,
    };
  }
  const blocking = blockingAccessIssue(state);
  if (['missing', 'blocked', 'error', 'revoked'].includes(state.status) || blocking) {
    return {
      venue_id: venueId,
      code: blocking?.code || 'LOCAL_VENUE_AUTHORIZATION_NOT_READY',
      message:
        blocking?.message ||
        `${venueId} local authorization is ${state.status || 'not ready'} and cannot be used for local policy registration.`,
    };
  }
  return null;
}

function keyHandleFromAuthorizationState(state, venueId) {
  const ref = authorizationRefString(state);
  const prefix = `${venueId}:`;
  const defaultRef = `${venueId}:key-handle`;
  if (
    typeof ref === 'string' &&
    ref.startsWith(prefix) &&
    ref.length > prefix.length &&
    ref !== defaultRef &&
    state?.status !== 'missing'
  ) {
    return ref.slice(prefix.length);
  }
  return state?.key_handle || state?.keyHandle || null;
}

function venueKeyContext(context = {}, venueId) {
  const state = authorizationStateFor(context, venueId);
  if (!state) return {};
  const keyHandle = keyHandleFromAuthorizationState(state, venueId);
  const ref = authorizationRefString(state);
  const defaultRef = `${venueId}:key-handle`;
  return {
    ...(keyHandle ? { key_handle: keyHandle } : {}),
    ...(ref && ref !== defaultRef
      ? {
          authorization_ref: ref,
        }
      : {}),
    ...(state.account_ref ? { account_ref: state.account_ref } : {}),
    ...(state.read_state?.read_account_address
      ? { read_account_address: state.read_state.read_account_address }
      : {}),
    ...(state.agent_wallet?.address ? { agent_wallet_address: state.agent_wallet.address } : {}),
  };
}

function walletAccountFromState(context = {}, venueId) {
  const state = authorizationStateFor(context, venueId);
  const account = state?.wallet_ref?.account;
  if (!account?.chain_id || !account?.address) return null;
  return {
    ...account,
    wallet_id: state.wallet_ref.wallet_id,
    wallet_display_name: state.wallet_ref.display_name,
  };
}

function walletAccountFromRefs(context = {}, chainId) {
  for (const wallet of walletList(context)) {
    for (const account of asArray(wallet.accounts)) {
      if (account?.chain_id !== chainId || !account?.address) continue;
      return {
        ...account,
        wallet_id: wallet.wallet_id,
        wallet_display_name: wallet.display_name,
      };
    }
  }
  return null;
}

function chainAccountContext(context = {}, venueId, chainId, fallbackAddress) {
  const account =
    walletAccountFromState(context, venueId) || walletAccountFromRefs(context, chainId) || null;
  const address = account?.address || fallbackAddress;
  return {
    address,
    capabilities: unique(account?.capabilities || ['read', 'sign', 'submit_tx']),
    wallet_id: account?.wallet_id || null,
    caip10: account?.caip10 || (address ? `${chainId}:${address}` : null),
  };
}

function slippageBpsFor(slip) {
  return Math.round(Number(slip) * 100);
}

function baseUnitAmountFor(notional) {
  return String(Math.max(1, Math.round(Number(notional) * 1_000_000)));
}

function adapterForVenueLabel(label, fallback) {
  const text = String(label || '').toLowerCase();
  if (text.includes('orca')) return 'orca';
  if (text.includes('raydium')) return 'raydium';
  if (text.includes('jupiter')) return 'jupiter';
  if (text.includes('safe')) return 'safe';
  if (text.includes('erc4337') || text.includes('erc-4337')) return 'erc4337';
  if (text.includes('uniswap')) return 'uniswap';
  return fallback;
}

function localTaskTemplateForLeg({ leg, index, budget, slip, scenario, authorizationContext }) {
  const venueId = venueIdFor(leg.venue);
  const side = leg.side === 'short' ? 'sell' : 'buy';
  const notional = Math.max(1, (Number(budget) * (Number(leg.pct) || 50)) / 100);
  const notionalText = notional.toFixed(2);
  const slippageBps = slippageBpsFor(slip);
  const amount = baseUnitAmountFor(notional);
  const seed = `${scenario}-${leg.venue}-${leg.side}-${index}-${Date.now()}-${randomHex(4)}`;
  if (venueId === 'hyperliquid') {
    return {
      venue_id: 'hyperliquid',
      action_type: 'place_order',
      ...venueKeyContext(authorizationContext, 'hyperliquid'),
      coin: 'BTC',
      side,
      orderType: 'limit',
      size: '0.001',
      price: '90000',
      tif: 'Gtc',
      cloid: `0x${hashText(seed).repeat(4).slice(0, 32)}`,
      max_quote_amount: notionalText,
      max_notional_usd: notionalText,
      max_slippage_bps: slippageBps,
      slippageBps,
    };
  }
  if (venueId === 'okx') {
    return {
      venue_id: 'okx',
      action_type: 'place_order',
      ...venueKeyContext(authorizationContext, 'okx'),
      instrument: 'BTC-USDT',
      side,
      orderType: 'limit',
      size: '0.001',
      price: '88000',
      clientOrderId: `sentry-ui-${hashText(seed).slice(0, 12)}`,
      max_quote_amount: notionalText,
      max_slippage_bps: slippageBps,
      slippageBps,
    };
  }
  if (venueId === 'solana-mainnet') {
    const buy = side === 'buy';
    const account = chainAccountContext(
      authorizationContext,
      'solana-mainnet',
      SOLANA_MAINNET_CHAIN_ID,
      LOCAL_POLICY_SOLANA_OWNER
    );
    return {
      venue_id: 'solana-mainnet',
      action_type: 'swap',
      account: {
        owner: account.address,
        capabilities: account.capabilities,
        ...(account.wallet_id ? { wallet_id: account.wallet_id } : {}),
        ...(account.caip10 ? { caip10: account.caip10 } : {}),
      },
      adapter: adapterForVenueLabel(leg.venue, 'jupiter'),
      inputMint: buy ? LOCAL_POLICY_SOLANA_USDC_MINT : LOCAL_POLICY_SOLANA_SOL_MINT,
      outputMint: buy ? LOCAL_POLICY_SOLANA_SOL_MINT : LOCAL_POLICY_SOLANA_USDC_MINT,
      amount,
      quoteId: `solana-${hashText(seed).slice(0, 20)}`,
      maxInputAmount: amount,
      max_quote_amount: notionalText,
      max_notional_usd: notionalText,
      max_slippage_bps: slippageBps,
      slippageBps,
    };
  }
  if (venueId === 'ethereum-mainnet') {
    const buy = side === 'buy';
    const account = chainAccountContext(
      authorizationContext,
      'ethereum-mainnet',
      ETHEREUM_MAINNET_CHAIN_ID,
      LOCAL_POLICY_ETHEREUM_ACCOUNT
    );
    return {
      venue_id: 'ethereum-mainnet',
      action_type: 'swap',
      account: {
        account: account.address,
        capabilities: account.capabilities,
        ...(account.wallet_id ? { wallet_id: account.wallet_id } : {}),
        ...(account.caip10 ? { caip10: account.caip10 } : {}),
      },
      adapter: adapterForVenueLabel(leg.venue, 'uniswap'),
      inputToken: buy ? LOCAL_POLICY_ETHEREUM_USDC : LOCAL_POLICY_ETHEREUM_WETH,
      outputToken: buy ? LOCAL_POLICY_ETHEREUM_WETH : LOCAL_POLICY_ETHEREUM_USDC,
      amount,
      quoteId: `ethereum-${hashText(seed).slice(0, 20)}`,
      maxInputAmount: amount,
      max_quote_amount: notionalText,
      max_notional_usd: notionalText,
      max_slippage_bps: slippageBps,
      slippageBps,
    };
  }
  return null;
}

function liveStrategyHash(text, fallback) {
  return `local-${hashText(text || fallback)}`;
}

export function buildLocalPolicyMetadata({
  values = {},
  meta = {},
  text = '',
  targetAgent = 'codex',
  authorizationContext = {},
}) {
  const scenario = values.scenario || 'funding-arb';
  const legs = Array.isArray(values.legs) ? values.legs : defaultLegsFor(scenario);
  const targetVenueIds = unique(legs.map((leg) => venueIdFor(leg.venue)));
  const budget = Number(values.budget) || Number(meta.budget) || 500;
  const slip = Number(values.slip) || Number(meta.slip) || 1;
  const policySeed = `${scenario}-${text || meta.name}-${budget}-${targetVenueIds.join('-')}`;
  return {
    policy_id: `ui-${safeIdPart(scenario)}-${hashText(policySeed)}`,
    display_name: meta.name || `${scenario} policy`,
    target_agent: targetAgent || 'codex',
    target_venue_ids: targetVenueIds.length ? targetVenueIds : ['hyperliquid', 'okx'],
    strategy_hash: liveStrategyHash(text, policySeed),
    strategy: {
      source: 'new_strategy_ui',
      scenario,
      intent: text || meta.name,
      mode: 'local_agent',
    },
    trigger:
      scenario === 'funding-arb'
        ? {
            type: 'funding_rate_above',
            venue_id: 'hyperliquid',
            symbol: 'BTC',
            funding_rate_above: 0.0001,
          }
        : {
            type: 'price_above',
            venue_id: targetVenueIds[0] || 'okx',
            symbol: 'BTC',
            price_above: 0,
          },
    constraints: {
      max_notional_usd: String(budget),
      max_slippage_bps: Math.round(slip * 100),
      expiry_days: Number(values.expiry) || 14,
      require_approval: Boolean(values.requireApproval),
      leverage: Number(values.leverage) || null,
      liquidation_buffer_pct: Number(values.liqBuffer) || null,
    },
    task_templates: legs
      .map((leg, index) =>
        localTaskTemplateForLeg({
          leg,
          index,
          budget,
          slip,
          scenario,
          authorizationContext,
        })
      )
      .filter(Boolean),
    source: 'dashboard_new_strategy',
  };
}
