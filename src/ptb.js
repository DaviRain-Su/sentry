// Frontend (v2 SDK) owner-signed PTB builders. Mirrors the worker's builders
// but uses the frontend's @mysten/sui v2 Transaction (so dapp-kit can sign it).
// Shared inputs come from core/deployment; the SDK-version glue is per-runtime.
import { Transaction } from '@mysten/sui/transactions'
import deployment from '../core/deployment.js'

const MG = deployment.movegate
const RG = deployment.rescuegrid

function hexToBytes(hex) {
  const h = hex.replace(/^0x/, '')
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}

/** Owner-signed create_policy<BudgetCoin>. */
export function buildCreatePolicyTx({ strategy, ownerAddress }) {
  const tx = new Transaction()
  tx.setSender(ownerAddress)
  const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(MG.creation_fee_mist))])
  tx.moveCall({
    target: `${RG.package_id}::policy::create_policy`,
    typeArguments: [strategy.budget_coin_type],
    arguments: [
      tx.object(MG.mandate_registry), tx.object(MG.agent_registry), tx.object(deployment.agent.passport_id),
      tx.object(MG.protocol_treasury), tx.object(MG.fee_config), tx.pure.address(strategy.agent),
      tx.pure.u64(BigInt(strategy.execution.max_single_trade_amount)), tx.pure.u64(BigInt(strategy.budget_ceiling)),
      tx.pure.u64(BigInt(strategy.expires_at_ms)), tx.pure.id(strategy.pool_id), tx.pure.string(strategy.budget_coin_type),
      tx.pure.u16(strategy.execution.max_slippage_bps), tx.pure.vector('u8', Array.from(hexToBytes(strategy.strategy_hash))),
      payment, tx.object('0x6'),
    ],
  })
  tx.transferObjects([payment], tx.pure.address(ownerAddress))
  return tx
}

/** Owner-signed revoke_policy. */
export function buildRevokeTx({ wrapperId, mandateId, ownerAddress }) {
  const tx = new Transaction()
  tx.setSender(ownerAddress)
  tx.moveCall({
    target: `${RG.package_id}::policy::revoke_policy`,
    arguments: [tx.object(wrapperId), tx.object(mandateId), tx.object(MG.mandate_registry), tx.object(deployment.agent.passport_id), tx.object('0x6')],
  })
  return tx
}
