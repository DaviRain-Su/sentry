// Try the permissionless DEEP faucet mint (deep::mint(recipient, amount)).
import { Transaction } from '@mysten/sui/transactions';
import { getClient } from '../src/sui-tx.js';
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs';

const DEEP_PKG = '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8';
const kp = loadAgentKeypairFromDevVars();
const owner = kp.getPublicKey().toSuiAddress();
const c = getClient();
const amount = BigInt(process.argv[2] || '10000000'); // 10 DEEP (6dp)

const tx = new Transaction();
tx.moveCall({
  target: `${DEEP_PKG}::deep::mint`,
  arguments: [tx.pure.address(owner), tx.pure.u64(amount)],
});
try {
  const r = await c.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showBalanceChanges: true, showEffects: true },
  });
  console.log('status:', r.effects?.status?.status, '| err:', r.effects?.status?.error || 'none');
  console.log(
    'balanceChanges:',
    JSON.stringify(
      (r.balanceChanges || []).map((b) => ({ coin: b.coinType.split('::').pop(), amt: b.amount }))
    )
  );
} catch (e) {
  console.log('ERR:', String(e.message).slice(0, 200));
}
