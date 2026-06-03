export const HYPERLIQUID_EXCHANGE_ENDPOINT = '/exchange';
export const HYPERLIQUID_INFO_ENDPOINT = '/info';
export const HYPERLIQUID_SIGNATURE_PART_RE = /^0x[0-9a-fA-F]{64}$/;
export const HYPERLIQUID_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const HYPERLIQUID_ORDER_SIDES = ['buy', 'sell'];
export const HYPERLIQUID_ORDER_TYPES = ['limit', 'market'];
export const HYPERLIQUID_TIFS = ['Alo', 'Ioc', 'Gtc'];
export const HYPERLIQUID_OPEN_ORDER_STATES = ['open'];
export const HYPERLIQUID_TERMINAL_ORDER_STATES = [
  'filled',
  'canceled',
  'triggered',
  'rejected',
  'marginCanceled',
  'vaultWithdrawalCanceled',
  'openInterestCapCanceled',
  'selfTradeCanceled',
  'reduceOnlyCanceled',
  'siblingFilledCanceled',
  'delistedCanceled',
  'liquidatedCanceled',
  'scheduledCancel',
  'tickRejected',
  'minTradeNtlRejected',
  'perpMarginRejected',
  'reduceOnlyRejected',
  'badAloPxRejected',
  'iocCancelRejected',
  'badTriggerPxRejected',
  'marketOrderNoLiquidityRejected',
  'positionIncreaseAtOpenInterestCapRejected',
  'positionFlipAtOpenInterestCapRejected',
  'tooAggressiveAtOpenInterestCapRejected',
  'openInterestIncreaseRejected',
  'insufficientSpotBalanceRejected',
  'oracleRejected',
  'perpMaxPositionRejected',
];
export const HYPERLIQUID_RAW_SECRET_FIELDS = [
  'secret',
  'api_secret',
  'apiSecret',
  'private_key',
  'privateKey',
  'wallet_private_key',
  'walletPrivateKey',
  'passphrase',
  'password',
  'seed',
  'mnemonic',
  'token',
  'raw_secret',
  'rawSecret',
];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numericString(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return Number(text) > 0 ? text : null;
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function secretFieldPath(value, prefix = '') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && HYPERLIQUID_RAW_SECRET_FIELDS.includes(key)) return path;
    const nested = secretFieldPath(child, path);
    if (nested) return nested;
  }
  return null;
}

function normalizeCoin(value) {
  return stringValue(value).toUpperCase();
}

function normalizeSide(value) {
  if (value === true) return 'buy';
  if (value === false) return 'sell';
  const text = stringValue(value).toLowerCase();
  if (text === 'b') return 'buy';
  if (text === 's') return 'sell';
  return text;
}

function normalizeOrderType(value) {
  return stringValue(value || 'limit').toLowerCase();
}

function normalizeTif(value) {
  const text = stringValue(value || 'Gtc').toLowerCase();
  if (text === 'alo') return 'Alo';
  if (text === 'ioc') return 'Ioc';
  return 'Gtc';
}

function hyperliquidAuthorizationRef(keyMetadata) {
  return `hyperliquid:${keyMetadata?.key_handle || 'agent-wallet'}`;
}

export function hyperliquidCoinFromTask(task = {}) {
  const params = task.action?.params || {};
  return normalizeCoin(params.coin || params.asset || task.asset || task.instrument);
}

export function hyperliquidCloidFromTask(task = {}) {
  const params = task.action?.params || {};
  return stringValue(params.cloid || params.client_order_id || task.client_order_id);
}

function hyperliquidCloidFromSignedAction(action = {}) {
  const orders = Array.isArray(action.orders) ? action.orders : [];
  const cloids = orders.map((order) => stringValue(order.c || order.cloid)).filter(Boolean);
  return cloids[0] || null;
}

function hyperliquidOrderIdFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    result.venue_order_id || result.order_id || evidence.venue_order_id || evidence.order_id
  );
}

