// E6 — Guardian. Pure decision function over a MoveGate Mandate snapshot, a
// SentryPolicyWrapper snapshot, and a proposed trade. Mirrors docs §9 ordering
// and §4 reason codes. Chain is the final authority; this is the off-chain
// pre-check that mirrors the on-chain asserts so the agent never submits a
// doomed tx.

export const GUARDIAN_REASON = {
  SLIPPAGE: 1,
  BUDGET: 2,
  EXPIRED: 3,
  REVOKED: 4,
  POOL_MISMATCH: 5,
  CONCENTRATION: 6,
  MANDATE_MISMATCH: 7,
  AGENT_MISMATCH: 8,
};

export const GUARDIAN_BLOCKER_CODE = {
  [GUARDIAN_REASON.SLIPPAGE]: 'OVER_SLIPPAGE',
  [GUARDIAN_REASON.BUDGET]: 'OVER_BUDGET',
  [GUARDIAN_REASON.EXPIRED]: 'POLICY_EXPIRED',
  [GUARDIAN_REASON.REVOKED]: 'POLICY_REVOKED',
  [GUARDIAN_REASON.POOL_MISMATCH]: 'WRONG_POOL',
  [GUARDIAN_REASON.MANDATE_MISMATCH]: 'MANDATE_MISMATCH',
  [GUARDIAN_REASON.AGENT_MISMATCH]: 'WRONG_AGENT',
};

/**
 * @param {object} a
 * @param {{id:string, revoked:boolean, expires_at_ms:number|string, agent?:string}} a.mandate
 * @param {{mandate_id:string, pool_id:string, budget_ceiling:string, spent_amount:string, max_slippage_bps:number, agent?:string}} a.wrapper
 * @param {{pool_id:string, amount:string, estimated_slippage_bps:number, agent_id?:string}} a.proposed
 * @param {number} a.nowMs
 * @returns {{decision:'allow'|'block', reason?:number, code?:string, label:string, detail:string, remaining:string, concentration_pct?:number, warnings?:object[]}}
 */
export function runGuardian({ mandate, wrapper, proposed, nowMs }) {
  const ceiling = BigInt(wrapper.budget_ceiling);
  const spent = BigInt(wrapper.spent_amount);
  const remaining = ceiling > spent ? ceiling - spent : 0n;
  const amount = BigInt(proposed.amount);
  const expires = Number(mandate.expires_at_ms);

  const block = (reason, label, detail) => ({
    decision: 'block',
    reason,
    code: GUARDIAN_BLOCKER_CODE[reason],
    label,
    detail,
    remaining: remaining.toString(),
  });

  // Order per docs §9 pseudocode.
  if (wrapper.mandate_id !== mandate.id)
    return block(
      GUARDIAN_REASON.MANDATE_MISMATCH,
      'Mandate/wrapper mismatch',
      'wrapper.mandate_id != mandate.id'
    );
  if (wrapper.agent && mandate.agent && wrapper.agent !== mandate.agent)
    return block(
      GUARDIAN_REASON.AGENT_MISMATCH,
      'Agent mismatch',
      'wrapper.agent != mandate.agent'
    );
  if (proposed.agent_id && wrapper.agent && proposed.agent_id !== wrapper.agent)
    return block(
      GUARDIAN_REASON.AGENT_MISMATCH,
      'Agent mismatch',
      'proposed agent is outside policy scope'
    );
  if (proposed.agent_id && mandate.agent && proposed.agent_id !== mandate.agent)
    return block(
      GUARDIAN_REASON.AGENT_MISMATCH,
      'Agent mismatch',
      'proposed agent is outside mandate scope'
    );
  if (mandate.revoked)
    return block(
      GUARDIAN_REASON.REVOKED,
      'Mandate revoked',
      'Policy authority has been revoked on-chain.'
    );
  if (nowMs >= expires)
    return block(GUARDIAN_REASON.EXPIRED, 'Mandate expired', 'Policy expiry reached.');
  if (remaining <= 0n)
    return block(GUARDIAN_REASON.BUDGET, 'Budget exhausted', 'No remaining budget.');
  if (amount > remaining)
    return block(
      GUARDIAN_REASON.BUDGET,
      'Budget would exceed ceiling',
      `amount ${amount} > remaining ${remaining}`
    );
  if (proposed.estimated_slippage_bps > wrapper.max_slippage_bps)
    return block(
      GUARDIAN_REASON.SLIPPAGE,
      'Slippage exceeds max',
      `${proposed.estimated_slippage_bps}bps > ${wrapper.max_slippage_bps}bps cap`
    );
  if (proposed.pool_id !== wrapper.pool_id)
    return block(
      GUARDIAN_REASON.POOL_MISMATCH,
      'Pool mismatch',
      'Proposed pool not in policy scope.'
    );

  // Concentration score for the UI — advisory, not a block in MVP.
  const usedPct = ceiling > 0n ? Number(((spent + amount) * 100n) / ceiling) : 0;
  const warnings = [];
  if (usedPct >= 80) {
    warnings.push({
      reason: GUARDIAN_REASON.CONCENTRATION,
      level: 'warn',
      label: 'Capital concentration',
      detail: `${usedPct}% of budget committed after this trade.`,
    });
  }
  return {
    decision: 'allow',
    label: 'Allowed',
    detail: 'All checks passed.',
    remaining: remaining.toString(),
    concentration_pct: usedPct,
    warnings,
  };
}
