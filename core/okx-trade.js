export const OKX_ORDER_ENDPOINT = '/api/v5/trade/order';
export const OKX_ORDER_STATUS_ENDPOINT = '/api/v5/trade/order';
export const OKX_ORDER_ACTIONS = ['place_order', 'cancel_order'];
export const OKX_ORDER_SIDES = ['buy', 'sell'];
export const OKX_ORDER_TYPES = ['limit', 'market', 'post_only', 'ioc', 'fok'];
export const OKX_TRADE_MODE = 'cash';
export const OKX_OPEN_ORDER_STATES = ['live', 'partially_filled'];
export const OKX_TERMINAL_ORDER_STATES = ['filled', 'canceled', 'mmp_canceled'];
export const OKX_ORDER_STATES = [...OKX_OPEN_ORDER_STATES, ...OKX_TERMINAL_ORDER_STATES];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numericString(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return Number(text) > 0 ? text : null;
}

function normalizeSide(value) {
  return String(value || '').toLowerCase();
}

function normalizeOrderType(value) {
  return String(value || 'limit').toLowerCase();
}

function normalizeInstrument(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function okxAuthorizationRef(keyMetadata) {
  return `okx:${keyMetadata?.key_handle || 'key-handle'}`;
}

function okxInstrumentFromTask(task = {}) {
  const params = task.action?.params || {};
  return normalizeInstrument(params.instId || params.inst_id || task.instrument);
}

function okxClientOrderIdFromTask(task = {}) {
  const params = task.action?.params || {};
  return stringValue(params.clOrdId || params.client_order_id || task.client_order_id);
}

function okxOrderIdFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    result.venue_order_id || result.order_id || evidence.venue_order_id || evidence.order_id
  );
}

function okxClientOrderIdFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(result.client_order_id || evidence.client_order_id);
}

function validateOkxClientOrderId(clientOrderId) {
  if (!clientOrderId) {
    return {
      status: 'error',
      code: 'OKX_CLIENT_ORDER_ID_REQUIRED',
      message: 'OKX place_order task requires clOrdId for idempotency.',
    };
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(clientOrderId)) {
    return {
      status: 'error',
      code: 'OKX_CLIENT_ORDER_ID_INVALID',
      message: 'OKX clOrdId must be 1-32 ASCII letters, numbers, underscores or hyphens.',
    };
  }
  return { status: 'ok' };
}