function hyperliquidCloidFromResult(result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    result.client_order_id || result.cloid || evidence.client_order_id || evidence.cloid
  );
}

function validateHyperliquidCloid(cloid) {
  if (!cloid) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_CLOID_REQUIRED',
      message: 'Hyperliquid place_order task requires cloid for idempotency.',
    };
  }
  if (!/^0x[0-9a-fA-F]{32}$/.test(cloid)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_CLOID_INVALID',
      message: 'Hyperliquid cloid must be a 128-bit hex string, formatted as 0x + 32 hex chars.',
    };
  }
  return { status: 'ok' };
}

function normalizeHyperliquidOid(value) {
  const text = stringValue(value);
  if (!text) return null;
  if (!/^[0-9]+$/.test(text)) return null;
  const numberValue = Number(text);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function positiveSafeInteger(value) {
  if (typeof value === 'bigint') {
    return value > 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  }
  const text = stringValue(value);
  if (!/^[0-9]+$/.test(text)) return null;
  const numberValue = Number(text);
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

function hyperliquidOrderStateIsTerminal(state) {
  const text = stringValue(state);
  if (!text) return false;
  if (HYPERLIQUID_OPEN_ORDER_STATES.includes(text)) return false;
  return HYPERLIQUID_TERMINAL_ORDER_STATES.includes(text) || text !== 'open';
}

function validateHyperliquidTaskCapabilities(task = {}) {
  const declared = [
    ...(task.constraints?.capabilities_required || []),
    ...(task.authorization?.capabilities_required || []),
  ];
  const missing = ['read', 'place_order'].filter((capability) => !declared.includes(capability));
  if (declared.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Hyperliquid task must not request withdrawal/transfer capability.',
    };
  }
  if (missing.length) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_TASK_CAPABILITIES_REQUIRED',
      message: `Hyperliquid place_order task requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok' };
}

function validateHyperliquidSignature(signature = {}) {
  if (!signature || typeof signature !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNATURE_REQUIRED',
      message: 'Hyperliquid signed exchange payload requires a signature object.',
    };
  }
  if (!HYPERLIQUID_SIGNATURE_PART_RE.test(stringValue(signature.r))) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNATURE_R_INVALID',
      message: 'Hyperliquid signature.r must be 0x + 64 hex chars.',
    };
  }
  if (!HYPERLIQUID_SIGNATURE_PART_RE.test(stringValue(signature.s))) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNATURE_S_INVALID',
      message: 'Hyperliquid signature.s must be 0x + 64 hex chars.',
    };
  }
  const v = Number(signature.v);
  if (![0, 1, 27, 28].includes(v)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNATURE_V_INVALID',
      message: 'Hyperliquid signature.v must be one of 0, 1, 27 or 28.',
    };
  }
  return {
    status: 'ok',
    signature: {
      r: stringValue(signature.r),
      s: stringValue(signature.s),
      v,
    },
  };
}

export function assertHyperliquidTradeScope(keyMetadata, capability = 'place_order') {
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      message: 'Hyperliquid key metadata is required before trade task construction.',
    };
  }
  if (keyMetadata.venue_id !== 'hyperliquid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_MISMATCH',
      message: 'Hyperliquid trade task can only use metadata for venue_id=hyperliquid.',
    };
  }
  const permissions = keyMetadata.permissions || [];
  if (permissions.includes('withdraw') || permissions.includes('transfer')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Hyperliquid withdrawal/transfer scope is never accepted.',
    };
  }
  if (!permissions.includes(capability)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_TRADE_PERMISSION_REQUIRED',
      message: `Hyperliquid key metadata requires ${capability} permission.`,
      required_permission: capability,
    };
  }
  return { status: 'ok' };
}

function validateHyperliquidOrderParams(params = {}) {
  if (!params.coin || !/^[A-Z0-9@_.:-]{1,32}$/.test(params.coin)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_COIN_REQUIRED',
      message: 'Hyperliquid order requires a coin/asset such as BTC or ETH.',
    };
  }
  if (!HYPERLIQUID_ORDER_SIDES.includes(params.side)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_SIDE_INVALID',
      message: `Hyperliquid order side must be one of: ${HYPERLIQUID_ORDER_SIDES.join(', ')}`,
    };
  }
  if (!HYPERLIQUID_ORDER_TYPES.includes(params.orderType)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_TYPE_INVALID',
      message: `Hyperliquid order type must be one of: ${HYPERLIQUID_ORDER_TYPES.join(', ')}`,
    };
  }
  if (!params.size) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_SIZE_REQUIRED',
      message: 'Hyperliquid order size must be a positive number string.',
    };
  }
  if (params.orderType === 'limit' && !params.price) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_PRICE_REQUIRED',
      message: 'Limit Hyperliquid orders require a positive price.',
    };
  }
  if (params.orderType === 'limit' && !HYPERLIQUID_TIFS.includes(params.tif)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_TIF_INVALID',
      message: `Hyperliquid tif must be one of: ${HYPERLIQUID_TIFS.join(', ')}`,
    };
  }
  return { status: 'ok' };
}

export function buildHyperliquidPlaceOrderTask(input = {}) {
  const keyMetadata = input.keyMetadata || input.key_metadata;
  const scope = assertHyperliquidTradeScope(keyMetadata, 'place_order');
  if (scope.status !== 'ok') return scope;
  const readScope = assertHyperliquidTradeScope(keyMetadata, 'read');
  if (readScope.status !== 'ok') return readScope;

  const coin = normalizeCoin(input.coin || input.asset || input.instrument);
  const side = normalizeSide(input.side ?? input.isBuy);
  const orderType = normalizeOrderType(input.orderType || input.order_type);
  const size = numericString(input.size || input.sz);
  const price = numericString(input.price || input.limitPx || input.limit_px);
  const tif = normalizeTif(input.tif || input.timeInForce || input.time_in_force);
  const maxNotionalUsd = numericString(
    input.maxNotionalUsd || input.max_notional_usd || input.quoteBudget || input.quote_budget
  );
  const clientOrderId =
    input.cloid ||
    input.clientOrderId ||
    input.client_order_id ||
    `0x${crypto.randomUUID().replace(/-/g, '')}`;

  const bad = validateHyperliquidOrderParams({ coin, side, orderType, size, price, tif });
  if (bad.status !== 'ok') return bad;
  const idempotency = validateHyperliquidCloid(clientOrderId);
  if (idempotency.status !== 'ok') return idempotency;

  const nowMs = Number(input.nowMs || Date.now());
  const expiresAtMs = Number(input.expiresAtMs || input.expires_at_ms || nowMs + 120_000);
  const taskId = input.taskId || input.task_id || `task_hyperliquid_${crypto.randomUUID()}`;
  const reduceOnly = Boolean(input.reduceOnly || input.reduce_only);

  return {
    status: 'ok',
    task: {
      task_id: taskId,
      target_agent: input.targetAgent || input.target_agent || null,
      venue_id: 'hyperliquid',
      policy_id: input.policyId || input.policy_id || null,
      policy_context: {
        policy_id: input.policyId || input.policy_id || null,
        venue_id: 'hyperliquid',
        account_ref: keyMetadata.account_ref || null,
        read_account_address: keyMetadata.read_account_address || null,
        max_notional_usd: maxNotionalUsd,
      },
      action: {
        type: 'place_order',
        params: {
          endpoint: HYPERLIQUID_EXCHANGE_ENDPOINT,
          venue_id: 'hyperliquid',
          coin,
          side,
          isBuy: side === 'buy',
          orderType,
          sz: size,
          limitPx: orderType === 'market' ? null : price,
          tif: orderType === 'limit' ? tif : null,
          reduceOnly,
          cloid: clientOrderId,
          simulated: Boolean(input.simulated),
        },
      },
      constraints: {
        venue_scope: ['hyperliquid'],
        capabilities_required: ['read', 'place_order'],
        max_notional_usd: maxNotionalUsd,
        idempotency_key: clientOrderId,
        require_receipt: true,
        no_withdraw: true,
        reduce_only: reduceOnly,
      },
      authorization: {
        authorization_ref:
          input.authorizationRef ||
          input.authorization_ref ||
          hyperliquidAuthorizationRef(keyMetadata),
        venue_id: 'hyperliquid',
        venue_account_id: 'hyperliquid',
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

export function validateHyperliquidPlaceOrderTask(task = {}) {
  if (task.venue_id !== 'hyperliquid' && task.policy_context?.venue_id !== 'hyperliquid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_TASK_VENUE_REQUIRED',
      message: 'Hyperliquid trade task must target venue_id=hyperliquid.',
    };
  }
  if (task.action?.type !== 'place_order') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_PLACE_ORDER_ACTION_REQUIRED',
      message: 'Hyperliquid trade task action.type must be place_order.',
    };
  }
  const capabilities = validateHyperliquidTaskCapabilities(task);
  if (capabilities.status !== 'ok') return capabilities;
  const params = task.action?.params || {};
  const orderType = normalizeOrderType(params.orderType || params.order_type);
  const orderParams = validateHyperliquidOrderParams({
    coin: normalizeCoin(params.coin || params.asset),
    side: normalizeSide(params.side ?? params.isBuy),
    orderType,
    size: numericString(params.sz || params.size),
    price: orderType === 'market' ? '1' : numericString(params.limitPx || params.price),
    tif: normalizeTif(params.tif || params.timeInForce || params.time_in_force),
  });
  if (orderParams.status !== 'ok') return orderParams;
  return validateHyperliquidCloid(hyperliquidCloidFromTask(task));
}

function firstOrderStatus(body = {}) {
  const response = body.response || body;
  const data = response.data || body.data || {};
  const statuses = data.statuses || response.statuses || body.statuses || [];
  return Array.isArray(statuses) ? statuses[0] || null : null;
}

export function normalizeHyperliquidOrderResponse(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_BAD_ORDER_RESPONSE',
      message: 'Hyperliquid order response must be an object.',
    };
  }
  if (body.status && body.status !== 'ok') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_API_ERROR',
      message: body.error || body.message || 'Hyperliquid order API returned an error.',
    };
  }

  const status = firstOrderStatus(body);
  if (!status) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_STATUS_REQUIRED',
      message: 'Hyperliquid order response did not include an order status.',
    };
  }
  if (status.error) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_REJECTED',
      message: status.error,
    };
  }

  const resting = status.resting || null;
  const filled = status.filled || null;
  const venueOrderId = stringValue(
    resting?.oid || filled?.oid || status.oid || options.venue_order_id
  );
  if (!venueOrderId) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_ID_REQUIRED',
      message: 'Hyperliquid order response did not include oid.',
    };
  }
  const clientOrderId = stringValue(
    resting?.cloid || filled?.cloid || status.cloid || options.client_order_id
  );
  const terminal = Boolean(filled);

  return {
    status: terminal ? 'done' : 'submitted',
    task_id: options.task_id || null,
    summary: terminal ? 'Hyperliquid order filled.' : 'Hyperliquid order accepted.',
    evidence: {
      venue_id: 'hyperliquid',
      venue_order_id: venueOrderId,
      client_order_id: clientOrderId || null,
      coin: options.coin || null,
      order_state: terminal ? 'filled' : 'resting',
      filled_size: stringValue(filled?.totalSz || filled?.sz || ''),
      average_price: stringValue(filled?.avgPx || ''),
    },
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function validateHyperliquidSignedExchangePayload(payload = {}, options = {}) {
  const rawSecretPath = secretFieldPath(payload);
  if (rawSecretPath) {
    return {
      status: 'error',
      code: 'RAW_SECRET_FIELD_REJECTED',
      message: `Hyperliquid signed exchange payload must not include raw secret field: ${rawSecretPath}`,
      path: rawSecretPath,
    };
  }
  if (!isObject(payload)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNED_PAYLOAD_REQUIRED',
      message: 'Hyperliquid signed exchange payload must be an object.',
    };
  }
  if (!isObject(payload.action)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_SIGNED_ACTION_REQUIRED',
      message: 'Hyperliquid signed exchange payload requires an action object.',
    };
  }
  const nonce = positiveSafeInteger(payload.nonce);
  if (!nonce) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_NONCE_INVALID',
      message: 'Hyperliquid signed exchange payload requires a positive safe-integer nonce.',
    };
  }
  const expiresAfter =
    payload.expiresAfter === undefined || payload.expiresAfter === null
      ? null
      : positiveSafeInteger(payload.expiresAfter);
  if ((payload.expiresAfter || payload.expiresAfter === 0) && !expiresAfter) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_EXPIRES_AFTER_INVALID',
      message: 'Hyperliquid expiresAfter must be a positive safe-integer timestamp when supplied.',
    };
  }
  const nowMs = Number(options.nowMs || options.now_ms || Date.now());
  if (expiresAfter && expiresAfter <= nowMs) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_EXPIRES_AFTER_ELAPSED',
      message: 'Hyperliquid signed exchange payload expiresAfter is already elapsed.',
      expires_after_ms: expiresAfter,
      now_ms: nowMs,
    };
  }
  if (expiresAfter && expiresAfter < nonce) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_EXPIRES_BEFORE_NONCE',
      message: 'Hyperliquid expiresAfter must not be earlier than nonce.',
      expires_after_ms: expiresAfter,
      nonce,
    };
  }
  const signature = validateHyperliquidSignature(payload.signature);
  if (signature.status !== 'ok') return signature;
  if (payload.vaultAddress && !HYPERLIQUID_ADDRESS_RE.test(stringValue(payload.vaultAddress))) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_VAULT_ADDRESS_INVALID',
      message: 'Hyperliquid vaultAddress must be a 42-character hex address when supplied.',
    };
  }

  const task = options.task || null;
  if (task) {
    const taskCheck = validateHyperliquidPlaceOrderTask(task);
    if (taskCheck.status !== 'ok') return taskCheck;
    if (payload.action.type !== 'order') {
      return {
        status: 'error',
        code: 'HYPERLIQUID_SIGNED_ACTION_TYPE_INVALID',
        message: 'Hyperliquid place_order task requires signed action.type=order.',
      };
    }
    const expectedCloid = hyperliquidCloidFromTask(task);
    const actualCloid = hyperliquidCloidFromSignedAction(payload.action);
    if (expectedCloid && actualCloid && expectedCloid !== actualCloid) {
      return {
        status: 'error',
        code: 'HYPERLIQUID_CLOID_MISMATCH',
        message: 'Signed Hyperliquid action cloid does not match the dispatched task.',
        expected_client_order_id: expectedCloid,
        actual_client_order_id: actualCloid,
      };
    }
    if (expectedCloid && !actualCloid) {
      return {
        status: 'error',
        code: 'HYPERLIQUID_SIGNED_ACTION_CLOID_REQUIRED',
        message: 'Signed Hyperliquid order action must include cloid bound to the dispatched task.',
        expected_client_order_id: expectedCloid,
      };
    }
  }

  return {
    status: 'ok',
    payload: {
      action: payload.action,
      nonce,
      signature: signature.signature,
      ...(payload.vaultAddress ? { vaultAddress: stringValue(payload.vaultAddress) } : {}),
      ...(expiresAfter ? { expiresAfter } : {}),
    },
  };
}

export function normalizeHyperliquidSignedExchangeSubmitResult(body = {}, options = {}) {
  const normalized = normalizeHyperliquidOrderResponse(body, {
    task_id: options.task_id,
    client_order_id: options.client_order_id,
    coin: options.coin,
    observed_at: options.observed_at,
  });
  if (normalized.status !== 'submitted' && normalized.status !== 'done') return normalized;
  return {
    ...normalized,
    evidence: {
      ...normalized.evidence,
      signed_exchange_submit: true,
      nonce: options.nonce || null,
      expires_after_ms: options.expires_after_ms || null,
    },
  };
}

export function buildHyperliquidOrderStatusQuery(input = {}) {
  const task = input.task || {};
  const result = input.result || {};
  const user = stringValue(
    input.user || input.read_account_address || task.policy_context?.read_account_address
  );
  const venueOrderId = stringValue(
    input.venueOrderId ||
      input.venue_order_id ||
      input.oid ||
      input.order_id ||
      hyperliquidOrderIdFromResult(result)
  );
  const clientOrderId = stringValue(
    input.cloid ||
      input.clientOrderId ||
      input.client_order_id ||
      hyperliquidCloidFromResult(result) ||
      hyperliquidCloidFromTask(task)
  );
  const coin = normalizeCoin(input.coin || input.asset || hyperliquidCoinFromTask(task));

  if (!user) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_USER_ADDRESS_REQUIRED',
      message: 'Hyperliquid order status query requires the master or subaccount user address.',
    };
  }
  if (!venueOrderId && !clientOrderId) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_LOOKUP_ID_REQUIRED',
      message: 'Hyperliquid order status query requires oid or cloid.',
    };
  }
  if (clientOrderId) {
    const idempotency = validateHyperliquidCloid(clientOrderId);
    if (idempotency.status !== 'ok') return idempotency;
  }
  const oid = normalizeHyperliquidOid(venueOrderId);
  if (venueOrderId && !oid && !clientOrderId) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_ID_UNSAFE',
      message:
        'Hyperliquid order status query requires a safe numeric oid or a 128-bit cloid fallback.',
    };
  }

  return {
    status: 'ok',
    query: {
      endpoint: HYPERLIQUID_INFO_ENDPOINT,
      method: 'POST',
      body: {
        type: 'orderStatus',
        user,
        oid: oid || clientOrderId,
      },
      expected: {
        venue_order_id: venueOrderId || null,
        client_order_id: clientOrderId || null,
        coin: coin || null,
      },
      idempotency_key: clientOrderId || null,
    },
  };
}

export function normalizeHyperliquidOrderStatusResponse(body, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_BAD_ORDER_STATUS_RESPONSE',
      message: 'Hyperliquid orderStatus response must be an object.',
    };
  }
  if (body.status === 'unknownOid' || body.status === 'unknownCloid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_NOT_FOUND',
      message: 'Hyperliquid orderStatus did not find the requested order.',
    };
  }
  if (body.error) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_STATUS_API_ERROR',
      message: body.error || body.message || 'Hyperliquid orderStatus returned an error.',
    };
  }
  const envelope = body.order || body.data || {};
  const order = envelope.order || envelope;
  const orderState = stringValue(envelope.status || body.order_status || body.orderState);
  if (!orderState || (body.status && body.status !== 'order')) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_STATUS_REQUIRED',
      message: 'Hyperliquid orderStatus response did not include an order state.',
    };
  }
  if (!order || typeof order !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_STATUS_ORDER_REQUIRED',
      message: 'Hyperliquid orderStatus response did not include order details.',
    };
  }

  const venueOrderId = stringValue(order.oid || options.venue_order_id);
  const clientOrderId = stringValue(order.cloid || options.client_order_id);
  const coin = normalizeCoin(order.coin || options.coin);
  const terminal = hyperliquidOrderStateIsTerminal(orderState);

  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    venue_order_id: venueOrderId || null,
    client_order_id: clientOrderId || null,
    coin: coin || null,
    side: stringValue(order.side || ''),
    price: stringValue(order.limitPx || ''),
    quantity: stringValue(order.sz || order.origSz || ''),
    original_quantity: stringValue(order.origSz || ''),
    order_state: orderState || null,
    terminal,
    filled_size:
      orderState === 'filled'
        ? stringValue(order.sz || order.totalSz || order.origSz || options.filled_size || '')
        : stringValue(options.filled_size || ''),
    average_price: stringValue(order.avgPx || options.average_price || ''),
    timestamp_ms: order.timestamp ?? null,
    status_timestamp_ms: envelope.statusTimestamp ?? body.statusTimestamp ?? null,
    observed_at: options.observed_at || new Date().toISOString(),
  };
}

export function verifyHyperliquidOrderStatusForTask(status = {}, task = {}) {
  const taskCheck = validateHyperliquidPlaceOrderTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (status.status !== 'ok') return status;

  const expectedClientOrderId = hyperliquidCloidFromTask(task);
  if (
    expectedClientOrderId &&
    status.client_order_id &&
    expectedClientOrderId !== status.client_order_id
  ) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_CLOID_MISMATCH',
      message: 'Hyperliquid orderStatus cloid does not match the dispatched task.',
      expected_client_order_id: expectedClientOrderId,
      actual_client_order_id: status.client_order_id,
    };
  }

  const expectedCoin = hyperliquidCoinFromTask(task);
  const actualCoin = normalizeCoin(status.coin);
  if (expectedCoin && actualCoin && expectedCoin !== actualCoin) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_COIN_MISMATCH',
      message: 'Hyperliquid orderStatus coin does not match the dispatched task.',
      expected_coin: expectedCoin,
      actual_coin: actualCoin,
    };
  }

  return { status: 'ok' };
}

export function verifyHyperliquidAgentTaskResult(result = {}, task = {}) {
  const taskCheck = validateHyperliquidPlaceOrderTask(task);
  if (taskCheck.status !== 'ok') return taskCheck;
  if (['blocked', 'error'].includes(result.status)) return { status: 'ok' };
  if (!['submitted', 'done', 'proposed'].includes(result.status)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_RESULT_STATUS_INVALID',
      message:
        'Hyperliquid AgentTaskResult status must be proposed, submitted, done, blocked or error.',
    };
  }
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const venueOrderId =
    result.venue_order_id || result.order_id || evidence.venue_order_id || evidence.order_id;
  if (['submitted', 'done'].includes(result.status) && !venueOrderId) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_ORDER_EVIDENCE_REQUIRED',
      message: 'Submitted/done Hyperliquid result requires venue_order_id or order_id evidence.',
    };
  }
  const expectedClientOrderId = hyperliquidCloidFromTask(task);
  const actualClientOrderId =
    evidence.client_order_id || evidence.cloid || result.client_order_id || result.cloid;
  if (
    expectedClientOrderId &&
    actualClientOrderId &&
    expectedClientOrderId !== actualClientOrderId
  ) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_CLOID_MISMATCH',
      message: 'Hyperliquid result client_order_id/cloid does not match the dispatched task.',
      expected_client_order_id: expectedClientOrderId,
      actual_client_order_id: actualClientOrderId,
    };
  }
  const expectedCoin = hyperliquidCoinFromTask(task);
  const actualCoin = normalizeCoin(evidence.coin || evidence.asset || result.coin || result.asset);
  if (expectedCoin && actualCoin && expectedCoin !== actualCoin) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_COIN_MISMATCH',
      message: 'Hyperliquid result coin does not match the dispatched task.',
      expected_coin: expectedCoin,
      actual_coin: actualCoin,
    };
  }
  if (evidence.venue_id && evidence.venue_id !== 'hyperliquid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_RESULT_VENUE_MISMATCH',
      message: 'Hyperliquid result evidence must have venue_id=hyperliquid.',
    };
  }
  return { status: 'ok' };
}
