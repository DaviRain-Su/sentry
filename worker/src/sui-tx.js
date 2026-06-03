// Worker-side (v1 SDK) Sui client + PTB builders. The PURE inputs come from the
// shared core (deployment constants); the Transaction building is SDK-version
// specific (worker = @mysten/sui v1) so it lives here, not in core/.
import { Transaction } from '@mysten/sui/transactions'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import deployment from './deployment.js'

export const DEPLOYMENT = deployment
const MG = deployment.movegate
const RG = deployment.sentry
const DB = deployment.deepbook
const DEEP_TYPE = DB.deep_coin_type
const ORDER_TYPE_NO_RESTRICTION = 0
const SELF_MATCHING_ALLOWED = 0

export function getClient() {
  return new SuiClient({ url: deployment.rpc || getFullnodeUrl('testnet') })
}

function hexToBytes(hex) {
  if (typeof hex !== 'string') throw new TypeError('hexToBytes expects a string')
  const h = hex.replace(/^0x/, '')
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error('Invalid hex string: contains non-hex characters')
  if (h.length % 2 !== 0) throw new Error('Invalid hex string: odd length')
  const a = new Uint8Array(h.length / 2)
  for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16)
  return a
}

export function readPolicyCreated(effectsOrEvents) {
  const events = effectsOrEvents.events || effectsOrEvents
  const ev = (events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
  if (!ev) return null
  return { mandate_id: ev.parsedJson.mandate_id, wrapper_id: ev.parsedJson.wrapper_id }
}

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

export function buildRevokeTx({ wrapperId, mandateId, ownerAddress }) {
  const tx = new Transaction()
  tx.setSender(ownerAddress)
  tx.moveCall({
    target: `${RG.package_id}::policy::revoke_policy`,
    arguments: [tx.object(wrapperId), tx.object(mandateId), tx.object(MG.mandate_registry), tx.object(deployment.agent.passport_id), tx.object('0x6')],
  })
  return tx
}

export function buildAgentSetupTx({ suiInMist, agentAddress }) {
  const tx = new Transaction()
  const pool = DB.pools.SUI_DBUSDC
  const [suiIn] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(suiInMist))])
  const [deepZero] = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEP_TYPE] })
  const [baseLeft, dbusdc, deepLeft] = tx.moveCall({
    target: `${DB.package_id}::pool::swap_exact_base_for_quote`,
    typeArguments: [pool.base, DB.dbusdc_coin_type],
    arguments: [tx.object(pool.pool_id), suiIn, deepZero, tx.pure.u64(0n), tx.object('0x6')],
  })
  const [bm] = tx.moveCall({ target: `${DB.package_id}::balance_manager::new` })
  tx.moveCall({ target: `${DB.package_id}::balance_manager::deposit`, typeArguments: [DB.dbusdc_coin_type], arguments: [bm, dbusdc] })
  tx.moveCall({ target: '0x2::transfer::public_share_object', typeArguments: [`${DB.package_id}::balance_manager::BalanceManager`], arguments: [bm] })
  tx.transferObjects([baseLeft, deepLeft], tx.pure.address(agentAddress))
  return tx
}

export function buildExecutionTx(a) {
  const tx = new Transaction()
  const quote = BigInt(a.quoteAmount)
  const [authToken] = tx.moveCall({
    target: `${MG.published_at}::mandate::authorize_action`,
    typeArguments: [DB.dbusdc_coin_type],
    arguments: [tx.object(a.mandateId), tx.object(deployment.agent.passport_id), tx.pure.address(RG.protocol_address), tx.pure.u64(quote), tx.pure.u8(RG.action_deepbook_rescue), tx.object('0x6')],
  })
  const [proof] = tx.moveCall({ target: `${DB.package_id}::balance_manager::generate_proof_as_owner`, arguments: [tx.object(a.balanceManagerId)] })
  tx.moveCall({
    target: `${DB.package_id}::pool::place_limit_order`,
    typeArguments: [a.pool.base, DB.dbusdc_coin_type],
    arguments: [tx.object(a.pool.pool_id), tx.object(a.balanceManagerId), proof, tx.pure.u64(BigInt(a.clientOrderId)), tx.pure.u8(ORDER_TYPE_NO_RESTRICTION), tx.pure.u8(SELF_MATCHING_ALLOWED), tx.pure.u64(BigInt(a.price)), tx.pure.u64(BigInt(a.quantity)), tx.pure.bool(true), tx.pure.bool(false), tx.pure.u64(BigInt(a.expireMs)), tx.object('0x6')],
  })
  tx.moveCall({
    target: `${RG.package_id}::policy::record_agent_trade`,
    arguments: [tx.object(a.wrapperId), tx.object(a.mandateId), tx.object(deployment.agent.passport_id), tx.object(MG.agent_registry), tx.pure.id(a.pool.pool_id), tx.pure.u64(quote), tx.pure.u64(BigInt(a.baseReceived)), tx.pure.u16(a.slippageBps), tx.pure.vector('u8', Array.from(new TextEncoder().encode(String(a.clientOrderId)))), authToken, tx.object('0x6')],
  })
  return tx
}
