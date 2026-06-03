import {
  SOLANA_CHAIN_ID,
  SOLANA_VENUE_ID,
  isSolanaSignature,
  verifySolanaAgentTaskResult,
} from '../../core/solana-trade.js';
import { SOLANA_MAINNET_RPC_URL, solanaRpcRequest } from './solana-readonly-adapter.mjs';

function signatureFromResult(result = {}) {
  const evidence = result.evidence && typeof result.evidence === 'object' ? result.evidence : {};
  return String(
    result.signature ||
      result.tx_signature ||
      result.tx_digest ||
      evidence.signature ||
      evidence.tx_signature ||
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

export function solanaSignatureStatusRequest(input = {}) {
  const signature = String(input.signature || signatureFromResult(input.result)).trim();
  if (!isSolanaSignature(signature)) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_REQUIRED',
      message: 'Solana receipt polling requires a valid transaction signature.',
    };
  }
  return {
    status: 'ok',
    method: 'POST',
    body: solanaRpcRequest(
      'getSignatureStatuses',
      [[signature], { searchTransactionHistory: true }],
      input.id || 1
    ),
    signature,
    idempotency_key: quoteIdFromTask(input.task, input.result) || signature,
  };
}

export function normalizeSolanaSignatureStatusResponse(body = {}, options = {}) {
  if (!body || typeof body !== 'object' || !body.result) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_STATUS_BAD_RESPONSE',
      message: 'Solana getSignatureStatuses response must include result.',
      solana_body: body,
    };
  }
  const values = Array.isArray(body.result.value) ? body.result.value : null;
  if (!values) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_STATUS_BAD_RESPONSE',
      message: 'Solana getSignatureStatuses result.value must be an array.',
      solana_body: body,
    };
  }
  const receipt = values[0] || null;
  if (!receipt) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_STATUS_NOT_FOUND',
      message: 'Solana RPC has not observed the transaction signature.',
      signature: options.signature || null,
    };
  }
  if (receipt.err) {
    return {
      status: 'error',
      code: 'SOLANA_TRANSACTION_REPORTED_ERROR',
      message: 'Solana signature status reports a transaction error.',
      signature: options.signature || null,
      slot: receipt.slot ?? null,
      solana_error: receipt.err,
    };
  }
  const confirmationStatus =
    receipt.confirmationStatus || (receipt.confirmations === null ? 'finalized' : 'confirmed');
  return {
    status: 'ok',
    venue_id: SOLANA_VENUE_ID,
    chain_id: SOLANA_CHAIN_ID,
    signature: options.signature || null,
    slot: receipt.slot ?? null,
    confirmations: receipt.confirmations ?? null,
    confirmation_status: confirmationStatus,
    terminal: confirmationStatus === 'finalized',
    observed_at: options.observed_at || new Date().toISOString(),
    idempotency_key: options.idempotency_key || options.signature || null,
  };
}

export async function fetchSolanaTransactionReceipt({
  task,
  result,
  signature,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
} = {}) {
  const taskResult = result || {};
  const taskCheck = verifySolanaAgentTaskResult(taskResult, task);
  if (taskCheck.status !== 'ok') return taskCheck;
  const request = solanaSignatureStatusRequest({ task, result: taskResult, signature });
  if (request.status !== 'ok') return request;
  const rpcUrl = env.SENTRY_SOLANA_RPC_URL || SOLANA_MAINNET_RPC_URL;
  const response = await fetchImpl(rpcUrl, {
    method: request.method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    return {
      status: 'error',
      code: body.error?.code ? 'SOLANA_RPC_ERROR' : 'SOLANA_HTTP_ERROR',
      rpc_code: body.error?.code ?? null,
      http_status: response.status,
      message: body.error?.message || `Solana HTTP ${response.status}`,
      solana_body: body,
    };
  }
  return normalizeSolanaSignatureStatusResponse(body, {
    signature: request.signature,
    idempotency_key: request.idempotency_key,
    observed_at: (typeof now === 'function' ? now() : now).toISOString(),
  });
}
