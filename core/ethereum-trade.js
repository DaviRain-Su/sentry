export const ETHEREUM_CHAIN_ID = 'eip155:1';
export const ETHEREUM_VENUE_ID = 'ethereum-mainnet';
export const ETHEREUM_SWAP_ADAPTERS = ['uniswap', 'safe', 'erc4337', 'custom'];
export const ETHEREUM_TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
export const ETHEREUM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numericString(value) {
  const text = stringValue(value);
  if (!/^[0-9]+$/.test(text) || /^0+$/.test(text)) return null;
  return text;
}

function normalizeAddress(value) {
  const text = stringValue(value);
  return ETHEREUM_ADDRESS_RE.test(text) ? text.toLowerCase() : text;
}

function normalizeAdapter(value) {
  const adapter = stringValue(value || 'uniswap').toLowerCase();
  return ETHEREUM_SWAP_ADAPTERS.includes(adapter) ? adapter : null;
}

function ethereumAccountFromInput(input = {}) {
  return normalizeAddress(
    input.account ||
      input.owner ||
      input.wallet ||
      input.walletAddress ||
      input.wallet_address ||
      input.smartAccount ||
      input.smart_account
  );
}

function ethereumAccountFromTask(task = {}) {
  return normalizeAddress(
    task.policy_context?.account ||
      task.policy_context?.owner ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref ||
      task.action?.params?.account
  );
}

function ethereumQuoteIdFromTask(task = {}) {
  return stringValue(task.action?.params?.quote_id || task.constraints?.idempotency_key);
}

function ethereumTxHashFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    result.tx_hash ||
      result.transaction_hash ||
      result.tx_digest ||
      evidence.tx_hash ||
      evidence.transaction_hash ||
      evidence.tx_digest
  );
}

export function isEthereumTxHash(value) {
  return ETHEREUM_TX_HASH_RE.test(String(value || ''));
}

