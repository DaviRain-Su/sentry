import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import {
  ETHEREUM_ADDRESS_RE,
  ETHEREUM_CHAIN_ID,
  ETHEREUM_TRANSACTION_REQUEST_FORMAT,
  ETHEREUM_VENUE_ID,
  validateEthereumSwapTask,
  verifyEthereumPreparedTransactionResult,
} from '../../core/ethereum-trade.js';

export const DEFAULT_UNISWAP_V3_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';
export const DEFAULT_UNISWAP_V3_FEE = 3000;
export const DEFAULT_UNISWAP_DEADLINE_SECONDS = 120;
export const EXACT_INPUT_SINGLE_SIGNATURE =
  'exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeAddress(value) {
  const text = stringValue(value).toLowerCase();
  return ETHEREUM_ADDRESS_RE.test(text) ? text : '';
}

function normalizeUintString(value) {
  const text = stringValue(value);
  if (!/^[0-9]+$/.test(text)) return null;
  return /^0+$/.test(text) ? null : text;
}

function normalizeNonNegativeUintString(value, fallback = '0') {
  const text = stringValue(value || fallback);
  if (!/^[0-9]+$/.test(text)) return null;
  return text;
}

function numberValue(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function taskParams(task = {}) {
  return task.action?.params || {};
}

function taskAccount(task = {}) {
  const params = taskParams(task);
  return normalizeAddress(
    params.account ||
      task.policy_context?.account ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref
  );
}

function quoteIdFromTask(task = {}) {
  return stringValue(taskParams(task).quote_id || task.constraints?.idempotency_key);
}

function uintToWord(value) {
  const bigint = BigInt(value);
  if (bigint < 0n) throw new Error('ABI uint must be non-negative.');
  const hex = bigint.toString(16);
  if (hex.length > 64) throw new Error('ABI uint exceeds uint256 width.');
  return hex.padStart(64, '0');
}

function addressToWord(value) {
  const address = normalizeAddress(value);
  if (!address) throw new Error(`Invalid EVM address: ${value}`);
  return address.slice(2).padStart(64, '0');
}

export function methodSelector(signature = EXACT_INPUT_SINGLE_SIGNATURE) {
  return Buffer.from(keccak_256(utf8ToBytes(signature)))
    .toString('hex')
    .slice(0, 8);
}

export function encodeUniswapV3ExactInputSingle(params = {}) {
  const words = [
    addressToWord(params.tokenIn),
    addressToWord(params.tokenOut),
    uintToWord(params.fee),
    addressToWord(params.recipient),
    uintToWord(params.deadline),
    uintToWord(params.amountIn),
    uintToWord(params.amountOutMinimum),
    uintToWord(params.sqrtPriceLimitX96 || '0'),
  ];
  return `0x${methodSelector()}${words.join('')}`;
}

function minOutputFromTask(task = {}, options = {}) {
  return normalizeUintString(
    options.minOutputAmount ||
      options.min_output_amount ||
      task.constraints?.min_output_amount ||
      taskParams(task).minOutputAmount ||
      taskParams(task).min_output_amount
  );
}

export function buildUniswapV3TransactionRequest(task = {}, options = {}) {
  const validation = validateEthereumSwapTask(task);
  if (validation.status !== 'ok') return validation;
  const params = taskParams(task);
  if (params.adapter !== 'uniswap') {
    return {
      status: 'error',
      code: 'ETHEREUM_UNISWAP_ADAPTER_REQUIRED',
      message: 'Uniswap builder only supports Ethereum swap tasks with adapter=uniswap.',
    };
  }

  const account = taskAccount(task);
  const router = normalizeAddress(
    options.router ||
      options.router_address ||
      process.env.SENTRY_UNISWAP_V3_ROUTER ||
      DEFAULT_UNISWAP_V3_ROUTER
  );
  const inputToken = normalizeAddress(params.inputToken || params.input_token);
  const outputToken = normalizeAddress(params.outputToken || params.output_token);
  const amountIn = normalizeUintString(params.amount || params.raw_amount);
  const amountOutMinimum = minOutputFromTask(task, options);
  const fee = numberValue(
    options.fee ?? options.poolFee ?? options.pool_fee ?? DEFAULT_UNISWAP_V3_FEE
  );
  const nowSeconds = Math.floor(Number(options.nowMs || options.now_ms || Date.now()) / 1000);
  const deadline = normalizeNonNegativeUintString(
    options.deadline ||
      options.deadline_seconds ||
      taskParams(task).deadline ||
      String(
        nowSeconds +
          numberValue(options.ttlSeconds ?? options.ttl_seconds, DEFAULT_UNISWAP_DEADLINE_SECONDS)
      )
  );

  if (!router) {
    return {
      status: 'error',
      code: 'UNISWAP_ROUTER_ADDRESS_REQUIRED',
      message: 'Ethereum Uniswap builder requires a valid SwapRouter address.',
    };
  }
  if (!amountOutMinimum) {
    return {
      status: 'error',
      code: 'UNISWAP_MIN_OUTPUT_REQUIRED',
      message: 'Ethereum Uniswap builder requires minOutputAmount/min_output_amount.',
    };
  }
  if (!Number.isInteger(fee) || fee <= 0 || fee > 1_000_000) {
    return {
      status: 'error',
      code: 'UNISWAP_POOL_FEE_INVALID',
      message: 'Uniswap V3 pool fee must be a positive uint24-compatible integer.',
    };
  }
  if (!deadline) {
    return {
      status: 'error',
      code: 'UNISWAP_DEADLINE_INVALID',
      message: 'Uniswap deadline must be a non-negative integer timestamp.',
    };
  }

  const data = encodeUniswapV3ExactInputSingle({
    tokenIn: inputToken,
    tokenOut: outputToken,
    fee,
    recipient: account,
    deadline,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: options.sqrtPriceLimitX96 || options.sqrt_price_limit_x96 || '0',
  });

  return {
    status: 'ok',
    transaction_request: {
      from: account,
      to: router,
      data,
      value: '0x0',
      chain_id: ETHEREUM_CHAIN_ID,
    },
    uniswap: {
      router,
      selector: `0x${methodSelector()}`,
      function: 'exactInputSingle',
      token_in: inputToken,
      token_out: outputToken,
      fee,
      recipient: account,
      deadline,
      amount_in: amountIn,
      amount_out_minimum: amountOutMinimum,
      sqrt_price_limit_x96: stringValue(
        options.sqrtPriceLimitX96 || options.sqrt_price_limit_x96 || '0'
      ),
    },
  };
}

async function readJsonResponse(response) {
  if (typeof response.json === 'function') return response.json();
  if (typeof response.text === 'function') {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  return {};
}

function sanitizeRpcError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error.slice(0, 500);
  if (isObject(error)) {
    return {
      code: error.code ?? null,
      message: stringValue(error.message || error.error || error.reason) || null,
    };
  }
  return String(error).slice(0, 500);
}

export async function simulateEthereumTransactionRequest(options = {}) {
  const { request, rpcUrl, fetchImpl = fetch } = options;
  if (!rpcUrl) {
    return {
      status: 'error',
      code: 'ETHEREUM_RPC_URL_REQUIRED',
      message:
        'Ethereum Uniswap builder requires SENTRY_ETHEREUM_RPC_URL or --rpc-url unless --simulated is used.',
    };
  }
  const response = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: options.id || 1,
      method: 'eth_call',
      params: [
        {
          from: request.from,
          to: request.to,
          data: request.data,
          value: request.value || '0x0',
        },
        options.blockTag || options.block_tag || 'latest',
      ],
    }),
  });
  const body = await readJsonResponse(response).catch((error) => ({
    error: { message: error?.message || String(error) },
  }));
  if (!response.ok) {
    return {
      status: 'error',
      code: 'ETHEREUM_RPC_HTTP_ERROR',
      message: `Ethereum RPC eth_call failed with HTTP ${response.status}.`,
      http_status: response.status,
      rpc_error: sanitizeRpcError(body.error || body),
    };
  }
  if (body.error) {
    return {
      status: 'error',
      code: 'ETHEREUM_SIMULATION_FAILED',
      message: 'Ethereum RPC eth_call returned an error.',
      rpc_error: sanitizeRpcError(body.error),
    };
  }
  return {
    status: 'ok',
    simulation: {
      status: 'ok',
      rpc_method: 'eth_call',
      block_tag: options.blockTag || options.block_tag || 'latest',
      return_data: stringValue(body.result || '0x'),
    },
  };
}