function validateOkxTaskCapabilities(task = {}) {
  const declared = [
    ...(task.constraints?.capabilities_required || []),
    ...(task.authorization?.capabilities_required || []),
  ];
  const missing = ['read', 'place_order'].filter((capability) => !declared.includes(capability));
  if (declared.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'OKX task must not request withdrawal capability.',
    };
  }
  if (missing.length) {
    return {
      status: 'error',
      code: 'OKX_TASK_CAPABILITIES_REQUIRED',
      message: `OKX place_order task requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok' };
}

export function assertOkxTradeScope(keyMetadata, capability = 'place_order') {
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_REQUIRED',
      message: 'OKX key metadata is required before trade task construction.',
    };
  }
  if (keyMetadata.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_MISMATCH',
      message: 'OKX trade task can only use metadata for venue_id=okx.',
    };
  }
  const permissions = keyMetadata.permissions || [];
  if (permissions.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'OKX withdrawal permission is never accepted.',
    };
  }
  if (!permissions.includes(capability)) {
    return {
      status: 'error',
      code: 'OKX_TRADE_PERMISSION_REQUIRED',
      message: `OKX key metadata requires ${capability} permission.`,
      required_permission: capability,
    };
  }
  return { status: 'ok' };
}

export function buildOkxPlaceOrderTask(input = {}) {
  const keyMetadata = input.keyMetadata || input.key_metadata;
  const scope = assertOkxTradeScope(keyMetadata, 'place_order');
  if (scope.status !== 'ok') return scope;
  const readScope = assertOkxTradeScope(keyMetadata, 'read');
  if (readScope.status !== 'ok') return readScope;

  const instId = normalizeInstrument(input.instrument || input.instId || input.inst_id);
  const side = normalizeSide(input.side);
  const ordType = normalizeOrderType(input.orderType || input.ordType || input.order_type);
  const size = numericString(input.size || input.sz);
  const price = numericString(input.price || input.px);
  const quoteBudget = numericString(
    input.quoteBudget || input.quote_budget || input.max_quote_amount
  );
  const clientOrderId =
    input.clientOrderId ||
    input.client_order_id ||
    `sentry-${String(input.taskId || input.task_id || Date.now()).slice(-24)}`;

  const bad = validateOkxOrderParams({ instId, side, ordType, size, price });
  if (bad.status !== 'ok') return bad;
  const idempotency = validateOkxClientOrderId(clientOrderId);
  if (idempotency.status !== 'ok') return idempotency;

  const nowMs = Number(input.nowMs || Date.now());
  const expiresAtMs = Number(input.expiresAtMs || input.expires_at_ms || nowMs + 120_000);
  const taskId = input.taskId || input.task_id || `task_okx_${crypto.randomUUID()}`;

  return {
    status: 'ok',
    task: {
      task_id: taskId,
      target_agent: input.targetAgent || input.target_agent || null,
      venue_id: 'okx',
      policy_id: input.policyId || input.policy_id || null,
      policy_context: {
        policy_id: input.policyId || input.policy_id || null,
        venue_id: 'okx',
        account_ref: keyMetadata.account_ref || null,
        max_quote_amount: quoteBudget,
      },
      action: {
        type: 'place_order',
        params: {
          endpoint: OKX_ORDER_ENDPOINT,
          venue_id: 'okx',
          instId,
          tdMode: OKX_TRADE_MODE,
          side,
          ordType,
          sz: size,
          px: ordType === 'market' ? null : price,
          clOrdId: clientOrderId,
          simulated: Boolean(input.simulated),
        },
      },
      constraints: {
        venue_scope: ['okx'],
        capabilities_required: ['read', 'place_order'],
        max_quote_amount: quoteBudget,
        idempotency_key: clientOrderId,
        require_receipt: true,
        no_withdraw: true,
      },
      authorization: {
        authorization_ref:
          input.authorizationRef || input.authorization_ref || okxAuthorizationRef(keyMetadata),
        venue_id: 'okx',
        venue_account_id: 'okx',
        authorization_model: 'venue_api_key',
        enforcement_layer: 'venue',
        budget_enforcement: 'venue_limit',
        funds_custodied: false,
        capabilities_required: ['read', 'place_order'],
      },
      issued_at_ms: nowMs,
      expires_at_ms: expiresAtMs,
    },
  };
}

function validateOkxOrderParams(params = {}) {
  if (!params.instId || !/^[A-Z0-9]+-[A-Z0-9]+(-[A-Z0-9]+)?$/.test(params.instId)) {
    return {
      status: 'error',
      code: 'OKX_INSTRUMENT_REQUIRED',
      message: 'OKX order requires an instId such as BTC-USDT.',
    };
  }
  if (!OKX_ORDER_SIDES.includes(params.side)) {
    return {
      status: 'error',
      code: 'OKX_ORDER_SIDE_INVALID',
      message: `OKX order side must be one of: ${OKX_ORDER_SIDES.join(', ')}`,
    };
  }
  if (!OKX_ORDER_TYPES.includes(params.ordType)) {
    return {
      status: 'error',
      code: 'OKX_ORDER_TYPE_INVALID',
      message: `OKX order type must be one of: ${OKX_ORDER_TYPES.join(', ')}`,
    };
  }
  if (!params.size) {
    return {
      status: 'error',
      code: 'OKX_ORDER_SIZE_REQUIRED',
      message: 'OKX order size must be a positive number string.',
    };
  }
  if (params.ordType !== 'market' && !params.price) {
    return {
      status: 'error',
      code: 'OKX_ORDER_PRICE_REQUIRED',
      message: 'Non-market OKX orders require a positive price.',
    };
  }
  return { status: 'ok' };
}

export function validateOkxPlaceOrderTask(task = {}) {
  if (task.venue_id !== 'okx' && task.policy_context?.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_TASK_VENUE_REQUIRED',
      message: 'OKX trade task must target venue_id=okx.',
    };
  }
  if (task.action?.type !== 'place_order') {
    return {
      status: 'error',
      code: 'OKX_PLACE_ORDER_ACTION_REQUIRED',
      message: 'OKX trade task action.type must be place_order.',
    };
  }
  const capabilities = validateOkxTaskCapabilities(task);
  if (capabilities.status !== 'ok') return capabilities;
  const params = task.action?.params || {};
  const ordType = normalizeOrderType(params.ordType || params.order_type);
  const orderParams = validateOkxOrderParams({
    instId: normalizeInstrument(params.instId || params.inst_id),
    side: normalizeSide(params.side),
    ordType,
    size: numericString(params.sz || params.size),
    price: ordType === 'market' ? '1' : numericString(params.px || params.price),
  });
  if (orderParams.status !== 'ok') return orderParams;
  return validateOkxClientOrderId(okxClientOrderIdFromTask(task));
}

export function normalizeOkxOrderResponse(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'OKX_BAD_ORDER_RESPONSE',
      message: 'OKX order response must be an object.',
    };
  }
  if (body.code !== '0') {
    return {
      status: 'error',
      code: 'OKX_ORDER_API_ERROR',
      okx_code: body.code ?? null,
      message: body.msg || 'OKX order API returned an error.',
    };
  }
  const order = Array.isArray(body.data) ? body.data[0] || {} : {};
  if (order.sCode && order.sCode !== '0') {
    return {
      status: 'error',
      code: 'OKX_ORDER_REJECTED',
      okx_code: order.sCode,
      message: order.sMsg || 'OKX rejected the order.',
    };
  }
  const venueOrderId = String(order.ordId || order.orderId || '');
  if (!venueOrderId) {
    return {
      status: 'error',
      code: 'OKX_ORDER_ID_REQUIRED',
      message: 'OKX order response did not include ordId.',
    };
  }
  const clientOrderId = String(order.clOrdId || options.client_order_id || '');
  return {
    status: 'submitted',
    task_id: options.task_id || null,
    summary: 'OKX order accepted.',
    evidence: {
      venue_id: 'okx',
      venue_order_id: venueOrderId,
      client_order_id: clientOrderId,
      instrument: options.instrument || null,
    },
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function buildOkxOrderStatusQuery(input = {}) {
  const task = input.task || {};
  const result = input.result || {};
  const instId = normalizeInstrument(
    input.instrument || input.instId || input.inst_id || okxInstrumentFromTask(task)
  );
  const venueOrderId = stringValue(
    input.venueOrderId ||
      input.venue_order_id ||
      input.ordId ||
      input.order_id ||
      okxOrderIdFromResult(result)
  );
  const clientOrderId = stringValue(
    input.clientOrderId ||
      input.client_order_id ||
      input.clOrdId ||
      okxClientOrderIdFromResult(result) ||
      okxClientOrderIdFromTask(task)
  );

  if (!instId) {
    return {
      status: 'error',
      code: 'OKX_INSTRUMENT_REQUIRED',
      message: 'OKX order status query requires instId.',
    };
  }
  if (!venueOrderId && !clientOrderId) {
    return {
      status: 'error',
      code: 'OKX_ORDER_LOOKUP_ID_REQUIRED',
      message: 'OKX order status query requires ordId or clOrdId.',
    };
  }
  if (clientOrderId) {
    const idempotency = validateOkxClientOrderId(clientOrderId);
    if (idempotency.status !== 'ok') return idempotency;
  }

  return {
    status: 'ok',
    query: {
      endpoint: OKX_ORDER_STATUS_ENDPOINT,
      method: 'GET',
      params: {
        instId,
        ...(venueOrderId ? { ordId: venueOrderId } : {}),
        ...(clientOrderId ? { clOrdId: clientOrderId } : {}),
      },
      idempotency_key: clientOrderId || null,
    },
  };
}

export function normalizeOkxOrderStatusResponse(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'OKX_BAD_ORDER_STATUS_RESPONSE',
      message: 'OKX order status response must be an object.',
    };
  }
  if (body.code !== '0') {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATUS_API_ERROR',
      okx_code: body.code ?? null,
      message: body.msg || 'OKX order status API returned an error.',
    };
  }
  const order = Array.isArray(body.data) ? body.data[0] || {} : {};
  const venueOrderId = stringValue(order.ordId || order.orderId || options.venue_order_id);
  const clientOrderId = stringValue(order.clOrdId || options.client_order_id);
  const instrument = normalizeInstrument(order.instId || options.instrument);
  const state = stringValue(order.state).toLowerCase();

  if (!venueOrderId && !clientOrderId) {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATUS_ID_REQUIRED',
      message: 'OKX order status response did not include ordId or clOrdId.',
    };
  }
  if (!instrument) {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATUS_INSTRUMENT_REQUIRED',
      message: 'OKX order status response did not include instId.',
    };
  }
  if (!OKX_ORDER_STATES.includes(state)) {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATE_UNKNOWN',
      message: `Unknown OKX order state: ${state || '(missing)'}`,
      order_state: state || null,
    };
  }

  return {
    status: 'ok',
    venue_id: 'okx',
    instrument,
    venue_order_id: venueOrderId || null,
    client_order_id: clientOrderId || null,
    order_state: state,
    terminal: OKX_TERMINAL_ORDER_STATES.includes(state),
    filled_size: stringValue(order.accFillSz || order.fillSz || '0'),
    average_price: stringValue(order.avgPx || ''),
    evidence: {
      venue_id: 'okx',
      venue_order_id: venueOrderId || null,
      client_order_id: clientOrderId || null,
      instrument,
      order_state: state,
    },
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function verifyOkxOrderStatusForTask(statusResult = {}, task = {}) {
  const taskCheck = validateOkxPlaceOrderTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (statusResult.status !== 'ok') {
    return {
      status: 'error',
      code: statusResult.code || 'OKX_ORDER_STATUS_NOT_OK',
      message: statusResult.message || 'OKX order status result is not ok.',
    };
  }
  if (statusResult.venue_id && statusResult.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATUS_VENUE_MISMATCH',
      message: 'OKX order status must have venue_id=okx.',
    };
  }
  const expectedInstrument = okxInstrumentFromTask(task);
  if (
    expectedInstrument &&
    statusResult.instrument &&
    expectedInstrument !== statusResult.instrument
  ) {
    return {
      status: 'error',
      code: 'OKX_ORDER_STATUS_INSTRUMENT_MISMATCH',
      message: 'OKX order status instrument does not match the dispatched task.',
      expected_instrument: expectedInstrument,
      actual_instrument: statusResult.instrument,
    };
  }
  const expectedClientOrderId = okxClientOrderIdFromTask(task);
  if (expectedClientOrderId && !statusResult.client_order_id) {
    return {
      status: 'error',
      code: 'OKX_CLIENT_ORDER_ID_REQUIRED',
      message: 'OKX order status must include clOrdId to prove idempotency.',
      expected_client_order_id: expectedClientOrderId,
    };
  }
  if (
    expectedClientOrderId &&
    statusResult.client_order_id &&
    expectedClientOrderId !== statusResult.client_order_id
  ) {
    return {
      status: 'error',
      code: 'OKX_CLIENT_ORDER_ID_MISMATCH',
      message: 'OKX order status client_order_id does not match the dispatched task.',
      expected_client_order_id: expectedClientOrderId,
      actual_client_order_id: statusResult.client_order_id,
    };
  }
  return { status: 'ok' };
}

export function verifyOkxAgentTaskResult(result = {}, task = {}) {
  const taskCheck = validateOkxPlaceOrderTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (['blocked', 'error'].includes(result.status)) return { status: 'ok' };
  if (!['submitted', 'done', 'proposed'].includes(result.status)) {
    return {
      status: 'error',
      code: 'OKX_RESULT_STATUS_INVALID',
      message: 'OKX AgentTaskResult status must be proposed, submitted, done, blocked or error.',
    };
  }
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const venueOrderId =
    result.venue_order_id || result.order_id || evidence.venue_order_id || evidence.order_id;
  if (['submitted', 'done'].includes(result.status) && !venueOrderId) {
    return {
      status: 'error',
      code: 'OKX_ORDER_EVIDENCE_REQUIRED',
      message: 'Submitted/done OKX result requires venue_order_id or order_id evidence.',
    };
  }
  const expectedClientOrderId =
    task.action?.params?.clOrdId || task.action?.params?.client_order_id;
  const actualClientOrderId = evidence.client_order_id || result.client_order_id;
  if (
    expectedClientOrderId &&
    actualClientOrderId &&
    expectedClientOrderId !== actualClientOrderId
  ) {
    return {
      status: 'error',
      code: 'OKX_CLIENT_ORDER_ID_MISMATCH',
      message: 'OKX result client_order_id does not match the dispatched task.',
      expected_client_order_id: expectedClientOrderId,
      actual_client_order_id: actualClientOrderId,
    };
  }
  if (evidence.venue_id && evidence.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_RESULT_VENUE_MISMATCH',
      message: 'OKX result evidence must have venue_id=okx.',
    };
  }
  return { status: 'ok' };
}
