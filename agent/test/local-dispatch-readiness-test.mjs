import assert from 'node:assert/strict';
import { buildLocalSecretStoreSnapshot } from '../../core/local-secrets.js';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import { buildOkxPlaceOrderTask } from '../../core/okx-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import { buildWalletReferenceSnapshot } from '../../core/wallet-refs.js';
import { getLocalDispatchReadiness } from '../src/local-dispatch-readiness.mjs';

const keyRecord = {
  venue_id: 'okx',
  key_handle: 'okx_key_ready',
  account_ref: 'okx:subaccount:ready',
  permissions: ['read', 'place_order', 'cancel_order'],
  ip_allowlist: true,
  rotated_at: '2026-06-01T00:00:00.000Z',
  rotation_days: 3650,
};
const okxProofTimestamp = '2026-06-03T00:00:00.000Z';
const secretStore = buildLocalSecretStoreSnapshot([keyRecord]);
const built = buildOkxPlaceOrderTask({
  taskId: 'task_okx_ready_1',
  keyMetadata: secretStore.keys[0],
  instrument: 'BTC-USDT',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  clientOrderId: 'sentry-ready-1',
});
assert.equal(built.status, 'ok');

const ready = await getLocalDispatchReadiness({
  task: built.task,
  secretStore,
  env: {
    SENTRY_OKX_OKX_KEY_READY_API_KEY: 'test-key',
    SENTRY_OKX_OKX_KEY_READY_SECRET_KEY: 'test-secret',
    SENTRY_OKX_OKX_KEY_READY_PASSPHRASE: 'test-passphrase',
  },
  keychain: {
    platform: 'darwin',
    execFileImpl: async () => {
      throw new Error('keychain should not be called when env is complete');
    },
  },
});
assert.equal(ready.status, 'ok');
assert.deepEqual(ready.ready_venue_ids, ['okx']);
assert.equal(ready.dispatch_ready_source, 'local_daemon');
assert.equal(ready.credential_resolution.source, 'env');
assert.equal(ready.operational_proof.rotation_proof.status, 'fresh');
assert.equal(JSON.stringify(ready).includes('test-secret'), false);

let okxLiveReadUrl = null;
let okxLiveReadHeaders = null;
const readyWithLiveRead = await getLocalDispatchReadiness({
  task: built.task,
  secretStore,
  env: {
    SENTRY_OKX_OKX_KEY_READY_API_KEY: 'test-key',
    SENTRY_OKX_OKX_KEY_READY_SECRET_KEY: 'test-secret',
    SENTRY_OKX_OKX_KEY_READY_PASSPHRASE: 'test-passphrase',
  },
  verifyOkxLiveRead: true,
  now: new Date(okxProofTimestamp),
  fetchImpl: async (url, init) => {
    okxLiveReadUrl = url;
    okxLiveReadHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          msg: '',
          data: [{ totalEq: '100', details: [] }],
        };
      },
    };
  },
});
assert.equal(readyWithLiveRead.status, 'ok');
assert.equal(readyWithLiveRead.live_read_proof.status, 'ok');
assert.equal(readyWithLiveRead.live_read_proof.proof_source, 'okx_account_balance');
assert.equal(readyWithLiveRead.live_read_proof.request_path, '/api/v5/account/balance');
assert.equal(okxLiveReadUrl, 'https://www.okx.com/api/v5/account/balance');
assert.equal(okxLiveReadHeaders['OK-ACCESS-KEY'], 'test-key');
assert.equal(JSON.stringify(readyWithLiveRead).includes('test-secret'), false);

const rejectedLiveRead = await getLocalDispatchReadiness({
  task: built.task,
  secretStore,
  env: {
    SENTRY_OKX_OKX_KEY_READY_API_KEY: 'test-key',
    SENTRY_OKX_OKX_KEY_READY_SECRET_KEY: 'test-secret',
    SENTRY_OKX_OKX_KEY_READY_PASSPHRASE: 'test-passphrase',
  },
  verifyOkxLiveRead: true,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { code: '50113', msg: 'Invalid signature' };
    },
  }),
});
assert.equal(rejectedLiveRead.status, 'error');
assert.equal(rejectedLiveRead.code, 'OKX_LIVE_READ_REJECTED');
assert.equal(rejectedLiveRead.local_decision, 'blocked_before_dispatch');
assert.equal(rejectedLiveRead.live_read_proof.okx_code, '50113');
assert.equal(JSON.stringify(rejectedLiveRead).includes('test-secret'), false);

