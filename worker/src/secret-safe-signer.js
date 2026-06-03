// Secret-safe signer construction helpers.
//
// Keep all AGENT_KEY decoding in one reviewed utility so scripts/runtime code
// can derive a Sui signer without logging, returning, or rethrowing key
// material. Callers may log the derived public address, but never the input.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';

export function keypairFromAgentSecret(secret, sourceLabel = 'AGENT_KEY') {
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error(`${sourceLabel} is missing`);
  }
  try {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret.trim()).secretKey);
  } catch {
    throw new Error(`${sourceLabel} is not a valid Sui private key`);
  }
}

export function keypairFromWorkerEnv(env) {
  return keypairFromAgentSecret(env?.AGENT_KEY, 'worker AGENT_KEY');
}
