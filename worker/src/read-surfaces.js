import { canonicalize } from './strategy-core.js'

const DEFAULT_PARSE_CACHE_TTL_MS = 5 * 60 * 1000

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function numericString(value) {
  return value == null ? '0' : String(value)
}

function normalizeDefaults(defaults) {
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) return {}
  return defaults
}

export function stableParseCacheKey({ owner, text, defaults }) {
  return canonicalize({ owner, text, defaults: normalizeDefaults(defaults) })
}

export function parseIntentWithStability(parseFn, cache, body, nowMs = Date.now(), cacheTtlMs = DEFAULT_PARSE_CACHE_TTL_MS) {
  const defaults = normalizeDefaults(body.defaults)
  const key = stableParseCacheKey({ owner: body.owner, text: body.text, defaults })
  const cached = cache.get(key)
  if (cached && cached.cache_expires_at_ms > nowMs && Number(cached.result?.strategy?.expires_at_ms ?? 0) > nowMs) {
    return cloneJson(cached.result)
  }

  const result = parseFn(body.text, body.owner, defaults, nowMs)
  if (result.status === 'ok') {
    const strategyExpiry = Number(result.strategy.expires_at_ms)
    cache.set(key, {
      result: cloneJson(result),
      cache_expires_at_ms: Math.min(nowMs + cacheTtlMs, Number.isFinite(strategyExpiry) ? strategyExpiry : nowMs),
    })
  }
  return result
}

export function bytesToHex(bytes) {
  if (!Array.isArray(bytes)) return null
  return '0x' + bytes.map((b) => Number(b).toString(16).padStart(2, '0')).join('')
}

export function derivePolicyStatus(mandate, nowMs = Date.now()) {
  if (mandate?.revoked) return 'revoked'
  if (mandate?.expires_at_ms != null && nowMs >= Number(mandate.expires_at_ms)) return 'expired'
  return 'active'
}

export function policyRuntimeState(status) {
  if (status === 'revoked') return 'Revoked'
  if (status === 'expired') return 'Expired'
  if (status === 'active') return 'Monitoring'
  return 'Unknown'
}

export function enrichPolicyFromChain({ eventPolicy, wrapper, mandate, createdTx, nowMs = Date.now() }) {
  const status = derivePolicyStatus(mandate, nowMs)
  const wrapperId = wrapper?.wrapper_id ?? eventPolicy.wrapper_id
  const mandateId = wrapper?.mandate_id ?? eventPolicy.mandate_id
  return {
    policy_id: wrapperId,
    wrapper_id: wrapperId,
    mandate_id: mandateId,
    owner: wrapper?.owner ?? mandate?.owner ?? eventPolicy.owner,
    agent: wrapper?.agent ?? mandate?.agent ?? eventPolicy.agent,
    pool_id: wrapper?.pool_id ?? eventPolicy.pool_id,
    budget_coin_type: wrapper?.budget_coin_type ?? eventPolicy.budget_coin_type,
    budget_ceiling: numericString(wrapper?.budget_ceiling ?? eventPolicy.budget_ceiling),
    spent_amount: numericString(wrapper?.spent_amount),
    max_slippage_bps: Number(wrapper?.max_slippage_bps ?? eventPolicy.max_slippage_bps),
    expires_at_ms: numericString(mandate?.expires_at_ms ?? eventPolicy.expires_at_ms),
    revoked: Boolean(mandate?.revoked),
    status,
    runtime_state: policyRuntimeState(status),
    runtime_state_stale: false,
    strategy_hash: wrapper?.strategy_hash ?? eventPolicy.strategy_hash ?? null,
    created_tx: createdTx,
  }
}

export function buildFundingReadiness({
  agentAddress,
  balanceManagerId,
  dbusdcBalance,
  deepBalance,
  suiBalanceMist,
  executionEnabled,
}) {
  const balances = {
    DBUSDC: numericString(dbusdcBalance),
    DEEP: numericString(deepBalance),
    SUI_MIST: numericString(suiBalanceMist),
  }
  const thresholds = {
    DBUSDC: { required: '>0', label: 'BalanceManager quote balance for live DeepBook orders' },
    DEEP: { required: '>0', label: 'BalanceManager DEEP fee balance' },
    SUI_MIST: { required: '>0', label: 'Agent wallet SUI gas balance' },
  }
  const blockers = []
  if (!executionEnabled) {
    blockers.push({ code: 'EXECUTION_DISABLED', label: 'Execution disabled', observed: 'false', required: 'true' })
  }
  if (BigInt(balances.DBUSDC) <= 0n) {
    blockers.push({ code: 'INSUFFICIENT_DBUSDC', label: 'BalanceManager DBUSDC unfunded', observed: balances.DBUSDC, required: thresholds.DBUSDC.required })
  }
  if (BigInt(balances.DEEP) <= 0n) {
    blockers.push({ code: 'INSUFFICIENT_DEEP', label: 'BalanceManager DEEP unfunded', observed: balances.DEEP, required: thresholds.DEEP.required })
  }
  if (BigInt(balances.SUI_MIST) <= 0n) {
    blockers.push({ code: 'INSUFFICIENT_GAS', label: 'Agent SUI gas unavailable', observed: balances.SUI_MIST, required: thresholds.SUI_MIST.required })
  }

  return {
    holder: 'agent_balance_manager',
    agent_address: agentAddress,
    balance_manager_id: balanceManagerId,
    execution_enabled: Boolean(executionEnabled),
    balances,
    thresholds,
    readiness_state: blockers.length ? 'blocked' : 'ready',
    ready: blockers.length === 0,
    blockers,
    blocker_labels: blockers.map((b) => b.label),
    blocker_codes: blockers.map((b) => b.code),
  }
}