export function assertEthereumAccountScope(account = {}) {
  if (!account || typeof account !== 'object') {
    return {
      status: 'error',
      code: 'ETHEREUM_ACCOUNT_REQUIRED',
      message: 'Ethereum task construction requires local wallet or smart-account metadata.',
    };
  }
  const accountRef = ethereumAccountFromInput(account);
  if (!ETHEREUM_ADDRESS_RE.test(accountRef)) {
    return {
      status: 'error',
      code: 'ETHEREUM_ACCOUNT_ADDRESS_REQUIRED',
      message: 'Ethereum task construction requires a valid wallet or smart-account address.',
    };
  }
  const capabilities = account.capabilities || account.permissions || [];
  if (capabilities.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Ethereum autonomous tasks must not request withdrawal capability.',
    };
  }
  const missing = ['read', 'sign', 'submit_tx'].filter(
    (capability) => !capabilities.includes(capability)
  );
  if (missing.length) {
    return {
      status: 'error',
      code: 'ETHEREUM_ACCOUNT_CAPABILITIES_REQUIRED',
      message: `Ethereum account metadata requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok', account_ref: accountRef, capabilities };
}

function validateEthereumSwapParams(params = {}) {
  if (!ETHEREUM_ADDRESS_RE.test(params.account)) {
    return {
      status: 'error',
      code: 'ETHEREUM_ACCOUNT_ADDRESS_REQUIRED',
      message: 'Ethereum swap task requires a valid wallet or smart-account address.',
    };
  }
  if (!ETHEREUM_ADDRESS_RE.test(params.inputToken)) {
    return {
      status: 'error',
      code: 'ETHEREUM_INPUT_TOKEN_REQUIRED',
      message: 'Ethereum swap task requires a valid input token address.',
    };
  }
  if (!ETHEREUM_ADDRESS_RE.test(params.outputToken)) {
    return {
      status: 'error',
      code: 'ETHEREUM_OUTPUT_TOKEN_REQUIRED',
      message: 'Ethereum swap task requires a valid output token address.',
    };
  }
  if (normalizeAddress(params.inputToken) === normalizeAddress(params.outputToken)) {
    return {
      status: 'error',
      code: 'ETHEREUM_SWAP_TOKENS_MUST_DIFFER',
      message: 'Ethereum swap inputToken and outputToken must differ.',
    };
  }
  if (!params.amount) {
    return {
      status: 'error',
      code: 'ETHEREUM_SWAP_AMOUNT_REQUIRED',
      message: 'Ethereum swap amount must be a positive integer string in base units.',
    };
  }
  if (!/^[0-9]+$/.test(params.amount) || Number(params.amount) <= 0) {
    return {
      status: 'error',
      code: 'ETHEREUM_SWAP_AMOUNT_INVALID',
      message: 'Ethereum swap amount must be a positive integer string in base units.',
    };
  }
  if (!params.adapter) {
    return {
      status: 'error',
      code: 'ETHEREUM_SWAP_ADAPTER_INVALID',
      message: `Ethereum swap adapter must be one of: ${ETHEREUM_SWAP_ADAPTERS.join(', ')}`,
    };
  }
  const slippageBps = Number(params.slippageBps ?? 0);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    return {
      status: 'error',
      code: 'ETHEREUM_SLIPPAGE_INVALID',
      message: 'Ethereum slippageBps must be an integer between 0 and 10000.',
    };
  }
  return { status: 'ok' };
}

function validateEthereumTaskCapabilities(task = {}) {
  const declared = [
    ...(task.constraints?.capabilities_required || []),
    ...(task.authorization?.capabilities_required || []),
  ];
  const missing = ['read', 'sign', 'submit_tx'].filter(
    (capability) => !declared.includes(capability)
  );
  if (declared.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Ethereum task must not request withdrawal capability.',
    };
  }
  if (missing.length) {
    return {
      status: 'error',
      code: 'ETHEREUM_TASK_CAPABILITIES_REQUIRED',
      message: `Ethereum swap task requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok' };
}

export function buildEthereumSwapTask(input = {}) {
  const account = input.account || input.accountMetadata || input.account_metadata;
  const scope = assertEthereumAccountScope(account);
  if (scope.status !== 'ok') return scope;

  const adapter = normalizeAdapter(
    input.adapter || input.executionAdapter || input.execution_adapter
  );
  const amount = stringValue(input.amount || input.rawAmount || input.raw_amount);
  const inputToken = normalizeAddress(input.inputToken || input.input_token);
  const outputToken = normalizeAddress(input.outputToken || input.output_token);
  const slippageBps = Number(input.slippageBps ?? input.slippage_bps ?? 50);
  const quoteId =
    input.quoteId ||
    input.quote_id ||
    `ethereum-${adapter || 'swap'}-${String(input.taskId || input.task_id || Date.now()).slice(-18)}`;
  const maxInputAmount = numericString(input.maxInputAmount || input.max_input_amount || amount);
  const minOutputAmount = numericString(input.minOutputAmount || input.min_output_amount);

  const params = {
    account: scope.account_ref,
    adapter,
    inputToken,
    outputToken,
    amount,
    slippageBps,
  };
  const bad = validateEthereumSwapParams(params);
  if (bad.status !== 'ok') return bad;

  const nowMs = Number(input.nowMs || Date.now());
  const expiresAtMs = Number(input.expiresAtMs || input.expires_at_ms || nowMs + 120_000);
  const taskId = input.taskId || input.task_id || `task_ethereum_${crypto.randomUUID()}`;

  return {
    status: 'ok',
    task: {
      task_id: taskId,
      target_agent: input.targetAgent || input.target_agent || null,
      venue_id: ETHEREUM_VENUE_ID,
      policy_id: input.policyId || input.policy_id || null,
      policy_context: {
        policy_id: input.policyId || input.policy_id || null,
        venue_id: ETHEREUM_VENUE_ID,
        chain_id: ETHEREUM_CHAIN_ID,
        account: scope.account_ref,
        wallet_address: scope.account_ref,
        smart_account: account.smart_account || account.smartAccount || null,
      },
      action: {
        type: 'submit_tx',
        params: {
          venue_id: ETHEREUM_VENUE_ID,
          chain_id: ETHEREUM_CHAIN_ID,
          intent: 'swap',
          adapter,
          account: scope.account_ref,
          inputToken,
          outputToken,
          amount,
          slippageBps,
          quote_id: quoteId,
          transaction_format: 'external_agent_built',
          simulated: Boolean(input.simulated),
        },
      },
      constraints: {
        venue_scope: [ETHEREUM_VENUE_ID],
        capabilities_required: ['read', 'sign', 'submit_tx'],
        idempotency_key: quoteId,
        require_receipt: true,
        require_simulation: true,
        max_input_amount: maxInputAmount,
        min_output_amount: minOutputAmount,
        slippage_bps: slippageBps,
        no_withdraw: true,
      },
      authorization: {
        authorization_ref:
          input.authorizationRef || input.authorization_ref || `ethereum:${scope.account_ref}`,
        venue_id: ETHEREUM_VENUE_ID,
        venue_account_id: ETHEREUM_VENUE_ID,
        account_ref: scope.account_ref,
        authorization_model: 'smart_account_module',
        enforcement_layer: 'chain',
        budget_enforcement: 'none',
        funds_custodied: false,
        capabilities_required: ['read', 'sign', 'submit_tx'],
      },
      issued_at_ms: nowMs,
      expires_at_ms: expiresAtMs,
    },
  };
}

export function validateEthereumSwapTask(task = {}) {
  if (task.venue_id !== ETHEREUM_VENUE_ID && task.policy_context?.venue_id !== ETHEREUM_VENUE_ID) {
    return {
      status: 'error',
      code: 'ETHEREUM_TASK_VENUE_REQUIRED',
      message: 'Ethereum swap task must target venue_id=ethereum-mainnet.',
    };
  }
  if (task.action?.type !== 'submit_tx') {
    return {
      status: 'error',
      code: 'ETHEREUM_SUBMIT_TX_ACTION_REQUIRED',
      message: 'Ethereum swap task action.type must be submit_tx.',
    };
  }
  const capabilities = validateEthereumTaskCapabilities(task);
  if (capabilities.status !== 'ok') return capabilities;
  const params = task.action?.params || {};
  const swapParams = validateEthereumSwapParams({
    account: ethereumAccountFromTask(task),
    adapter: normalizeAdapter(params.adapter || params.execution_adapter),
    inputToken: normalizeAddress(params.inputToken || params.input_token),
    outputToken: normalizeAddress(params.outputToken || params.output_token),
    amount: stringValue(params.amount || params.raw_amount),
    slippageBps: Number(
      params.slippageBps ?? params.slippage_bps ?? task.constraints?.slippage_bps
    ),
  });
  if (swapParams.status !== 'ok') return swapParams;
  return { status: 'ok' };
}

export function normalizeEthereumExecutionResult(body = {}, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'ETHEREUM_BAD_EXECUTION_RESPONSE',
      message: 'Ethereum execution response must be an object.',
    };
  }
  const txHash = stringValue(
    body.tx_hash || body.transaction_hash || body.transactionHash || body.hash || options.tx_hash
  );
  if (!isEthereumTxHash(txHash)) {
    return {
      status: 'error',
      code: 'ETHEREUM_TX_HASH_REQUIRED',
      message: 'Ethereum execution response requires a valid transaction hash.',
    };
  }
  const receiptStatus = body.receipt_status ?? body.receiptStatus ?? null;
  const executionStatus = stringValue(body.execution_status || body.status).toLowerCase();
  const confirmationStatus = stringValue(body.confirmation_status || body.confirmationStatus);
  const finality = stringValue(body.finality);
  const err = body.err || body.error || body.revert_reason || body.revertReason || null;
  const reverted =
    receiptStatus === 0 ||
    receiptStatus === '0x0' ||
    ['reverted', 'failed', 'failure'].includes(executionStatus) ||
    Boolean(err);
  const done =
    !reverted &&
    (receiptStatus === 1 ||
      receiptStatus === '0x1' ||
      ['success', 'succeeded'].includes(executionStatus) ||
      ['confirmed', 'finalized'].includes(confirmationStatus.toLowerCase()) ||
      ['confirmed', 'finalized'].includes(finality.toLowerCase()));
  return {
    status: reverted ? 'error' : done ? 'done' : 'submitted',
    task_id: options.task_id || body.task_id || null,
    summary: reverted ? 'Ethereum transaction reverted.' : 'Ethereum transaction submitted.',
    evidence: {
      venue_id: ETHEREUM_VENUE_ID,
      chain_id: ETHEREUM_CHAIN_ID,
      tx_hash: txHash,
      transaction_hash: txHash,
      block_number: body.block_number || body.blockNumber || null,
      receipt_status: receiptStatus,
      confirmation_status: confirmationStatus || null,
      finality: finality || null,
      err,
      quote_id: body.quote_id || options.quote_id || null,
    },
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function verifyEthereumAgentTaskResult(result = {}, task = {}) {
  const taskCheck = validateEthereumSwapTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (['blocked', 'error'].includes(result.status)) return { status: 'ok' };
  if (!['submitted', 'done', 'proposed'].includes(result.status)) {
    return {
      status: 'error',
      code: 'ETHEREUM_RESULT_STATUS_INVALID',
      message:
        'Ethereum AgentTaskResult status must be proposed, submitted, done, blocked or error.',
    };
  }
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const txHash = ethereumTxHashFromResult(result);
  if (['submitted', 'done'].includes(result.status) && !isEthereumTxHash(txHash)) {
    return {
      status: 'error',
      code: 'ETHEREUM_TX_HASH_REQUIRED',
      message: 'Submitted/done Ethereum result requires a valid transaction hash.',
    };
  }
  if (evidence.venue_id && evidence.venue_id !== ETHEREUM_VENUE_ID) {
    return {
      status: 'error',
      code: 'ETHEREUM_RESULT_VENUE_MISMATCH',
      message: 'Ethereum result evidence must have venue_id=ethereum-mainnet.',
    };
  }
  if (evidence.chain_id && evidence.chain_id !== ETHEREUM_CHAIN_ID) {
    return {
      status: 'error',
      code: 'ETHEREUM_RESULT_CHAIN_MISMATCH',
      message: 'Ethereum result evidence must have chain_id=eip155:1.',
    };
  }
  const expectedQuoteId = ethereumQuoteIdFromTask(task);
  const actualQuoteId = evidence.quote_id || result.quote_id;
  if (expectedQuoteId && actualQuoteId && expectedQuoteId !== actualQuoteId) {
    return {
      status: 'error',
      code: 'ETHEREUM_QUOTE_ID_MISMATCH',
      message: 'Ethereum result quote_id does not match the dispatched task.',
      expected_quote_id: expectedQuoteId,
      actual_quote_id: actualQuoteId,
    };
  }
  if (
    evidence.receipt_status === 0 ||
    evidence.receipt_status === '0x0' ||
    evidence.receipt_status === 'reverted' ||
    evidence.err ||
    evidence.error
  ) {
    return {
      status: 'error',
      code: 'ETHEREUM_TRANSACTION_REVERTED',
      message: 'Ethereum result evidence reports a reverted transaction.',
      receipt_status: evidence.receipt_status,
    };
  }
  return { status: 'ok' };
}
