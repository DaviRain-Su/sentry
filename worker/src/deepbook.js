// F1/F3 — Deepbook v3 adapter (raw PTB against the live on-chain package, so we
// are independent of the @mysten/deepbook-v3 SDK's @mysten/sui v2 peer).
// Signatures verified on-chain (sui_getNormalizedMoveModulesByPackage):
//   balance_manager::new(ctx): BalanceManager        [key+store -> shareable]
//   balance_manager::deposit<T>(&mut BM, Coin<T>, ctx)
//   balance_manager::generate_proof_as_owner(&mut BM, &ctx): TradeProof
//   pool::place_limit_order<B,Q>(&mut Pool, &mut BM, &TradeProof, client_order_id:u64,
//       order_type:u8, self_matching:u8, price:u64, quantity:u64, is_bid:bool,
//       pay_with_deep:bool, expire_ms:u64, &Clock, &ctx): OrderInfo   [OrderInfo: copy+drop+store]
//   <dbusdc>::DBUSDC::mint(amount:u64): Coin<DBUSDC>  [permissionless testnet faucet]
import { Transaction } from '@mysten/sui/transactions'
import { DEPLOYMENT } from './sui-tx.js'

const DB = DEPLOYMENT.deepbook
const MG = DEPLOYMENT.movegate
const RG = DEPLOYMENT.rescuegrid

// deepbook constants (from the `constants` module): standard limit order.
export const ORDER_TYPE_NO_RESTRICTION = 0
export const SELF_MATCHING_ALLOWED = 0
export const FLOAT_SCALING = 1_000_000_000n // 1e9 price scaling

const DEEP_TYPE = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP'

/**
 * Agent setup (agent-signed, one PTB): acquire DBUSDC by swapping SUI on the
 * SUI/DBUSDC pool (DBUSDC mint is permissioned on testnet), create a
 * BalanceManager, deposit the DBUSDC, and share the manager so later
 * agent-signed execution PTBs can reference it. Leftover SUI/DEEP go back to
 * the agent. A zero DEEP coin covers fees on input-fee pools.
 */
export function buildAgentSetupTx({ suiInMist, agentAddress }) {
  const tx = new Transaction()
  const pool = DB.pools.SUI_DBUSDC
  const [suiIn] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(suiInMist))])
  const [deepZero] = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEP_TYPE] })
  // returns (Coin<Base=SUI>, Coin<Quote=DBUSDC>, Coin<DEEP>)
  const [baseLeft, dbusdc, deepLeft] = tx.moveCall({
    target: `${DB.package_id}::pool::swap_exact_base_for_quote`,
    typeArguments: [pool.base, DB.dbusdc_coin_type],
    arguments: [tx.object(pool.pool_id), suiIn, deepZero, tx.pure.u64(0n), tx.object('0x6')],
  })
  const [bm] = tx.moveCall({ target: `${DB.package_id}::balance_manager::new` })
  tx.moveCall({
    target: `${DB.package_id}::balance_manager::deposit`,
    typeArguments: [DB.dbusdc_coin_type],
    arguments: [bm, dbusdc],
  })
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`${DB.package_id}::balance_manager::BalanceManager`],
    arguments: [bm],
  })
  tx.transferObjects([baseLeft, deepLeft], tx.pure.address(agentAddress))
  return tx
}

/**
 * Execution PTB (agent-signed) — the heart of F3 and B5:
 *   authorize_action<DBUSDC>  -> AuthToken (hot potato)
 *   generate_proof_as_owner   -> TradeProof
 *   pool::place_limit_order   -> OrderInfo (dropped)
 *   record_agent_trade        -> consumes AuthToken via MoveGate receipt
 * All in one transaction; the Move compiler guarantees the AuthToken is
 * consumed here. Amounts are agent-computed and asserted on-chain.
 *
 * @param {object} a
 * @param {string} a.wrapperId
 * @param {string} a.mandateId
 * @param {string} a.balanceManagerId
 * @param {{pool_id:string, base:string}} a.pool      // from deployment.deepbook.pools.*
 * @param {bigint|string} a.quoteAmount   // DBUSDC smallest units; authorize+record amount
 * @param {bigint|string} a.baseReceived  // SUI smallest units recorded as received
 * @param {bigint|string} a.price         // deepbook price (FLOAT_SCALING)
 * @param {bigint|string} a.quantity      // deepbook base quantity
 * @param {number} a.slippageBps
 * @param {bigint|string} a.clientOrderId
 * @param {bigint|string} a.expireMs
 */
export function buildExecutionTx(a) {
  const tx = new Transaction()
  const quote = BigInt(a.quoteAmount)

  const [authToken] = tx.moveCall({
    target: `${MG.published_at}::mandate::authorize_action`,
    typeArguments: [DB.dbusdc_coin_type],
    arguments: [
      tx.object(a.mandateId),
      tx.object(DEPLOYMENT.agent.passport_id),
      tx.pure.address(RG.protocol_address),
      tx.pure.u64(quote),
      tx.pure.u8(RG.action_deepbook_rescue),
      tx.object('0x6'),
    ],
  })

  const [proof] = tx.moveCall({
    target: `${DB.package_id}::balance_manager::generate_proof_as_owner`,
    arguments: [tx.object(a.balanceManagerId)],
  })

  // place_limit_order<Base, Quote> — OrderInfo return is dropped (has drop).
  tx.moveCall({
    target: `${DB.package_id}::pool::place_limit_order`,
    typeArguments: [a.pool.base, DB.dbusdc_coin_type],
    arguments: [
      tx.object(a.pool.pool_id),
      tx.object(a.balanceManagerId),
      proof,
      tx.pure.u64(BigInt(a.clientOrderId)),
      tx.pure.u8(ORDER_TYPE_NO_RESTRICTION),
      tx.pure.u8(SELF_MATCHING_ALLOWED),
      tx.pure.u64(BigInt(a.price)),
      tx.pure.u64(BigInt(a.quantity)),
      tx.pure.bool(true),  // is_bid = buy the dip
      tx.pure.bool(false), // pay_with_deep
      tx.pure.u64(BigInt(a.expireMs)),
      tx.object('0x6'),
    ],
  })

  tx.moveCall({
    target: `${RG.package_id}::policy::record_agent_trade`,
    arguments: [
      tx.object(a.wrapperId),
      tx.object(a.mandateId),
      tx.object(DEPLOYMENT.agent.passport_id),
      tx.object(MG.agent_registry),
      tx.pure.id(a.pool.pool_id),
      tx.pure.u64(quote),
      tx.pure.u64(BigInt(a.baseReceived)),
      tx.pure.u16(a.slippageBps),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(String(a.clientOrderId)))),
      authToken,
      tx.object('0x6'),
    ],
  })

  return tx
}
