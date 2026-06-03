import {
  fetchHyperliquidJsonWithBackoff,
  hyperliquidRetrySummary,
} from './hyperliquid-rate-limit.mjs';

export const HYPERLIQUID_INFO_URL = 'https://api.hyperliquid.xyz/info';

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function numericString(value) {
  if (value === undefined || value === null || value === '') return '0';
  return String(value);
}

export function isHyperliquidAddress(value) {
  return ADDRESS_RE.test(String(value || ''));
}

export function resolveHyperliquidUserAddress(keyMetadata = {}, env = process.env) {
  const candidates = [
    keyMetadata.read_account_address,
    keyMetadata.account_address,
    keyMetadata.account_ref,
    env.SENTRY_HYPERLIQUID_USER_ADDRESS,
    env.SENTRY_HYPERLIQUID_USER,
  ].filter(Boolean);
  const address = candidates.find((value) => isHyperliquidAddress(value));
  if (!address) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_USER_ADDRESS_REQUIRED',
      message:
        'Hyperliquid read-only queries require the actual master or subaccount address, not an agent-wallet handle.',
    };
  }
  return { status: 'ok', user: address.toLowerCase() };
}

export function assertHyperliquidReadScope(keyMetadata) {
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      message: 'Hyperliquid key metadata is required before read-only adapter use.',
    };
  }
  if (keyMetadata.venue_id !== 'hyperliquid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_MISMATCH',
      message: 'Hyperliquid read-only adapter can only use metadata for venue_id=hyperliquid.',
    };
  }
  const permissions = keyMetadata.permissions || [];
  if (permissions.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Hyperliquid withdrawal/transfer scope is never accepted.',
    };
  }
  if (!permissions.includes('read')) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_READ_PERMISSION_REQUIRED',
      message: 'Hyperliquid read-only adapter requires read permission.',
    };
  }
  return { status: 'ok' };
}

export function hyperliquidInfoRequest(type, { user, dex } = {}) {
  const body = { type };
  if (user) body.user = user;
  if (dex) body.dex = dex;
  return {
    method: 'POST',
    url: HYPERLIQUID_INFO_URL,
    headers: { 'content-type': 'application/json' },
    body,
  };
}

export function normalizeHyperliquidClearinghouseState(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_BAD_RESPONSE',
      message: 'Hyperliquid clearinghouseState response must be an object.',
    };
  }
  const margin = body.marginSummary || body.crossMarginSummary || {};
  const positions = (body.assetPositions || []).map((row) => {
    const position = row.position || row;
    return {
      venue_id: 'hyperliquid',
      source_type: 'venue_api',
      account_ref: options.account_ref || null,
      asset: position.coin,
      quantity: numericString(position.szi),
      value_usd: numericString(position.positionValue),
      entry_price: numericString(position.entryPx),
      unrealized_pnl: numericString(position.unrealizedPnl),
      margin_used: numericString(position.marginUsed),
      liquidation_price: numericString(position.liquidationPx),
      leverage: position.leverage || null,
      observed_at: options.observed_at || new Date().toISOString(),
    };
  });
  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    account_ref: options.account_ref || null,
    account_value_usd: numericString(margin.accountValue),
    total_notional_usd: numericString(margin.totalNtlPos),
    total_margin_used: numericString(margin.totalMarginUsed),
    withdrawable: numericString(body.withdrawable),
    position_count: positions.length,
    positions,
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function normalizeHyperliquidSpotState(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_BAD_RESPONSE',
      message: 'Hyperliquid spotClearinghouseState response must be an object.',
    };
  }
  const balances = (body.balances || []).map((row) => ({
    venue_id: 'hyperliquid',
    source_type: 'venue_api',
    account_ref: options.account_ref || null,
    asset: row.coin,
    quantity: numericString(row.total),
    value_usd: numericString(row.entryNtl),
    available: numericString(Number(row.total || 0) - Number(row.hold || 0)),
    locked: numericString(row.hold),
    observed_at: options.observed_at || new Date().toISOString(),
  }));
  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    account_ref: options.account_ref || null,
    balance_count: balances.length,
    balances,
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function normalizeHyperliquidOpenOrders(body, options = {}) {
  if (!Array.isArray(body)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_BAD_RESPONSE',
      message: 'Hyperliquid open orders response must be an array.',
    };
  }
  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    account_ref: options.account_ref || null,
    order_count: body.length,
    orders: body.map((order) => ({
      venue_id: 'hyperliquid',
      order_id: String(order.oid ?? ''),
      client_order_id: order.cloid || null,
      asset: order.coin,
      side: order.side,
      order_type: order.orderType || null,
      price: numericString(order.limitPx),
      quantity: numericString(order.sz || order.origSz),
      reduce_only: Boolean(order.reduceOnly),
      timestamp_ms: order.timestamp ?? null,
    })),
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

