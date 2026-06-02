// E6 — Guardian unit tests (docs §9 ordering + §4 reason codes).
import { runGuardian, GUARDIAN_BLOCKER_CODE as C, GUARDIAN_REASON as R } from '../src/guardian.js'

let fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got}, want ${want})`}`)
}

const MID = '0xMANDATE'
const POOL = '0xPOOL'
const AGENT = '0xAGENT'
const base = {
  mandate: { id: MID, agent: AGENT, revoked: false, expires_at_ms: 10_000 },
  wrapper: { mandate_id: MID, agent: AGENT, pool_id: POOL, budget_ceiling: '1000000', spent_amount: '0', max_slippage_bps: 100 },
  proposed: { pool_id: POOL, amount: '100000', estimated_slippage_bps: 50 },
  nowMs: 1_000,
}
const run = (over) => runGuardian({ ...base, ...over, mandate: { ...base.mandate, ...(over?.mandate) }, wrapper: { ...base.wrapper, ...(over?.wrapper) }, proposed: { ...base.proposed, ...(over?.proposed) } })

check('healthy -> allow', run().decision, 'allow')
check('mandate/wrapper mismatch -> 7', run({ wrapper: { mandate_id: '0xOTHER' } }).reason, R.MANDATE_MISMATCH)
check('mandate/wrapper mismatch code stable', run({ wrapper: { mandate_id: '0xOTHER' } }).code, C[R.MANDATE_MISMATCH])
check('agent mismatch -> 8', run({ wrapper: { agent: '0xOTHER' } }).reason, R.AGENT_MISMATCH)
check('agent mismatch code stable', run({ wrapper: { agent: '0xOTHER' } }).code, C[R.AGENT_MISMATCH])
check('proposed wrong agent -> 8', run({ proposed: { agent_id: '0xOTHER' } }).reason, R.AGENT_MISMATCH)
check('proposed wrong agent code stable', run({ proposed: { agent_id: '0xOTHER' } }).code, C[R.AGENT_MISMATCH])
check('revoked -> 4', run({ mandate: { revoked: true } }).reason, R.REVOKED)
check('revoked code stable', run({ mandate: { revoked: true } }).code, C[R.REVOKED])
check('expired -> 3', run({ nowMs: 20_000 }).reason, R.EXPIRED)
check('expired code stable', run({ nowMs: 20_000 }).code, C[R.EXPIRED])
check('budget exhausted -> 2', run({ wrapper: { spent_amount: '1000000' } }).reason, R.BUDGET)
check('amount over remaining -> 2', run({ proposed: { amount: '2000000' } }).reason, R.BUDGET)
check('budget code stable', run({ proposed: { amount: '2000000' } }).code, C[R.BUDGET])
check('slippage over cap -> 1', run({ proposed: { estimated_slippage_bps: 150 } }).reason, R.SLIPPAGE)
check('slippage code stable', run({ proposed: { estimated_slippage_bps: 150 } }).code, C[R.SLIPPAGE])
check('pool mismatch -> 5', run({ proposed: { pool_id: '0xBAD' } }).reason, R.POOL_MISMATCH)
check('pool mismatch code stable', run({ proposed: { pool_id: '0xBAD' } }).code, C[R.POOL_MISMATCH])

// ordering: revoked takes precedence over expired
check('revoked beats expired (order)', run({ mandate: { revoked: true }, nowMs: 20_000 }).reason, R.REVOKED)

// concentration warning on a large-but-allowed trade
const conc = run({ wrapper: { spent_amount: '850000' }, proposed: { amount: '100000' } })
check('concentration -> still allow', conc.decision, 'allow')
check('concentration warning present', conc.warnings?.[0]?.reason, R.CONCENTRATION)

console.log(fail === 0 ? '\nALL GUARDIAN TESTS PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
