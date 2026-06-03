// Proof of the E3 create_policy PTB builder via DRY-RUN (no key, no broadcast).
// Builds the strategy + tx exactly as the Worker does, then dry-runs it against
// testnet to confirm it is well-formed and would succeed (PolicyCreated emitted,
// SentryPolicyWrapper created). The real signature is the frontend's zkLogin.
//
//   RG_OWNER=<owner address with gas> node test/verify-create-policy.mjs
import { strategyHash } from '../src/strategy-core.js'
import { buildCreatePolicyTx, getClient, DEPLOYMENT } from '../src/sui-tx.js'

const owner = process.env.RG_OWNER || DEPLOYMENT.agent.address
console.log('owner (sender, owner=agent for this test):', owner)

// MVP test: owner doubles as agent (deployment.agent.address). Build a small
// 50-USDC risk_response strategy on the SUI_DBUSDC pool.
const nowMs = Date.now()
const strategy = {
  version: '1',
  strategy_type: 'risk_response',
  owner,
  agent: DEPLOYMENT.agent.address,
  chain: 'sui:testnet',
  pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
  budget_ceiling: '50000000',          // 50 DBUSDC (6dp)
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '10000000' },
  expires_at_ms: nowMs + 86_400_000,
}
const hash = strategyHash(strategy)
strategy.strategy_hash = hash // carried into the wrapper
console.log('strategy_hash:', hash)

const client = getClient()
const tx = buildCreatePolicyTx({ strategy, ownerAddress: owner })
const bytes = await tx.build({ client })

const res = await client.dryRunTransactionBlock({ transactionBlock: bytes })
const status = res.effects?.status?.status
console.log('dry-run status:', status)
if (status !== 'success') console.log('error:', JSON.stringify(res.effects?.status))
const ev = (res.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
console.log('PolicyCreated emitted:', !!ev, ev ? { mandate_id: ev.parsedJson.mandate_id, wrapper_id: ev.parsedJson.wrapper_id } : '')
const wrapper = (res.objectChanges || []).find(
  (o) => o.objectType && o.objectType.endsWith('::policy::SentryPolicyWrapper'),
)
console.log('SentryPolicyWrapper created:', wrapper?.objectType ? 'yes' : 'no')
const gas = res.effects?.gasUsed
if (gas) console.log('gas (computation+storage):', Number(gas.computationCost) + Number(gas.storageCost), 'MIST')
process.exit(status === 'success' ? 0 : 1)