export async function prepareEthereumUniswapSwap(options = {}) {
  const {
    task,
    fetchImpl = fetch,
    env = process.env,
    now = new Date(),
    simulated = false,
  } = options;
  const built = buildUniswapV3TransactionRequest(task, {
    router: options.router,
    fee: options.fee,
    minOutputAmount: options.minOutputAmount,
    deadline: options.deadline,
    ttlSeconds: options.ttlSeconds,
    sqrtPriceLimitX96: options.sqrtPriceLimitX96,
    nowMs: now instanceof Date ? now.getTime() : Number(now || Date.now()),
  });
  if (built.status !== 'ok') return built;

  const simulation = simulated
    ? {
        status: 'ok',
        simulation: {
          status: 'simulated',
          source: 'cli_simulated_flag',
        },
      }
    : await simulateEthereumTransactionRequest({
        request: built.transaction_request,
        rpcUrl:
          options.rpcUrl || options.rpc_url || env.SENTRY_ETHEREUM_RPC_URL || env.ETHEREUM_RPC_URL,
        fetchImpl,
        blockTag: options.blockTag || options.block_tag,
      });
  if (simulation.status !== 'ok') return simulation;

  const result = {
    task_id: task.task_id,
    status: 'proposed',
    summary: 'Uniswap V3 transaction request prepared for local signing.',
    evidence: {
      venue_id: ETHEREUM_VENUE_ID,
      chain_id: ETHEREUM_CHAIN_ID,
      quote_id: quoteIdFromTask(task),
      adapter: 'uniswap',
      transaction_format: ETHEREUM_TRANSACTION_REQUEST_FORMAT,
      transaction_request: built.transaction_request,
      simulation: simulation.simulation,
      uniswap: built.uniswap,
    },
    observed_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
  };

  const verified = verifyEthereumPreparedTransactionResult(result, task);
  if (verified.status !== 'ok') return verified;
  return {
    status: 'ok',
    result,
    prepared_transaction: verified.prepared_transaction,
  };
}

export function ethereumUniswapErrorResult(task = {}, error = {}) {
  return {
    task_id: task?.task_id || null,
    status: 'error',
    code: error.code || 'ETHEREUM_UNISWAP_PREPARE_FAILED',
    summary: error.message || 'Ethereum Uniswap swap preparation failed.',
    evidence: {
      venue_id: ETHEREUM_VENUE_ID,
      chain_id: ETHEREUM_CHAIN_ID,
      quote_id: quoteIdFromTask(task) || null,
      adapter: 'uniswap',
    },
    observed_at: new Date().toISOString(),
  };
}
