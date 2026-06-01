// On-chain proof of the E3 create_policy PTB builder.
// Builds the strategy + tx exactly as the Worker does, signs with a stand-in
// ed25519 key (passed via RG_OWNER_KEY, a `suiprivkey1...` bech32 string),
// submits to testnet, and reads the PolicyCreated event.
//
//   KEY=$(sui keytool export --key-identity <addr> --json | jq -r '...')
//   RG_OWNER_KEY=$KEY node test/verify-create-policy.mjs
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { strategyHash } from '../src/strategy-core.js'
import { buildCreatePolicyTx, getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'

const bech32 = process.env.RG_OWNER_KEY
if (!bech32) { console.error('set RG_OWNER_KEY (suiprivkey1...)'); process.exit(2) }
const { secretKey } = decodeSuiPrivateKey(bech32)
const kp = Ed25519Keypair.fromSecretKey(secretKey)
const owner = kp.getPublicKey().toSuiAddress()
console.log('signer (owner=agent for this test):', owner)

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

const res = await client.signAndExecuteTransaction({
  signer: kp,
  transaction: tx,
  options: { showEvents: true, showEffects: true, showObjectChanges: true },
})
console.log('digest:', res.digest)
console.log('status:', res.effects?.status?.status)
const created = readPolicyCreated(res)
console.log('PolicyCreated:', created)
const wrapperObj = (res.objectChanges || []).find(
  (o) => o.objectType && o.objectType.endsWith('::policy::RescuePolicyWrapper'),
)
console.log('wrapper object:', wrapperObj?.objectId, wrapperObj?.objectType)
process.exit(res.effects?.status?.status === 'success' ? 0 : 1)
