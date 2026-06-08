import { createHmac } from 'node:crypto';
import { fetchOkxJsonWithBackoff, okxRetrySummary } from './okx-rate-limit.mjs';

export const OKX_BASE_URL = 'https://www.okx.com';
export const OKX_BALANCE_PATH = '/api/v5/account/balance';

function uppercaseMethod(method) {
  return String(method || 'GET').toUpperCase();
}

function encodeQuery(params = {}) {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  );
  if (!entries.length) return '';
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  return `?${search.toString()}`;
}

export function buildOkxRequestPath(path, params = {}) {
  return `${path}${encodeQuery(params)}`;
}

export function signOkxRequest({ timestamp, method, requestPath, body = '', secretKey }) {
  if (!timestamp) throw new Error('OKX timestamp is required for signing.');
  if (!requestPath) throw new Error('OKX requestPath is required for signing.');
  if (!secretKey) throw new Error('OKX secretKey is required for signing.');
  const prehash = `${timestamp}${uppercaseMethod(method)}${requestPath}${body || ''}`;
  return createHmac('sha256', secretKey).update(prehash).digest('base64');
}

export function buildOkxAuthHeaders({
  apiKey,
  secretKey,
  passphrase,
  timestamp = new Date().toISOString(),
  method = 'GET',
  requestPath,
  body = '',
  simulated = false,
}) {
  if (!apiKey) throw new Error('OKX apiKey is required.');
  if (!passphrase) throw new Error('OKX passphrase is required.');
  const signature = signOkxRequest({ timestamp, method, requestPath, body, secretKey });
  const headers = {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    'content-type': 'application/json',
  };
  if (simulated) headers['x-simulated-trading'] = '1';
  return headers;
}

export function assertOkxReadScope(keyMetadata) {
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_REQUIRED',
      message: 'OKX key metadata is required before read-only adapter use.',
    };
  }
  if (keyMetadata.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_MISMATCH',
      message: 'OKX read-only adapter can only use metadata for venue_id=okx.',
    };
  }
  const permissions = keyMetadata.permissions || [];
  if (permissions.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'OKX withdrawal permission is never accepted.',
    };
  }
  if (!permissions.includes('read')) {
    return {
      status: 'error',
      code: 'OKX_READ_PERMISSION_REQUIRED',
      message: 'OKX read-only adapter requires read permission.',
    };
  }
  return { status: 'ok' };
}

function numericString(value) {
  if (value === undefined || value === null || value === '') return '0';
  return String(value);
}

export function normalizeOkxBalanceResponse(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'OKX_BAD_RESPONSE',
      message: 'OKX balance response must be an object.',
    };
  }
  if (body.code !== '0') {
    return {
      status: 'error',
      code: 'OKX_API_ERROR',
      okx_code: body.code ?? null,
      message: body.msg || 'OKX API returned an error.',
    };
  }

  const account = Array.isArray(body.data) ? body.data[0] || {} : {};
  const details = Array.isArray(account.details) ? account.details : [];
  const balances = details.map((row) => ({
    venue_id: 'okx',
    account_ref: options.account_ref || null,
    asset: row.ccy,
    equity: numericString(row.eq),
    equity_usd: numericString(row.eqUsd || row.disEq),
    cash_balance: numericString(row.cashBal),
    available_balance: numericString(row.availBal || row.availEq),
    frozen_balance: numericString(row.frozenBal),
    raw: options.includeRaw ? row : undefined,
  }));

  return {
    status: 'ok',
    venue_id: 'okx',
    account_ref: options.account_ref || null,
    total_equity_usd: numericString(account.totalEq),
    balance_count: balances.length,
    balances,
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function okxBalanceRequest({ ccy, simulated = false } = {}) {
  const requestPath = buildOkxRequestPath(OKX_BALANCE_PATH, { ccy });
  return {
    method: 'GET',
    requestPath,
    url: `${OKX_BASE_URL}${requestPath}`,
    body: '',
    simulated,
  };
}

export async function fetchOkxAccountBalance({
  credentials,
  keyMetadata,
  ccy,
  fetchImpl = fetch,
  now = new Date(),
  simulated = false,
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const scope = assertOkxReadScope(keyMetadata);
  if (scope.status !== 'ok') return scope;
  if (!credentials || typeof credentials !== 'object') {
    return {
      status: 'error',
      code: 'OKX_CREDENTIALS_REQUIRED',
      message: 'OKX credentials must be supplied by a local keychain/external-agent adapter.',
    };
  }
  const request = okxBalanceRequest({ ccy, simulated });
  const fetched = await fetchOkxJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `okx:${keyMetadata.key_handle || 'key'}:${request.requestPath}`,
    fetchOnce: async () => {
      const timestamp = (typeof now === 'function' ? now() : now).toISOString();
      const headers = buildOkxAuthHeaders({
        ...credentials,
        timestamp,
        method: request.method,
        requestPath: request.requestPath,
        body: request.body,
        simulated,
      });
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers,
      });
      const body = await response.json();
      return { response, body, observed_at: timestamp };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'OKX_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: okxRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok) {
    return {
      status: 'error',
      code: response.status === 429 ? 'OKX_RATE_LIMITED' : 'OKX_HTTP_ERROR',
      http_status: response.status,
      message: body?.msg || `OKX HTTP ${response.status}`,
      okx_body: body,
      retry: okxRetrySummary(fetched),
    };
  }
  const normalized = normalizeOkxBalanceResponse(body, {
    account_ref: keyMetadata.account_ref,
    observed_at: fetched.observed_at,
  });
  return normalized.status === 'ok'
    ? { ...normalized, retry: okxRetrySummary(fetched) }
    : { ...normalized, retry: okxRetrySummary(fetched) };
}