const noIpAllowlist = await getLocalDispatchReadiness({
  task: built.task,
  secretStore: buildLocalSecretStoreSnapshot([{ ...keyRecord, ip_allowlist: false }]),
  env: {
    SENTRY_OKX_OKX_KEY_READY_API_KEY: 'test-key',
    SENTRY_OKX_OKX_KEY_READY_SECRET_KEY: 'test-secret',
    SENTRY_OKX_OKX_KEY_READY_PASSPHRASE: 'test-passphrase',
  },
});
assert.equal(noIpAllowlist.status, 'error');
assert.equal(noIpAllowlist.code, 'IP_ALLOWLIST_REQUIRED');
assert.equal(noIpAllowlist.local_decision, 'blocked_before_dispatch');

const expiredOkxRotation = await getLocalDispatchReadiness({
  task: built.task,
  secretStore: buildLocalSecretStoreSnapshot([
    { ...keyRecord, rotated_at: '2026-05-01T00:00:00.000Z', rotation_days: 1 },
  ]),
  now: new Date(okxProofTimestamp),
});
assert.equal(expiredOkxRotation.status, 'error');
assert.equal(expiredOkxRotation.code, 'KEY_ROTATION_EXPIRED');
assert.equal(expiredOkxRotation.local_decision, 'blocked_before_dispatch');
assert.equal(expiredOkxRotation.operational_proof.rotation_proof.status, 'expired');

const missingCredentials = await getLocalDispatchReadiness({
  task: built.task,
  secretStore,
  env: {},
  keychain: { platform: 'linux' },
});
assert.equal(missingCredentials.status, 'error');
assert.equal(missingCredentials.code, 'OKX_CREDENTIAL_SOURCE_MISSING');
assert.equal(JSON.stringify(missingCredentials).includes('test-secret'), false);

const missingKey = await getLocalDispatchReadiness({
  task: built.task,
  secretStore: buildLocalSecretStoreSnapshot([]),
});
assert.equal(missingKey.status, 'error');
assert.equal(missingKey.code, 'OKX_KEY_METADATA_REQUIRED');

const revokedOkxKey = await getLocalDispatchReadiness({
  task: built.task,
  secretStore: buildLocalSecretStoreSnapshot([
    {
      ...keyRecord,
      status: 'revoked',
      revoked_at: '2026-06-04T00:00:00.000Z',
      permissions: ['read'],
    },
  ]),
  env: {
    SENTRY_OKX_OKX_KEY_READY_API_KEY: 'test-key',
    SENTRY_OKX_OKX_KEY_READY_SECRET_KEY: 'test-secret',
    SENTRY_OKX_OKX_KEY_READY_PASSPHRASE: 'test-passphrase',
  },
});
assert.equal(revokedOkxKey.status, 'error');
assert.equal(revokedOkxKey.code, 'KEY_NOT_LINKED');
assert.equal(revokedOkxKey.local_decision, 'blocked_before_dispatch');

const ambiguousKey = await getLocalDispatchReadiness({
  task: {
    ...built.task,
    authorization: {
      ...built.task.authorization,
      authorization_ref: 'okx:key-handle',
    },
    policy_context: {
      ...built.task.policy_context,
      account_ref: null,
    },
  },
  secretStore: buildLocalSecretStoreSnapshot([
    keyRecord,
    { ...keyRecord, key_handle: 'okx_key_ready_2', account_ref: 'okx:subaccount:ready-2' },
  ]),
});
assert.equal(ambiguousKey.status, 'error');
assert.equal(ambiguousKey.code, 'OKX_KEY_HANDLE_REQUIRED');

