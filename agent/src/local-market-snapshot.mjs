import {
  fetchHyperliquidJsonWithBackoff,
  hyperliquidRetrySummary,
} from './hyperliquid-rate-limit.mjs';
import { HYPERLIQUID_INFO_URL, hyperliquidInfoRequest } from './hyperliquid-readonly-adapter.mjs';
import { OKX_BASE_URL, buildOkxRequestPath } from './okx-readonly-adapter.mjs';
import { fetchOkxJsonWithBackoff, okxRetrySummary } from './okx-rate-limit.mjs';

export const DEFAULT_MARKET_VENUES = ['okx', 'hyperliquid'];
export const DEFAULT_MARKET_SYMBOLS = ['BTC', 'ETH', 'SOL'];

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numericValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function parseMarketList(value, fallback = []) {
  if (Array.isArray(value))
    return unique(value.map((item) => normalizeString(item)).filter(Boolean));
  if (!value) return [...fallback];
  return unique(
    String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : now || new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function okxInstId(symbol) {
  const text = normalizeString(symbol).toUpperCase();
  if (!text) return '';
  if (text.includes('-')) return text;
  return `${text}-USDT-SWAP`;
}

function hyperliquidCoin(symbol) {
  const text = normalizeString(symbol).toUpperCase();
  if (!text) return '';
  return text.split('-')[0];
}

function marketStatus(results) {
  if (results.length && results.every((result) => result.status === 'ok')) return 'ok';
  if (
    results.some(
      (result) => result.status === 'ok' || (Array.isArray(result.markets) && result.markets.length)
    )
  ) {
    return 'partial';
  }
  return 'blocked';
}

function normalizeOkxTicker(body, { instId, observedAt }) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'OKX_MARKET_BAD_RESPONSE',
      message: 'OKX ticker response must be an object.',
    };
  }
  if (body.code !== '0') {
    return {
      status: 'error',
      code: 'OKX_MARKET_API_ERROR',
      okx_code: body.code ?? null,
      message: body.msg || 'OKX ticker API returned an error.',
    };
  }
  const row = Array.isArray(body.data) ? body.data[0] || {} : {};
  const price = numericValue(row.last ?? row.markPx ?? row.idxPx);
  if (price === null) {
    return {
      status: 'error',
      code: 'OKX_MARKET_PRICE_MISSING',
      message: 'OKX ticker response did not include a numeric last price.',
    };
  }
  return {
    status: 'ok',
    venue_id: 'okx',
    symbol: row.instId || instId,
    price,
    mark_price: numericValue(row.markPx),
    index_price: numericValue(row.idxPx),
    bid_price: numericValue(row.bidPx),
    ask_price: numericValue(row.askPx),
    volume_24h: numericValue(row.volCcy24h ?? row.vol24h),
    health: 'online',
    observed_at: observedAt,
    source: 'okx_public_market_ticker',
  };
}

function normalizeOkxFunding(body, { instId, observedAt }) {
  if (!body || typeof body !== 'object') return null;
  if (body.code !== '0') return null;
  const row = Array.isArray(body.data) ? body.data[0] || {} : {};
  const fundingRate = numericValue(row.fundingRate);
  if (fundingRate === null) return null;
  return {
    inst_id: row.instId || instId,
    funding_rate: fundingRate,
    next_funding_time_ms: numericValue(row.nextFundingTime),
    observed_at: observedAt,
  };
}

async function fetchOkxPublicJson({
  requestPath,
  fetchImpl,
  rateLimiter,
  rateLimitPolicy,
  sleepImpl,
}) {
  const url = `${OKX_BASE_URL}${requestPath}`;
  const fetched = await fetchOkxJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `okx:market:${requestPath}`,
    fetchOnce: async () => {
      const response = await fetchImpl(url, { method: 'GET' });
      const body = await response.json();
      return { response, body };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'OKX_MARKET_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: okxRetrySummary(fetched),
    };
  }
  if (!fetched.response.ok) {
    return {
      status: 'error',
      code: fetched.response.status === 429 ? 'OKX_MARKET_RATE_LIMITED' : 'OKX_MARKET_HTTP_ERROR',
      http_status: fetched.response.status,
      message: fetched.body?.msg || `OKX market HTTP ${fetched.response.status}`,
      retry: okxRetrySummary(fetched),
    };
  }
  return { status: 'ok', body: fetched.body, retry: okxRetrySummary(fetched) };
}

