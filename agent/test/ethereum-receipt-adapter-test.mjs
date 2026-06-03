import assert from 'node:assert/strict';
import {
  buildEthereumSwapTask,
  normalizeEthereumExecutionResult,
} from '../../core/ethereum-trade.js';
import {
  ethereumTransactionReceiptRequest,
  fetchEthereumTransactionReceipt,
  normalizeEthereumTransactionReceiptResponse,
} from '../src/ethereum-receipt-adapter.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const account = '0x0000000000000000000000000000000000000001';
const txHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
const built = buildEthereumSwapTask({
  taskId: 'task_ethereum_receipt_1',
  account: {
    account,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'uniswap',
  inputToken: '0x0000000000000000000000000000000000000002',
  outputToken: '0x0000000000000000000000000000000000000003',
  amount: '1000000',
  quoteId: 'quote_ethereum_receipt_1',
});
assert.equal(built.status, 'ok');

const result = normalizeEthereumExecutionResult(
  {
    tx_hash: txHash,
    quote_id: 'quote_ethereum_receipt_1',
  },
  { task_id: built.task.task_id, observed_at: timestamp }
);
assert.equal(result.status, 'submitted');

const request = ethereumTransactionReceiptRequest({ task: built.task, result });
assert.equal(request.status, 'ok');
assert.deepEqual(request.body, {
  jsonrpc: '2.0',
  id: 1,
  method: 'eth_getTransactionReceipt',
  params: [txHash],
});
assert.equal(request.idempotency_key, 'quote_ethereum_receipt_1');

const normalized = normalizeEthereumTransactionReceiptResponse(
  {
    result: {
      transactionHash: txHash,
      blockHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      blockNumber: '0x123',
      status: '0x1',
      gasUsed: '0x5208',
      effectiveGasPrice: '0x3b9aca00',
    },
  },
  {
    tx_hash: txHash,
    observed_at: timestamp,
    idempotency_key: 'quote_ethereum_receipt_1',
  }
);
assert.equal(normalized.status, 'ok');
assert.equal(normalized.terminal, true);
assert.equal(normalized.receipt_status, '0x1');

let capturedBody = null;
const fetched = await fetchEthereumTransactionReceipt({
  task: built.task,
  result,
  now: new Date(timestamp),
  env: { SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.invalid' },
  fetchImpl: async (url, init) => {
    assert.equal(url, 'https://ethereum.invalid');
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          result: {
            transactionHash: txHash,
            blockHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
            blockNumber: '0x123',
            status: '0x1',
            gasUsed: '0x5208',
          },
        };
      },
    };
  },
});
assert.equal(fetched.status, 'ok');
assert.deepEqual(capturedBody, request.body);

const notFound = normalizeEthereumTransactionReceiptResponse(
  {
    result: null,
  },
  { tx_hash: txHash }
);
assert.equal(notFound.status, 'error');
assert.equal(notFound.code, 'ETHEREUM_RECEIPT_NOT_FOUND');

const reverted = normalizeEthereumTransactionReceiptResponse(
  {
    result: {
      transactionHash: txHash,
      blockNumber: '0x123',
      status: '0x0',
    },
  },
  { tx_hash: txHash }
);
assert.equal(reverted.status, 'error');
assert.equal(reverted.code, 'ETHEREUM_TRANSACTION_REVERTED');

const mismatch = normalizeEthereumTransactionReceiptResponse(
  {
    result: {
      transactionHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      blockNumber: '0x123',
      status: '0x1',
    },
  },
  { tx_hash: txHash }
);
assert.equal(mismatch.status, 'error');
assert.equal(mismatch.code, 'ETHEREUM_RECEIPT_TX_HASH_MISMATCH');

const rpcError = await fetchEthereumTransactionReceipt({
  task: built.task,
  result,
  env: { SENTRY_ETHEREUM_RPC_URL: 'https://ethereum.invalid' },
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { error: { code: -32603, message: 'upstream unavailable' } };
    },
  }),
});
assert.equal(rpcError.status, 'error');
assert.equal(rpcError.code, 'ETHEREUM_RPC_ERROR');

console.log('ALL ETHEREUM RECEIPT ADAPTER TESTS PASS');
