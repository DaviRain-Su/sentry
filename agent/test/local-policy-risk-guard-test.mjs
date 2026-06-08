import assert from 'node:assert/strict';
import {
  evaluateLocalPolicyRiskGuard,
  localPolicyRiskGuardRequired,
} from '../src/local-policy-risk-guard.mjs';

const NOW = new Date('2026-06-03T00:00:10.000Z');

const task = {
  task_id: 'task-risk-okx-1',
  venue_id: 'okx',
  action: {
    type: 'place_order',
    params: {
      sz: '0.01',
      px: '90000',
    },
  },
};

const policy = {
  policy_id: 'risk-policy-okx-1',
  target_venue_ids: ['okx'],
  constraints: {
    risk_checks: {
      max_inventory_age_ms: 60_000,
      min_available_balances: [{ venue_id: 'okx', asset: 'USDT', amount: '900' }],
      max_position_value_usd: [{ venue_id: 'okx', asset: 'BTC', amount: '50000' }],
      max_venue_exposure_usd: [{ venue_id: 'okx', amount: '150000' }],
    },
  },
};

const snapshot = {
  status: 'ok',
  generated_at: '2026-06-03T00:00:00.000Z',
  positions: [
    {
      venue_id: 'okx',
      asset: 'USDT',
      available: '1000',
      quantity: '1000',
      value_usd: '1000',
      observed_at: '2026-06-03T00:00:00.000Z',
    },
    {
      venue_id: 'okx',
      asset: 'BTC',
      quantity: '0.1',
      value_usd: '9000',
      observed_at: '2026-06-03T00:00:00.000Z',
    },
  ],
  access_issues: [],
  live_reads: [{ venue_id: 'okx', status: 'ok' }],
};

assert.equal(localPolicyRiskGuardRequired({ policy_id: 'no-risk' }), false);
assert.equal(localPolicyRiskGuardRequired(policy), true);

const skipped = evaluateLocalPolicyRiskGuard({ policy_id: 'no-risk' }, task, {
  inventorySnapshot: snapshot,
  now: NOW,
});
assert.equal(skipped.status, 'skipped');

const ok = evaluateLocalPolicyRiskGuard(policy, task, {
  inventorySnapshot: snapshot,
  now: NOW,
});
assert.equal(ok.status, 'ok');
assert.equal(ok.local_decision, 'allowed_by_local_inventory_guard');

const stale = evaluateLocalPolicyRiskGuard(policy, task, {
  inventorySnapshot: {
    ...snapshot,
    generated_at: '2026-06-02T23:00:00.000Z',
  },
  now: NOW,
});
assert.equal(stale.status, 'blocked');
assert.equal(stale.code, 'POLICY_INVENTORY_STALE');

const tooLow = evaluateLocalPolicyRiskGuard(policy, task, {
  inventorySnapshot: {
    ...snapshot,
    positions: [{ venue_id: 'okx', asset: 'USDT', available: '100', value_usd: '100' }],
  },
  now: NOW,
});
assert.equal(tooLow.status, 'blocked');
assert.equal(tooLow.code, 'POLICY_AVAILABLE_BALANCE_TOO_LOW');

const accessBlocked = evaluateLocalPolicyRiskGuard(policy, task, {
  inventorySnapshot: {
    ...snapshot,
    access_issues: [
      {
        venue_id: 'okx',
        severity: 'blocked',
        code: 'OKX_CREDENTIAL_SOURCE_MISSING',
        message: 'missing credential source',
      },
    ],
  },
  now: NOW,
});
assert.equal(accessBlocked.status, 'blocked');
assert.equal(accessBlocked.code, 'POLICY_INVENTORY_ACCESS_BLOCKED');

const exposureBlocked = evaluateLocalPolicyRiskGuard(
  {
    ...policy,
    constraints: {
      risk_checks: {
        max_venue_exposure_usd: [{ venue_id: 'okx', amount: '9500' }],
      },
    },
  },
  task,
  { inventorySnapshot: snapshot, now: NOW }
);
assert.equal(exposureBlocked.status, 'blocked');
assert.equal(exposureBlocked.code, 'POLICY_VENUE_EXPOSURE_EXCEEDED');

const directNumericExposureBlocked = evaluateLocalPolicyRiskGuard(
  {
    ...policy,
    constraints: {
      risk_checks: {
        max_venue_exposure_usd: '9500',
      },
    },
  },
  task,
  { inventorySnapshot: snapshot, now: NOW }
);
assert.equal(directNumericExposureBlocked.status, 'blocked');
assert.equal(directNumericExposureBlocked.code, 'POLICY_VENUE_EXPOSURE_EXCEEDED');

console.log('ALL LOCAL POLICY RISK GUARD TESTS PASS');
