import assert from 'node:assert/strict';
import {
  buildAuthorizationStateSnapshot,
  describeAuthorizationRef,
  getAuthorizationRegistrySnapshot,
  validateTaskAuthorization,
} from '../../core/authorization.js';
import { buildLocalSecretStoreSnapshot } from '../../core/local-secrets.js';
import { buildWalletReferenceSnapshot } from '../../core/wallet-refs.js';
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

const emptyState = buildAuthorizationStateSnapshot({
  secretStore: buildLocalSecretStoreSnapshot([]),
  walletStore: buildWalletReferenceSnapshot([]),
  now: '2026-06-04T00:00:00.000Z',
});
assert.equal(emptyState.status, 'blocked');
assert.equal(emptyState.target_states.length, 4);
assert.equal(emptyState.readiness_summary.target_count, 4);
assert.equal(emptyState.readiness_summary.production_ready, false);
assert.deepEqual(emptyState.readiness_summary.blocked_venue_ids.sort(), [
  'ethereum-mainnet',
  'hyperliquid',
  'okx',
  'solana-mainnet',
]);
assert.equal(emptyState.legacy_demo_states[0].status, 'demo_ready');
assert.equal(
  emptyState.target_states.find((state) => state.venue_id === 'okx').status,
  'missing'
);
assert.equal(
  emptyState.access_issues.some((issue) => issue.code === 'VENUE_KEY_MISSING'),
  true
);
assert.equal(JSON.stringify(emptyState).includes('private_key'), false);
assert.equal(JSON.stringify(emptyState).includes('passphrase'), false);

const configuredState = buildAuthorizationStateSnapshot({
  now: '2026-06-04T00:00:00.000Z',
  secretStore: buildLocalSecretStoreSnapshot([
    {
      venue_id: 'okx',
      key_handle: 'okx_key_state',
      display_handle: 'okx_....state',
      account_ref: 'okx:subaccount:state',
      storage: 'os_keychain',
      permissions: ['read', 'place_order', 'cancel_order'],
      ip_allowlist: true,
      rotated_at: '2026-06-01T00:00:00.000Z',
      rotation_days: 30,
      status: 'linked',
    },
    {
      venue_id: 'hyperliquid',
      key_handle: 'hl_key_state',
      display_handle: 'hl_....state',
      account_ref: 'hyperliquid:subaccount:state',
      read_account_address: '0x0000000000000000000000000000000000000001',
      agent_wallet_address: '0x0000000000000000000000000000000000000042',
      agent_wallet_grant: {
        status: 'active',
        source: 'metadata_attestation',
        permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      },
      storage: 'os_keychain',
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      rotated_at: '2026-06-01T00:00:00.000Z',
      rotation_days: 30,
      status: 'linked',
    },
  ]),
  walletStore: buildWalletReferenceSnapshot([
    {
      wallet_id: 'ows_state',
      provider: 'ows',
      accounts: [
        {
          chain_id: 'solana:mainnet',
          address: '11111111111111111111111111111111',
          capabilities: ['read', 'sign', 'submit_tx'],
        },
        {
          chain_id: 'eip155:1',
          address: '0x0000000000000000000000000000000000000001',
          capabilities: ['read', 'sign', 'submit_tx'],
        },
      ],
    },
  ]),
});
assert.equal(configuredState.status, 'partial');
assert.equal(configuredState.readiness_summary.production_ready, false);
assert.deepEqual(configuredState.readiness_summary.metadata_ready_venue_ids.sort(), [
  'hyperliquid',
  'okx',
]);
assert.deepEqual(configuredState.readiness_summary.planned_venue_ids.sort(), [
  'ethereum-mainnet',
  'solana-mainnet',
]);
const okxState = configuredState.states.find((state) => state.venue_id === 'okx');
assert.equal(okxState.status, 'metadata_ready');
assert.equal(okxState.readiness.category, 'metadata_ready');
assert.equal(okxState.readiness.dispatch_ready, false);
assert.equal(
  okxState.readiness.next_steps.some((step) => step.includes('production UI wiring')),
  true
);
assert.equal(okxState.key_handle, 'okx_....state');
assert.equal(okxState.authorization_ref.ref, 'okx:okx_key_state');
assert.equal(okxState.dispatch_ready, false);
assert.equal(okxState.revoke_state.venue_revoke_required, true);
assert.equal(okxState.rotation_state.status, 'fresh');
assert.equal(okxState.rotation_state.rotation_due_at, '2026-07-01T00:00:00.000Z');

const hyperliquidState = configuredState.states.find((state) => state.venue_id === 'hyperliquid');
assert.equal(hyperliquidState.status, 'metadata_ready');
assert.equal(hyperliquidState.readiness.category, 'metadata_ready');
assert.equal(
  hyperliquidState.readiness.next_steps.some((step) => step.includes('live submit verification')),
  true
);
assert.equal(hyperliquidState.agent_wallet.grant_status, 'active');
assert.equal(hyperliquidState.agent_wallet.live_verified, false);
assert.equal(hyperliquidState.rotation_state.status, 'fresh');

