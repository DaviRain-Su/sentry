import assert from 'node:assert/strict'
import {
  buildFundingReadiness,
  bytesToHex,
  enrichPolicyFromChain,
  parseIntentWithStability,
} from '../src/read-surfaces.js'

const OWNER = '0x1111111111111111111111111111111111111111111111111111111111111111'

{
  const cache = new Map()
  const parseFn = (_text, owner, _defaults, nowMs) => ({
    status: 'ok',
    strategy: { owner, expires_at_ms: nowMs + 86_400_000 },
    strategy_hash: `hash-${nowMs}`,
  })
  const first = parseIntentWithStability(parseFn, cache, { owner: OWNER, text: 'Rescue SUI if it drops 8%, 500 USDC budget' }, 1_000)
  const second = parseIntentWithStability(parseFn, cache, { owner: OWNER, text: 'Rescue SUI if it drops 8%, 500 USDC budget' }, 2_000)
  assert.equal(second.strategy_hash, first.strategy_hash, 'identical parse requests reuse the cached stable strategy_hash')
  assert.deepEqual(second.strategy, first.strategy, 'identical parse requests reuse canonical strategy data')
}

assert.equal(
  bytesToHex([71, 119, 41, 70, 208, 54, 46, 86, 227, 142, 213, 65, 145, 1, 212, 45, 167, 78, 53, 79, 75, 28, 201, 182, 238, 81, 231, 34, 223, 119, 221, 240]),
  '0x47772946d0362e56e38ed5419101d42da74e354f4b1cc9b6ee51e722df77ddf0',
  'Move vector<u8> strategy_hash serializes as 0x hex',
)

{
  const policy = enrichPolicyFromChain({
    eventPolicy: { wrapper_id: '0xwrap', mandate_id: '0xmandate', owner: OWNER, agent: OWNER, pool_id: '0xpool', budget_ceiling: '50000000', max_slippage_bps: 100, expires_at_ms: '9000' },
    wrapper: { wrapper_id: '0xwrap', mandate_id: '0xmandate', owner: OWNER, agent: OWNER, pool_id: '0xpool', budget_coin_type: 'coin', budget_ceiling: '50000000', spent_amount: '0', max_slippage_bps: 100, strategy_hash: '0xabc' },
    mandate: { id: '0xmandate', owner: OWNER, agent: OWNER, revoked: true, expires_at_ms: '9000' },
    createdTx: 'digest',
    nowMs: 1_000,
  })
  assert.equal(policy.spent_amount, '0')
  assert.equal(policy.strategy_hash, '0xabc')
  assert.equal(policy.revoked, true)
  assert.equal(policy.status, 'revoked')
  assert.equal(policy.runtime_state, 'Revoked')
}

{
  const readiness = buildFundingReadiness({
    agentAddress: OWNER,
    balanceManagerId: '0xbm',
    dbusdcBalance: '0',
    deepBalance: '0',
    suiBalanceMist: '123',
    executionEnabled: false,
  })
  assert.equal(readiness.readiness_state, 'blocked')
  assert.equal(readiness.ready, false)
  assert.deepEqual(readiness.blocker_codes, ['EXECUTION_DISABLED', 'INSUFFICIENT_DBUSDC', 'INSUFFICIENT_DEEP'])
  assert.equal(readiness.balances.DBUSDC, '0')
  assert.equal(readiness.balances.DEEP, '0')
  assert.equal(readiness.balances.SUI_MIST, '123')
}

console.log('\nALL READ SURFACE TESTS PASS')
