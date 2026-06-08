import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_VENUE_ID,
  isEthereumTxHash,
  verifyEthereumAgentTaskResult,
} from '../../core/ethereum-trade.js';
import { chainRpcRetrySummary, fetchChainRpcJsonWithBackoff } from './chain-rpc-rate-limit.mjs';
import { ETHEREUM_MAINNET_RPC_URL, ethereumRpcRequest } from './ethereum-readonly-adapter.mjs';

function txHashFromResult(result = {}) {
  const evidence = result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
  return String(
    result.tx_hash ||
      result.transaction_hash ||
      result.tx_digest ||
      evidence.tx_hash ||
      evidence.transaction_hash ||
      evidence.tx_digest ||
      ''
  ).trim();
}

function quoteIdFromTask(task = {}, result = {}) {
  const evidence = result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
  return String(
    task.action?.params?.quote_id ||
      task.constraints?.idempotency_key ||
      evidence.quote_id ||
      result.quote_id ||
      ''
  ).trim();
}

export function ethereumTransactionReceiptRequest(input = {}) {
  const txHash = String(input.txHash || input.tx_hash || txHashFromResult(input.result)).trim();
  if (!isEthereumTxHash(txHash)) {
    return {
      status: 'error',
      code: 'ETHEREUM_TX_HASH_REQUIRED',
      message: 'Ethereum receipt polling requires a valid transaction hash.',
    };
  }
  return {
    status: 'ok',
    method: 'POST',
    body: ethereumRpcRequest('eth_getTransactionReceipt', [txHash], input.id || 1),
    tx_hash: txHash,
    idempotency_key: quoteIdFromTask(input.task, input.result) || txHash,
  };
}

export function normalizeEthereumTransactionReceiptResponse(body = {}, options = {}) {
  if (!body || typeof body !== 'object' || !('result' in body)) {
    return {
      status: 'error',
      code: 'ETHEREUM_RECEIPT_BAD_RESPONSE',
      message: 'Ethereum eth_getTransactionReceipt response must include result.',
      ethereum_body: body,
    };
  }
  const receipt = body.result;
  if (!receipt) {
    return {
      status: 'error',
      code: 'ETHEREUM_RECEIPT_NOT_FOUND',
      message: 'Ethereum RPC has not observed the transaction receipt.',
      tx_hash: options.tx_hash || null,
    };
  }
  const txHash = String(receipt.transactionHash || receipt.transaction_hash || '').toLowerCase();
  const expectedTxHash = String(options.tx_hash || '').toLowerCase();
  if (!isEthereumTxHash(txHash)) {
    return {
      status: 'error',
      code: 'ETHEREUM_RECEIPT_TX_HASH_MISSING',
      message: 'Ethereum receipt did not include a valid transactionHash.',
      tx_hash: options.tx_hash || null,
      ethereum_receipt: receipt,
    };
  }
  if (expectedTxHash && txHash !== expectedTxHash) {
    return {
      status: 'error',
      code: 'ETHEREUM_RECEIPT_TX_HASH_MISMATCH',
      message: 'Ethereum receipt transactionHash does not match the dispatched transaction.',
      expected_tx_hash: expectedTxHash,
      actual_tx_hash: txHash,
    };
  }
  const receiptStatus = receipt.status ?? null;
  if (receiptStatus === '0x0' || receiptStatus === 0) {
    return {
      status: 'error',
      code: 'ETHEREUM_TRANSACTION_REVERTED',
      message: 'Ethereum transaction receipt reports status=0x0.',
      tx_hash: txHash,
      block_number: receipt.blockNumber || receipt.block_number || null,
      receipt_status: receiptStatus,
    };
  }
  return {
    status: 'ok',
    venue_id: ETHEREUM_VENUE_ID,
    chain_id: ETHEREUM_CHAIN_ID,
    tx_hash: txHash,
    transaction_hash: txHash,
    block_hash: receipt.blockHash || receipt.block_hash || null,
    block_number: receipt.blockNumber || receipt.block_number || null,
    receipt_status: receiptStatus,
    gas_used: receipt.gasUsed || receipt.gas_used || null,
    effective_gas_price: receipt.effectiveGasPrice || receipt.effective_gas_price || null,
    terminal: Boolean(receipt.blockNumber || receipt.block_number),
    observed_at: options.observed_at || new Date().toISOString(),
    idempotency_key: options.idempotency_key || txHash,
  };
}

export async function fetchEthereumTransactionReceipt({
  task,
  result,
  txHash,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  rateLimiter = null,
  rateLimitPolicy = {},
  sleepImpl,
} = {}) {
  const taskResult = result || {};
  const taskCheck = verifyEthereumAgentTaskResult(taskResult, task);
  if (taskCheck.status !== 'ok') return taskCheck;
  const request = ethereumTransactionReceiptRequest({ task, result: taskResult, txHash });
  if (request.status !== 'ok') return request;
  const rpcUrl = env.SENTRY_ETHEREUM_RPC_URL || ETHEREUM_MAINNET_RPC_URL;
  const fetched = await fetchChainRpcJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: 'ethereum:eth_getTransactionReceipt',
    fetchOnce: async () => {
      const response = await fetchImpl(rpcUrl, {
        method: request.method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const body = await response.json();
      return { response, body };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'ETHEREUM_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: chainRpcRetrySummary(fetched),
    };
  }
  const { response, body } = fetched;
  if (!response.ok || body.error) {
    return {
      status: 'error',
      code: body.error?.code ? 'ETHEREUM_RPC_ERROR' : 'ETHEREUM_HTTP_ERROR',
      rpc_code: body.error?.code ?? null,
      http_status: response.status,
      message: body.error?.message || `Ethereum HTTP ${response.status}`,
      ethereum_body: body,
      retry: chainRpcRetrySummary(fetched),
    };
  }
  return {
    ...normalizeEthereumTransactionReceiptResponse(body, {
      tx_hash: request.tx_hash,
      idempotency_key: request.idempotency_key,
      observed_at: (typeof now === 'function' ? now() : now).toISOString(),
    }),
    retry: chainRpcRetrySummary(fetched),
  };
}
