// Try to acquire test DBUSDC by selling a little SUI on the SUI_DBUSDC pool.
import { Transaction } from '@mysten/sui/transactions'
import { getClient, DEPLOYMENT } from '../src/sui-tx.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

const DEEP_TYPE = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP'
const kp = loadAgentKeypairFromDevVars()
const owner = kp.getPublicKey().toSuiAddress()
const c = getClient()
const DB = DEPLOYMENT.deepbook, pool = DB.pools.SUI_DBUSDC
const sui = BigInt(process.argv[2] || '200000000') // 0.2 SUI

const tx = new Transaction()
const [inCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(sui)])
const [deepZero] = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [DEEP_TYPE] })
const [baseOut, quoteOut, deepOut] = tx.moveCall({
  target: `${DB.package_id}::pool::swap_exact_base_for_quote`,
  typeArguments: [pool.base, DB.dbusdc_coin_type],
  arguments: [tx.object(pool.pool_id), inCoin, deepZero, tx.pure.u64(0n), tx.object('0x6')],
})
tx.transferObjects([baseOut, quoteOut, deepOut], tx.pure.address(owner))

const res = await c.signAndExecuteTransaction({ signer: kp, transaction: tx, options: { showBalanceChanges: true, showEffects: true } })
console.log('status:', res.effects?.status?.status, '| digest:', res.digest)
const bc = (res.balanceChanges || []).map(b => ({ coin: b.coinType.split('::').pop(), amount: b.amount }))
console.log('balanceChanges:', JSON.stringify(bc))
process.exit(0)
