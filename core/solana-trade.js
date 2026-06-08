export const SOLANA_CHAIN_ID = 'solana:mainnet';
export const SOLANA_VENUE_ID = 'solana-mainnet';
export const SOLANA_SWAP_ADAPTERS = ['jupiter', 'raydium', 'orca', 'custom'];
export const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
export const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const SOLANA_UNSIGNED_TRANSACTION_FORMAT = 'solana_unsigned_transaction_base64';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function numericString(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return Number(text) > 0 ? text : null;
}

function positiveNumericString(value) {
  const text = stringValue(value);
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? text : null;
}

function normalizeAdapter(value) {
  const adapter = stringValue(value || 'jupiter').toLowerCase();
  return SOLANA_SWAP_ADAPTERS.includes(adapter) ? adapter : null;
}

function normalizeMint(value) {
  return stringValue(value);
}

function solanaOwnerFromInput(input = {}) {
  return stringValue(input.owner || input.wallet || input.walletAddress || input.wallet_address);
}

function solanaOwnerFromTask(task = {}) {
  return stringValue(
    task.policy_context?.owner ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref ||
      task.action?.params?.owner
  );
}

function solanaQuoteIdFromTask(task = {}) {
  return stringValue(task.action?.params?.quote_id || task.constraints?.idempotency_key);
}

function solanaSignatureFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    result.signature ||
      result.tx_signature ||
      result.tx_digest ||
      evidence.signature ||
      evidence.tx_signature ||
      evidence.tx_digest
  );
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function solanaPreparedTransactionEvidence(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const prepared = isObject(evidence.prepared_transaction) ? evidence.prepared_transaction : {};
  return {
    evidence,
    prepared,
    unsignedTransactionBase64: stringValue(
      evidence.unsigned_transaction_base64 ||
        evidence.transaction_base64 ||
        evidence.swap_transaction_base64 ||
        prepared.unsigned_transaction_base64 ||
        prepared.transaction_base64 ||
        prepared.swap_transaction_base64
    ),
    requiredSigners: [
      ...arrayStrings(evidence.required_signers),
      ...arrayStrings(prepared.required_signers),
      stringValue(evidence.required_signer || prepared.required_signer),
      stringValue(evidence.signer || prepared.signer),
    ].filter(Boolean),
    quoteId: stringValue(evidence.quote_id || result.quote_id || prepared.quote_id),
    chainId: stringValue(evidence.chain_id || prepared.chain_id),
    simulation: isObject(evidence.simulation) ? evidence.simulation : {},
    simulationId: stringValue(evidence.simulation_id || prepared.simulation_id),
  };
}

function isBase64Like(value) {
  return /^[A-Za-z0-9+/=_-]{32,}$/.test(stringValue(value));
}

function simulationStatus(value = {}) {
  return stringValue(
    value.evidence.simulation_status ||
      value.simulation.status ||
      value.simulation.result ||
      value.prepared.simulation_status
  ).toLowerCase();
}

function simulationError(value = {}) {
  return (
    value.evidence.err ||
    value.evidence.error ||
    value.simulation.err ||
    value.simulation.error ||
    null
  );
}

function simulationSucceeded(status) {
  return ['ok', 'success', 'succeeded', 'passed', 'simulated'].includes(status);
}

export function isSolanaSignature(value) {
  return SOLANA_SIGNATURE_RE.test(String(value || ''));
}

