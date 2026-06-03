import assert from 'node:assert/strict';
import { buildLocalInventorySnapshot, getInventoryAdapterRegistry } from '../../core/inventory.js';
import {
  buildLocalSecretStoreSnapshot,
  validateVenueKeyMetadata,
} from '../../core/local-secrets.js';

const secretStore = buildLocalSecretStoreSnapshot();
assert.equal(secretStore.status, 'ok');
assert.equal(secretStore.key_count, 2);
assert.equal(secretStore.keys.some((key) => key.venue_id === 'okx'), true);
assert.equal(secretStore.keys.some((key) => key.venue_id === 'hyperliquid'), true);
assert.equal(JSON.stringify(secretStore).includes('api_secret'), false);
assert.equal(JSON.stringify(secretStore).includes('private_key'), false);

for (const key of secretStore.keys) {
  assert.equal(key.storage, 'os_keychain');
  assert.equal(key.permissions.includes('withdraw'), false);
}

const rawSecret = validateVenueKeyMetadata({
  venue_id: 'okx',
  key_handle: 'okx_bad',
  api_secret: 'do-not-store-this',
  permissions: ['read'],
});
assert.equal(rawSecret.status, 'error');
assert.equal(rawSecret.code, 'RAW_SECRET_REJECTED');

const withdraw = validateVenueKeyMetadata({
  venue_id: 'okx',
  key_handle: 'okx_bad',
  permissions: ['read', 'withdraw'],
});
assert.equal(withdraw.status, 'error');
assert.equal(withdraw.code, 'WITHDRAW_NOT_ALLOWED');

const registry = getInventoryAdapterRegistry();
const targetIds = registry.target_adapters.map((adapter) => adapter.venue_id);
assert.deepEqual(targetIds, ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx']);
assert.equal(registry.legacy_demo_adapters.map((adapter) => adapter.venue_id).includes('sui-testnet-demo'), true);

const venueOnlySnapshot = buildLocalInventorySnapshot({
  secretStore,
  scope: ['hyperliquid', 'okx'],
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(venueOnlySnapshot.status, 'ok');
assert.equal(venueOnlySnapshot.positions.length, 0, 'skeleton must not invent balances');
assert.equal(venueOnlySnapshot.sources.length, 2);
assert.equal(
  venueOnlySnapshot.sources.every((source) => source.status === 'configured_readonly'),
  true
);
assert.equal(venueOnlySnapshot.access_issues.length, 0);

const fullSnapshot = buildLocalInventorySnapshot({
  secretStore,
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(fullSnapshot.status, 'ok');
assert.equal(
  fullSnapshot.sources.find((source) => source.venue_id === 'solana-mainnet')?.status,
  'read_adapter_ready'
);
assert.equal(
  fullSnapshot.sources.find((source) => source.venue_id === 'ethereum-mainnet')?.status,
  'read_adapter_ready'
);
assert.equal(
  fullSnapshot.access_issues.some((issue) => issue.code === 'INVENTORY_ADAPTER_PLANNED'),
  false
);

const metadataOnlySolana = buildLocalInventorySnapshot({
  secretStore,
  scope: ['solana-mainnet'],
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(metadataOnlySolana.status, 'ok');
assert.equal(
  metadataOnlySolana.sources[0].requirements.includes('SENTRY_SOLANA_WALLET_ADDRESS'),
  true
);

const metadataOnlyEthereum = buildLocalInventorySnapshot({
  secretStore,
  scope: ['ethereum-mainnet'],
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(metadataOnlyEthereum.status, 'ok');
assert.equal(
  metadataOnlyEthereum.sources[0].requirements.includes('SENTRY_ETHEREUM_WALLET_ADDRESS'),
  true
);

const missingKeySnapshot = buildLocalInventorySnapshot({
  secretStore: buildLocalSecretStoreSnapshot([]),
  scope: ['okx'],
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(missingKeySnapshot.status, 'blocked');
assert.equal(missingKeySnapshot.access_issues[0].code, 'VENUE_KEY_MISSING');

const unknownScope = buildLocalInventorySnapshot({
  secretStore,
  scope: ['not-a-venue'],
  now: '2026-06-03T00:00:00.000Z',
});
assert.equal(unknownScope.status, 'blocked');
assert.equal(unknownScope.access_issues[0].code, 'UNKNOWN_VENUE');

console.log('ALL LOCAL INVENTORY TESTS PASS');
