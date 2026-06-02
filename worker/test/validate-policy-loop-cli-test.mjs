import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const help = spawnSync(process.execPath, ['scripts/validate-policy-loop.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(help.status, 0, help.stderr)
assert.match(help.stdout, /--pause-before-revoke-ms <ms>/)
assert.match(help.stdout, /--active-checkpoint-only/)
assert.match(help.stdout, /secret-safe/i)
assert.equal(help.stdout.includes('AGENT_KEY='), false, 'help output must not print secret values')

console.log('\nALL POLICY LOOP CLI TESTS PASS')
