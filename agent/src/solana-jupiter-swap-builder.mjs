import {
  SOLANA_CHAIN_ID,
  SOLANA_UNSIGNED_TRANSACTION_FORMAT,
  SOLANA_VENUE_ID,
  validateSolanaSwapTask,
  verifySolanaPreparedTransactionResult,
} from '../../core/solana-trade.js';

export const DEFAULT_JUPITER_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
export const DEFAULT_JUPITER_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numberValue(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function taskParams(task = {}) {
  return task.action?.params || {};
}

function taskOwner(task = {}) {
  const params = taskParams(task);
  return stringValue(
    params.owner ||
      task.policy_context?.owner ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref
  );
}

function quoteIdFromTask(task = {}) {
  return stringValue(taskParams(task).quote_id || task.constraints?.idempotency_key);
}

function slippageBpsFromTask(task = {}) {
  const params = taskParams(task);
  return numberValue(
    params.slippageBps ?? params.slippage_bps ?? task.constraints?.slippage_bps,
    50
  );
}

function sanitizeJupiterError(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 500);
  if (isObject(value)) {
    return {
      code: stringValue(value.code || value.errorCode || value.error_code) || null,
      message: stringValue(value.message || value.error || value.details) || null,
    };
  }
  return String(value).slice(0, 500);
}

function jupiterHeaders(env = {}) {
  const headers = { accept: 'application/json' };
  const apiKey = stringValue(env.SENTRY_JUPITER_API_KEY || env.JUPITER_API_KEY);
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}

async function readJsonResponse(response) {
  if (typeof response.json === 'function') return response.json();
  if (typeof response.text === 'function') {
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }
  return {};
}

function httpError(code, message, response, body = {}) {
  return {
    status: 'error',
    code,
    message,
    http_status: response?.status ?? null,
    upstream_code: body?.code || body?.errorCode || body?.error_code || null,
    upstream_message: body?.message || body?.error || null,
  };
}

export function buildJupiterQuoteRequest(task = {}, options = {}) {
  const validation = validateSolanaSwapTask(task);
  if (validation.status !== 'ok') return validation;
  const params = taskParams(task);
  if (params.adapter !== 'jupiter') {
    return {
      status: 'error',
      code: 'SOLANA_JUPITER_ADAPTER_REQUIRED',
      message: 'Jupiter builder only supports Solana swap tasks with adapter=jupiter.',
    };
  }

  const url = new URL(options.quoteUrl || options.quote_url || DEFAULT_JUPITER_QUOTE_URL);
  url.searchParams.set('inputMint', stringValue(params.inputMint || params.input_mint));
  url.searchParams.set('outputMint', stringValue(params.outputMint || params.output_mint));
  url.searchParams.set('amount', stringValue(params.amount || params.raw_amount));
  url.searchParams.set('slippageBps', String(slippageBpsFromTask(task)));
  url.searchParams.set('swapMode', 'ExactIn');
  if (options.onlyDirectRoutes !== undefined) {
    url.searchParams.set('onlyDirectRoutes', String(Boolean(options.onlyDirectRoutes)));
  }
  if (options.maxAccounts !== undefined) {
    url.searchParams.set('maxAccounts', String(Number(options.maxAccounts)));
  }

  return {
    status: 'ok',
    url: url.toString(),
    method: 'GET',
    request: {
      inputMint: url.searchParams.get('inputMint'),
      outputMint: url.searchParams.get('outputMint'),
      amount: url.searchParams.get('amount'),
      slippageBps: Number(url.searchParams.get('slippageBps')),
      swapMode: url.searchParams.get('swapMode'),
    },
  };
}

