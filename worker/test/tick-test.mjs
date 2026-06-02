// E7 — decideTick state-machine unit tests (docs §8 / §7 actions).
import { buildFundingReadiness } from '../src/read-surfaces.js'
import { decideTick, fundingReadinessBlock } from '../src/tick.js'

let fail = 0
const check = (name, got, want) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${got}, want ${want})`}`)
}

const MID = '0xMANDATE'
const OWNER = '0x1111111111111111111111111111111111111111111111111111111111111111'
const base = {
  wrapper: { mandate_id: MID, pool_id: '0xPOOL', budget_ceiling: '1000000', spent_amount: '0', max_slippage_bps: 100 },
  mandate: { id: MID, revoked: false, expires_at_ms: 10_000 },
  triggerMet: true,
  proposed: { pool_id: '0xPOOL', amount: '100000', estimated_slippage_bps: 50 },
  nowMs: 1_000,
  executionEnabled: true,
}
const run = (o) => decideTick({ ...base, ...o })

check('revoked -> stopped_revoked', run({ mandate: { id: MID, revoked: true, expires_at_ms: 10_000 } }).action, 'stopped_revoked')
check('expired -> stopped_expired', run({ nowMs: 20_000 }).action, 'stopped_expired')
check('no trigger -> no_op', run({ triggerMet: false }).action, 'no_op')
check('guardian block -> blocked', run({ proposed: { pool_id: '0xPOOL', amount: '100000', estimated_slippage_bps: 150 } }).action, 'blocked')
check('trigger+pass+enabled -> execute', run({}).action, 'execute')
const disabled = run({ executionEnabled: false })
check('trigger+pass+disabled -> blocked (gated)', disabled.action, 'blocked')
check('disabled gate uses stable code', disabled.code, 'EXECUTION_DISABLED')
// precedence: revoked before trigger/execute
check('revoked beats execute', run({ mandate: { id: MID, revoked: true, expires_at_ms: 10_000 }, executionEnabled: true }).action, 'stopped_revoked')

const unfundedDisabled = fundingReadinessBlock(buildFundingReadiness({
  agentAddress: OWNER,
  balanceManagerId: '0xBALANCEMANAGER',
  dbusdcBalance: '0',
  deepBalance: '0',
  suiBalanceMist: '1000000',
  executionEnabled: false,
  requiredDbusdcBalance: '100000',
  requiredDeepBalance: '1',
  requiredSuiGasMist: '1',
}))
check('funding block prefers missing DBUSDC as primary blocker', unfundedDisabled.code, 'INSUFFICIENT_DBUSDC')
check('funding block includes disabled flag', unfundedDisabled.blocker_codes.includes('EXECUTION_DISABLED'), true)
check('funding block includes missing DEEP', unfundedDisabled.blocker_codes.includes('INSUFFICIENT_DEEP'), true)
check('funding block never claims execution', unfundedDisabled.execution_claimed, false)

console.log(fail === 0 ? '\nALL TICK TESTS PASS' : `\n${fail} FAILED`)
process.exit(fail === 0 ? 0 : 1)
