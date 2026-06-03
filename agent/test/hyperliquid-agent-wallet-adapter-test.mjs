import assert from 'node:assert/strict';
import { buildLocalSecretStoreSnapshot } from '../../core/local-secrets.js';
import {
  hyperliquidUserRoleRequest,
  normalizeHyperliquidUserRoleResponse,
  verifyHyperliquidLiveAgentWalletGrant,
} from '../src/hyperliquid-agent-wallet-adapter.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const user = '0x0000000000000000000000000000000000000001';
const agentWallet = '0x1111111111111111111111111111111111111111';
const store = buildLocalSecretStoreSnapshot([
  {
    venue_id: 'hyperliquid',
    key_handle: 'hl_agent_wallet',
    account_ref: 'hyperliquid:subaccount:wallet',
    read_account_address: user,
    agent_wallet_address: agentWallet,
    agent_wallet_grant: {
      status: 'active',
      source: 'metadata_attestation',
      verified_at: timestamp,
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    },
    permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  },
]);
assert.equal(store.status, 'ok');
const keyMetadata = store.keys[0];

const request = hyperliquidUserRoleRequest({ keyMetadata });
assert.equal(request.status, 'ok');
assert.equal(request.method, 'POST');
assert.equal(request.url, 'https://api.hyperliquid.xyz/info');
assert.deepEqual(request.body, {
  type: 'userRole',
  user: agentWallet,
});

const normalized = normalizeHyperliquidUserRoleResponse(
  {
    role: 'agent',
    data: { user },
  },
  {
    agent_wallet_address: agentWallet,
    expected_owners: [user],
    observed_at: timestamp,
    permissions: ['read', 'place_order'],
  }
);
assert.equal(normalized.status, 'ok');
assert.equal(normalized.agent_wallet_address, agentWallet);
assert.equal(normalized.user, user);
assert.equal(normalized.owner, user);
assert.equal(normalized.proof_source, 'hyperliquid_userRole');
assert.deepEqual(normalized.permissions, ['read', 'place_order']);

const roleFromType = normalizeHyperliquidUserRoleResponse(
  {
    type: 'agent',
    user,
  },
  {
    agent_wallet_address: agentWallet,
    expected_owners: [user],
    observed_at: timestamp,
  }
);
assert.equal(roleFromType.status, 'ok');

const mismatch = normalizeHyperliquidUserRoleResponse(
  {
    role: 'agent',
    data: { user: '0x2222222222222222222222222222222222222222' },
  },
  {
    agent_wallet_address: agentWallet,
    expected_owners: [user],
  }
);
assert.equal(mismatch.status, 'error');
assert.equal(mismatch.code, 'HYPERLIQUID_AGENT_WALLET_OWNER_MISMATCH');

const revoked = normalizeHyperliquidUserRoleResponse(
  {
    role: 'user',
    data: { user },
  },
  {
    agent_wallet_address: agentWallet,
    expected_owners: [user],
  }
);
assert.equal(revoked.status, 'error');
assert.equal(revoked.code, 'HYPERLIQUID_AGENT_WALLET_NOT_LINKED');

let capturedBody = null;
const verified = await verifyHyperliquidLiveAgentWalletGrant({
  keyMetadata,
  now: new Date(timestamp),
  fetchImpl: async (_url, init) => {
    capturedBody = JSON.parse(init.body);
    assert.equal(init.headers['content-type'], 'application/json');
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          role: 'agent',
          data: { user },
        };
      },
    };
  },
});
assert.equal(verified.status, 'ok');
assert.deepEqual(capturedBody, {
  type: 'userRole',
  user: agentWallet,
});
assert.equal(verified.metadata_proof.agent_wallet_address, agentWallet);
assert.equal(verified.retry.retry_count, 0);

const retrySleeps = [];
let attempts = 0;
const retried = await verifyHyperliquidLiveAgentWalletGrant({
  keyMetadata,
  now: new Date(timestamp),
  rateLimitPolicy: { max_attempts: 2, base_backoff_ms: 5, max_backoff_ms: 5 },
  sleepImpl: async (ms) => retrySleeps.push(ms),
  fetchImpl: async () => {
    attempts += 1;
    if (attempts === 1) {
      return {
        ok: false,
        status: 429,
        headers: { 'retry-after': '0.005' },
        async json() {
          return { error: 'rate limit' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          role: 'agent',
          data: { user },
        };
      },
    };
  },
});
assert.equal(retried.status, 'ok');
assert.equal(attempts, 2);
assert.deepEqual(retrySleeps, [5]);
assert.equal(retried.retry.retry_count, 1);

const liveMismatch = await verifyHyperliquidLiveAgentWalletGrant({
  keyMetadata,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        role: 'agent',
        data: { user: '0x2222222222222222222222222222222222222222' },
      };
    },
  }),
});
assert.equal(liveMismatch.status, 'error');
assert.equal(liveMismatch.code, 'HYPERLIQUID_AGENT_WALLET_OWNER_MISMATCH');

const missingGrant = await verifyHyperliquidLiveAgentWalletGrant({
  keyMetadata: {
    ...keyMetadata,
    agent_wallet_address: null,
    agent_wallet: null,
  },
  fetchImpl: async () => {
    throw new Error('fetch should not run without local grant metadata');
  },
});
assert.equal(missingGrant.status, 'error');
assert.equal(missingGrant.code, 'HYPERLIQUID_AGENT_WALLET_GRANT_REQUIRED');

console.log('ALL HYPERLIQUID AGENT WALLET ADAPTER TESTS PASS');
