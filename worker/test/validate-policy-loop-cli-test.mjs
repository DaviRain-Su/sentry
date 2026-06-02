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

const safetyHelp = spawnSync(process.execPath, ['scripts/validate-safety-negative-paths.mjs', '--help'], {
  cwd: new URL('..', import.meta.url),
  encoding: 'utf8',
})

assert.equal(safetyHelp.status, 0, safetyHelp.stderr)
assert.match(safetyHelp.stdout, /over-budget/i)
assert.match(safetyHelp.stdout, /mandate-wrapper mismatch/i)
assert.match(safetyHelp.stdout, /no raw secrets/i)
assert.equal(safetyHelp.stdout.includes('AGENT_KEY='), false, 'safety help output must not print secret values')

console.log('\nALL POLICY LOOP CLI TESTS PASS')
