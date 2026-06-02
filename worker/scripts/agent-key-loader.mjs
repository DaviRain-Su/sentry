// CLI-only loader for the dedicated agent key.
//
// The raw key is read from worker/.dev.vars and immediately converted through
// the shared secret-safe signer helper. This module never prints or exports the
// secret value; callers should only log public addresses, object IDs, and txs.
import { readFileSync } from 'node:fs'
import { keypairFromAgentSecret } from '../src/secret-safe-signer.js'

export function readWorkerDevVar(name, devVarsUrl = new URL('../.dev.vars', import.meta.url)) {
  const text = readFileSync(devVarsUrl, 'utf8')
  return text.match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1] ?? null
}

export function loadAgentKeypairFromDevVars(devVarsUrl = new URL('../.dev.vars', import.meta.url)) {
  return keypairFromAgentSecret(readWorkerDevVar('AGENT_KEY', devVarsUrl), 'worker/.dev.vars AGENT_KEY')
}
