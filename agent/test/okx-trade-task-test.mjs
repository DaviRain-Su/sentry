import assert from 'node:assert/strict';
import {
  assertOkxTradeScope,
  buildOkxOrderStatusQuery,
  buildOkxPlaceOrderTask,
  normalizeOkxOrderStatusResponse,
  normalizeOkxOrderResponse,
  verifyOkxOrderStatusForTask,
  validateOkxPlaceOrderTask,
  verifyOkxAgentTaskResult,
} from '../../core/okx-trade.js';

const keyMetadata = {
  venue_id: 'okx',
  key_handle: 'okx_key_trade',
  display_handle: 'okx_....trade',
  account_ref: 'okx:subaccount:trade',
  permissions: ['read', 'place_order', 'cancel_order'],
};

assert.equal(assertOkxTradeScope(keyMetadata, 'place_order').status, 'ok');
assert.equal(
  assertOkxTradeScope({ ...keyMetadata, permissions: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertOkxTradeScope({ ...keyMetadata, permissions: ['read'] }, 'place_order').code,
  'OKX_TRADE_PERMISSION_REQUIRED'
);

const built = buildOkxPlaceOrderTask({
  taskId: 'task_okx_trade_1',
  policyId: 'policy_okx_trade',
  targetAgent: 'codex',
  keyMetadata,
  instrument: 'btc-usdt',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  quoteBudget: '1000',
  slippageBps: 50,
  clientOrderId: 'sentry-client-1',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
  simulated: true,
});
assert.equal(built.status, 'ok');
assert.equal(built.task.venue_id, 'okx');
assert.equal(built.task.target_agent, 'codex');
assert.equal(built.task.action.type, 'place_order');
assert.equal(built.task.action.params.instId, 'BTC-USDT');
assert.equal(built.task.action.params.tdMode, 'cash');
assert.equal(built.task.constraints.no_withdraw, true);
assert.deepEqual(built.task.constraints.capabilities_required, ['read', 'place_order']);
assert.equal(built.task.constraints.max_quote_amount, '1000');
assert.equal(built.task.constraints.slippage_bps, '50');
assert.equal(built.task.constraints.idempotency_key, 'sentry-client-1');
assert.equal(built.task.authorization.authorization_ref, 'okx:okx_key_trade');
assert.equal(JSON.stringify(built).includes('secret'), false);

assert.equal(
  buildOkxPlaceOrderTask({
    keyMetadata: { ...keyMetadata, permissions: ['place_order'] },
    instrument: 'BTC-USDT',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    clientOrderId: 'sentry-client-no-read',
  }).required_permission,
  'read'
);

assert.equal(validateOkxPlaceOrderTask(built.task).status, 'ok');
assert.equal(
  validateOkxPlaceOrderTask({
    ...built.task,
    constraints: { capabilities_required: ['place_order'] },
    authorization: { ...built.task.authorization, capabilities_required: [] },
  }).code,
  'OKX_TASK_CAPABILITIES_REQUIRED'
);
assert.equal(
  validateOkxPlaceOrderTask({
    ...built.task,
    action: {
      type: 'place_order',
      params: {
        endpoint: '/api/v5/trade/order',
        venue_id: 'okx',
        inst_id: 'BTC-USDT',
        tdMode: 'cash',
        side: 'buy',
        order_type: 'market',
        size: '0.01',
        clOrdId: 'sentry-client-market',
      },
    },
  }).status,
  'ok'
);
assert.equal(
  validateOkxPlaceOrderTask({
    ...built.task,
    action: {
      ...built.task.action,
      params: {
        ...built.task.action.params,
        clOrdId: '',
      },
    },
  }).code,
  'OKX_CLIENT_ORDER_ID_REQUIRED'
);
assert.equal(
  validateOkxPlaceOrderTask({
    ...built.task,
    constraints: { capabilities_required: ['withdraw'] },
  }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  buildOkxPlaceOrderTask({
    keyMetadata,
    instrument: 'BTC-USDT',
    side: 'hold',
    size: '0.01',
    price: '99000',
  }).code,
  'OKX_ORDER_SIDE_INVALID'
);

const normalized = normalizeOkxOrderResponse(
  {
    code: '0',
    msg: '',
    data: [{ ordId: '123456789', clOrdId: 'sentry-client-1', sCode: '0', sMsg: '' }],
  },
  {
    task_id: built.task.task_id,
    client_order_id: 'sentry-client-1',
    instrument: 'BTC-USDT',
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(normalized.status, 'submitted');
assert.equal(normalized.evidence.venue_order_id, '123456789');
assert.equal(normalized.evidence.client_order_id, 'sentry-client-1');

assert.equal(verifyOkxAgentTaskResult(normalized, built.task).status, 'ok');
assert.equal(
  verifyOkxAgentTaskResult(
    {
      ...normalized,
      evidence: { ...normalized.evidence, client_order_id: 'wrong-client-id' },
    },
    built.task
  ).code,
  'OKX_CLIENT_ORDER_ID_MISMATCH'
);
assert.equal(
  verifyOkxAgentTaskResult(
    { task_id: built.task.task_id, status: 'submitted', evidence: { venue_id: 'okx' } },
    built.task
  ).code,
  'OKX_ORDER_EVIDENCE_REQUIRED'
);
assert.equal(
  normalizeOkxOrderResponse({ code: '0', data: [{ sCode: '51008', sMsg: 'insufficient balance' }] })
    .code,
  'OKX_ORDER_REJECTED'
);

const statusQuery = buildOkxOrderStatusQuery({ task: built.task, result: normalized });
assert.equal(statusQuery.status, 'ok');
assert.equal(statusQuery.query.endpoint, '/api/v5/trade/order');
assert.equal(statusQuery.query.params.instId, 'BTC-USDT');
assert.equal(statusQuery.query.params.ordId, '123456789');
assert.equal(statusQuery.query.params.clOrdId, 'sentry-client-1');
assert.equal(statusQuery.query.idempotency_key, 'sentry-client-1');

assert.equal(
  buildOkxOrderStatusQuery({ instrument: 'BTC-USDT' }).code,
  'OKX_ORDER_LOOKUP_ID_REQUIRED'
);

const status = normalizeOkxOrderStatusResponse(
  {
    code: '0',
    msg: '',
    data: [
      {
        ordId: '123456789',
        clOrdId: 'sentry-client-1',
        instId: 'BTC-USDT',
        state: 'filled',
        accFillSz: '0.01',
        avgPx: '99000',
      },
    ],
  },
  { observed_at: '2026-06-03T00:00:00.000Z' }
);
assert.equal(status.status, 'ok');
assert.equal(status.terminal, true);
assert.equal(status.evidence.order_state, 'filled');
assert.equal(verifyOkxOrderStatusForTask(status, built.task).status, 'ok');
assert.equal(
  verifyOkxOrderStatusForTask({ ...status, client_order_id: 'wrong-client-id' }, built.task).code,
  'OKX_CLIENT_ORDER_ID_MISMATCH'
);
assert.equal(
  verifyOkxOrderStatusForTask({ ...status, instrument: 'ETH-USDT' }, built.task).code,
  'OKX_ORDER_STATUS_INSTRUMENT_MISMATCH'
);
assert.equal(
  normalizeOkxOrderStatusResponse({
    code: '0',
    data: [{ ordId: '1', instId: 'BTC-USDT', state: 'mystery' }],
  }).code,
  'OKX_ORDER_STATE_UNKNOWN'
);

console.log('ALL OKX TRADE TASK TESTS PASS');
