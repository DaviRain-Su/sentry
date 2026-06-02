import assert from 'node:assert/strict'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { keypairFromAgentSecret } from '../src/secret-safe-signer.js'

const generated = Ed25519Keypair.generate()
const secret = generated.getSecretKey()
const restored = keypairFromAgentSecret(secret, 'test AGENT_KEY')

assert.equal(
  restored.getPublicKey().toSuiAddress(),
  generated.getPublicKey().toSuiAddress(),
  'secret-safe signer restores the same public address',
)

for (const bad of ['', 'not-a-sui-private-key']) {
  assert.throws(
    () => keypairFromAgentSecret(bad, 'test AGENT_KEY'),
    (err) => {
      if (bad) assert.equal(String(err.message).includes(bad), false, 'errors must not echo secret input')
      assert.match(err.message, /^test AGENT_KEY (is missing|is not a valid Sui private key)$/)
      return true
    },
  )
}

console.log('\nALL SECRET-SAFE SIGNER TESTS PASS')