const hyperliquidUser = '0x0000000000000000000000000000000000000001';
const hyperliquidKey = {
  venue_id: 'hyperliquid',
  key_handle: 'hl_key_ready',
  account_ref: 'hyperliquid:subaccount:ready',
  read_account_address: hyperliquidUser,
  agent_wallet_address: '0x1111111111111111111111111111111111111111',
  agent_wallet_grant: {
    status: 'active',
    source: 'metadata_attestation',
    verified_at: '2026-06-03T00:00:00.000Z',
    permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  },
  permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  rotated_at: '2026-06-01T00:00:00.000Z',
  rotation_days: 3650,
};
const hyperliquidStore = buildLocalSecretStoreSnapshot([hyperliquidKey]);
const hyperliquidBuilt = buildHyperliquidPlaceOrderTask({
  taskId: 'task_hl_ready_1',
  keyMetadata: hyperliquidStore.keys[0],
  coin: 'BTC',
  side: 'buy',
  orderType: 'limit',
  size: '0.01',
  price: '99000',
  cloid: '0x00000000000000000000000000000001',
});
assert.equal(hyperliquidBuilt.status, 'ok');

const hyperliquidReady = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: hyperliquidStore,
  env: {},
});
assert.equal(hyperliquidReady.status, 'ok');
assert.deepEqual(hyperliquidReady.ready_venue_ids, ['hyperliquid']);
assert.equal(hyperliquidReady.dispatch_ready_source, 'local_daemon');
assert.equal(hyperliquidReady.read_account_address, hyperliquidUser);
assert.equal(hyperliquidReady.agent_wallet_address, '0x1111111111111111111111111111111111111111');
assert.equal(hyperliquidReady.agent_wallet_grant.status, 'ok');
assert.equal(hyperliquidReady.operational_proof.rotation_proof.status, 'fresh');
assert.equal(JSON.stringify(hyperliquidReady).includes('private_key'), false);

const hyperliquidExpiredRotation = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: buildLocalSecretStoreSnapshot([
    { ...hyperliquidKey, rotated_at: '2026-05-01T00:00:00.000Z', rotation_days: 1 },
  ]),
  env: {},
  now: new Date('2026-06-03T00:00:00.000Z'),
});
assert.equal(hyperliquidExpiredRotation.status, 'error');
assert.equal(hyperliquidExpiredRotation.code, 'KEY_ROTATION_EXPIRED');
assert.equal(hyperliquidExpiredRotation.local_decision, 'blocked_before_dispatch');
assert.equal(hyperliquidExpiredRotation.operational_proof.rotation_proof.status, 'expired');

let hyperliquidLiveGrantBody = null;
const hyperliquidReadyLive = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: hyperliquidStore,
  env: {},
  verifyHyperliquidLiveGrant: true,
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (_url, init) => {
    hyperliquidLiveGrantBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          role: 'agent',
          data: { user: hyperliquidUser },
        };
      },
    };
  },
});
assert.equal(hyperliquidReadyLive.status, 'ok');
assert.equal(hyperliquidReadyLive.agent_wallet_live_grant.status, 'ok');
assert.equal(hyperliquidReadyLive.agent_wallet_live_grant.proof_source, 'hyperliquid_userRole');
assert.deepEqual(hyperliquidLiveGrantBody, {
  type: 'userRole',
  user: '0x1111111111111111111111111111111111111111',
});

const hyperliquidLiveGrantRevoked = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: hyperliquidStore,
  env: {},
  verifyHyperliquidLiveGrant: true,
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        role: 'user',
        data: { user: hyperliquidUser },
      };
    },
  }),
});
assert.equal(hyperliquidLiveGrantRevoked.status, 'error');
assert.equal(hyperliquidLiveGrantRevoked.code, 'HYPERLIQUID_AGENT_WALLET_NOT_LINKED');
assert.equal(hyperliquidLiveGrantRevoked.agent_wallet_live_grant.role, 'user');

const hyperliquidMissingRead = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: buildLocalSecretStoreSnapshot([
    { ...hyperliquidKey, permissions: ['place_order', 'cancel_order'] },
  ]),
  env: {},
});
assert.equal(hyperliquidMissingRead.status, 'error');
assert.equal(hyperliquidMissingRead.code, 'KEY_PERMISSION_PROOF_MISSING');

