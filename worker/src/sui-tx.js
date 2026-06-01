// E3 — build the create_policy PTB (signer-agnostic). The Worker serializes
// the unsigned tx for the frontend (zkLogin) to sign; the same builder is used
// by the on-chain verification script with a stand-in key.
import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import deployment from '../../deployment.testnet.json' with { type: 'json' }

export const DEPLOYMENT = deployment
const MG = deployment.movegate
const RG = deployment.rescuegrid

export function getClient() {
  return new SuiClient({ url: deployment.rpc || getFullnodeUrl('testnet') })
}

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '')
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}

/**
 * Build the create_policy<BudgetCoin> transaction.
 * sender = owner (creation tx is owner-signed); the creation fee is split from
 * the owner's gas coin and the remainder returned to the owner.
 */
export function buildCreatePolicyTx({ strategy, ownerAddress }) {
  const tx = new Transaction()
  tx.setSender(ownerAddress)

  const fee = BigInt(MG.creation_fee_mist)
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(fee)])

  tx.moveCall({
    target: `${RG.package_id}::policy::create_policy`,
    typeArguments: [strategy.budget_coin_type],
    arguments: [
      tx.object(MG.mandate_registry),
      tx.object(MG.agent_registry),
      tx.object(deployment.agent.passport_id),
      tx.object(MG.protocol_treasury),
      tx.object(MG.fee_config),
      tx.pure.address(strategy.agent),
      tx.pure.u64(BigInt(strategy.execution.max_single_trade_amount)),
      tx.pure.u64(BigInt(strategy.budget_ceiling)),
      tx.pure.u64(BigInt(strategy.expires_at_ms)),
      tx.pure.id(strategy.pool_id),
      tx.pure.string(strategy.budget_coin_type),
      tx.pure.u16(strategy.execution.max_slippage_bps),
      tx.pure.vector('u8', Array.from(hexToBytes(strategy.strategy_hash))),
      payment,
      tx.object('0x6'),
    ],
  })

  // return the (partially spent) fee coin to the owner
  tx.transferObjects([payment], tx.pure.address(ownerAddress))
  return tx
}

/** Extract mandate_id + wrapper_id from the PolicyCreated event. */
export function readPolicyCreated(effectsOrEvents) {
  const events = effectsOrEvents.events || effectsOrEvents
  const ev = (events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
  if (!ev) return null
  return { mandate_id: ev.parsedJson.mandate_id, wrapper_id: ev.parsedJson.wrapper_id }
}
