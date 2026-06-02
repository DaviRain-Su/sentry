// E7 — agent tick. decideTick() is the pure state-machine core (docs §8);
// runTick() adds chain I/O + (gated) execution. Allowed actions (docs §7):
// no_op | blocked | executed | stopped_revoked | stopped_expired | error.
import { runGuardian } from './guardian.js'
import { readWrapper, readMandate, readBalanceManagerBalance, readClockTimestampMs } from './chain.js'
import { buildExecutionTx } from './deepbook.js'
import { DEPLOYMENT } from './sui-tx.js'
import { keypairFromWorkerEnv } from './secret-safe-signer.js'
import { buildFundingReadiness } from './read-surfaces.js'

export const EXECUTION_BLOCKER_LABELS = {
  EXECUTION_DISABLED: 'Execution disabled',
  INSUFFICIENT_DBUSDC: 'Insufficient DBUSDC',
  INSUFFICIENT_DEEP: 'Insufficient DEEP',
  INSUFFICIENT_GAS: 'Insufficient SUI gas',
  TRIGGER_NOT_MET: 'Trigger not met',
  POLICY_REVOKED: 'Policy revoked',
  POLICY_EXPIRED: 'Policy expired',
  OVER_BUDGET: 'Over budget',
  OVER_SLIPPAGE: 'Over slippage',
  WRONG_POOL: 'Wrong pool',
  WRONG_AGENT: 'Wrong agent',
  MANDATE_MISMATCH: 'Mandate/wrapper mismatch',
  EXECUTION_FAILED: 'Execution failed',
  UNRESOLVED_TRANSACTION: 'Unresolved transaction',
  INVALID_AUTHORIZATION: 'Invalid authorization',
  FORCE_TRIGGER_DISABLED: 'Force trigger disabled',
}

function blockerLabel(code) {
  return EXECUTION_BLOCKER_LABELS[code] ?? code
}

function readinessBlock({ action = 'blocked', code, detail, extra = {} }) {
  return {
    action,
    code,
    blocker_code: code,
    blocker_label: blockerLabel(code),
    blocker_codes: [code],
    blocker_labels: [blockerLabel(code)],
    readiness_state: action === 'no_op' ? 'monitoring' : 'blocked',
    execution_claimed: false,
    detail,
    ...extra,
  }
}

function executionNonSuccess({ code = 'UNRESOLVED_TRANSACTION', detail, digest, submitted = false, extra = {} }) {
  return readinessBlock({
    action: 'error',
    code,
    detail,
    extra: {
      submitted,
      tx_digest: digest,
      readiness_state: 'blocked',
      execution_success_evidence: false,
      ...extra,
    },
  })
}