export async function verifyOkxLiveReadProof({
  credentials,
  keyMetadata,
  ccy,
  fetchImpl = fetch,
  now = new Date(),
  simulated = false,
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const scope = assertOkxReadScope(keyMetadata);
  if (scope.status !== 'ok') return scope;
  if (!credentials || typeof credentials !== 'object') {
    return {
      status: 'error',
      code: 'OKX_CREDENTIALS_REQUIRED',
      message: 'OKX credentials must be supplied before live read proof verification.',
    };
  }

  const request = okxBalanceRequest({ ccy, simulated });
  const fetched = await fetchOkxJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `okx-live-read-proof:${keyMetadata.key_handle || 'key'}:${request.requestPath}`,
    fetchOnce: async () => {
      const timestamp = (typeof now === 'function' ? now() : now).toISOString();
      const headers = buildOkxAuthHeaders({
        ...credentials,
        timestamp,
        method: request.method,
        requestPath: request.requestPath,
        body: request.body,
        simulated,
      });
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers,
      });
      const body = await response.json();
      return { response, body, observed_at: timestamp };
    },
  });

  if (fetched.error) {
    return {
      status: 'error',
      code: 'OKX_LIVE_READ_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: okxRetrySummary(fetched),
    };
  }

  const { response, body } = fetched;
  if (!response?.ok) {
    return {
      status: 'error',
      code: response?.status === 429 ? 'OKX_RATE_LIMITED' : 'OKX_LIVE_READ_HTTP_ERROR',
      http_status: response?.status ?? null,
      okx_code: body?.code ?? null,
      message: body?.msg || `OKX HTTP ${response?.status ?? 'error'}`,
      proof_source: 'okx_account_balance',
      request_path: request.requestPath,
      retry: okxRetrySummary(fetched),
    };
  }

  if (!body || body.code !== '0') {
    return {
      status: 'error',
      code: 'OKX_LIVE_READ_REJECTED',
      http_status: response.status,
      okx_code: body?.code ?? null,
      message: body?.msg || 'OKX rejected the signed live read proof request.',
      proof_source: 'okx_account_balance',
      request_path: request.requestPath,
      retry: okxRetrySummary(fetched),
    };
  }

  return {
    status: 'ok',
    venue_id: 'okx',
    key_handle: keyMetadata.key_handle,
    account_ref: keyMetadata.account_ref,
    proof_source: 'okx_account_balance',
    request_path: request.requestPath,
    http_status: response.status,
    okx_code: body.code,
    observed_at: fetched.observed_at,
    retry: okxRetrySummary(fetched),
  };
}