export function assertSolanaAccountScope(account = {}) {
  if (!account || typeof account !== 'object') {
    return {
      status: 'error',
      code: 'SOLANA_ACCOUNT_REQUIRED',
      message: 'Solana task construction requires local wallet/account metadata.',
    };
  }
  const owner = solanaOwnerFromInput(account);
  if (!SOLANA_ADDRESS_RE.test(owner)) {
    return {
      status: 'error',
      code: 'SOLANA_WALLET_ADDRESS_REQUIRED',
      message: 'Solana task construction requires a valid local wallet address.',
    };
  }
  const capabilities = account.capabilities || account.permissions || [];
  if (capabilities.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Solana autonomous tasks must not request withdrawal capability.',
    };
  }
  const missing = ['read', 'sign', 'submit_tx'].filter(
    (capability) => !capabilities.includes(capability)
  );
  if (missing.length) {
    return {
      status: 'error',
      code: 'SOLANA_ACCOUNT_CAPABILITIES_REQUIRED',
      message: `Solana account metadata requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok', owner, capabilities };
}

function validateSolanaSwapParams(params = {}) {
  if (!SOLANA_ADDRESS_RE.test(params.owner)) {
    return {
      status: 'error',
      code: 'SOLANA_WALLET_ADDRESS_REQUIRED',
      message: 'Solana swap task requires a valid owner wallet address.',
    };
  }
  if (!normalizeMint(params.inputMint)) {
    return {
      status: 'error',
      code: 'SOLANA_INPUT_MINT_REQUIRED',
      message: 'Solana swap task requires inputMint.',
    };
  }
  if (!normalizeMint(params.outputMint)) {
    return {
      status: 'error',
      code: 'SOLANA_OUTPUT_MINT_REQUIRED',
      message: 'Solana swap task requires outputMint.',
    };
  }
  if (normalizeMint(params.inputMint) === normalizeMint(params.outputMint)) {
    return {
      status: 'error',
      code: 'SOLANA_SWAP_MINTS_MUST_DIFFER',
      message: 'Solana swap inputMint and outputMint must differ.',
    };
  }
  if (!params.amount) {
    return {
      status: 'error',
      code: 'SOLANA_SWAP_AMOUNT_REQUIRED',
      message: 'Solana swap amount must be a positive integer string in base units.',
    };
  }
  if (!/^[0-9]+$/.test(params.amount) || Number(params.amount) <= 0) {
    return {
      status: 'error',
      code: 'SOLANA_SWAP_AMOUNT_INVALID',
      message: 'Solana swap amount must be a positive integer string in base units.',
    };
  }
  if (!params.adapter) {
    return {
      status: 'error',
      code: 'SOLANA_SWAP_ADAPTER_INVALID',
      message: `Solana swap adapter must be one of: ${SOLANA_SWAP_ADAPTERS.join(', ')}`,
    };
  }
  const slippageBps = Number(params.slippageBps ?? 0);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    return {
      status: 'error',
      code: 'SOLANA_SLIPPAGE_INVALID',
      message: 'Solana slippageBps must be an integer between 0 and 10000.',
    };
  }
  return { status: 'ok' };
}

function validateSolanaTaskCapabilities(task = {}) {
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
      message: 'Solana task must not request withdrawal capability.',
    };
  }
  if (missing.length) {
    return {
      status: 'error',
      code: 'SOLANA_TASK_CAPABILITIES_REQUIRED',
      message: `Solana swap task requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok' };
}

export function buildSolanaSwapTask(input = {}) {
  const account = input.account || input.accountMetadata || input.account_metadata;
  const scope = assertSolanaAccountScope(account);
  if (scope.status !== 'ok') return scope;

  const adapter = normalizeAdapter(
    input.adapter || input.executionAdapter || input.execution_adapter
  );
  const amount = stringValue(input.amount || input.rawAmount || input.raw_amount);
  const inputMint = normalizeMint(input.inputMint || input.input_mint);
  const outputMint = normalizeMint(input.outputMint || input.output_mint);
  const slippageBps = Number(input.slippageBps ?? input.slippage_bps ?? 50);
  const quoteId =
    input.quoteId ||
    input.quote_id ||
    `solana-${adapter || 'swap'}-${String(input.taskId || input.task_id || Date.now()).slice(-18)}`;
  const maxInputAmount = numericString(input.maxInputAmount || input.max_input_amount || amount);
  const minOutputAmount = numericString(input.minOutputAmount || input.min_output_amount);
  const maxNotionalUsd = positiveNumericString(
    input.maxNotionalUsd ||
      input.max_notional_usd ||
      input.max_quote_amount ||
      input.quoteBudget ||
      input.quote_budget
  );

  const params = {
    owner: scope.owner,
    adapter,
    inputMint,
    outputMint,
    amount,
    slippageBps,
  };
  const bad = validateSolanaSwapParams(params);
  if (bad.status !== 'ok') return bad;

  const nowMs = Number(input.nowMs || Date.now());
  const expiresAtMs = Number(input.expiresAtMs || input.expires_at_ms || nowMs + 120_000);
  const taskId = input.taskId || input.task_id || `task_solana_${crypto.randomUUID()}`;

  return {
    status: 'ok',
    task: {
      task_id: taskId,
      target_agent: input.targetAgent || input.target_agent || null,
      venue_id: SOLANA_VENUE_ID,
      policy_id: input.policyId || input.policy_id || null,
      policy_context: {
        policy_id: input.policyId || input.policy_id || null,
        venue_id: SOLANA_VENUE_ID,
        chain_id: SOLANA_CHAIN_ID,
        owner: scope.owner,
        wallet_address: scope.owner,
      },
      action: {
        type: 'submit_tx',
        params: {
          venue_id: SOLANA_VENUE_ID,
          chain_id: SOLANA_CHAIN_ID,
          intent: 'swap',
          adapter,
          owner: scope.owner,
          inputMint,
          outputMint,
          amount,
          slippageBps,
          quote_id: quoteId,
          transaction_format: SOLANA_UNSIGNED_TRANSACTION_FORMAT,
          signing_handoff:
            input.signingHandoff || input.signing_handoff || 'external_agent_ows_or_wallet',
          prepared_result_required: true,
          prepared_transaction_schema: {
            unsigned_transaction_base64: true,
            required_signers: [scope.owner],
            simulation_required: true,
          },
          simulated: Boolean(input.simulated),
        },
      },
      constraints: {
        venue_scope: [SOLANA_VENUE_ID],
        capabilities_required: ['read', 'sign', 'submit_tx'],
        idempotency_key: quoteId,
        require_receipt: true,
        require_simulation: true,
        require_prepared_transaction: true,
        require_quote_id: true,
        max_notional_usd: maxNotionalUsd,
        max_input_amount: maxInputAmount,
        min_output_amount: minOutputAmount,
        slippage_bps: slippageBps,
        no_withdraw: true,
      },
      authorization: {
        authorization_ref:
          input.authorizationRef || input.authorization_ref || `solana:${scope.owner}`,
        venue_id: SOLANA_VENUE_ID,
        venue_account_id: SOLANA_VENUE_ID,
        account_ref: scope.owner,
        authorization_model: 'native_delegation',
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

export function validateSolanaSwapTask(task = {}) {
  if (task.venue_id !== SOLANA_VENUE_ID && task.policy_context?.venue_id !== SOLANA_VENUE_ID) {
    return {
      status: 'error',
      code: 'SOLANA_TASK_VENUE_REQUIRED',
      message: 'Solana swap task must target venue_id=solana-mainnet.',
    };
  }
  if (task.action?.type !== 'submit_tx') {
    return {
      status: 'error',
      code: 'SOLANA_SUBMIT_TX_ACTION_REQUIRED',
      message: 'Solana swap task action.type must be submit_tx.',
    };
  }
  const capabilities = validateSolanaTaskCapabilities(task);
  if (capabilities.status !== 'ok') return capabilities;
  const params = task.action?.params || {};
  const swapParams = validateSolanaSwapParams({
    owner: solanaOwnerFromTask(task),
    adapter: normalizeAdapter(params.adapter || params.execution_adapter),
    inputMint: params.inputMint || params.input_mint,
    outputMint: params.outputMint || params.output_mint,
    amount: stringValue(params.amount || params.raw_amount),
    slippageBps: Number(
      params.slippageBps ?? params.slippage_bps ?? task.constraints?.slippage_bps
    ),
  });
  if (swapParams.status !== 'ok') return swapParams;
  if (
    params.transaction_format &&
    params.transaction_format !== SOLANA_UNSIGNED_TRANSACTION_FORMAT
  ) {
    return {
      status: 'error',
      code: 'SOLANA_TRANSACTION_FORMAT_INVALID',
      message: `Solana submit_tx task requires transaction_format=${SOLANA_UNSIGNED_TRANSACTION_FORMAT}.`,
    };
  }
  return { status: 'ok' };
}

export function normalizeSolanaExecutionResult(body = {}, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'SOLANA_BAD_EXECUTION_RESPONSE',
      message: 'Solana execution response must be an object.',
    };
  }
  const signature = stringValue(
    body.signature || body.tx_signature || body.tx_digest || options.signature
  );
  if (!isSolanaSignature(signature)) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_REQUIRED',
      message: 'Solana execution response requires a valid transaction signature.',
    };
  }
  const err = body.err ?? body.error ?? null;
  return {
    status: err ? 'error' : body.confirmation_status === 'finalized' ? 'done' : 'submitted',
    task_id: options.task_id || body.task_id || null,
    summary: err ? 'Solana transaction returned an error.' : 'Solana transaction submitted.',
    evidence: {
      venue_id: SOLANA_VENUE_ID,
      signature,
      tx_signature: signature,
      tx_digest: signature,
      slot: body.slot ?? null,
      confirmation_status: body.confirmation_status || body.confirmationStatus || 'submitted',
      err,
      quote_id: body.quote_id || options.quote_id || null,
    },
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function verifySolanaAgentTaskResult(result = {}, task = {}) {
  const taskCheck = validateSolanaSwapTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (['blocked', 'error'].includes(result.status)) return { status: 'ok' };
  if (!['submitted', 'done', 'proposed'].includes(result.status)) {
    return {
      status: 'error',
      code: 'SOLANA_RESULT_STATUS_INVALID',
      message: 'Solana AgentTaskResult status must be proposed, submitted, done, blocked or error.',
    };
  }
  const evidence = isObject(result.evidence) ? result.evidence : {};
  if (result.status === 'proposed') {
    return verifySolanaPreparedTransactionResult(result, task);
  }
  const signature = solanaSignatureFromResult(result);
  if (['submitted', 'done'].includes(result.status) && !isSolanaSignature(signature)) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNATURE_REQUIRED',
      message: 'Submitted/done Solana result requires a valid transaction signature.',
    };
  }
  if (evidence.venue_id && evidence.venue_id !== SOLANA_VENUE_ID) {
    return {
      status: 'error',
      code: 'SOLANA_RESULT_VENUE_MISMATCH',
      message: 'Solana result evidence must have venue_id=solana-mainnet.',
    };
  }
  const expectedQuoteId = solanaQuoteIdFromTask(task);
  const actualQuoteId = evidence.quote_id || result.quote_id;
  if (expectedQuoteId && actualQuoteId && expectedQuoteId !== actualQuoteId) {
    return {
      status: 'error',
      code: 'SOLANA_QUOTE_ID_MISMATCH',
      message: 'Solana result quote_id does not match the dispatched task.',
      expected_quote_id: expectedQuoteId,
      actual_quote_id: actualQuoteId,
    };
  }
  if (evidence.err) {
    return {
      status: 'error',
      code: 'SOLANA_TRANSACTION_REPORTED_ERROR',
      message: 'Solana result evidence reports a transaction error.',
      solana_error: evidence.err,
    };
  }
  return { status: 'ok' };
}

export function verifySolanaPreparedTransactionResult(result = {}, task = {}) {
  const taskCheck = validateSolanaSwapTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  const prepared = solanaPreparedTransactionEvidence(result);
  if (prepared.evidence.venue_id && prepared.evidence.venue_id !== SOLANA_VENUE_ID) {
    return {
      status: 'error',
      code: 'SOLANA_RESULT_VENUE_MISMATCH',
      message: 'Solana prepared transaction evidence must have venue_id=solana-mainnet.',
    };
  }
  if (prepared.chainId && prepared.chainId !== SOLANA_CHAIN_ID) {
    return {
      status: 'error',
      code: 'SOLANA_RESULT_CHAIN_MISMATCH',
      message: 'Solana prepared transaction evidence must have chain_id=solana:mainnet.',
    };
  }
  const expectedQuoteId = solanaQuoteIdFromTask(task);
  if (!prepared.quoteId) {
    return {
      status: 'error',
      code: 'SOLANA_QUOTE_ID_REQUIRED',
      message: 'Solana proposed transaction requires quote_id evidence.',
    };
  }
  if (expectedQuoteId && prepared.quoteId !== expectedQuoteId) {
    return {
      status: 'error',
      code: 'SOLANA_QUOTE_ID_MISMATCH',
      message: 'Solana prepared transaction quote_id does not match the dispatched task.',
      expected_quote_id: expectedQuoteId,
      actual_quote_id: prepared.quoteId,
    };
  }
  if (!isBase64Like(prepared.unsignedTransactionBase64)) {
    return {
      status: 'error',
      code: 'SOLANA_UNSIGNED_TRANSACTION_REQUIRED',
      message: 'Solana proposed transaction requires unsigned_transaction_base64 evidence.',
    };
  }
  const owner = solanaOwnerFromTask(task);
  if (!prepared.requiredSigners.length) {
    return {
      status: 'error',
      code: 'SOLANA_REQUIRED_SIGNER_REQUIRED',
      message: 'Solana proposed transaction must declare required_signers.',
    };
  }
  if (!prepared.requiredSigners.includes(owner)) {
    return {
      status: 'error',
      code: 'SOLANA_REQUIRED_SIGNER_MISMATCH',
      message: 'Solana proposed transaction required_signers must include the task owner wallet.',
      expected_signer: owner,
      actual_signers: prepared.requiredSigners,
    };
  }
  const simErr = simulationError(prepared);
  if (simErr) {
    return {
      status: 'error',
      code: 'SOLANA_SIMULATION_FAILED',
      message: 'Solana proposed transaction simulation returned an error.',
      simulation_error: simErr,
    };
  }
  const simStatus = simulationStatus(prepared);
  if (!prepared.simulationId && !simStatus) {
    return {
      status: 'error',
      code: 'SOLANA_SIMULATION_EVIDENCE_REQUIRED',
      message:
        'Solana proposed transaction requires simulation_id or successful simulation status.',
    };
  }
  if (simStatus && !simulationSucceeded(simStatus)) {
    return {
      status: 'error',
      code: 'SOLANA_SIMULATION_FAILED',
      message: 'Solana proposed transaction simulation status is not successful.',
      simulation_status: simStatus,
    };
  }
  return {
    status: 'ok',
    prepared_transaction: {
      venue_id: SOLANA_VENUE_ID,
      chain_id: SOLANA_CHAIN_ID,
      quote_id: prepared.quoteId,
      required_signers: prepared.requiredSigners,
      transaction_format: SOLANA_UNSIGNED_TRANSACTION_FORMAT,
      simulation_id: prepared.simulationId || null,
      simulation_status: simStatus || null,
    },
  };
}