const hyperliquidMissingGrant = await getLocalDispatchReadiness({
  task: hyperliquidBuilt.task,
  secretStore: buildLocalSecretStoreSnapshot([
    { ...hyperliquidKey, agent_wallet_address: null, agent_wallet_grant: null },
  ]),
  env: {},
});
assert.equal(hyperliquidMissingGrant.status, 'error');
assert.equal(hyperliquidMissingGrant.code, 'HYPERLIQUID_AGENT_WALLET_GRANT_REQUIRED');

const hyperliquidMissingUser = await getLocalDispatchReadiness({
  task: {
    ...hyperliquidBuilt.task,
    policy_context: {
      ...hyperliquidBuilt.task.policy_context,
      read_account_address: null,
    },
  },
  secretStore: buildLocalSecretStoreSnapshot([
    {
      ...hyperliquidKey,
      read_account_address: null,
      account_ref: 'hyperliquid:subaccount:ready',
    },
  ]),
  env: {},
});
assert.equal(hyperliquidMissingUser.status, 'error');
assert.equal(hyperliquidMissingUser.code, 'HYPERLIQUID_USER_ADDRESS_REQUIRED');

const hyperliquidAmbiguousKey = await getLocalDispatchReadiness({
  task: {
    ...hyperliquidBuilt.task,
    authorization: {
      ...hyperliquidBuilt.task.authorization,
      authorization_ref: 'hyperliquid:agent-wallet',
    },
    policy_context: {
      ...hyperliquidBuilt.task.policy_context,
      account_ref: null,
      read_account_address: null,
    },
  },
  secretStore: buildLocalSecretStoreSnapshot([
    hyperliquidKey,
    {
      ...hyperliquidKey,
      key_handle: 'hl_key_ready_2',
      account_ref: 'hyperliquid:subaccount:ready-2',
    },
  ]),
  env: {},
});
assert.equal(hyperliquidAmbiguousKey.status, 'error');
assert.equal(hyperliquidAmbiguousKey.code, 'HYPERLIQUID_KEY_HANDLE_REQUIRED');

const solanaOwner = '11111111111111111111111111111111';
const solanaBuilt = buildSolanaSwapTask({
  taskId: 'task_solana_ready_1',
  account: {
    owner: solanaOwner,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'jupiter',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000000',
  quoteId: 'quote_solana_ready_1',
});
assert.equal(solanaBuilt.status, 'ok');

const solanaReady = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
    SENTRY_SOLANA_RPC_URL: 'https://solana.invalid',
  },
});
assert.equal(solanaReady.status, 'ok');
assert.deepEqual(solanaReady.ready_venue_ids, ['solana-mainnet']);
assert.equal(solanaReady.dispatch_ready_source, 'local_daemon');
assert.equal(solanaReady.local_account_proof.source, 'env');
assert.equal(solanaReady.local_account_proof.account_ref, solanaOwner);
assert.equal(solanaReady.local_account_proof.rpc_url, 'https://solana.invalid');
assert.equal(solanaReady.local_account_proof.signer_probe.status, 'partial');
assert.equal(
  solanaReady.local_account_proof.signer_probe.code,
  'SOLANA_SIGNER_PROBE_NOT_CONFIGURED'
);
assert.deepEqual(solanaReady.local_account_proof.required_capabilities, [
  'read',
  'sign',
  'submit_tx',
]);
assert.equal(JSON.stringify(solanaReady).includes('private_key'), false);

const solanaWalletStore = buildWalletReferenceSnapshot([
  {
    wallet_id: 'ows_solana_ready',
    accounts: [{ chain_id: 'solana:mainnet', address: solanaOwner }],
    capabilities: ['read', 'sign', 'submit_tx'],
  },
]);
const solanaOwsReady = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  walletStore: solanaWalletStore,
  env: {},
});
assert.equal(solanaOwsReady.status, 'ok');
assert.equal(solanaOwsReady.local_account_proof.source, 'ows_wallet_ref');
assert.equal(solanaOwsReady.local_account_proof.wallet_ref.wallet_id, 'ows_solana_ready');
assert.equal(solanaOwsReady.local_account_proof.wallet_ref.signing_handoff, 'external_agent_ows');
assert.equal(JSON.stringify(solanaOwsReady).includes('token'), false);