async function postInfo({ type, user, dex, fetchImpl, rateLimiter, rateLimitPolicy, sleepImpl }) {
  const request = hyperliquidInfoRequest(type, { user, dex });
  const fetched = await fetchHyperliquidJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `hyperliquid:${type}:${user || 'anonymous'}:${dex || 'default'}`,
    fetchOnce: async () => {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      const body = await response.json();
      return { response, body };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: hyperliquidRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok) {
    return {
      status: 'error',
      code: response.status === 429 ? 'HYPERLIQUID_RATE_LIMITED' : 'HYPERLIQUID_HTTP_ERROR',
      http_status: response.status,
      message: body?.error || body?.message || `Hyperliquid HTTP ${response.status}`,
      hyperliquid_body: body,
      retry: hyperliquidRetrySummary(fetched),
    };
  }
  return { status: 'ok', body, retry: hyperliquidRetrySummary(fetched) };
}

export async function fetchHyperliquidReadState({
  keyMetadata,
  user,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  dex,
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const scope = assertHyperliquidReadScope(keyMetadata);
  if (scope.status !== 'ok') return scope;
  const resolvedUser = user
    ? { status: isHyperliquidAddress(user) ? 'ok' : 'error', user: String(user).toLowerCase() }
    : resolveHyperliquidUserAddress(keyMetadata, env);
  if (resolvedUser.status !== 'ok') {
    return {
      ...resolvedUser,
      code: resolvedUser.code || 'HYPERLIQUID_USER_ADDRESS_INVALID',
      message:
        resolvedUser.message || 'Hyperliquid user address must be a 42-character hex address.',
    };
  }

  const observedAt = now.toISOString();
  const clearing = await postInfo({
    type: 'clearinghouseState',
    user: resolvedUser.user,
    dex,
    fetchImpl,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (clearing.status !== 'ok') return clearing;
  const spot = await postInfo({
    type: 'spotClearinghouseState',
    user: resolvedUser.user,
    fetchImpl,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (spot.status !== 'ok') return spot;
  const orders = await postInfo({
    type: 'frontendOpenOrders',
    user: resolvedUser.user,
    dex,
    fetchImpl,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (orders.status !== 'ok') return orders;

  const accountRef = keyMetadata.account_ref || resolvedUser.user;
  const clearingState = normalizeHyperliquidClearinghouseState(clearing.body, {
    account_ref: accountRef,
    observed_at: observedAt,
  });
  const spotState = normalizeHyperliquidSpotState(spot.body, {
    account_ref: accountRef,
    observed_at: observedAt,
  });
  const openOrders = normalizeHyperliquidOpenOrders(orders.body, {
    account_ref: accountRef,
    observed_at: observedAt,
  });
  if (clearingState.status !== 'ok') return clearingState;
  if (spotState.status !== 'ok') return spotState;
  if (openOrders.status !== 'ok') return openOrders;

  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    user: resolvedUser.user,
    account_ref: accountRef,
    positions: [...clearingState.positions, ...spotState.balances],
    open_orders: openOrders.orders,
    account_summary: {
      account_value_usd: clearingState.account_value_usd,
      total_notional_usd: clearingState.total_notional_usd,
      total_margin_used: clearingState.total_margin_used,
      withdrawable: clearingState.withdrawable,
    },
    retry: {
      clearinghouseState: clearing.retry,
      spotClearinghouseState: spot.retry,
      frontendOpenOrders: orders.retry,
    },
    observed_at: observedAt,
  };
}