function toBigIntOrNull(value) {
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function tradeEventsForWrapper(events, wrapperId) {
  return (events || []).filter((e) => {
    if (!String(e.type || '').endsWith('::policy::AgentTradeExecuted')) return false
    const eventWrapper = e.parsedJson?.wrapper_id ?? e.data?.wrapper_id
    return eventWrapper === wrapperId
  })
}

export function classifyExecutionResolution({ submitted, resolved, beforeWrapper, afterWrapper, wrapperId }) {
  const evidence = resolved ?? submitted ?? {}
  const digest = evidence.digest ?? submitted?.digest
  const status = evidence.effects?.status?.status
  if (status !== 'success') {
    const error = evidence.effects?.status?.error
    return executionNonSuccess({
      code: 'EXECUTION_FAILED',
      detail: `Execution failed: ${error || status || 'Sui RPC did not return successful effects.'}`,
      digest,
      submitted: Boolean(digest),
      extra: {
        effects_status: status ?? null,
      },
    })
  }

  const events = tradeEventsForWrapper(evidence.events, wrapperId)
  const beforeSpent = toBigIntOrNull(beforeWrapper?.spent_amount)
  const afterSpent = toBigIntOrNull(afterWrapper?.spent_amount)
  const spendIncreased = beforeSpent != null && afterSpent != null && afterSpent > beforeSpent
  const hasTradeEvent = events.length > 0

  if (!hasTradeEvent || !spendIncreased) {
    return executionNonSuccess({
      code: 'UNRESOLVED_TRANSACTION',
      detail: 'Execution remains unresolved: successful effects alone are not accepted without AgentTradeExecuted event evidence and an on-chain spend increase.',
      digest,
      submitted: Boolean(digest),
      extra: {
        effects_status: status,
        agent_trade_event_found: hasTradeEvent,
        spend_increased: spendIncreased,
        spend_before: beforeWrapper?.spent_amount ?? null,
        spend_after: afterWrapper?.spent_amount ?? null,
      },
    })
  }

  return {
    action: 'executed',
    detail: 'Rescue order executed with resolved Sui success, AgentTradeExecuted event, and on-chain spend increase.',
    tx_digest: digest,
    submitted: true,
    readiness_state: 'executed',
    execution_claimed: true,
    execution_success_evidence: true,
    effects_status: status,
    agent_trade_event_found: true,
    spend_increased: true,
    spend_before: beforeWrapper.spent_amount,
    spend_after: afterWrapper.spent_amount,
    spend_delta: (afterSpent - beforeSpent).toString(),
  }
}

/**
 * Pure decision. No I/O.
 * @param {object} a
 * @param {{mandate_id:string,pool_id:string,budget_ceiling:string,spent_amount:string,max_slippage_bps:number,agent?:string}} a.wrapper
 * @param {{id:string,revoked:boolean,expires_at_ms:number|string,agent?:string}} a.mandate
 * @param {boolean} a.triggerMet
 * @param {{pool_id:string,amount:string,estimated_slippage_bps:number,agent_id?:string}} a.proposed
 * @param {number} a.nowMs
 * @param {boolean} a.executionEnabled
 * @param {string=} a.expectedAgentId
 * @param {string=} a.expectedPoolId
 * @returns {{action:string, reason?:number, detail:string, guardian?:object}}
 */
export function decideTick({ wrapper, mandate, triggerMet, proposed, nowMs, executionEnabled, expectedAgentId, expectedPoolId }) {
  if (mandate.revoked) return readinessBlock({ action: 'stopped_revoked', code: 'POLICY_REVOKED', detail: 'Mandate revoked on-chain; halting.' })
  if (nowMs >= Number(mandate.expires_at_ms)) return readinessBlock({ action: 'stopped_expired', code: 'POLICY_EXPIRED', detail: 'Mandate expired; halting.' })
  if (expectedAgentId && (wrapper.agent !== expectedAgentId || mandate.agent !== expectedAgentId)) {
    return readinessBlock({ code: 'WRONG_AGENT', detail: 'Execution blocked: policy agent does not match the configured RescueGrid agent.' })
  }
  if (expectedPoolId && wrapper.pool_id !== expectedPoolId) {
    return readinessBlock({ code: 'WRONG_POOL', detail: 'Execution blocked: policy pool is outside the configured execution scope.' })
  }
  if (!triggerMet) return readinessBlock({ action: 'no_op', code: 'TRIGGER_NOT_MET', detail: 'Trigger condition not met; monitoring.' })

  const guardian = runGuardian({ mandate, wrapper, proposed, nowMs })
  if (guardian.decision === 'block') {
    return readinessBlock({
      code: guardian.code ?? 'UNRESOLVED_TRANSACTION',
      detail: `Guardian blocked: ${guardian.label} — ${guardian.detail}`,
      extra: { reason: guardian.reason, guardian },
    })
  }
  if (!executionEnabled) {
    return readinessBlock({
      code: 'EXECUTION_DISABLED',
      detail: 'Execution blocked: EXECUTION_ENABLED is false or the agent key is unavailable; usable DBUSDC/DEEP funding must be verified before live execution.',
      extra: { guardian },
    })
  }
  return { action: 'execute', detail: 'Trigger met + Guardian passed; executing rescue order.', guardian }
}

export async function validateExecutionPlan(client, {
  wrapperId,
  mandateId,
  proposed,
  nowMs = undefined,
  expectedAgentId,
  expectedPoolId,
}) {
  const wrapper = await readWrapper(client, wrapperId)
  if (!wrapper) return { action: 'error', code: 'WRAPPER_NOT_FOUND', detail: 'Wrapper not found on-chain.', execution_claimed: false }
  const clockMs = nowMs ?? await readClockTimestampMs(client)
  if (!Number.isFinite(clockMs)) return { action: 'error', code: 'CLOCK_UNAVAILABLE', detail: 'Sui Clock timestamp was not readable.', execution_claimed: false }

  if (mandateId && mandateId !== wrapper.mandate_id) {
    const mandate = { id: mandateId, revoked: false, expires_at_ms: String(clockMs + 1), agent: wrapper.agent }
    const decision = decideTick({
      wrapper,
      mandate,
      triggerMet: true,
      proposed,
      nowMs: clockMs,
      executionEnabled: true,
      expectedAgentId,
      expectedPoolId,
    })
    return {
      ...decision,
      wrapper_id: wrapperId,
      mandate_id: mandateId,
      wrapper_mandate_id: wrapper.mandate_id,
      construction_path: 'Worker/API non-executing plan validation',
      chain_time_source: 'sui_clock_object_0x6',
      submitted: false,
      execution_claimed: false,
    }
  }

  const mandate = await readMandate(client, wrapper.mandate_id)
  if (!mandate) return { action: 'error', code: 'MANDATE_NOT_FOUND', detail: 'Mandate not found on-chain.', execution_claimed: false }
  const decision = decideTick({
    wrapper,
    mandate,
    triggerMet: true,
    proposed,
    nowMs: clockMs,
    executionEnabled: true,
    expectedAgentId,
    expectedPoolId,
  })
  const planDecision = decision.action === 'execute'
    ? { action: 'validated', readiness_state: 'ready', detail: 'Plan passed Guardian pre-submit validation; no transaction was submitted.', guardian: decision.guardian }
    : decision
  return {
    ...planDecision,
    wrapper_id: wrapperId,
    mandate_id: wrapper.mandate_id,
    construction_path: 'Worker/API non-executing plan validation',
    chain_time_source: 'sui_clock_object_0x6',
    submitted: false,
    execution_claimed: false,
  }
}

/** Per-trade amount: one rung = budget/5, capped at remaining budget. */
function perTradeAmount(wrapper) {
  const ceiling = BigInt(wrapper.budget_ceiling)
  const spent = BigInt(wrapper.spent_amount)
  const remaining = ceiling > spent ? ceiling - spent : 0n
  const rung = ceiling / 5n
  return (rung < remaining ? rung : remaining)
}

export function fundingReadinessBlock(funding) {
  const blockers = funding?.blockers ?? []
  if (blockers.length === 0) return null
  const primary = funding.funding_blockers?.[0] ?? blockers[0]
  return {
    code: primary.code,
    detail: `Execution blocked: ${blockers.map((b) => b.label).join('; ')}.`,
    balances: {
      dbusdc: funding.balances.DBUSDC,
      deep: funding.balances.DEEP,
      sui_mist: funding.balances.SUI_MIST,
      dbusdc_required: funding.thresholds.DBUSDC.required,
      deep_required: funding.thresholds.DEEP.required,
      sui_mist_required: funding.thresholds.SUI_MIST.required,
    },
    funding,
    execution_claimed: false,
    blocker_codes: funding.blocker_codes,
    blocker_labels: funding.blocker_labels,
  }
}

async function checkFunding(client, proposed, executionEnabled) {
  const [dbusdcBalance, deepBalance, suiBalance] = await Promise.all([
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.dbusdc_coin_type),
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.deep_coin_type),
    client.getBalance({ owner: DEPLOYMENT.agent.address, coinType: '0x2::sui::SUI' }),
  ])
  const funding = buildFundingReadiness({
    agentAddress: DEPLOYMENT.agent.address,
    balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
    dbusdcBalance: dbusdcBalance.toString(),
    deepBalance: deepBalance.toString(),
    suiBalanceMist: String(suiBalance.totalBalance ?? '0'),
    executionEnabled,
    requiredDbusdcBalance: proposed.amount,
    requiredDeepBalance: '1',
    requiredSuiGasMist: '1',
  })
  return fundingReadinessBlock(funding)
}

