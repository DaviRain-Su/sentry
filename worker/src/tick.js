// E7 — agent tick. decideTick() is the pure state-machine core (docs §8);
// runTick() adds chain I/O + (gated) execution. Allowed actions (docs §7):
// no_op | blocked | executed | stopped_revoked | stopped_expired | error.
import { runGuardian } from './guardian.js'
import { readWrapper, readMandate, readBalanceManagerBalance } from './chain.js'
import { buildExecutionTx } from './deepbook.js'
import { DEPLOYMENT } from './sui-tx.js'
import { keypairFromWorkerEnv } from './secret-safe-signer.js'

/**
 * Pure decision. No I/O.
 * @param {object} a
 * @param {{mandate_id:string,pool_id:string,budget_ceiling:string,spent_amount:string,max_slippage_bps:number}} a.wrapper
 * @param {{id:string,revoked:boolean,expires_at_ms:number|string}} a.mandate
 * @param {boolean} a.triggerMet
 * @param {{pool_id:string,amount:string,estimated_slippage_bps:number}} a.proposed
 * @param {number} a.nowMs
 * @param {boolean} a.executionEnabled
 * @returns {{action:string, reason?:number, detail:string, guardian?:object}}
 */
export function decideTick({ wrapper, mandate, triggerMet, proposed, nowMs, executionEnabled }) {
  if (mandate.revoked) return { action: 'stopped_revoked', detail: 'Mandate revoked on-chain; halting.' }
  if (nowMs >= Number(mandate.expires_at_ms)) return { action: 'stopped_expired', detail: 'Mandate expired; halting.' }
  if (!triggerMet) return { action: 'no_op', detail: 'Trigger condition not met; monitoring.' }

  const guardian = runGuardian({ mandate, wrapper, proposed, nowMs })
  if (guardian.decision === 'block') {
    return { action: 'blocked', reason: guardian.reason, detail: `Guardian blocked: ${guardian.label} — ${guardian.detail}`, guardian }
  }
  if (!executionEnabled) {
    return {
      action: 'blocked',
      code: 'EXECUTION_DISABLED',
      detail: 'Execution blocked: EXECUTION_ENABLED is false or the agent key is unavailable; usable DBUSDC/DEEP funding must be verified before live execution.',
      guardian,
    }
  }
  return { action: 'execute', detail: 'Trigger met + Guardian passed; executing rescue order.', guardian }
}

/** Per-trade amount: one rung = budget/5, capped at remaining budget. */
function perTradeAmount(wrapper) {
  const ceiling = BigInt(wrapper.budget_ceiling)
  const spent = BigInt(wrapper.spent_amount)
  const remaining = ceiling > spent ? ceiling - spent : 0n
  const rung = ceiling / 5n
  return (rung < remaining ? rung : remaining)
}

async function checkFunding(client, proposed) {
  const [dbusdcBalance, deepBalance] = await Promise.all([
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.dbusdc_coin_type),
    readBalanceManagerBalance(client, DEPLOYMENT.deepbook.deep_coin_type),
  ])
  const dbusdcRequired = BigInt(proposed.amount)
  if (dbusdcBalance < dbusdcRequired) {
    return {
      code: 'INSUFFICIENT_DBUSDC',
      detail: `Execution blocked: BalanceManager DBUSDC ${dbusdcBalance.toString()} is below required ${dbusdcRequired.toString()}.`,
      balances: { dbusdc: dbusdcBalance.toString(), deep: deepBalance.toString(), dbusdc_required: dbusdcRequired.toString(), deep_required: '>0' },
    }
  }
  if (deepBalance <= 0n) {
    return {
      code: 'INSUFFICIENT_DEEP',
      detail: 'Execution blocked: BalanceManager DEEP fee balance is zero.',
      balances: { dbusdc: dbusdcBalance.toString(), deep: deepBalance.toString(), dbusdc_required: dbusdcRequired.toString(), deep_required: '>0' },
    }
  }
  return null
}

/**
 * Full tick with chain reads + gated execution.
 * @param {object} env worker env (AGENT_KEY, EXECUTION_ENABLED, DEMO_MODE)
 * @param {object} p { wrapperId, forceTrigger, nowMs, market }
 */
export async function runTick(env, p) {
  const client = (await import('./sui-tx.js')).getClient()
  const nowMs = p.nowMs ?? Date.now()
  const wrapper = await readWrapper(client, p.wrapperId)
  if (!wrapper) return { action: 'error', detail: 'Wrapper not found on-chain.' }
  const mandate = await readMandate(client, wrapper.mandate_id)
  if (!mandate) return { action: 'error', detail: 'Mandate not found on-chain.' }

  // Trigger: force_trigger (demo) or a real price-drop evaluation supplied by the caller.
  const triggerMet = !!p.forceTrigger || !!(p.market && p.market.triggerMet)
  const amount = perTradeAmount(wrapper)
  const proposed = {
    pool_id: wrapper.pool_id,
    amount: amount.toString(),
    estimated_slippage_bps: p.market?.estimated_slippage_bps ?? Math.min(80, wrapper.max_slippage_bps),
  }
  const executionEnabled = env?.EXECUTION_ENABLED === 'true' && !!env?.AGENT_KEY

  const decision = decideTick({ wrapper, mandate, triggerMet, proposed, nowMs, executionEnabled })
  if (decision.action !== 'execute') return { ...decision, wrapper_id: p.wrapperId, mandate_id: wrapper.mandate_id }

  const fundingBlock = await checkFunding(client, proposed)
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
    const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEffects: true } })
    const ok = res.effects?.status?.status === 'success'
    return { action: ok ? 'executed' : 'error', detail: ok ? 'Rescue order executed.' : `Execution failed: ${res.effects?.status?.error}`, tx_digest: res.digest, wrapper_id: p.wrapperId }
  } catch (e) {
    return { action: 'error', detail: `Execution error: ${String(e?.message || e)}`, wrapper_id: p.wrapperId }
  }
}