const solanaOwsSignerBlocked = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  walletStore: solanaWalletStore,
  requireSignerProbe: true,
  env: {},
});
assert.equal(solanaOwsSignerBlocked.status, 'error');
assert.equal(solanaOwsSignerBlocked.code, 'SOLANA_SIGNER_PROBE_NOT_CONFIGURED');
assert.equal(solanaOwsSignerBlocked.wallet_ref.wallet_id, 'ows_solana_ready');

const solanaRevokedWalletBlocked = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  walletStore: buildWalletReferenceSnapshot([
    {
      wallet_id: 'ows_solana_ready',
      status: 'revoked',
      accounts: [{ chain_id: 'solana:mainnet', address: solanaOwner, capabilities: ['read'] }],
      capabilities: ['read'],
    },
  ]),
  env: {},
});
assert.equal(solanaRevokedWalletBlocked.status, 'error');
assert.equal(solanaRevokedWalletBlocked.code, 'SOLANA_OWS_WALLET_NOT_LINKED');
assert.equal(solanaRevokedWalletBlocked.local_decision, 'blocked_before_dispatch');

const solanaRequireSignerBlocked = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  requireSignerProbe: true,
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
  },
});
assert.equal(solanaRequireSignerBlocked.status, 'error');
assert.equal(solanaRequireSignerBlocked.code, 'SOLANA_SIGNER_PROBE_NOT_CONFIGURED');

const solanaSignerReady = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  requireSignerProbe: true,
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
    SENTRY_SOLANA_SIGNER_ADDRESS: solanaOwner,
  },
});
assert.equal(solanaSignerReady.status, 'ok');
assert.equal(solanaSignerReady.local_account_proof.signer_probe.status, 'ok');
assert.equal(solanaSignerReady.local_account_proof.signer_probe.source, 'env_signer_address');

const solanaMissingEnv = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  env: {},
});
assert.equal(solanaMissingEnv.status, 'error');
assert.equal(solanaMissingEnv.code, 'SOLANA_WALLET_ADDRESS_REQUIRED');

const solanaMismatch = await getLocalDispatchReadiness({
  task: solanaBuilt.task,
  env: {
    SENTRY_SOLANA_WALLET_ADDRESS: 'So11111111111111111111111111111111111111112',
  },
});
assert.equal(solanaMismatch.status, 'error');
assert.equal(solanaMismatch.code, 'SOLANA_LOCAL_ACCOUNT_MISMATCH');

const ethereumAccount = '0x0000000000000000000000000000000000000001';
const ethereumBuilt = buildEthereumSwapTask({
  taskId: 'task_ethereum_ready_1',
  account: {
    account: ethereumAccount,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'uniswap',
  inputToken: '0x0000000000000000000000000000000000000002',
  outputToken: '0x0000000000000000000000000000000000000003',
  amount: '1000000',
  quoteId: 'quote_ethereum_ready_1',
});
assert.equal(ethereumBuilt.status, 'ok');

const ethereumReady = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: '0x0000000000000000000000000000000000000001',
    SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.invalid',
  },
});
assert.equal(ethereumReady.status, 'ok');
assert.deepEqual(ethereumReady.ready_venue_ids, ['ethereum-mainnet']);
assert.equal(ethereumReady.dispatch_ready_source, 'local_daemon');
assert.equal(ethereumReady.account_ref, ethereumAccount);
assert.equal(ethereumReady.local_account_proof.source, 'env');
assert.equal(ethereumReady.local_account_proof.account_ref, ethereumAccount);
assert.equal(ethereumReady.local_account_proof.rpc_url, 'https://ethereum.invalid');
assert.equal(ethereumReady.local_account_proof.signer_probe.status, 'partial');
assert.equal(
  ethereumReady.local_account_proof.signer_probe.code,
  'ETHEREUM_SIGNER_PROBE_NOT_CONFIGURED'
);
assert.deepEqual(ethereumReady.local_account_proof.required_capabilities, [
  'read',
  'sign',
  'submit_tx',
]);
assert.equal(JSON.stringify(ethereumReady).includes('private_key'), false);