/**
 * Full tick with chain reads + gated execution.
 * @param {object} env worker env (AGENT_KEY, EXECUTION_ENABLED, DEMO_MODE)
 * @param {object} p { wrapperId, forceTrigger, nowMs, market }
 */
export async function runTick(env, p) {
  const client = (await import('./sui-tx.js')).getClient()
  const nowMs = p.nowMs ?? await readClockTimestampMs(client) ?? Date.now()
  const wrapper = await readWrapper(client, p.wrapperId)
  if (!wrapper) return { action: 'error', code: 'WRAPPER_NOT_FOUND', detail: 'Wrapper not found on-chain.', execution_claimed: false }
  const mandate = await readMandate(client, wrapper.mandate_id)
  if (!mandate) return { action: 'error', code: 'MANDATE_NOT_FOUND', detail: 'Mandate not found on-chain.', execution_claimed: false }

  // Trigger: force_trigger (demo) or a real price-drop evaluation supplied by the caller.
  const triggerMet = !!p.forceTrigger || !!(p.market && p.market.triggerMet)
  const amount = perTradeAmount(wrapper)
  const proposed = {
    pool_id: wrapper.pool_id,
    amount: amount.toString(),
    estimated_slippage_bps: p.market?.estimated_slippage_bps ?? Math.min(80, wrapper.max_slippage_bps),
  }
  const executionEnabled = env?.EXECUTION_ENABLED === 'true' && !!env?.AGENT_KEY

  const expectedPoolId = DEPLOYMENT.deepbook.pools[DEPLOYMENT.deepbook.default_pool]?.pool_id
  const decision = decideTick({ wrapper, mandate, triggerMet, proposed, nowMs, executionEnabled, expectedAgentId: DEPLOYMENT.agent.address, expectedPoolId })
  if (decision.action !== 'execute') return { ...decision, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }

  const fundingBlock = await checkFunding(client, proposed, executionEnabled)
  if (fundingBlock) {
    return { action: 'blocked', ...fundingBlock, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }
  }

  // execute: build + sign + submit (only reached when executionEnabled)
  try {
    const kp = keypairFromWorkerEnv(env)
    const pool = Object.values(DEPLOYMENT.deepbook.pools).find((x) => x.pool_id === wrapper.pool_id)
    const tx = buildExecutionTx({
      wrapperId: p.wrapperId, mandateId: wrapper.mandate_id,
      balanceManagerId: DEPLOYMENT.agent.balance_manager_id,
      pool, quoteAmount: proposed.amount, baseReceived: p.market?.baseReceived ?? '0',
      price: p.market?.price ?? '0', quantity: p.market?.quantity ?? '0',
      slippageBps: proposed.estimated_slippage_bps, clientOrderId: nowMs, expireMs: nowMs + 3600_000,
    })
    const submitted = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true, showEvents: true } })
    if (!submitted.digest) {
      return {
        ...executionNonSuccess({
          detail: 'Execution submission did not return a transaction digest; no success is claimed.',
          submitted: false,
        }),
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }

    let resolved = submitted
    try {
      if (typeof client.waitForTransaction === 'function') {
        resolved = await client.waitForTransaction({
          digest: submitted.digest,
          options: { showEffects: true, showEvents: true },
        })
      }
    } catch (e) {
      return {
        ...executionNonSuccess({
          detail: `Execution remains unresolved: Sui RPC did not resolve digest ${submitted.digest}. ${String(e?.message || e)}`,
          digest: submitted.digest,
          submitted: true,
        }),
        wrapper_id: p.wrapperId,
        mandate_id: wrapper.mandate_id,
      }
    }

    let afterWrapper = null
    try {
      afterWrapper = await readWrapper(client, p.wrapperId)
    } catch {
      afterWrapper = null
    }
    const result = classifyExecutionResolution({
      submitted,
      resolved,
      beforeWrapper: wrapper,
      afterWrapper,
      wrapperId: p.wrapperId,
    })
    return { ...result, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }
  } catch (e) {
    return {
      ...executionNonSuccess({
        detail: `Execution submission error: ${String(e?.message || e)}`,
        submitted: false,
      }),
      wrapper_id: p.wrapperId,
      mandate_id: wrapper.mandate_id,
    }
  }
}