export function normalizeJupiterQuoteResponse(body = {}, task = {}) {
  if (!isObject(body)) {
    return {
      status: 'error',
      code: 'JUPITER_BAD_QUOTE_RESPONSE',
      message: 'Jupiter quote response must be a JSON object.',
    };
  }
  if (body.error || body.message === 'No routes found') {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_REJECTED',
      message: 'Jupiter quote endpoint rejected the swap request.',
      upstream_error: sanitizeJupiterError(body.error || body),
    };
  }

  const params = taskParams(task);
  const inputMint = stringValue(body.inputMint || body.input_mint);
  const outputMint = stringValue(body.outputMint || body.output_mint);
  const inAmount = stringValue(body.inAmount || body.in_amount);
  const outAmount = stringValue(body.outAmount || body.out_amount);
  const slippageBps = numberValue(body.slippageBps ?? body.slippage_bps, null);
  const expectedInputMint = stringValue(params.inputMint || params.input_mint);
  const expectedOutputMint = stringValue(params.outputMint || params.output_mint);
  const expectedAmount = stringValue(params.amount || params.raw_amount);

  if (inputMint && inputMint !== expectedInputMint) {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_INPUT_MINT_MISMATCH',
      message: 'Jupiter quote inputMint does not match the task.',
      expected_input_mint: expectedInputMint,
      actual_input_mint: inputMint,
    };
  }
  if (outputMint && outputMint !== expectedOutputMint) {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_OUTPUT_MINT_MISMATCH',
      message: 'Jupiter quote outputMint does not match the task.',
      expected_output_mint: expectedOutputMint,
      actual_output_mint: outputMint,
    };
  }
  if (inAmount && inAmount !== expectedAmount) {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_AMOUNT_MISMATCH',
      message: 'Jupiter quote inAmount does not match the task amount.',
      expected_amount: expectedAmount,
      actual_amount: inAmount,
    };
  }
  if (!outAmount || Number(outAmount) <= 0) {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_OUT_AMOUNT_REQUIRED',
      message: 'Jupiter quote must include a positive outAmount.',
    };
  }
  const maxSlippageBps = slippageBpsFromTask(task);
  if (slippageBps !== null && slippageBps > maxSlippageBps) {
    return {
      status: 'error',
      code: 'JUPITER_QUOTE_SLIPPAGE_EXCEEDS_TASK',
      message: 'Jupiter quote slippageBps exceeds the dispatched task slippage cap.',
      max_slippage_bps: maxSlippageBps,
      actual_slippage_bps: slippageBps,
    };
  }

  return {
    status: 'ok',
    quote_response: body,
    summary: {
      input_mint: inputMint || expectedInputMint,
      output_mint: outputMint || expectedOutputMint,
      in_amount: inAmount || expectedAmount,
      out_amount: outAmount,
      other_amount_threshold: stringValue(body.otherAmountThreshold || body.other_amount_threshold),
      price_impact_pct: stringValue(body.priceImpactPct || body.price_impact_pct) || null,
      route_plan_count: Array.isArray(body.routePlan || body.route_plan)
        ? (body.routePlan || body.route_plan).length
        : null,
    },
  };
}

export function buildJupiterSwapRequest(task = {}, quoteResponse = {}, options = {}) {
  const validation = validateSolanaSwapTask(task);
  if (validation.status !== 'ok') return validation;
  const owner = taskOwner(task);
  return {
    status: 'ok',
    url: options.swapUrl || options.swap_url || DEFAULT_JUPITER_SWAP_URL,
    method: 'POST',
    body: {
      quoteResponse,
      userPublicKey: owner,
      wrapAndUnwrapSol: options.wrapAndUnwrapSol ?? options.wrap_and_unwrap_sol ?? true,
      dynamicComputeUnitLimit:
        options.dynamicComputeUnitLimit ?? options.dynamic_compute_unit_limit ?? true,
      asLegacyTransaction: Boolean(options.asLegacyTransaction ?? options.as_legacy_transaction),
      ...(options.prioritizationFeeLamports !== undefined
        ? { prioritizationFeeLamports: options.prioritizationFeeLamports }
        : {}),
    },
  };
}

export function normalizeJupiterSwapResponse(body = {}, task = {}, quote = {}) {
  if (!isObject(body)) {
    return {
      status: 'error',
      code: 'JUPITER_BAD_SWAP_RESPONSE',
      message: 'Jupiter swap response must be a JSON object.',
    };
  }
  if (body.error) {
    return {
      status: 'error',
      code: 'JUPITER_SWAP_REJECTED',
      message: 'Jupiter swap endpoint rejected the transaction request.',
      upstream_error: sanitizeJupiterError(body.error),
    };
  }

  const swapTransaction = stringValue(
    body.swapTransaction || body.swap_transaction || body.transaction || body.transaction_base64
  );
  const quoteId = quoteIdFromTask(task);
  const owner = taskOwner(task);
  const simulationError = body.simulationError || body.simulation_error || null;
  const result = {
    task_id: task.task_id,
    status: 'proposed',
    summary: simulationError
      ? 'Jupiter prepared a Solana swap transaction but simulation failed.'
      : 'Jupiter prepared a Solana swap transaction for local signing.',
    evidence: {
      venue_id: SOLANA_VENUE_ID,
      chain_id: SOLANA_CHAIN_ID,
      quote_id: quoteId,
      adapter: 'jupiter',
      transaction_format: SOLANA_UNSIGNED_TRANSACTION_FORMAT,
      unsigned_transaction_base64: swapTransaction,
      required_signers: [owner],
      simulation: simulationError
        ? { status: 'failed', err: sanitizeJupiterError(simulationError) }
        : { status: 'ok' },
      jupiter: {
        quote_out_amount: quote.summary?.out_amount || null,
        other_amount_threshold: quote.summary?.other_amount_threshold || null,
        price_impact_pct: quote.summary?.price_impact_pct || null,
        route_plan_count: quote.summary?.route_plan_count ?? null,
      },
    },
    observed_at: new Date().toISOString(),
  };

  const verified = verifySolanaPreparedTransactionResult(result, task);
  if (verified.status !== 'ok') return verified;
  return {
    status: 'ok',
    result,
    prepared_transaction: verified.prepared_transaction,
  };
}

