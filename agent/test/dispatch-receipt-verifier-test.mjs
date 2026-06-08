import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildLocalSecretStoreSnapshot } from '../../core/local-secrets.js';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import { buildOkxPlaceOrderTask } from '../../core/okx-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import { verifyDispatchReceipt } from '../src/dispatch-receipt-verifier.mjs';
import { readHyperliquidNonceStore } from '../src/hyperliquid-nonce-store.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-dispatch-receipt-'));

function mockSignerSpawn(handler) {
  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let stdinBody = '';
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdinBody += chunk.toString();
        callback();
      },
      final(callback) {
        const payload = JSON.parse(stdinBody);
        calls.push({ cmd, args, env: options.env, payload });
        Promise.resolve(handler({ cmd, args, env: options.env, payload }))
          .then((result = {}) => {
            if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
            if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
            child.emit('close', result.exitCode ?? 0, result.signal ?? null);
          })
          .catch((error) => child.emit('error', error));
        callback();
      },
    });
    child.kill = () => {
      child.killed = true;
    };
    return child;
  };
  return { calls, spawnImpl };
}

try {
  const keyRecord = {
    venue_id: 'okx',
    key_handle: 'okx_key_receipt',
    account_ref: 'okx:subaccount:receipt',
    permissions: ['read', 'place_order', 'cancel_order'],
    ip_allowlist: true,
  };
  const secretStore = buildLocalSecretStoreSnapshot([keyRecord]);
  const built = buildOkxPlaceOrderTask({
    taskId: 'task_okx_receipt_1',
    keyMetadata: secretStore.keys[0],
    instrument: 'BTC-USDT',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    clientOrderId: 'sentry-receipt-1',
  });
  assert.equal(built.status, 'ok');

  const dispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: built.task.task_id,
    agent_result: {
      task_id: built.task.task_id,
      status: 'submitted',
      evidence: {
        venue_id: 'okx',
        venue_order_id: '123456789',
        client_order_id: 'sentry-receipt-1',
      },
    },
  };

  let capturedUrl = null;
  const verified = await verifyDispatchReceipt({
    task: built.task,
    dispatch,
    secretStore,
    env: {
      SENTRY_OKX_OKX_KEY_RECEIPT_API_KEY: 'test-key',
      SENTRY_OKX_OKX_KEY_RECEIPT_SECRET_KEY: 'test-secret',
      SENTRY_OKX_OKX_KEY_RECEIPT_PASSPHRASE: 'test-passphrase',
    },
    now: new Date(timestamp),
    simulated: true,
    fetchImpl: async (url, init) => {
      capturedUrl = url;
      assert.equal(init.headers['OK-ACCESS-KEY'], 'test-key');
      assert.equal(init.headers['x-simulated-trading'], '1');
      assert.equal(JSON.stringify(init.headers).includes('test-secret'), false);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: '0',
            msg: '',
            data: [
              {
                ordId: '123456789',
                clOrdId: 'sentry-receipt-1',
                instId: 'BTC-USDT',
                state: 'filled',
                accFillSz: '0.01',
                avgPx: '99000',
              },
            ],
          };
        },
      };
    },
  });
  assert.equal(verified.status, 'ok');
  assert.equal(verified.dispatch.local_decision, 'accepted_result_verified_terminal');
  assert.equal(verified.dispatch.receipt_verification.order_state, 'filled');
  assert.equal(verified.dispatch.agent_result.evidence.order_state, 'filled');
  assert.equal(capturedUrl?.includes('/api/v5/trade/order?'), true);
  assert.equal(JSON.stringify(verified).includes('test-secret'), false);

  const missingKey = await verifyDispatchReceipt({
    task: built.task,
    dispatch,
    secretStore: buildLocalSecretStoreSnapshot([]),
  });
  assert.equal(missingKey.status, 'error');
  assert.equal(missingKey.code, 'OKX_KEY_METADATA_REQUIRED');
  assert.equal(missingKey.local_decision, 'receipt_verification_failed');

  const missingCredentials = await verifyDispatchReceipt({
    task: built.task,
    dispatch,
    secretStore,
    env: {},
    keychain: { platform: 'linux' },
  });
  assert.equal(missingCredentials.status, 'error');
  assert.equal(missingCredentials.code, 'OKX_CREDENTIAL_SOURCE_MISSING');

  const noIpAllowlist = await verifyDispatchReceipt({
    task: built.task,
    dispatch,
    secretStore: buildLocalSecretStoreSnapshot([{ ...keyRecord, ip_allowlist: false }]),
    env: {
      SENTRY_OKX_OKX_KEY_RECEIPT_API_KEY: 'test-key',
      SENTRY_OKX_OKX_KEY_RECEIPT_SECRET_KEY: 'test-secret',
      SENTRY_OKX_OKX_KEY_RECEIPT_PASSPHRASE: 'test-passphrase',
    },
  });
  assert.equal(noIpAllowlist.status, 'error');
  assert.equal(noIpAllowlist.code, 'IP_ALLOWLIST_REQUIRED');

  const missingReadPermission = await verifyDispatchReceipt({
    task: built.task,
    dispatch,
    secretStore: buildLocalSecretStoreSnapshot([
      { ...keyRecord, permissions: ['place_order', 'cancel_order'], ip_allowlist: true },
    ]),
    env: {
      SENTRY_OKX_OKX_KEY_RECEIPT_API_KEY: 'test-key',
      SENTRY_OKX_OKX_KEY_RECEIPT_SECRET_KEY: 'test-secret',
      SENTRY_OKX_OKX_KEY_RECEIPT_PASSPHRASE: 'test-passphrase',
    },
  });
  assert.equal(missingReadPermission.status, 'error');
  assert.equal(missingReadPermission.code, 'KEY_PERMISSION_PROOF_MISSING');

  const hyperliquidUser = '0x0000000000000000000000000000000000000001';
  const hyperliquidCloid = '0x00000000000000000000000000000001';
  const hyperliquidKey = {
    venue_id: 'hyperliquid',
    key_handle: 'hl_key_receipt',
    account_ref: 'hyperliquid:subaccount:receipt',
    read_account_address: hyperliquidUser,
    agent_wallet_address: '0x1111111111111111111111111111111111111111',
    agent_wallet_grant: {
      status: 'active',
      source: 'metadata_attestation',
      verified_at: timestamp,
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    },
    permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
  };
  const hyperliquidStore = buildLocalSecretStoreSnapshot([hyperliquidKey]);
  const hyperliquidTask = buildHyperliquidPlaceOrderTask({
    taskId: 'task_hl_receipt_1',
    keyMetadata: hyperliquidStore.keys[0],
    coin: 'BTC',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    cloid: hyperliquidCloid,
  });
  assert.equal(hyperliquidTask.status, 'ok');
  const hyperliquidDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: hyperliquidTask.task.task_id,
    agent_result: {
      task_id: hyperliquidTask.task.task_id,
      status: 'submitted',
      evidence: {
        venue_id: 'hyperliquid',
        venue_order_id: '123456789',
        client_order_id: hyperliquidCloid,
        coin: 'BTC',
      },
    },
  };

  let capturedHyperliquidBody = null;
  const verifiedHyperliquid = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: hyperliquidDispatch,
    secretStore: hyperliquidStore,
    now: new Date(timestamp),
    fetchImpl: async (_url, init) => {
      capturedHyperliquidBody = JSON.parse(init.body);
      assert.equal(init.headers['content-type'], 'application/json');
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'order',
            order: {
              order: {
                coin: 'BTC',
                oid: 123456789,
                cloid: hyperliquidCloid,
                side: 'B',
                limitPx: '99000',
                sz: '0.01',
                origSz: '0.01',
              },
              status: 'open',
              statusTimestamp: 1_780_000_001_000,
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedHyperliquid.status, 'ok');
  assert.equal(verifiedHyperliquid.dispatch.local_decision, 'accepted_result_verified_open');
  assert.equal(verifiedHyperliquid.dispatch.receipt_verification.order_state, 'open');
  assert.equal(verifiedHyperliquid.dispatch.receipt_verification.venue_id, 'hyperliquid');
  assert.equal(
    verifiedHyperliquid.dispatch.receipt_verification.agent_wallet_grant.agent_wallet_address,
    '0x1111111111111111111111111111111111111111'
  );
  assert.equal(verifiedHyperliquid.dispatch.agent_result.evidence.order_state, 'open');
  assert.deepEqual(capturedHyperliquidBody, {
    type: 'orderStatus',
    user: hyperliquidUser,
    oid: 123456789,
  });

  const hyperliquidLiveBodies = [];
  const verifiedHyperliquidLiveGrant = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: hyperliquidDispatch,
    secretStore: hyperliquidStore,
    now: new Date(timestamp),
    verifyHyperliquidLiveGrant: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      hyperliquidLiveBodies.push(body);
      if (body.type === 'userRole') {
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
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'order',
            order: {
              order: {
                coin: 'BTC',
                oid: 123456789,
                cloid: hyperliquidCloid,
                side: 'B',
                limitPx: '99000',
                sz: '0.01',
                origSz: '0.01',
              },
              status: 'open',
              statusTimestamp: 1_780_000_001_000,
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedHyperliquidLiveGrant.status, 'ok');
  assert.equal(
    verifiedHyperliquidLiveGrant.dispatch.receipt_verification.agent_wallet_live_grant.status,
    'ok'
  );
  assert.deepEqual(hyperliquidLiveBodies, [
    {
      type: 'userRole',
      user: '0x1111111111111111111111111111111111111111',
    },
    {
      type: 'orderStatus',
      user: hyperliquidUser,
      oid: 123456789,
    },
  ]);

  const hyperliquidSignedPayload = {
    action: {
      type: 'order',
      orders: [
        {
          a: 0,
          b: true,
          p: '99000',
          s: '0.01',
          r: false,
          t: { limit: { tif: 'Gtc' } },
          c: hyperliquidCloid,
        },
      ],
      grouping: 'na',
    },
    nonce: 1_780_000_000_000,
    signature: {
      r: '0x1111111111111111111111111111111111111111111111111111111111111111',
      s: '0x2222222222222222222222222222222222222222222222222222222222222222',
      v: 27,
    },
    expiresAfter: 1_781_000_000_000,
  };
  const proposedHyperliquidDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: hyperliquidTask.task.task_id,
    agent_result: {
      task_id: hyperliquidTask.task.task_id,
      status: 'proposed',
      evidence: {
        venue_id: 'hyperliquid',
        signed_exchange_payload: hyperliquidSignedPayload,
      },
    },
  };

  const signedSubmitBodies = [];
  const hyperliquidNonceStorePath = path.join(dir, 'hyperliquid-nonces.json');
  const verifiedHyperliquidSignedSubmit = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: proposedHyperliquidDispatch,
    secretStore: hyperliquidStore,
    now: new Date(timestamp),
    hyperliquidNonceStorePath,
    verifyHyperliquidLiveGrant: true,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      signedSubmitBodies.push(body);
      if (body.type === 'userRole') {
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
      }
      if (body.action?.type === 'order') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              status: 'ok',
              response: {
                type: 'order',
                data: {
                  statuses: [{ resting: { oid: 123456789, cloid: hyperliquidCloid } }],
                },
              },
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'order',
            order: {
              order: {
                coin: 'BTC',
                oid: 123456789,
                cloid: hyperliquidCloid,
                side: 'B',
                limitPx: '99000',
                sz: '0.01',
                origSz: '0.01',
              },
              status: 'open',
              statusTimestamp: 1_780_000_001_000,
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedHyperliquidSignedSubmit.status, 'ok');
  assert.equal(verifiedHyperliquidSignedSubmit.dispatch.agent_result.status, 'submitted');
  assert.equal(
    verifiedHyperliquidSignedSubmit.dispatch.agent_result.evidence.signed_exchange_submit,
    true
  );
  assert.equal(verifiedHyperliquidSignedSubmit.receipt_verification.signed_submit.status, 'ok');
  assert.equal(
    verifiedHyperliquidSignedSubmit.receipt_verification.signed_submit.nonce,
    1_780_000_000_000
  );
  assert.equal(
    verifiedHyperliquidSignedSubmit.receipt_verification.agent_wallet_live_grant.status,
    'ok'
  );
  assert.deepEqual(signedSubmitBodies[0], {
    type: 'userRole',
    user: '0x1111111111111111111111111111111111111111',
  });
  assert.deepEqual(signedSubmitBodies[1], hyperliquidSignedPayload);
  assert.deepEqual(signedSubmitBodies[2], {
    type: 'orderStatus',
    user: hyperliquidUser,
    oid: 123456789,
  });
  const nonceStore = await readHyperliquidNonceStore({ storePath: hyperliquidNonceStorePath });
  assert.equal(nonceStore.records.length, 1);
  assert.equal(nonceStore.records[0].status, 'submitted');
  assert.equal(nonceStore.records[0].venue_order_id, '123456789');

  const missingHyperliquidKey = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: hyperliquidDispatch,
    secretStore: buildLocalSecretStoreSnapshot([]),
  });
  assert.equal(missingHyperliquidKey.status, 'error');
  assert.equal(missingHyperliquidKey.code, 'HYPERLIQUID_KEY_METADATA_REQUIRED');

  const missingHyperliquidRead = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: hyperliquidDispatch,
    secretStore: buildLocalSecretStoreSnapshot([
      { ...hyperliquidKey, permissions: ['place_order', 'cancel_order'] },
    ]),
  });
  assert.equal(missingHyperliquidRead.status, 'error');
  assert.equal(missingHyperliquidRead.code, 'KEY_PERMISSION_PROOF_MISSING');

  const missingHyperliquidGrant = await verifyDispatchReceipt({
    task: hyperliquidTask.task,
    dispatch: hyperliquidDispatch,
    secretStore: buildLocalSecretStoreSnapshot([
      { ...hyperliquidKey, agent_wallet_address: null, agent_wallet_grant: null },
    ]),
    fetchImpl: async () => {
      throw new Error('fetch should not run without Hyperliquid agent-wallet grant proof');
    },
  });
  assert.equal(missingHyperliquidGrant.status, 'error');
  assert.equal(missingHyperliquidGrant.code, 'HYPERLIQUID_AGENT_WALLET_GRANT_REQUIRED');

  const missingHyperliquidUser = await verifyDispatchReceipt({
    task: {
      ...hyperliquidTask.task,
      policy_context: {
        ...hyperliquidTask.task.policy_context,
        read_account_address: null,
      },
    },
    dispatch: hyperliquidDispatch,
    secretStore: buildLocalSecretStoreSnapshot([
      {
        ...hyperliquidKey,
        read_account_address: null,
        account_ref: 'hyperliquid:subaccount:receipt',
      },
    ]),
    env: {},
    fetchImpl: async () => {
      throw new Error('fetch should not run without a Hyperliquid user address');
    },
  });
  assert.equal(missingHyperliquidUser.status, 'error');
  assert.equal(missingHyperliquidUser.code, 'HYPERLIQUID_USER_ADDRESS_REQUIRED');

  const solanaSignature =
    '5KJvsngHeMpm884wtmM1ke22tjhMgZorT1fdS1T8yPzJkQdY1LZQmibZQj1A7wB8Qz3n8YdDsZc8QmvM1Qx3abc';
  const solanaTask = buildSolanaSwapTask({
    taskId: 'task_solana_receipt_1',
    account: {
      owner: '11111111111111111111111111111111',
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    adapter: 'jupiter',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '1000000',
    quoteId: 'quote_solana_receipt_1',
  });
  assert.equal(solanaTask.status, 'ok');
  const solanaDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: solanaTask.task.task_id,
    agent_result: {
      task_id: solanaTask.task.task_id,
      status: 'submitted',
      evidence: {
        venue_id: 'solana-mainnet',
        signature: solanaSignature,
        tx_signature: solanaSignature,
        quote_id: 'quote_solana_receipt_1',
      },
    },
  };
  let capturedSolanaRpcBody = null;
  const verifiedSolana = await verifyDispatchReceipt({
    task: solanaTask.task,
    dispatch: solanaDispatch,
    secretStore,
    now: new Date(timestamp),
    env: { SENTRY_SOLANA_RPC_URL: 'https://solana.invalid' },
    fetchImpl: async (_url, init) => {
      capturedSolanaRpcBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              value: [
                {
                  slot: 123456,
                  confirmations: null,
                  err: null,
                  confirmationStatus: 'finalized',
                },
              ],
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedSolana.status, 'ok');
  assert.equal(verifiedSolana.dispatch.local_decision, 'accepted_result_verified_terminal');
  assert.equal(verifiedSolana.dispatch.receipt_verification.venue_id, 'solana-mainnet');
  assert.equal(verifiedSolana.dispatch.receipt_verification.signature, solanaSignature);
  assert.equal(verifiedSolana.dispatch.receipt_verification.tx_digest, solanaSignature);
  assert.equal(verifiedSolana.dispatch.agent_result.evidence.confirmation_status, 'finalized');
  assert.equal(verifiedSolana.dispatch.agent_result.evidence.tx_digest, solanaSignature);
  assert.deepEqual(capturedSolanaRpcBody, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignatureStatuses',
    params: [[solanaSignature], { searchTransactionHistory: true }],
  });

  const solanaUnsigned = Buffer.from('unsigned-solana-receipt-transaction').toString('base64');
  const proposedSolanaDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: solanaTask.task.task_id,
    agent_result: {
      task_id: solanaTask.task.task_id,
      status: 'proposed',
      evidence: {
        venue_id: 'solana-mainnet',
        chain_id: 'solana:mainnet',
        quote_id: 'quote_solana_receipt_1',
        unsigned_transaction_base64: solanaUnsigned,
        required_signers: [solanaTask.task.policy_context.owner],
        simulation: { status: 'ok' },
      },
    },
  };
  const solanaSignerMock = mockSignerSpawn(({ payload }) => {
    assert.equal(payload.venue_id, 'solana-mainnet');
    assert.equal(payload.prepared_transaction.unsigned_transaction_base64, solanaUnsigned);
    return { stdout: `${JSON.stringify({ signature: solanaSignature })}\n` };
  });
  const verifiedProposedSolana = await verifyDispatchReceipt({
    task: solanaTask.task,
    dispatch: proposedSolanaDispatch,
    secretStore,
    now: new Date(timestamp),
    env: {
      SENTRY_SOLANA_RPC_URL: 'https://solana.invalid',
      SENTRY_SOLANA_SIGNER_COMMAND: 'ows-solana submit',
    },
    signerSpawnImpl: solanaSignerMock.spawnImpl,
    fetchImpl: async (_url, init) => {
      capturedSolanaRpcBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              value: [
                {
                  slot: 123456,
                  confirmations: null,
                  err: null,
                  confirmationStatus: 'finalized',
                },
              ],
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedProposedSolana.status, 'ok');
  assert.equal(verifiedProposedSolana.dispatch.agent_result.status, 'submitted');
  assert.equal(verifiedProposedSolana.receipt_verification.signer_handoff.status, 'ok');
  assert.equal(verifiedProposedSolana.dispatch.agent_result.evidence.signer_handoff, true);
  assert.deepEqual(solanaSignerMock.calls[0].args, ['submit']);

  const ethereumTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const ethereumTask = buildEthereumSwapTask({
    taskId: 'task_ethereum_receipt_1',
    account: {
      account: '0x0000000000000000000000000000000000000001',
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    adapter: 'uniswap',
    inputToken: '0x0000000000000000000000000000000000000002',
    outputToken: '0x0000000000000000000000000000000000000003',
    amount: '1000000',
    quoteId: 'quote_ethereum_receipt_1',
  });
  assert.equal(ethereumTask.status, 'ok');
  const ethereumDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: ethereumTask.task.task_id,
    agent_result: {
      task_id: ethereumTask.task.task_id,
      status: 'submitted',
      evidence: {
        venue_id: 'ethereum-mainnet',
        chain_id: 'eip155:1',
        tx_hash: ethereumTxHash,
        transaction_hash: ethereumTxHash,
        quote_id: 'quote_ethereum_receipt_1',
      },
    },
  };
  let capturedEthereumRpcBody = null;
  const verifiedEthereum = await verifyDispatchReceipt({
    task: ethereumTask.task,
    dispatch: ethereumDispatch,
    secretStore,
    now: new Date(timestamp),
    env: { SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.invalid' },
    fetchImpl: async (_url, init) => {
      capturedEthereumRpcBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              transactionHash: ethereumTxHash,
              blockHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              blockNumber: '0x123',
              status: '0x1',
              gasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedEthereum.status, 'ok');
  assert.equal(verifiedEthereum.dispatch.local_decision, 'accepted_result_verified_terminal');
  assert.equal(verifiedEthereum.dispatch.receipt_verification.venue_id, 'ethereum-mainnet');
  assert.equal(verifiedEthereum.dispatch.receipt_verification.tx_hash, ethereumTxHash);
  assert.equal(verifiedEthereum.dispatch.receipt_verification.tx_digest, ethereumTxHash);
  assert.equal(verifiedEthereum.dispatch.agent_result.evidence.receipt_status, '0x1');
  assert.equal(verifiedEthereum.dispatch.agent_result.evidence.tx_digest, ethereumTxHash);
  assert.deepEqual(capturedEthereumRpcBody, {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getTransactionReceipt',
    params: [ethereumTxHash],
  });

  const proposedEthereumDispatch = {
    status: 'ok',
    local_decision: 'accepted_result',
    task_id: ethereumTask.task.task_id,
    agent_result: {
      task_id: ethereumTask.task.task_id,
      status: 'proposed',
      evidence: {
        venue_id: 'ethereum-mainnet',
        chain_id: 'eip155:1',
        quote_id: 'quote_ethereum_receipt_1',
        transaction_request: {
          from: ethereumTask.task.policy_context.account,
          to: '0xe592427a0aece92de3edee1f18e0157c05861564',
          data: '0x414bf389',
          value: '0',
        },
        simulation: { status: 'ok' },
      },
    },
  };
  const ethereumSignerMock = mockSignerSpawn(({ payload }) => {
    assert.equal(payload.venue_id, 'ethereum-mainnet');
    assert.equal(
      payload.prepared_transaction.transaction_request.from,
      ethereumTask.task.policy_context.account
    );
    return { stdout: `${JSON.stringify({ tx_hash: ethereumTxHash })}\n` };
  });
  const verifiedProposedEthereum = await verifyDispatchReceipt({
    task: ethereumTask.task,
    dispatch: proposedEthereumDispatch,
    secretStore,
    now: new Date(timestamp),
    env: {
      SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.invalid',
      SENTRY_ETHEREUM_SIGNER_COMMAND: 'safe-cli send-json',
    },
    signerSpawnImpl: ethereumSignerMock.spawnImpl,
    fetchImpl: async (_url, init) => {
      capturedEthereumRpcBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              transactionHash: ethereumTxHash,
              blockHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
              blockNumber: '0x123',
              status: '0x1',
              gasUsed: '0x5208',
              effectiveGasPrice: '0x3b9aca00',
            },
          };
        },
      };
    },
  });
  assert.equal(verifiedProposedEthereum.status, 'ok');
  assert.equal(verifiedProposedEthereum.dispatch.agent_result.status, 'submitted');
  assert.equal(verifiedProposedEthereum.receipt_verification.signer_handoff.status, 'ok');
  assert.equal(verifiedProposedEthereum.dispatch.agent_result.evidence.signer_handoff, true);
  assert.deepEqual(ethereumSignerMock.calls[0].args, ['send-json']);

  const skipped = await verifyDispatchReceipt({
    task: { venue_id: 'sui-testnet-demo', action: { type: 'submit_tx' } },
    dispatch,
    secretStore,
  });
  assert.equal(skipped.status, 'ok');
  assert.equal(skipped.receipt_verification.status, 'skipped');

  console.log('ALL DISPATCH RECEIPT VERIFIER TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
