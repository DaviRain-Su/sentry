// Validate Guardian/safety negative paths against a live local Worker and real
// Sui Testnet policy objects. This script is intentionally secret-safe: it only
// prints public addresses, object IDs, tx digests, strategy hashes, stable
// blocker codes, and sanitized comparison results.
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { Transaction } from '@mysten/sui/transactions'
import { strategyHash } from '../src/strategy-core.js'
import { getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'
import { queryPolicyEvents, readClockTimestampMs, readMandate, readWrapper } from '../src/chain.js'
import { loadAgentKeypairFromDevVars } from './agent-key-loader.mjs'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (!arg.startsWith('--')) continue
  const [key, inlineValue] = arg.split('=')
  const nextValue = process.argv[i + 1]
  if (inlineValue != null) args.set(key, inlineValue)
  else if (nextValue && !nextValue.startsWith('--')) {
    args.set(key, nextValue)
    i += 1
  } else {
    args.set(key, 'true')
  }
}

if (args.has('--help') || process.argv.includes('-h')) {
  console.log(`Validate live Testnet Guardian/safety negative paths.

Usage:
  node worker/scripts/validate-safety-negative-paths.mjs [--worker-url http://localhost:8787]

Creates a current-run active policy and short-lived expired policy with the
scripted agent-key owner path, validates over-budget, over-slippage, wrong pool,
wrong agent, mandate-wrapper mismatch, expired, and revoked negative paths via
the non-mutating Worker validate-plan API, then verifies no spend or execution
success activity was created. No raw secrets are printed.`)
  process.exit(0)
}

const workerUrl = String(args.get('--worker-url') || process.env.WORKER_URL || 'http://localhost:8787').replace(/\/$/, '')
const expectedChain = 'sui:testnet'
const poolId = DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id
const wrongPoolId = `0x${'f'.repeat(64)}`
const wrongAgentId = `0x${'a'.repeat(64)}`
const mismatchedMandateId = `0x${'b'.repeat(64)}`
const client = getClient()
const keypair = loadAgentKeypairFromDevVars()
const signerAddress = keypair.getPublicKey().toSuiAddress()
const ownerAddress = signerAddress
const delegatedAgentAddress = DEPLOYMENT.agent.address

function fail(message, details = undefined) {
  const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function assert(condition, message, details = undefined) {
  if (!condition) fail(message, details)
}

function txMeta(tx) {
  return {
    digest: tx.digest,
    status: tx.effects?.status?.status ?? null,
    checkpoint: tx.checkpoint ?? null,
    timestamp_ms: tx.timestampMs ? Number(tx.timestampMs) : null,
  }
}

function withoutStrategyHash(strategy) {
  const { strategy_hash: _strategyHash, ...unsignedStrategy } = strategy
  return unsignedStrategy
}

function hexFromMaybeVector(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
}

async function getJson(path) {
  const res = await fetch(`${workerUrl}${path}`)
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker GET ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker GET ${path} returned an error`, json)
  return json
}

async function postJson(path, body) {
  const res = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker POST ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker POST ${path} returned an error`, json)
  return json
}

async function waitForTx(digest) {
  return client.waitForTransaction({
    digest,
    options: { showEvents: true, showEffects: true, showObjectChanges: true },
  })
}

async function waitForSuiClockAtLeast(targetMs, { attempts = 45, delayMs = 1_000 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const clockMs = await readClockTimestampMs(client)
    if (clockMs >= targetMs) return clockMs
    await delay(delayMs)
  }
  fail('Timed out waiting for Sui Clock to pass policy expiry', { target_ms: targetMs })
}

async function createPolicy({ marker, budgetCeiling, maxSlippageBps, expiresAtMs }) {
  const strategy = {
    version: '1',
    strategy_type: 'risk_response',
    current_run_marker: marker,
    owner: ownerAddress,
    agent: delegatedAgentAddress,
    chain: expectedChain,
    pool_id: poolId,
    budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
    budget_ceiling: String(budgetCeiling),
    trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
    execution: {
      order_type: 'market_or_ioc',
      max_slippage_bps: maxSlippageBps,
      max_single_trade_amount: String(budgetCeiling),
    },
    expires_at_ms: expiresAtMs,
  }
  strategy.strategy_hash = strategyHash(strategy)

  const built = await postJson('/api/policies', {
    owner: ownerAddress,
    strategy: withoutStrategyHash(strategy),
    strategy_hash: strategy.strategy_hash,
    confirmed: true,
  })
  const submitted = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: Transaction.from(built.tx_json),
    options: { showEffects: true },
  })
  const resolved = await waitForTx(submitted.digest)
  assert(resolved.effects?.status?.status === 'success', 'create_policy transaction failed', txMeta(resolved))

  const created = readPolicyCreated(resolved)
  assert(created?.wrapper_id && created?.mandate_id, 'PolicyCreated event did not contain wrapper/mandate IDs', resolved.events)
  const event = (resolved.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
  assert(hexFromMaybeVector(event?.parsedJson?.strategy_hash) === strategy.strategy_hash, 'PolicyCreated strategy hash did not match current run')

  return {
    marker,
    strategy_hash: strategy.strategy_hash,
    wrapper_id: created.wrapper_id,
    mandate_id: created.mandate_id,
    create_tx_digest: resolved.digest,
    expires_at_ms: String(expiresAtMs),
    budget_ceiling: String(budgetCeiling),
    max_slippage_bps: maxSlippageBps,
  }
}

