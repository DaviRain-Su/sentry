import assert from 'node:assert/strict';
import {
  describeAuthorizationRef,
  getAuthorizationRegistrySnapshot,
  validateTaskAuthorization,
} from '../../core/authorization.js';
import { BUDGET_ENFORCEMENT } from '../../core/venues.js';

const registry = getAuthorizationRegistrySnapshot();
assert.equal(registry.status, 'ok');
assert.equal(registry.target_entries.length, 4, 'expected four target authorization entries');
assert.deepEqual(registry.ready_for_dispatch, ['sui-testnet-demo']);

const hyperliquid = describeAuthorizationRef('hyperliquid');
assert.equal(hyperliquid.status, 'ok');
assert.equal(hyperliquid.authorization_ref.authorization_model, 'venue_api_key');
assert.equal(hyperliquid.authorization_ref.enforcement_layer, 'venue');
assert.equal(hyperliquid.authorization_ref.budget_enforcement, BUDGET_ENFORCEMENT.VENUE_LIMIT);
assert.equal(hyperliquid.authorization_ref.dispatch_ready, false);
assert.equal(hyperliquid.must_not_claim_chain_enforced, true);
assert.equal(hyperliquid.must_not_claim_custody_enforced, false);
assert.ok(!hyperliquid.authorization_ref.capabilities.includes('withdraw'));

const okx = describeAuthorizationRef('okx');
assert.equal(okx.status, 'ok');
assert.equal(okx.authorization_ref.authorization_model, 'venue_api_key');
assert.equal(okx.authorization_ref.enforcement_layer, 'venue');
assert.equal(okx.authorization_ref.budget_enforcement, BUDGET_ENFORCEMENT.VENUE_LIMIT);
assert.equal(okx.requires_secret_store, true);
assert.ok(!okx.authorization_ref.capabilities.includes('withdraw'));

const solana = describeAuthorizationRef('solana-mainnet');
assert.equal(solana.status, 'ok');
assert.equal(solana.authorization_ref.authorization_model, 'native_delegation');
assert.equal(solana.authorization_ref.chain_enforced, false);
assert.equal(solana.authorization_ref.dispatch_ready, false);
assert.equal(solana.must_not_claim_chain_enforced, true);

const ethereum = describeAuthorizationRef('ethereum-mainnet');
assert.equal(ethereum.status, 'ok');
assert.equal(ethereum.authorization_ref.authorization_model, 'smart_account_module');
assert.equal(ethereum.authorization_ref.chain_enforced, false);
assert.equal(ethereum.authorization_ref.dispatch_ready, false);
assert.equal(ethereum.requires_owner_signature, true);

const suiDemo = describeAuthorizationRef('sui-testnet-demo');
assert.equal(suiDemo.authorization_ref.authorization_model, 'sentry_contract');
assert.equal(suiDemo.authorization_ref.budget_enforcement, BUDGET_ENFORCEMENT.CHAIN_ACCOUNTING);
assert.equal(suiDemo.authorization_ref.funds_custodied, false);
assert.equal(suiDemo.authorization_ref.dispatch_ready, true);
assert.equal(suiDemo.must_not_claim_chain_enforced, false);
assert.equal(suiDemo.must_not_claim_custody_enforced, true);

const missing = validateTaskAuthorization({});
assert.equal(missing.status, 'error');
assert.equal(missing.code, 'MISSING_AUTHORIZATION');

const missingRef = validateTaskAuthorization({
  authorization: {
    venue_id: 'okx',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    capabilities_required: ['read'],
  },
});
assert.equal(missingRef.status, 'error');
assert.equal(missingRef.code, 'MISSING_AUTHORIZATION_REF');

const withdraw = validateTaskAuthorization({
  authorization: {
    venue_id: 'okx',
    authorization_ref: 'okx:key-handle',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    capabilities_required: ['withdraw'],
  },
});
assert.equal(withdraw.status, 'error');
assert.equal(withdraw.code, 'WITHDRAW_NOT_ALLOWED');

const planned = validateTaskAuthorization({
  authorization: {
    venue_id: 'hyperliquid',
    authorization_ref: 'hyperliquid:key-handle',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    capabilities_required: ['read', 'place_order'],
  },
});
assert.equal(planned.status, 'error');
assert.equal(planned.code, 'ADAPTER_NOT_DISPATCH_READY');

const plannedPreflight = validateTaskAuthorization(
  {
    authorization: {
      venue_id: 'hyperliquid',
      authorization_ref: 'hyperliquid:key-handle',
      authorization_model: 'venue_api_key',
      enforcement_layer: 'venue',
      capabilities_required: ['read', 'place_order'],
    },
  },
  { allow_planned: true }
);
assert.equal(plannedPreflight.status, 'ok');
assert.equal(plannedPreflight.authorization.dispatch_ready_source, 'planned_override');

const okxTask = {
  authorization: {
    venue_id: 'okx',
    authorization_ref: 'okx:okx_key_dispatch',
    authorization_model: 'venue_api_key',
    enforcement_layer: 'venue',
    capabilities_required: ['read', 'place_order'],
  },
};
const okxBlocked = validateTaskAuthorization(okxTask);
assert.equal(okxBlocked.status, 'error');
assert.equal(okxBlocked.code, 'ADAPTER_NOT_DISPATCH_READY');

const okxLocalReady = validateTaskAuthorization(okxTask, {
  local_dispatch_ready_venues: ['okx'],
});
assert.equal(okxLocalReady.status, 'ok');
assert.equal(okxLocalReady.authorization.dispatch_ready, true);
assert.equal(okxLocalReady.authorization.dispatch_ready_source, 'local_daemon');

const hyperliquidLocalReady = validateTaskAuthorization(
  {
    authorization: {
      venue_id: 'hyperliquid',
      authorization_ref: 'hyperliquid:hl_key_dispatch',
      authorization_model: 'venue_api_key',
      enforcement_layer: 'venue',
      capabilities_required: ['read', 'place_order'],
    },
  },
  { local_dispatch_ready_venues: ['hyperliquid'] }
);
assert.equal(hyperliquidLocalReady.status, 'ok');
assert.equal(hyperliquidLocalReady.authorization.dispatch_ready, true);
assert.equal(hyperliquidLocalReady.authorization.dispatch_ready_source, 'local_daemon');

const hyperliquidNotOkx = validateTaskAuthorization(
  {
    authorization: {
      venue_id: 'hyperliquid',
      authorization_ref: 'hyperliquid:key-handle',
      authorization_model: 'venue_api_key',
      enforcement_layer: 'venue',
      capabilities_required: ['read', 'place_order'],
    },
  },
  { local_dispatch_ready_venues: ['okx'] }
);
assert.equal(hyperliquidNotOkx.status, 'error');
assert.equal(hyperliquidNotOkx.code, 'ADAPTER_NOT_DISPATCH_READY');

const liveDemo = validateTaskAuthorization({
  authorization: {
    venue_id: 'sui-testnet-demo',
    authorization_ref: 'sui-testnet-demo:policy-wrapper',
    authorization_model: 'sentry_contract',
    enforcement_layer: 'chain',
    capabilities_required: ['read', 'sign', 'submit_tx'],
  },
});
assert.equal(liveDemo.status, 'ok');

console.log('ALL AUTHORIZATION ADAPTER TESTS PASS');
