// One-time on-chain setup for the dedicated agent (signed by AGENT_KEY):
//   1. register the agent's MoveGate passport
//   2. faucet-mint DBUSDC -> create BalanceManager -> deposit -> share
// Prints the new passport id + balance_manager id to wire into deployment.
import { Transaction } from '@mysten/sui/transactions';
import { getClient, DEPLOYMENT } from '../src/sui-tx.js';
import { buildAgentSetupTx } from '../src/deepbook.js';
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs';

const kp = loadAgentKeypairFromDevVars();
const agent = kp.getPublicKey().toSuiAddress();
const client = getClient();
const MG = DEPLOYMENT.movegate;
console.log('agent:', agent);

async function exec(tx, label) {
  const res = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  const status = res.effects?.status?.status;
  console.log(`${label}: ${status} (${res.digest})`);
  if (status !== 'success') {
    console.log(JSON.stringify(res.effects?.status));
    process.exit(1);
  }
  return res;
}

// 1. register passport (idempotent-ish: skip if already has one)
const has = await client.devInspectTransactionBlock; // noop ref
let passportId = null;
{
  const tx = new Transaction();
  tx.moveCall({
    target: `${MG.published_at}::passport::register_agent`,
    arguments: [tx.object(MG.agent_registry), tx.object('0x6')],
  });
  const res = await exec(tx, 'register_agent');
  passportId = (res.objectChanges || []).find((o) =>
    o.objectType?.endsWith('::passport::AgentPassport')
  )?.objectId;
}

// 2. mint + BalanceManager + deposit + share
let bmId = null;
{
  const tx = buildAgentSetupTx({ suiInMist: 300_000_000n, agentAddress: agent }); // swap 0.3 SUI -> DBUSDC
  const res = await exec(tx, 'agent_setup(swap+BM+deposit+share)');
  bmId = (res.objectChanges || []).find((o) =>
    o.objectType?.endsWith('::balance_manager::BalanceManager')
  )?.objectId;
}

console.log('\n--- wire into deployment ---');
console.log('AGENT_ADDRESS=' + agent);
console.log('AGENT_PASSPORT_ID=' + passportId);
console.log('BALANCE_MANAGER_ID=' + bmId);
