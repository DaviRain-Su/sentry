// Generate (or reuse) the dedicated Sentry agent keypair, stored only in
// worker/.dev.vars (gitignored) as AGENT_KEY. Prints the address only.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { keypairFromAgentSecret } from '../src/secret-safe-signer.js';

const path = new URL('../.dev.vars', import.meta.url);
let env = existsSync(path) ? readFileSync(path, 'utf8') : '';
const existing = env.match(/^AGENT_KEY=(\S+)/m);

let kp;
if (existing) {
  kp = keypairFromAgentSecret(existing[1], 'worker/.dev.vars AGENT_KEY');
  console.log('reused existing AGENT_KEY');
} else {
  kp = Ed25519Keypair.generate();
  const sk = kp.getSecretKey(); // suiprivkey1...
  env += (env && !env.endsWith('\n') ? '\n' : '') + `AGENT_KEY=${sk}\n`;
  writeFileSync(path, env);
  console.log('generated AGENT_KEY -> worker/.dev.vars');
}
console.log('AGENT_ADDRESS=' + kp.getPublicKey().toSuiAddress());