export async function fetchOkxMarketSnapshot({
  symbols = DEFAULT_MARKET_SYMBOLS,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const observedAt = nowIso(now);
  const rows = [];
  const accessIssues = [];
  for (const symbol of parseMarketList(symbols, DEFAULT_MARKET_SYMBOLS)) {
    const instId = okxInstId(symbol);
    const ticker = await fetchOkxPublicJson({
      requestPath: buildOkxRequestPath('/api/v5/market/ticker', { instId }),
      fetchImpl,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    if (ticker.status !== 'ok') {
      accessIssues.push({ venue_id: 'okx', symbol: instId, severity: 'blocked', ...ticker });
      continue;
    }
    const market = normalizeOkxTicker(ticker.body, { instId, observedAt });
    if (market.status !== 'ok') {
      accessIssues.push({ venue_id: 'okx', symbol: instId, severity: 'blocked', ...market });
      continue;
    }

    const funding = await fetchOkxPublicJson({
      requestPath: buildOkxRequestPath('/api/v5/public/funding-rate', { instId }),
      fetchImpl,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    const normalizedFunding =
      funding.status === 'ok' ? normalizeOkxFunding(funding.body, { instId, observedAt }) : null;
    if (normalizedFunding) {
      market.funding_rate = normalizedFunding.funding_rate;
      market.next_funding_time_ms = normalizedFunding.next_funding_time_ms;
    } else if (funding.status !== 'ok') {
      accessIssues.push({
        venue_id: 'okx',
        symbol: instId,
        severity: 'warn',
        ...funding,
      });
    }
    market.retry = { ticker: ticker.retry, funding: funding.retry || null };
    rows.push(market);
  }
  return {
    status: rows.length
      ? accessIssues.some((issue) => issue.severity === 'blocked')
        ? 'partial'
        : 'ok'
      : 'blocked',
    venue_id: 'okx',
    markets: rows,
    market_count: rows.length,
    access_issues: accessIssues,
    observed_at: observedAt,
  };
}

function normalizeHyperliquidAllMids(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_MARKET_BAD_RESPONSE',
      message: 'Hyperliquid allMids response must be an object.',
    };
  }
  return { status: 'ok', mids: body };
}

function normalizeHyperliquidAssetContexts(body, { observedAt }) {
  if (
    !Array.isArray(body) ||
    !body[0] ||
    !Array.isArray(body[0].universe) ||
    !Array.isArray(body[1])
  ) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_MARKET_BAD_RESPONSE',
      message: 'Hyperliquid metaAndAssetCtxs response must be [meta, contexts].',
    };
  }
  const contexts = new Map();
  body[0].universe.forEach((asset, index) => {
    const ctx = body[1][index] || {};
    contexts.set(String(asset.name || '').toUpperCase(), {
      venue_id: 'hyperliquid',
      symbol: asset.name,
      price: numericValue(ctx.markPx ?? ctx.midPx),
      mark_price: numericValue(ctx.markPx),
      index_price: numericValue(ctx.oraclePx),
      funding_rate: numericValue(ctx.funding),
      open_interest: numericValue(ctx.openInterest),
      health: 'online',
      observed_at: observedAt,
      source: 'hyperliquid_public_meta_and_asset_contexts',
    });
  });
  return { status: 'ok', contexts };
}

async function fetchHyperliquidPublicInfo({
  type,
  fetchImpl,
  rateLimiter,
  rateLimitPolicy,
  sleepImpl,
}) {
  const request = hyperliquidInfoRequest(type);
  const fetched = await fetchHyperliquidJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `hyperliquid:market:${type}`,
    fetchOnce: async () => {
      const response = await fetchImpl(request.url || HYPERLIQUID_INFO_URL, {
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
      code: 'HYPERLIQUID_MARKET_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: hyperliquidRetrySummary(fetched),
    };
  }
  if (!fetched.response.ok) {
    return {
      status: 'error',
      code:
        fetched.response.status === 429
          ? 'HYPERLIQUID_MARKET_RATE_LIMITED'
          : 'HYPERLIQUID_MARKET_HTTP_ERROR',
      http_status: fetched.response.status,
      message:
        fetched.body?.error ||
        fetched.body?.message ||
        `Hyperliquid market HTTP ${fetched.response.status}`,
      retry: hyperliquidRetrySummary(fetched),
    };
  }
  return { status: 'ok', body: fetched.body, retry: hyperliquidRetrySummary(fetched) };
}

export async function fetchHyperliquidMarketSnapshot({
  symbols = DEFAULT_MARKET_SYMBOLS,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const observedAt = nowIso(now);
  const [midsResult, contextsResult] = await Promise.all([
    fetchHyperliquidPublicInfo({
      type: 'allMids',
      fetchImpl,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    }),
    fetchHyperliquidPublicInfo({
      type: 'metaAndAssetCtxs',
      fetchImpl,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    }),
  ]);
  const accessIssues = [];
  if (midsResult.status !== 'ok')
    accessIssues.push({ venue_id: 'hyperliquid', severity: 'blocked', ...midsResult });
  if (contextsResult.status !== 'ok')
    accessIssues.push({ venue_id: 'hyperliquid', severity: 'blocked', ...contextsResult });
  if (accessIssues.some((issue) => issue.severity === 'blocked')) {
    return {
      status: 'blocked',
      venue_id: 'hyperliquid',
      markets: [],
      market_count: 0,
      access_issues: accessIssues,
      observed_at: observedAt,
    };
  }

  const mids = normalizeHyperliquidAllMids(midsResult.body);
  const contexts = normalizeHyperliquidAssetContexts(contextsResult.body, { observedAt });
  if (mids.status !== 'ok')
    accessIssues.push({ venue_id: 'hyperliquid', severity: 'blocked', ...mids });
  if (contexts.status !== 'ok')
    accessIssues.push({ venue_id: 'hyperliquid', severity: 'blocked', ...contexts });
  if (accessIssues.some((issue) => issue.severity === 'blocked')) {
    return {
      status: 'blocked',
      venue_id: 'hyperliquid',
      markets: [],
      market_count: 0,
      access_issues: accessIssues,
      observed_at: observedAt,
    };
  }

  const rows = [];
  for (const symbol of parseMarketList(symbols, DEFAULT_MARKET_SYMBOLS)) {
    const coin = hyperliquidCoin(symbol);
    const context = contexts.contexts.get(coin) || {};
    const mid = numericValue(mids.mids[coin]);
    const price = context.price ?? mid;
    if (price === null || price === undefined) {
      accessIssues.push({
        venue_id: 'hyperliquid',
        symbol: coin,
        severity: 'warn',
        status: 'missing',
        code: 'HYPERLIQUID_MARKET_PRICE_MISSING',
        message: 'Hyperliquid public market data did not include this symbol.',
      });
      continue;
    }
    rows.push({
      ...context,
      venue_id: 'hyperliquid',
      symbol: coin,
      price,
      mark_price: context.mark_price ?? price,
      health: context.health || 'online',
      observed_at: observedAt,
      source: context.source || 'hyperliquid_public_all_mids',
      retry: { allMids: midsResult.retry, metaAndAssetCtxs: contextsResult.retry },
    });
  }

  return {
    status: rows.length
      ? accessIssues.some((issue) => issue.severity === 'blocked')
        ? 'partial'
        : 'ok'
      : 'blocked',
    venue_id: 'hyperliquid',
    markets: rows,
    market_count: rows.length,
    access_issues: accessIssues,
    observed_at: observedAt,
  };
}

export async function buildLocalMarketSnapshot({
  venues = DEFAULT_MARKET_VENUES,
  symbols = DEFAULT_MARKET_SYMBOLS,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const observedAt = nowIso(now);
  const venueIds = parseMarketList(venues, DEFAULT_MARKET_VENUES);
  const results = [];
  for (const venueId of venueIds) {
    if (venueId === 'okx') {
      results.push(
        await fetchOkxMarketSnapshot({
          symbols,
          fetchImpl,
          now,
          rateLimiter,
          rateLimitPolicy,
          sleepImpl,
        })
      );
      continue;
    }
    if (venueId === 'hyperliquid') {
      results.push(
        await fetchHyperliquidMarketSnapshot({
          symbols,
          fetchImpl,
          now,
          rateLimiter,
          rateLimitPolicy,
          sleepImpl,
        })
      );
      continue;
    }
    results.push({
      status: 'blocked',
      venue_id: venueId,
      markets: [],
      market_count: 0,
      access_issues: [
        {
          venue_id: venueId,
          severity: 'blocked',
          status: 'blocked',
          code: 'MARKET_VENUE_UNSUPPORTED',
          message: 'Local public market snapshot supports OKX and Hyperliquid only.',
        },
      ],
      observed_at: observedAt,
    });
  }

  const accessIssues = results.flatMap((result) => result.access_issues || []);
  const markets = results.flatMap((result) => result.markets || []);
  return {
    status: marketStatus(results),
    source: 'local_public_market_snapshot',
    venue_ids: venueIds,
    symbols: parseMarketList(symbols, DEFAULT_MARKET_SYMBOLS),
    markets,
    market_count: markets.length,
    access_issues: accessIssues,
    observed_at: observedAt,
    results,
  };
}
