import assert from 'node:assert/strict';
import {
  evaluateLocalPolicyTriggerGuard,
  localPolicyTriggerGuardRequired,
} from '../src/local-policy-trigger-guard.mjs';

const task = {
  task_id: 'task_trigger_1',
  venue_id: 'okx',
  action: {
    type: 'place_order',
    params: {
      instId: 'BTC-USDT',
    },
  },
};

assert.equal(localPolicyTriggerGuardRequired({}), false);
assert.equal(
  evaluateLocalPolicyTriggerGuard({}, task).local_decision,
  'trigger_guard_not_required'
);

const priceBelowPolicy = {
  policy_id: 'trigger-price-below',
  trigger: {
    type: 'price_below',
    venue_id: 'okx',
    symbol: 'BTC-USDT',
    threshold: '90000',
  },
};
assert.equal(localPolicyTriggerGuardRequired(priceBelowPolicy), true);

const missingSnapshot = evaluateLocalPolicyTriggerGuard(priceBelowPolicy, task);
assert.equal(missingSnapshot.status, 'blocked');
assert.equal(missingSnapshot.code, 'POLICY_MARKET_SNAPSHOT_REQUIRED');

const notTriggered = evaluateLocalPolicyTriggerGuard(priceBelowPolicy, task, {
  marketSnapshot: {
    markets: [{ venue_id: 'okx', symbol: 'BTC-USDT', price: '91000' }],
  },
});
assert.equal(notTriggered.status, 'skipped');
assert.equal(notTriggered.code, 'POLICY_TRIGGER_NOT_SATISFIED');

const triggered = evaluateLocalPolicyTriggerGuard(priceBelowPolicy, task, {
  marketSnapshot: {
    markets: [{ venue_id: 'okx', symbol: 'BTC-USDT', price: '89000' }],
  },
});
assert.equal(triggered.status, 'ok');
assert.equal(triggered.local_decision, 'trigger_satisfied');
assert.equal(triggered.market.price, 89000);

const priceDrop = evaluateLocalPolicyTriggerGuard(
  {
    policy_id: 'trigger-drop',
    trigger: {
      type: 'price_drop_bps',
      venue_id: 'okx',
      symbol: 'BTC-USDT',
      threshold_bps: '500',
      reference_price: '100000',
    },
  },
  task,
  {
    marketSnapshot: {
      prices: {
        'BTC-USDT': { venue_id: 'okx', price: '94000' },
      },
    },
  }
);
assert.equal(priceDrop.status, 'ok');
assert.equal(Math.round(priceDrop.observed_bps), 600);

const funding = evaluateLocalPolicyTriggerGuard(
  {
    policy_id: 'trigger-funding',
    trigger: {
      type: 'funding_rate_above',
      venue_id: 'hyperliquid',
      symbol: 'ETH',
      threshold: '0.0002',
    },
  },
  {
    ...task,
    venue_id: 'hyperliquid',
    action: { type: 'place_order', params: { coin: 'ETH' } },
  },
  {
    marketSnapshot: {
      markets: [{ venue_id: 'hyperliquid', symbol: 'ETH', funding_rate: '0.0003' }],
    },
  }
);
assert.equal(funding.status, 'ok');

const anyTrigger = evaluateLocalPolicyTriggerGuard(
  {
    policy_id: 'trigger-any',
    trigger: {
      any: [
        { type: 'price_below', venue_id: 'okx', symbol: 'BTC-USDT', threshold: '80000' },
        { type: 'venue_health', venue_id: 'okx', symbol: 'BTC-USDT' },
      ],
    },
  },
  task,
  {
    marketSnapshot: {
      markets: [{ venue_id: 'okx', symbol: 'BTC-USDT', price: '90000', health: 'online' }],
    },
  }
);
assert.equal(anyTrigger.status, 'ok');
assert.equal(anyTrigger.trigger_type, 'any');

console.log('ALL LOCAL POLICY TRIGGER GUARD TESTS PASS');