const solanaState = configuredState.states.find((state) => state.venue_id === 'solana-mainnet');
assert.equal(solanaState.status, 'partial');
assert.equal(solanaState.readiness.category, 'planned');
assert.deepEqual(solanaState.readiness.planned_issue_codes, [
  'NATIVE_DELEGATION_GRANT_NOT_INSTALLED',
]);
assert.equal(solanaState.grant_state.source, 'ows_wallet_ref');
assert.equal(solanaState.grant_state.chain_grant_installed, false);
assert.equal(solanaState.wallet_ref.wallet_id, 'ows_state');
assert.equal(
  solanaState.access_issues.some((issue) => issue.code === 'NATIVE_DELEGATION_GRANT_NOT_INSTALLED'),
  true
);

const ethereumState = configuredState.states.find((state) => state.venue_id === 'ethereum-mainnet');
assert.equal(ethereumState.status, 'partial');
assert.equal(ethereumState.readiness.category, 'planned');
assert.deepEqual(ethereumState.readiness.planned_issue_codes, [
  'SMART_ACCOUNT_GRANT_NOT_INSTALLED',
]);
assert.equal(ethereumState.wallet_ref.account.chain_id, 'eip155:1');
assert.equal(
  ethereumState.access_issues.some((issue) => issue.code === 'SMART_ACCOUNT_GRANT_NOT_INSTALLED'),
  true
);
assert.equal(JSON.stringify(configuredState).includes('must-not-leak'), false);

const expiredRotationState = buildAuthorizationStateSnapshot({
  now: '2026-06-04T00:00:00.000Z',
  secretStore: buildLocalSecretStoreSnapshot([
    {
      venue_id: 'hyperliquid',
      key_handle: 'hl_key_expired',
      display_handle: 'hl_....expired',
      account_ref: 'hyperliquid:subaccount:expired',
      read_account_address: '0x0000000000000000000000000000000000000001',
      agent_wallet_address: '0x0000000000000000000000000000000000000042',
      agent_wallet_grant: {
        status: 'active',
        source: 'metadata_attestation',
        permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      },
      storage: 'os_keychain',
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
      rotated_at: '2026-05-01T00:00:00.000Z',
      rotation_days: 1,
      status: 'linked',
    },
  ]),
  walletStore: buildWalletReferenceSnapshot([]),
  scope: ['hyperliquid'],
});
assert.equal(expiredRotationState.status, 'blocked');
assert.equal(
  expiredRotationState.states.find((state) => state.venue_id === 'hyperliquid').rotation_state
    .status,
  'expired'
);
assert.equal(
  expiredRotationState.access_issues.some(
    (issue) => issue.code === 'VENUE_KEY_ROTATION_EXPIRED'
  ),
  true
);

const revokedState = buildAuthorizationStateSnapshot({
  now: '2026-06-04T00:00:00.000Z',
  secretStore: buildLocalSecretStoreSnapshot([
    {
      venue_id: 'okx',
      key_handle: 'okx_key_revoked',
      display_handle: 'okx_....revoked',
      account_ref: 'okx:subaccount:revoked',
      storage: 'os_keychain',
      permissions: ['read'],
      ip_allowlist: true,
      status: 'revoked',
      revoked_at: '2026-06-04T00:00:00.000Z',
    },
  ]),
  walletStore: buildWalletReferenceSnapshot([
    {
      wallet_id: 'ows_revoked',
      provider: 'ows',
      status: 'revoked',
      accounts: [
        {
          chain_id: 'solana:mainnet',
          address: '11111111111111111111111111111111',
          capabilities: ['read'],
        },
      ],
    },
  ]),
  scope: ['okx', 'solana-mainnet'],
});
assert.equal(revokedState.status, 'blocked');
assert.equal(revokedState.states.find((state) => state.venue_id === 'okx').status, 'blocked');
assert.equal(
  revokedState.access_issues.some((issue) => issue.code === 'VENUE_KEY_REVOKED_LOCALLY'),
  true
);
assert.equal(
  revokedState.access_issues.some((issue) => issue.code === 'WALLET_REF_REVOKED_LOCALLY'),
  true
);

const scopedState = buildAuthorizationStateSnapshot({
  scope: ['okx', 'unknown-venue'],
  secretStore: buildLocalSecretStoreSnapshot([]),
});
assert.equal(scopedState.states.length, 1);
assert.equal(scopedState.access_issues.some((issue) => issue.code === 'UNKNOWN_VENUE'), true);

console.log('ALL AUTHORIZATION ADAPTER TESTS PASS');