const ethereumWalletStore = buildWalletReferenceSnapshot([
  {
    wallet_id: 'ows_ethereum_ready',
    accounts: [{ chain_id: 'eip155:1', address: ethereumAccount }],
    capabilities: ['read', 'sign', 'submit_tx'],
  },
]);
const ethereumOwsReady = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  walletStore: ethereumWalletStore,
  env: {},
});
assert.equal(ethereumOwsReady.status, 'ok');
assert.equal(ethereumOwsReady.local_account_proof.source, 'ows_wallet_ref');
assert.equal(ethereumOwsReady.local_account_proof.wallet_ref.wallet_id, 'ows_ethereum_ready');
assert.equal(ethereumOwsReady.local_account_proof.wallet_ref.signing_handoff, 'external_agent_ows');
assert.equal(JSON.stringify(ethereumOwsReady).includes('token'), false);

const ethereumOwsSignerBlocked = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  walletStore: ethereumWalletStore,
  requireSignerProbe: true,
  env: {},
});
assert.equal(ethereumOwsSignerBlocked.status, 'error');
assert.equal(ethereumOwsSignerBlocked.code, 'ETHEREUM_SIGNER_PROBE_NOT_CONFIGURED');
assert.equal(ethereumOwsSignerBlocked.wallet_ref.wallet_id, 'ows_ethereum_ready');

const ethereumRevokedWalletBlocked = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  walletStore: buildWalletReferenceSnapshot([
    {
      wallet_id: 'ows_ethereum_ready',
      status: 'revoked',
      accounts: [{ chain_id: 'eip155:1', address: ethereumAccount, capabilities: ['read'] }],
      capabilities: ['read'],
    },
  ]),
  env: {},
});
assert.equal(ethereumRevokedWalletBlocked.status, 'error');
assert.equal(ethereumRevokedWalletBlocked.code, 'ETHEREUM_OWS_WALLET_NOT_LINKED');
assert.equal(ethereumRevokedWalletBlocked.local_decision, 'blocked_before_dispatch');

const ethereumRequireSignerBlocked = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  requireSignerProbe: true,
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: ethereumAccount,
  },
});
assert.equal(ethereumRequireSignerBlocked.status, 'error');
assert.equal(ethereumRequireSignerBlocked.code, 'ETHEREUM_SIGNER_PROBE_NOT_CONFIGURED');

const ethereumSignerReady = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  requireSignerProbe: true,
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: ethereumAccount,
    SENTRY_ETHEREUM_SIGNER_ADDRESS: ethereumAccount,
  },
});
assert.equal(ethereumSignerReady.status, 'ok');
assert.equal(ethereumSignerReady.local_account_proof.signer_probe.status, 'ok');
assert.equal(ethereumSignerReady.local_account_proof.signer_probe.source, 'env_signer_address');

const ethereumMissingEnv = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  env: {},
});
assert.equal(ethereumMissingEnv.status, 'error');
assert.equal(ethereumMissingEnv.code, 'ETHEREUM_WALLET_ADDRESS_REQUIRED');

const ethereumMismatch = await getLocalDispatchReadiness({
  task: ethereumBuilt.task,
  env: {
    SENTRY_ETHEREUM_WALLET_ADDRESS: '0x0000000000000000000000000000000000000004',
  },
});
assert.equal(ethereumMismatch.status, 'error');
assert.equal(ethereumMismatch.code, 'ETHEREUM_LOCAL_ACCOUNT_MISMATCH');

const skipped = await getLocalDispatchReadiness({
  task: {
    task_id: 'task_sui_demo',
    venue_id: 'sui-testnet-demo',
    action: { type: 'submit_tx' },
  },
  secretStore,
});
assert.equal(skipped.status, 'skipped');
assert.deepEqual(skipped.ready_venue_ids, []);

console.log('ALL LOCAL DISPATCH READINESS TESTS PASS');
