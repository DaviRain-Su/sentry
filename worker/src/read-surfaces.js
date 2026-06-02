import { canonicalize } from './strategy-core.js'

const DEFAULT_PARSE_CACHE_TTL_MS = 5 * 60 * 1000

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function numericString(value) {
  return value == null ? '0' : String(value)
}

function bigintOrZero(value) {
  try {
    return BigInt(numericString(value))
  } catch {
    return 0n
  }
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
  requiredDbusdcBalance = '1',
  requiredDeepBalance = '1',
  requiredSuiGasMist = '1',
}) {
  const balances = {
    DBUSDC: numericString(dbusdcBalance),
    DEEP: numericString(deepBalance),
    SUI_MIST: numericString(suiBalanceMist),
  }
  const thresholds = {
    DBUSDC: { required: numericString(requiredDbusdcBalance), label: 'BalanceManager quote balance for live DeepBook orders' },
    DEEP: { required: numericString(requiredDeepBalance), label: 'BalanceManager DEEP fee balance' },
    SUI_MIST: { required: numericString(requiredSuiGasMist), label: 'Agent wallet SUI gas balance' },
  }
  const criteria = [
    {
      holder: balanceManagerId,
      holder_label: 'DeepBook BalanceManager',
      asset: 'DBUSDC',
      threshold: thresholds.DBUSDC.required,
      observed: balances.DBUSDC,
      observed_balance: balances.DBUSDC,
      usable: bigintOrZero(balances.DBUSDC) >= bigintOrZero(thresholds.DBUSDC.required),
      source_of_truth: 'DeepBook BalanceManager read from Sui Testnet',
      blocker_code: 'INSUFFICIENT_DBUSDC',
    },
    {
      holder: balanceManagerId,
      holder_label: 'DeepBook BalanceManager',
      asset: 'DEEP',
      threshold: thresholds.DEEP.required,
      observed: balances.DEEP,
      observed_balance: balances.DEEP,
      usable: bigintOrZero(balances.DEEP) >= bigintOrZero(thresholds.DEEP.required),
      source_of_truth: 'DeepBook BalanceManager read from Sui Testnet',
      blocker_code: 'INSUFFICIENT_DEEP',
    },
    {
      holder: agentAddress,
      holder_label: 'Agent gas address',
      asset: 'SUI_MIST',
      threshold: thresholds.SUI_MIST.required,
      observed: balances.SUI_MIST,
      observed_balance: balances.SUI_MIST,
      usable: bigintOrZero(balances.SUI_MIST) >= bigintOrZero(thresholds.SUI_MIST.required),
      source_of_truth: 'Agent wallet gas balance from Sui Testnet',
      blocker_code: 'INSUFFICIENT_GAS',
    },
  ]
  for (const row of criteria) {
    row.usability = row.usable ? 'usable' : 'blocked'
  }
  const blockers = []
  if (!executionEnabled) {
    blockers.push({ code: 'EXECUTION_DISABLED', label: 'Execution disabled', observed: 'false', required: 'true' })
  }
  for (const row of criteria) {
    if (row.usable) continue
    const labels = {
      INSUFFICIENT_DBUSDC: 'BalanceManager DBUSDC below required threshold',
      INSUFFICIENT_DEEP: 'BalanceManager DEEP below required fee threshold',
      INSUFFICIENT_GAS: 'Agent SUI gas below required threshold',
    }
    blockers.push({ code: row.blocker_code, label: labels[row.blocker_code], holder: row.holder, asset: row.asset, observed: row.observed_balance, required: row.threshold })
  }
  const fundingBlockers = blockers.filter((b) => b.code !== 'EXECUTION_DISABLED')
  const fundingReady = fundingBlockers.length === 0

  return {
    holder: 'agent_balance_manager',
    agent_address: agentAddress,
    balance_manager_id: balanceManagerId,
    execution_enabled: Boolean(executionEnabled),
    balances,
    thresholds,
    criteria,
    funding_state: fundingReady ? 'ready' : 'blocked',
    funding_ready: fundingReady,
    funding_precondition_satisfied: fundingReady,
    execution_claimed: false,
    readiness_state: blockers.length ? 'blocked' : 'ready',
    ready: blockers.length === 0,
    blockers,
    funding_blockers: fundingBlockers,
    blocker_labels: blockers.map((b) => b.label),
    blocker_codes: blockers.map((b) => b.code),
  }
}
