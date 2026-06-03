import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import {
  claimHyperliquidExchangeNonce,
  finalizeHyperliquidExchangeNonce,
  hyperliquidNonceIdentity,
  readHyperliquidNonceStore,
} from '../src/hyperliquid-nonce-store.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-hl-nonces-'));

try {
  const storePath = path.join(dir, 'nonces.json');
  const keyMetadata = {
    venue_id: 'hyperliquid',
    key_handle: 'hl_nonce_test',
    account_ref: 'hyperliquid:subaccount:nonce',
    read_account_address: '0x0000000000000000000000000000000000000001',
    permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  };
  const built = buildHyperliquidPlaceOrderTask({
    taskId: 'task_hl_nonce_1',
    keyMetadata,
    coin: 'BTC',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    cloid: '0x00000000000000000000000000000001',
  });
  assert.equal(built.status, 'ok');
  const request = {
    idempotency_key: '0x00000000000000000000000000000001',
    nonce: 1_780_000_000_000,
    expires_after_ms: 1_781_000_000_000,
    body: { nonce: 1_780_000_000_000 },
  };

  const identity = hyperliquidNonceIdentity({ task: built.task, request });
  assert.equal(identity.authorization_ref, 'hyperliquid:hl_nonce_test');
  assert.equal(identity.record_key, 'hyperliquid:hl_nonce_test:1780000000000');

  const claimed = await claimHyperliquidExchangeNonce({
    task: built.task,
    request,
    storePath,
    now: new Date('2026-06-03T00:00:00.000Z'),
  });
  assert.equal(claimed.status, 'ok');
  assert.equal(claimed.record.status, 'claimed');

  const duplicateClaim = await claimHyperliquidExchangeNonce({
    task: built.task,
    request,
    storePath,
    now: new Date('2026-06-03T00:00:01.000Z'),
  });
  assert.equal(duplicateClaim.status, 'error');
  assert.equal(duplicateClaim.code, 'HYPERLIQUID_NONCE_ALREADY_USED');
  assert.equal(duplicateClaim.existing_status, 'claimed');

  const finalized = await finalizeHyperliquidExchangeNonce({
    claim: claimed,
    storePath,
    now: new Date('2026-06-03T00:00:02.000Z'),
    result: {
      status: 'submitted',
      evidence: {
        venue_order_id: '123456789',
        client_order_id: '0x00000000000000000000000000000001',
        order_state: 'open',
      },
    },
  });
  assert.equal(finalized.status, 'ok');
  assert.equal(finalized.record.status, 'submitted');
  assert.equal(finalized.record.venue_order_id, '123456789');

  const persisted = await readHyperliquidNonceStore({ storePath });
  assert.equal(persisted.status, 'ok');
  assert.equal(persisted.records.length, 1);
  assert.equal(persisted.records[0].status, 'submitted');

  const duplicateAfterSubmit = await claimHyperliquidExchangeNonce({
    task: built.task,
    request,
    storePath,
  });
  assert.equal(duplicateAfterSubmit.status, 'error');
  assert.equal(duplicateAfterSubmit.code, 'HYPERLIQUID_NONCE_ALREADY_USED');
  assert.equal(duplicateAfterSubmit.existing_status, 'submitted');

  console.log('ALL HYPERLIQUID NONCE STORE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