async function revokePolicy(policy) {
  const built = await postJson(`/api/policies/${policy.wrapper_id}/revoke`, { owner: ownerAddress, confirmed: true })
  assert(built.wrapper_id === policy.wrapper_id, 'Worker revoke build wrapper id mismatch', built)
  assert(built.mandate_id === policy.mandate_id, 'Worker revoke build mandate id mismatch', built)
  const submitted = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: Transaction.from(built.tx_json),
    options: { showEffects: true },
  })
  const resolved = await waitForTx(submitted.digest)
  assert(resolved.effects?.status?.status === 'success', 'revoke_policy transaction failed', txMeta(resolved))
  const event = (resolved.events || []).find((e) => String(e.type).endsWith('::policy::PolicyRevoked'))
  assert(event?.parsedJson?.wrapper_id === policy.wrapper_id, 'PolicyRevoked event wrapper mismatch', event?.parsedJson)
  return resolved
}

async function activitySummary(wrapperId) {
  const detail = await getJson(`/api/policies/${wrapperId}/activity`)
  return {
    spent_amount: String(detail.policy?.spent_amount),
    execution_success_count: (detail.events || []).filter((e) => e.type === 'AgentTradeExecuted').length,
    event_types: (detail.events || []).map((e) => e.type),
  }
}

async function assertBlockedPlan({ name, policy, proposed, expectedCode, mandateId }) {
  const beforeWrapper = await readWrapper(client, policy.wrapper_id)
  const beforeActivity = await activitySummary(policy.wrapper_id)
  const response = await postJson('/api/execution/validate-plan', {
    wrapper_id: policy.wrapper_id,
    mandate_id: mandateId,
    proposed,
  })
  const afterWrapper = await readWrapper(client, policy.wrapper_id)
  const afterActivity = await activitySummary(policy.wrapper_id)
  const chainEvents = await queryPolicyEvents(client, policy.wrapper_id)
  const chainSuccessEvents = chainEvents.filter((e) => e.type === 'AgentTradeExecuted')

  assert(response.action !== 'validated' && response.action !== 'execute' && response.action !== 'executed', `${name} unexpectedly passed validation`, response)
  assert(response.code === expectedCode || response.blocker_code === expectedCode, `${name} returned wrong blocker`, response)
  assert(response.submitted === false, `${name} did not report pre-submission block`, response)
  assert(response.execution_claimed === false, `${name} claimed execution`, response)
  assert(beforeWrapper?.spent_amount === afterWrapper?.spent_amount, `${name} changed wrapper spend`, { before: beforeWrapper, after: afterWrapper })
  assert(beforeActivity.spent_amount === afterActivity.spent_amount, `${name} changed API spend`, { beforeActivity, afterActivity })
  assert(beforeActivity.execution_success_count === afterActivity.execution_success_count, `${name} created execution success activity`, { beforeActivity, afterActivity })
  assert(chainSuccessEvents.length === 0, `${name} created AgentTradeExecuted chain activity`, chainEvents)

  return {
    name,
    endpoint: 'POST /api/execution/validate-plan',
    construction_path: response.construction_path,
    expected_code: expectedCode,
    observed_code: response.code ?? response.blocker_code,
    action: response.action,
    submitted: response.submitted,
    execution_claimed: response.execution_claimed,
    spend_before: beforeWrapper?.spent_amount,
    spend_after: afterWrapper?.spent_amount,
    success_activity_count_before: beforeActivity.execution_success_count,
    success_activity_count_after: afterActivity.execution_success_count,
    chain_time_source: response.chain_time_source,
  }
}

assert(DEPLOYMENT.chain === expectedChain, 'Deployment is not configured for Sui Testnet', { chain: DEPLOYMENT.chain })
assert(String(DEPLOYMENT.rpc).includes('testnet'), 'Deployment RPC is not Testnet', { rpc: DEPLOYMENT.rpc })
const workerRoot = await getJson('/')
assert(workerRoot.service === 'rescuegrid-worker', 'Worker root did not identify rescuegrid-worker', workerRoot)

