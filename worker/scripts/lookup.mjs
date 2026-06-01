// Read the agent passport id + BalanceManager DBUSDC balance (devInspect).
import { Transaction } from '@mysten/sui/transactions'
import { getClient, DEPLOYMENT } from '../src/sui-tx.js'

const client = getClient()
const agent = process.argv[2] || '0x9eeed099a0ff576571ffdb5c494db31a3ab2f6c2c76511a778ce5d3952c2ee43'
const bm = process.argv[3] || '0x2e2e818f16f71f488384bb60e1d0e09c8c9cc8e211f006caba7d577cadeaaec2'
const MG = DEPLOYMENT.movegate
const DB = DEPLOYMENT.deepbook

const tx = new Transaction()
tx.moveCall({ target: `${MG.published_at}::passport::get_passport_id`, arguments: [tx.object(MG.agent_registry), tx.pure.address(agent)] })
const ins = await client.devInspectTransactionBlock({ sender: agent, transactionBlock: tx })
const ret = ins.results?.[0]?.returnValues?.[0]
if (ret) console.log('AGENT_PASSPORT_ID=0x' + Buffer.from(ret[0]).toString('hex'))

const tx2 = new Transaction()
tx2.moveCall({ target: `${DB.package_id}::balance_manager::balance`, typeArguments: [DB.dbusdc_coin_type], arguments: [tx2.object(bm)] })
const ins2 = await client.devInspectTransactionBlock({ sender: agent, transactionBlock: tx2 })
const bal = ins2.results?.[0]?.returnValues?.[0]
if (bal) {
  const b = Buffer.from(bal[0]); let v = 0n
  for (let i = b.length - 1; i >= 0; i--) v = (v << 8n) + BigInt(b[i])
  console.log('BM_DBUSDC_BALANCE=' + v.toString(), '(' + Number(v) / 1e6 + ' DBUSDC)')
}
