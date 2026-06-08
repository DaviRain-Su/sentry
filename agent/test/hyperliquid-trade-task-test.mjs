import assert from 'node:assert/strict';
import {
  assertHyperliquidTradeScope,
  buildHyperliquidOrderStatusQuery,
  buildHyperliquidPlaceOrderTask,
  normalizeHyperliquidOrderResponse,
  normalizeHyperliquidOrderStatusResponse,
  validateHyperliquidPlaceOrderTask,
  verifyHyperliquidAgentTaskResult,
  verifyHyperliquidOrderStatusForTask,
} from '../../core/hyperliquid-trade.js';

const cloid = '0x00000000000000000000000000000001';
const user = '0x0000000000000000000000000000000000000001';
const keyMetadata = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_agent_trade',
  display_handle: 'hl_....trade',
  account_ref: 'hyperliquid:subaccount:trade',
  read_account_address: user,
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
};

assert.equal(assertHyperliquidTradeScope(keyMetadata, 'place_order').status, 'ok');
assert.equal(
  assertHyperliquidTradeScope({ ...keyMetadata, permissions: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertHyperliquidTradeScope({ ...keyMetadata, permissions: ['read'] }, 'place_order').code,
  'HYPERLIQUID_TRADE_PERMISSION_REQUIRED'
);

const built = buildHyperliquidPlaceOrderTask({
  taskId: 'task_hl_trade_1',
  policyId: 'policy_hl_trade',
  targetAgent: 'codex',
  keyMetadata,
  coin: 'btc',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  tif: 'Gtc',
  max_quote_amount: '1000',
  slippageBps: 50,
  cloid,
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
  simulated: true,
});
assert.equal(built.status, 'ok');
assert.equal(built.task.venue_id, 'hyperliquid');
assert.equal(built.task.target_agent, 'codex');
assert.equal(built.task.action.type, 'place_order');
assert.equal(built.task.action.params.coin, 'BTC');
assert.equal(built.task.action.params.isBuy, true);
assert.equal(built.task.action.params.tif, 'Gtc');
assert.equal(built.task.constraints.idempotency_key, cloid);
assert.equal(built.task.constraints.max_notional_usd, '1000');
assert.equal(built.task.constraints.slippage_bps, '50');
assert.equal(built.task.constraints.no_withdraw, true);
assert.deepEqual(built.task.constraints.capabilities_required, ['read', 'place_order']);
assert.equal(built.task.authorization.authorization_ref, 'hyperliquid:hl_agent_trade');
assert.equal(JSON.stringify(built).includes('private_key'), false);

assert.equal(validateHyperliquidPlaceOrderTask(built.task).status, 'ok');
assert.equal(
  validateHyperliquidPlaceOrderTask({
    ...built.task,
    constraints: { capabilities_required: ['place_order'] },
    authorization: { ...built.task.authorization, capabilities_required: [] },
  }).code,
  'HYPERLIQUID_TASK_CAPABILITIES_REQUIRED'
);
assert.equal(
  validateHyperliquidPlaceOrderTask({
    ...built.task,
    action: {
      ...built.task.action,
      params: {
        ...built.task.action.params,
        cloid: 'bad-cloid',
      },
    },
  }).code,
  'HYPERLIQUID_CLOID_INVALID'
);
assert.equal(
  buildHyperliquidPlaceOrderTask({
    keyMetadata,
    coin: 'BTC',
    side: 'hold',
    size: '0.01',
    price: '99000',
    cloid,
  }).code,
  'HYPERLIQUID_ORDER_SIDE_INVALID'
);
assert.equal(
  buildHyperliquidPlaceOrderTask({
    keyMetadata: { ...keyMetadata, permissions: ['place_order'] },
    coin: 'BTC',
    side: 'buy',
    size: '0.01',
    price: '99000',
    cloid,
  }).required_permission,
  'read'
);

const resting = normalizeHyperliquidOrderResponse(
  {
    status: 'ok',
    response: {
      type: 'order',
      data: {
        statuses: [{ resting: { oid: 123456789, cloid } }],
      },
    },
  },
  {
    task_id: built.task.task_id,
    client_order_id: cloid,
    coin: 'BTC',
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(resting.status, 'submitted');
assert.equal(resting.evidence.venue_order_id, '123456789');
assert.equal(resting.evidence.client_order_id, cloid);
assert.equal(verifyHyperliquidAgentTaskResult(resting, built.task).status, 'ok');

const filled = normalizeHyperliquidOrderResponse(
  {
    status: 'ok',
    response: {
      type: 'order',
      data: {
        statuses: [{ filled: { oid: 123456789, cloid, totalSz: '0.01', avgPx: '99000' } }],
      },
    },
  },
  {
    task_id: built.task.task_id,
    client_order_id: cloid,
    coin: 'BTC',
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(filled.status, 'done');
assert.equal(filled.evidence.order_state, 'filled');
assert.equal(filled.evidence.filled_size, '0.01');

assert.equal(
  verifyHyperliquidAgentTaskResult(
    {
      ...resting,
      evidence: {
        ...resting.evidence,
        client_order_id: '0x00000000000000000000000000000002',
      },
    },
    built.task
  ).code,
  'HYPERLIQUID_CLOID_MISMATCH'
);
assert.equal(
  verifyHyperliquidAgentTaskResult(
    { task_id: built.task.task_id, status: 'submitted', evidence: { venue_id: 'hyperliquid' } },
    built.task
  ).code,
  'HYPERLIQUID_ORDER_EVIDENCE_REQUIRED'
);
assert.equal(
  verifyHyperliquidAgentTaskResult(
    {
      ...resting,
      evidence: {
        ...resting.evidence,
        coin: 'ETH',
      },
    },
    built.task
  ).code,
  'HYPERLIQUID_COIN_MISMATCH'
);
assert.equal(
  normalizeHyperliquidOrderResponse({
    status: 'ok',
    response: { type: 'order', data: { statuses: [{ error: 'insufficient margin' }] } },
  }).code,
  'HYPERLIQUID_ORDER_REJECTED'
);

const statusQuery = buildHyperliquidOrderStatusQuery({ task: built.task, result: resting });
assert.equal(statusQuery.status, 'ok');
assert.equal(statusQuery.query.endpoint, '/info');
assert.deepEqual(statusQuery.query.body, { type: 'orderStatus', user, oid: 123456789 });
assert.equal(statusQuery.query.expected.venue_order_id, '123456789');
assert.equal(statusQuery.query.expected.client_order_id, cloid);
assert.equal(
  buildHyperliquidOrderStatusQuery({
    task: {
      ...built.task,
      policy_context: { ...built.task.policy_context, read_account_address: null },
    },
    result: {},
  }).code,
  'HYPERLIQUID_USER_ADDRESS_REQUIRED'
);

const openStatus = normalizeHyperliquidOrderStatusResponse(
  {
    status: 'order',
    order: {
      order: {
        coin: 'BTC',
        oid: 123456789,
        cloid,
        side: 'B',
        limitPx: '99000',
        sz: '0.01',
        origSz: '0.01',
        timestamp: 1_780_000_000_000,
      },
      status: 'open',
      statusTimestamp: 1_780_000_001_000,
    },
  },
  {
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(openStatus.status, 'ok');
assert.equal(openStatus.terminal, false);
assert.equal(openStatus.venue_order_id, '123456789');
assert.equal(openStatus.client_order_id, cloid);
assert.equal(verifyHyperliquidOrderStatusForTask(openStatus, built.task).status, 'ok');
assert.equal(
  verifyHyperliquidOrderStatusForTask({ ...openStatus, client_order_id: null }, built.task).status,
  'ok'
);
assert.equal(
  verifyHyperliquidOrderStatusForTask(
    { ...openStatus, client_order_id: '0x00000000000000000000000000000002' },
    built.task
  ).code,
  'HYPERLIQUID_CLOID_MISMATCH'
);
assert.equal(
  normalizeHyperliquidOrderStatusResponse({ status: 'unknownOid' }).code,
  'HYPERLIQUID_ORDER_NOT_FOUND'
);

console.log('ALL HYPERLIQUID TRADE TASK TESTS PASS');