const currentClockMs = await readClockTimestampMs(client)
assert(Number.isFinite(currentClockMs), 'Sui Clock timestamp was not readable')
const runNonce = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`

console.log(JSON.stringify({
  phase: 'preflight',
  worker_url: workerUrl,
  chain: DEPLOYMENT.chain,
  rpc: DEPLOYMENT.rpc,
  signer_address: signerAddress,
  scripted_owner_address: ownerAddress,
  configured_delegated_agent_address: delegatedAgentAddress,
  signer_equals_owner: signerAddress === ownerAddress,
  owner_equals_delegated_agent: ownerAddress === delegatedAgentAddress,
  agent_key_as_owner_intentional: true,
  sui_clock_ms: currentClockMs,
}, null, 2))

const activePolicy = await createPolicy({
  marker: `safety-negative-active-${runNonce}`,
  budgetCeiling: '1000000',
  maxSlippageBps: 100,
  expiresAtMs: currentClockMs + 86_400_000,
})
console.log(JSON.stringify({ phase: 'active_policy_created', ...activePolicy }, null, 2))

const cases = [
  {
    name: 'over-budget',
    policy: activePolicy,
    expectedCode: 'OVER_BUDGET',
    proposed: { pool_id: poolId, amount: '1000001', estimated_slippage_bps: 50, agent_id: delegatedAgentAddress },
  },
  {
    name: 'over-slippage',
    policy: activePolicy,
    expectedCode: 'OVER_SLIPPAGE',
    proposed: { pool_id: poolId, amount: '100000', estimated_slippage_bps: 101, agent_id: delegatedAgentAddress },
  },
  {
    name: 'wrong-pool',
    policy: activePolicy,
    expectedCode: 'WRONG_POOL',
    proposed: { pool_id: wrongPoolId, amount: '100000', estimated_slippage_bps: 50, agent_id: delegatedAgentAddress },
  },
  {
    name: 'wrong-agent',
    policy: activePolicy,
    expectedCode: 'WRONG_AGENT',
    proposed: { pool_id: poolId, amount: '100000', estimated_slippage_bps: 50, agent_id: wrongAgentId },
  },
  {
    name: 'mandate-wrapper-mismatch',
    policy: activePolicy,
    expectedCode: 'MANDATE_MISMATCH',
    mandateId: mismatchedMandateId,
    proposed: { pool_id: poolId, amount: '100000', estimated_slippage_bps: 50, agent_id: delegatedAgentAddress },
  },
]

const evidence = []
for (const c of cases) {
  evidence.push(await assertBlockedPlan(c))
}

const expiryTargetMs = Math.max(currentClockMs, Date.now()) + 15_000
const expiringPolicy = await createPolicy({
  marker: `safety-negative-expired-${runNonce}`,
  budgetCeiling: '1000000',
  maxSlippageBps: 100,
  expiresAtMs: expiryTargetMs,
})
console.log(JSON.stringify({ phase: 'expiring_policy_created', ...expiringPolicy }, null, 2))
const expiredClockMs = await waitForSuiClockAtLeast(expiryTargetMs + 1)
const expiredMandate = await readMandate(client, expiringPolicy.mandate_id)
assert(Number(expiredMandate?.expires_at_ms) < expiredClockMs, 'Expired policy setup did not pass Sui Clock expiry', { expiredClockMs, mandate: expiredMandate })
evidence.push(await assertBlockedPlan({
  name: 'expired-policy',
  policy: expiringPolicy,
  expectedCode: 'POLICY_EXPIRED',
  proposed: { pool_id: poolId, amount: '100000', estimated_slippage_bps: 50, agent_id: delegatedAgentAddress },
}))

const revokeResolved = await revokePolicy(activePolicy)
const revokedMandate = await readMandate(client, activePolicy.mandate_id)
assert(revokedMandate?.revoked === true, 'Active policy mandate was not revoked after revoke tx', revokedMandate)
evidence.push(await assertBlockedPlan({
  name: 'revoked-policy',
  policy: activePolicy,
  expectedCode: 'POLICY_REVOKED',
  proposed: { pool_id: poolId, amount: '100000', estimated_slippage_bps: 50, agent_id: delegatedAgentAddress },
}))

console.log(JSON.stringify({
  phase: 'negative_path_evidence',
  active_policy: activePolicy,
  expiring_policy: expiringPolicy,
  revoke_tx: txMeta(revokeResolved),
  assertions: ['VAL-SAFETY-001', 'VAL-SAFETY-002', 'VAL-SAFETY-003', 'VAL-SAFETY-005', 'VAL-SAFETY-008'],
  evidence,
}, null, 2))

console.log(JSON.stringify({
  phase: 'pass',
  summary: 'All Guardian/safety negative paths blocked before submission through Worker/API validate-plan evidence; wrapper spend and execution-success activity stayed unchanged.',
  active_wrapper_id: activePolicy.wrapper_id,
  expired_wrapper_id: expiringPolicy.wrapper_id,
  active_revoke_tx_digest: revokeResolved.digest,
  validated_codes: evidence.map((e) => e.observed_code),
}, null, 2))
