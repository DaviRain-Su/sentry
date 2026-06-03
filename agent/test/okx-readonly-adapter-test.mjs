import assert from 'node:assert/strict';
import {
  assertOkxReadScope,
  buildOkxAuthHeaders,
  buildOkxRequestPath,
  fetchOkxAccountBalance,
  normalizeOkxBalanceResponse,
  okxBalanceRequest,
  signOkxRequest,
} from '../src/okx-readonly-adapter.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const requestPath = '/api/v5/account/balance?ccy=BTC%2CETH';
const signature = signOkxRequest({
  timestamp,
  method: 'GET',
  requestPath,
  secretKey: 'test-secret',
});

assert.equal(
  signature,
  '1++hZ8nsp6Tk/2Hxsf2F/SX64/BxQL7Z14DWjVmGENM=',
  'OKX signature vector drifted'
);
assert.equal(buildOkxRequestPath('/api/v5/account/balance', { ccy: ['BTC', 'ETH'] }), requestPath);

const headers = buildOkxAuthHeaders({
  apiKey: 'test-key',
  secretKey: 'test-secret',
  passphrase: 'test-passphrase',
  timestamp,
  method: 'GET',
  requestPath,
  simulated: true,
});
assert.equal(headers['OK-ACCESS-KEY'], 'test-key');
assert.equal(headers['OK-ACCESS-SIGN'], signature);
assert.equal(headers['OK-ACCESS-TIMESTAMP'], timestamp);
assert.equal(headers['OK-ACCESS-PASSPHRASE'], 'test-passphrase');
assert.equal(headers['x-simulated-trading'], '1');
assert.equal(JSON.stringify(headers).includes('test-secret'), false);

const keyMetadata = {
  venue_id: 'okx',
  account_ref: 'okx:subaccount:test',
  permissions: ['read', 'place_order', 'cancel_order'],
};
assert.equal(assertOkxReadScope(keyMetadata).status, 'ok');
assert.equal(
  assertOkxReadScope({ ...keyMetadata, permissions: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertOkxReadScope({ ...keyMetadata, permissions: ['place_order'] }).code,
  'OKX_READ_PERMISSION_REQUIRED'
);

const normalized = normalizeOkxBalanceResponse(
  {
    code: '0',
    msg: '',
    data: [
      {
        totalEq: '123.45',
        details: [
          {
            ccy: 'USDC',
            eq: '100',
            eqUsd: '100.01',
            cashBal: '100',
            availBal: '80',
            frozenBal: '20',
          },
          {
            ccy: 'BTC',
            eq: '0.01',
            eqUsd: '1030',
            cashBal: '0.01',
            availEq: '0.008',
          },
        ],
      },
    ],
  },
  { account_ref: keyMetadata.account_ref, observed_at: timestamp }
);
assert.equal(normalized.status, 'ok');
assert.equal(normalized.balance_count, 2);
assert.equal(normalized.total_equity_usd, '123.45');
assert.equal(normalized.balances[0].asset, 'USDC');
assert.equal(normalized.balances[0].available_balance, '80');
assert.equal(normalized.balances[1].available_balance, '0.008');

const apiError = normalizeOkxBalanceResponse({ code: '50113', msg: 'Invalid signature' });
assert.equal(apiError.status, 'error');
assert.equal(apiError.okx_code, '50113');

const request = okxBalanceRequest({ ccy: 'USDC', simulated: true });
assert.equal(request.method, 'GET');
assert.equal(request.requestPath, '/api/v5/account/balance?ccy=USDC');
assert.equal(request.url, 'https://www.okx.com/api/v5/account/balance?ccy=USDC');

let capturedUrl = null;
let capturedHeaders = null;
const fetched = await fetchOkxAccountBalance({
  credentials: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-passphrase',
  },
  keyMetadata,
  ccy: 'USDC',
  now: new Date(timestamp),
  simulated: true,
  fetchImpl: async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          msg: '',
          data: [{ totalEq: '100', details: [{ ccy: 'USDC', eq: '100', availBal: '100' }] }],
        };
      },
    };
  },
});
assert.equal(fetched.status, 'ok');
assert.equal(fetched.balance_count, 1);
assert.equal(capturedUrl, 'https://www.okx.com/api/v5/account/balance?ccy=USDC');
assert.equal(capturedHeaders['OK-ACCESS-KEY'], 'test-key');
assert.equal(capturedHeaders['x-simulated-trading'], '1');
assert.equal(JSON.stringify(capturedHeaders).includes('test-secret'), false);

const noCredentials = await fetchOkxAccountBalance({ keyMetadata });
assert.equal(noCredentials.status, 'error');
assert.equal(noCredentials.code, 'OKX_CREDENTIALS_REQUIRED');

let retryCalls = 0;
const retrySleeps = [];
const retryFetched = await fetchOkxAccountBalance({
  credentials: {
    apiKey: 'test-key',
    secretKey: 'test-secret',
    passphrase: 'test-passphrase',
  },
  keyMetadata,
  ccy: 'USDC',
  now: () => new Date(timestamp),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 10, max_backoff_ms: 10 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async () => {
    retryCalls += 1;
    if (retryCalls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { 'retry-after': '0.01' },
        async json() {
          return { code: '50011', msg: 'rate limit' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          msg: '',
          data: [{ totalEq: '100', details: [{ ccy: 'USDC', eq: '100', availBal: '100' }] }],
        };
      },
    };
  },
});
assert.equal(retryFetched.status, 'ok');
assert.equal(retryFetched.retry.attempts, 2);
assert.equal(retryFetched.retry.retry_count, 1);
assert.deepEqual(retrySleeps, [10]);

console.log('ALL OKX READONLY ADAPTER TESTS PASS');