export async function prepareSolanaJupiterSwap(options = {}) {
  const {
    task,
    fetchImpl = fetch,
    env = process.env,
    now = new Date(),
    quoteUrl = env.SENTRY_JUPITER_QUOTE_URL || env.JUPITER_QUOTE_URL || DEFAULT_JUPITER_QUOTE_URL,
    swapUrl = env.SENTRY_JUPITER_SWAP_URL || env.JUPITER_SWAP_URL || DEFAULT_JUPITER_SWAP_URL,
  } = options;
  const quoteRequest = buildJupiterQuoteRequest(task, {
    quoteUrl,
    onlyDirectRoutes: options.onlyDirectRoutes,
    maxAccounts: options.maxAccounts,
  });
  if (quoteRequest.status !== 'ok') return quoteRequest;

  const quoteResponse = await fetchImpl(quoteRequest.url, {
    method: 'GET',
    headers: jupiterHeaders(env),
  });
  const quoteBody = await readJsonResponse(quoteResponse).catch((error) => ({
    error: error?.message || String(error),
  }));
  if (!quoteResponse.ok) {
    return httpError(
      'JUPITER_QUOTE_HTTP_ERROR',
      `Jupiter quote request failed with HTTP ${quoteResponse.status}.`,
      quoteResponse,
      quoteBody
    );
  }
  const quote = normalizeJupiterQuoteResponse(quoteBody, task);
  if (quote.status !== 'ok') return quote;

  const swapRequest = buildJupiterSwapRequest(task, quote.quote_response, {
    swapUrl,
    wrapAndUnwrapSol: options.wrapAndUnwrapSol,
    dynamicComputeUnitLimit: options.dynamicComputeUnitLimit,
    asLegacyTransaction: options.asLegacyTransaction,
    prioritizationFeeLamports: options.prioritizationFeeLamports,
  });
  if (swapRequest.status !== 'ok') return swapRequest;

  const swapResponse = await fetchImpl(swapRequest.url, {
    method: 'POST',
    headers: {
      ...jupiterHeaders(env),
      'content-type': 'application/json',
    },
    body: JSON.stringify(swapRequest.body),
  });
  const swapBody = await readJsonResponse(swapResponse).catch((error) => ({
    error: error?.message || String(error),
  }));
  if (!swapResponse.ok) {
    return httpError(
      'JUPITER_SWAP_HTTP_ERROR',
      `Jupiter swap request failed with HTTP ${swapResponse.status}.`,
      swapResponse,
      swapBody
    );
  }

  const prepared = normalizeJupiterSwapResponse(swapBody, task, quote);
  if (prepared.status !== 'ok') return prepared;
  return {
    status: 'ok',
    result: {
      ...prepared.result,
      observed_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    },
    prepared_transaction: prepared.prepared_transaction,
    quote: quote.summary,
  };
}

export function solanaJupiterErrorResult(task = {}, error = {}) {
  return {
    task_id: task?.task_id || null,
    status: 'error',
    code: error.code || 'SOLANA_JUPITER_PREPARE_FAILED',
    summary: error.message || 'Solana Jupiter swap preparation failed.',
    evidence: {
      venue_id: SOLANA_VENUE_ID,
      chain_id: SOLANA_CHAIN_ID,
      quote_id: quoteIdFromTask(task) || null,
      adapter: 'jupiter',
    },
    observed_at: new Date().toISOString(),
  };
}
