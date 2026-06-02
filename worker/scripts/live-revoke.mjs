// Broadcast a REAL revoke_policy on testnet (agent-as-owner), proving the
// owner revocation path. Usage: node scripts/live-revoke.mjs <wrapperId> <mandateId>
import { buildRevokeTx, getClient } from '../src/sui-tx.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

const [, , wrapperId, mandateId] = process.argv
if (!wrapperId || !mandateId) { console.error('usage: live-revoke.mjs <wrapperId> <mandateId>'); process.exit(2) }
const kp = loadAgentKeypairFromDevVars()
const owner = kp.getPublicKey().toSuiAddress()
const client = getClient()

const tx = buildRevokeTx({ wrapperId, mandateId, ownerAddress: owner })
const res = await client.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showEvents: true, showEffects: true } })
console.log('status:', res.effects?.status?.status, '| digest:', res.digest)
const ev = (res.events || []).find(e => String(e.type).endsWith('::PolicyRevoked'))
console.log('PolicyRevoked emitted:', !!ev)
process.exit(res.effects?.status?.status === 'success' ? 0 : 1)
