// Broadcast a REAL create_policy on testnet, signed by the dedicated agent key
// (agent doubles as owner for this verification — the contract allows it).
// Proves the live write path end-to-end: mint Mandate + RescuePolicyWrapper,
// emit PolicyCreated. No DBUSDC needed (only the ~0.01 SUI MoveGate fee).
//   node scripts/live-create-policy.mjs
import { strategyHash } from '../src/strategy-core.js'
import { buildCreatePolicyTx, getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

const kp = loadAgentKeypairFromDevVars()
const owner = kp.getPublicKey().toSuiAddress()
const client = getClient()

const nowMs = Date.now()
const strategy = {
  version: '1', strategy_type: 'risk_response', owner, agent: DEPLOYMENT.agent.address,
  chain: 'sui:testnet', pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
  budget_ceiling: '50000000',
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '10000000' },
  expires_at_ms: nowMs + 6 * 86_400_000,
}
strategy.strategy_hash = strategyHash(strategy)
console.log('owner=agent:', owner)
console.log('strategy_hash:', strategy.strategy_hash)

const tx = buildCreatePolicyTx({ strategy, ownerAddress: owner })
const res = await client.signAndExecuteTransaction({
  signer: kp, transaction: tx,
  options: { showEvents: true, showEffects: true, showObjectChanges: true },
})
console.log('status:', res.effects?.status?.status, '| digest:', res.digest)
console.log('PolicyCreated:', readPolicyCreated(res))
const w = (res.objectChanges || []).find(o => o.objectType?.endsWith('::policy::RescuePolicyWrapper'))
console.log('wrapper object id:', w?.objectId)
process.exit(res.effects?.status?.status === 'success' ? 0 : 1)
