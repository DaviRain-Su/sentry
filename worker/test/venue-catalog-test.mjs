import assert from 'node:assert/strict';
import {
  BUDGET_ENFORCEMENT,
  TARGET_VENUE_IDS,
  getVenueCatalogSnapshot,
} from '../../core/venues.js';

const catalog = getVenueCatalogSnapshot();
const targetIds = new Set(catalog.target_venue_ids);

for (const id of ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx']) {
  assert.equal(targetIds.has(id), true, `${id} missing from target venue catalog`);
}

assert.deepEqual(catalog.target_venue_ids, TARGET_VENUE_IDS, 'target venue ids drifted');
assert.equal(catalog.target_chains.length, 2, 'expected two target chain integrations');
assert.equal(catalog.target_perps.length, 1, 'expected Hyperliquid as the target perps venue');
assert.equal(catalog.target_exchanges.length, 1, 'expected OKX as the only target exchange');

const okx = catalog.target_exchanges.find((v) => v.id === 'okx');
assert.ok(okx, 'OKX target exchange missing');
assert.equal(okx.authorization_model, 'venue_api_key');
assert.equal(okx.enforcement_layer, 'venue');
assert.equal(okx.budget_enforcement, BUDGET_ENFORCEMENT.VENUE_LIMIT);
assert.equal(okx.funds_custodied, false);
assert.match(okx.permissions, /no withdrawals/i);

const solana = catalog.target_chains.find((v) => v.id === 'solana-mainnet');
assert.equal(solana.authorization_model, 'native_delegation');
assert.equal(solana.status, 'read-only');
assert.equal(solana.adapter_status, 'trade-task-and-receipt-skeleton');
assert.equal(solana.chain_enforced, false, 'read-only Solana adapter must not claim enforcement');
assert.equal(
  solana.required_next.some((item) => /receipt polling/i.test(item)),
  false,
  'Solana receipt polling should not remain listed as required_next'
);

const ethereum = catalog.target_chains.find((v) => v.id === 'ethereum-mainnet');
assert.equal(ethereum.authorization_model, 'smart_account_module');
assert.equal(ethereum.status, 'read-only');
assert.equal(ethereum.adapter_status, 'trade-task-and-receipt-skeleton');
assert.equal(ethereum.chain_enforced, false, 'read-only Ethereum adapter must not claim enforcement');
assert.equal(
  ethereum.required_next.some((item) => /receipt polling/i.test(item)),
  false,
  'Ethereum receipt polling should not remain listed as required_next'
);

const hyperliquid = catalog.target_perps.find((v) => v.id === 'hyperliquid');
assert.ok(hyperliquid, 'Hyperliquid target venue missing');
assert.equal(hyperliquid.authorization_model, 'venue_api_key');
assert.equal(hyperliquid.enforcement_layer, 'venue');
assert.equal(hyperliquid.budget_enforcement, BUDGET_ENFORCEMENT.VENUE_LIMIT);
assert.equal(hyperliquid.kind, 'perps');
assert.equal(hyperliquid.adapter_status, 'trade-task-skeleton');
assert.match(hyperliquid.permissions, /no withdrawals/i);

const suiDemo = catalog.legacy_demo.find((v) => v.id === 'sui-testnet-demo');
assert.ok(suiDemo, 'Sui demo venue should remain visible as legacy demo path');
assert.equal(suiDemo.budget_enforcement, BUDGET_ENFORCEMENT.CHAIN_ACCOUNTING);
assert.equal(suiDemo.funds_custodied, false);

console.log('ALL VENUE CATALOG TESTS PASS');
