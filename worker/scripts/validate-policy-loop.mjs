// Validate the real Sui Testnet policy write loop with the configured agent key.
//
// This script is intentionally secret-safe: it reads AGENT_KEY only to derive a
// signer, never prints the raw key, and emits only public addresses/object IDs,
// tx digests, strategy hashes, and comparison results.
//
// Usage:
//   node worker/scripts/validate-policy-loop.mjs [--worker-url http://localhost:8787]
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { strategyHash } from '../src/strategy-core.js'
import { buildCreatePolicyTx, buildRevokeTx, getClient, readPolicyCreated, DEPLOYMENT } from '../src/sui-tx.js'
import { readMandate, readWrapper } from '../src/chain.js'

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i]
  if (arg.startsWith('--')) {
    const [k, inlineValue] = arg.split('=')
    args.set(k, inlineValue ?? process.argv[i + 1])
    if (inlineValue == null) i += 1
  }
}

const workerUrl = String(args.get('--worker-url') || process.env.WORKER_URL || 'http://localhost:8787').replace(/\/$/, '')
const expectedChain = 'sui:testnet'

function fail(message, details = undefined) {
  const suffix = details == null ? '' : `\n${JSON.stringify(details, null, 2)}`
  throw new Error(`${message}${suffix}`)
}

function assert(condition, message, details = undefined) {
  if (!condition) fail(message, details)
}

function envValue(name) {
  const text = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  return text.match(new RegExp(`^${name}=(\\S+)`, 'm'))?.[1] ?? null
}

function txMeta(tx) {
  return {
    digest: tx.digest,
    status: tx.effects?.status?.status ?? null,
    checkpoint: tx.checkpoint ?? null,
    timestamp_ms: tx.timestampMs ? Number(tx.timestampMs) : null,
  }
}

function hexFromMaybeVector(value) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return null
  return `0x${value.map((b) => Number(b).toString(16).padStart(2, '0')).join('')}`
}

function importantPolicyFields(policy) {
  return {
    wrapper_id: policy.wrapper_id,
    mandate_id: policy.mandate_id,
    owner: policy.owner,
    agent: policy.agent,
    pool_id: policy.pool_id,
    budget_coin_type: policy.budget_coin_type,
    budget_ceiling: String(policy.budget_ceiling),
    spent_amount: String(policy.spent_amount),
    max_slippage_bps: Number(policy.max_slippage_bps),
    strategy_hash: policy.strategy_hash,
    revoked: Boolean(policy.revoked),
    status: policy.status,
    runtime_state: policy.runtime_state,
  }
}

function compareFields(label, actual, expected) {
  const mismatches = []
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) mismatches.push({ field: key, expected: value, actual: actual[key] })
  }
  assert(mismatches.length === 0, `${label} mismatch`, mismatches)
}

async function getJson(path) {
  const res = await fetch(`${workerUrl}${path}`)
  const json = await res.json().catch(() => null)
  assert(res.ok, `Worker GET ${path} returned HTTP ${res.status}`, json)
  assert(json && json.status !== 'error', `Worker GET ${path} returned an error`, json)
  return json
}

async function waitFor(label, fn, { attempts = 12, delayMs = 1_500 } = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const value = await fn()
      if (value) return value
    } catch (e) {
      lastError = e
    }
    await delay(delayMs)
  }
  if (lastError) throw lastError
  fail(`Timed out waiting for ${label}`)
}

async function waitForTx(client, digest) {
  return client.waitForTransaction({
    digest,
    options: { showEvents: true, showEffects: true, showObjectChanges: true },
  })
}

function findOwnerActivity(activity, txDigest, titlePart) {
  return (activity || []).find((item) => item.tx === txDigest && String(item.title || '').includes(titlePart))
}

const key = envValue('AGENT_KEY')
assert(key, 'AGENT_KEY is missing from worker/.dev.vars')

const keypair = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey)
const signerAddress = keypair.getPublicKey().toSuiAddress()
const ownerAddress = signerAddress
const delegatedAgentAddress = DEPLOYMENT.agent.address
const client = getClient()

assert(DEPLOYMENT.chain === expectedChain, 'Deployment is not configured for Sui Testnet', { chain: DEPLOYMENT.chain })
assert(String(DEPLOYMENT.rpc).includes('testnet'), 'Deployment RPC is not Testnet', { rpc: DEPLOYMENT.rpc })

const workerRoot = await getJson('/')
assert(workerRoot.service === 'rescuegrid-worker', 'Worker root did not identify rescuegrid-worker', workerRoot)
assert(workerRoot.agent === delegatedAgentAddress, 'Worker root agent differs from deployment agent', workerRoot)

const nowMs = Date.now()
const currentRunMarker = `policy-loop-${new Date(nowMs).toISOString()}-${randomUUID().slice(0, 8)}`
const strategy = {
  version: '1',
  strategy_type: 'risk_response',
  current_run_marker: currentRunMarker,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  chain: expectedChain,
  pool_id: DEPLOYMENT.deepbook.pools.SUI_DBUSDC.pool_id,
  budget_coin_type: DEPLOYMENT.deepbook.dbusdc_coin_type,
  budget_ceiling: '50000000',
  trigger: { metric: 'price_drop_pct', asset: 'SUI', threshold_pct: '8' },
  execution: { order_type: 'market_or_ioc', max_slippage_bps: 100, max_single_trade_amount: '10000000' },
  expires_at_ms: nowMs + 6 * 86_400_000,
}
strategy.strategy_hash = strategyHash(strategy)

console.log(JSON.stringify({
  phase: 'preflight',
  worker_url: workerUrl,
  chain: DEPLOYMENT.chain,
  rpc: DEPLOYMENT.rpc,
  current_run_marker: currentRunMarker,
  signer_address: signerAddress,
  scripted_owner_address: ownerAddress,
  configured_delegated_agent_address: delegatedAgentAddress,
  signer_equals_owner: signerAddress === ownerAddress,
  owner_equals_delegated_agent: ownerAddress === delegatedAgentAddress,
  agent_key_as_owner_intentional: true,
  strategy_hash: strategy.strategy_hash,
}, null, 2))

const createTx = buildCreatePolicyTx({ strategy, ownerAddress })
const createSubmitted = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: createTx,
  options: { showEffects: true },
})
const createResolved = await waitForTx(client, createSubmitted.digest)
assert(createResolved.effects?.status?.status === 'success', 'create_policy transaction failed', txMeta(createResolved))

const created = readPolicyCreated(createResolved)
const wrapperId = created?.wrapper_id
const mandateId = created?.mandate_id
assert(wrapperId && mandateId, 'PolicyCreated event did not contain wrapper/mandate IDs', createResolved.events)

const createEvent = (createResolved.events || []).find((e) => String(e.type).endsWith('::policy::PolicyCreated'))
assert(hexFromMaybeVector(createEvent?.parsedJson?.strategy_hash) === strategy.strategy_hash, 'PolicyCreated strategy hash did not match current-run hash')

console.log(JSON.stringify({
  phase: 'created',
  tx: txMeta(createResolved),
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  policy_created_event: {
    type: createEvent?.type,
    wrapper_id: createEvent?.parsedJson?.wrapper_id,
    mandate_id: createEvent?.parsedJson?.mandate_id,
    owner: createEvent?.parsedJson?.owner,
    agent: createEvent?.parsedJson?.agent,
  },
}, null, 2))

const wrapperAfterCreate = await readWrapper(client, wrapperId)
const mandateAfterCreate = await readMandate(client, mandateId)
assert(wrapperAfterCreate, 'Wrapper object was not readable after create', { wrapper_id: wrapperId })
assert(mandateAfterCreate, 'Mandate object was not readable after create', { mandate_id: mandateId })
compareFields('chain wrapper after create', wrapperAfterCreate, {
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  pool_id: strategy.pool_id,
  budget_coin_type: strategy.budget_coin_type,
  budget_ceiling: strategy.budget_ceiling,
  spent_amount: '0',
  max_slippage_bps: strategy.execution.max_slippage_bps,
  strategy_hash: strategy.strategy_hash,
})
compareFields('chain mandate after create', mandateAfterCreate, {
  id: mandateId,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  revoked: false,
})

const apiPolicyAfterCreate = await waitFor('created policy in Worker list', async () => {
  const response = await getJson(`/api/policies?owner=${ownerAddress}`)
  return response.policies?.find((p) => p.wrapper_id === wrapperId) ?? null
})
compareFields('Worker policy after create', importantPolicyFields(apiPolicyAfterCreate), {
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  pool_id: strategy.pool_id,
  budget_coin_type: strategy.budget_coin_type,
  budget_ceiling: strategy.budget_ceiling,
  spent_amount: '0',
  max_slippage_bps: strategy.execution.max_slippage_bps,
  strategy_hash: strategy.strategy_hash,
  revoked: false,
  status: 'active',
  runtime_state: 'Monitoring',
})

const apiActivityAfterCreate = await waitFor('PolicyCreated in Worker activity', async () => {
  const [ownerActivity, detailActivity] = await Promise.all([
    getJson(`/api/activity?owner=${ownerAddress}`),
    getJson(`/api/policies/${wrapperId}/activity`),
  ])
  const ownerItem = findOwnerActivity(ownerActivity.activity, createResolved.digest, 'created')
  const detailEvent = detailActivity.events?.find((e) => e.tx === createResolved.digest && e.type === 'PolicyCreated')
  return ownerItem && detailEvent ? { ownerActivity, detailActivity, ownerItem, detailEvent } : null
})
assert(apiActivityAfterCreate.detailActivity.policy.spent_amount === '0', 'Initial per-policy activity did not report zero spend', apiActivityAfterCreate.detailActivity.policy)
assert(apiActivityAfterCreate.detailActivity.events.every((e) => e.type !== 'AgentTradeExecuted'), 'Initial activity unexpectedly included execution success')

console.log(JSON.stringify({
  phase: 'api_after_create',
  policy: importantPolicyFields(apiPolicyAfterCreate),
  owner_activity_create_tx: apiActivityAfterCreate.ownerItem.tx,
  per_policy_event_types: apiActivityAfterCreate.detailActivity.events.map((e) => ({ type: e.type, tx: e.tx, timestamp_ms: e.timestamp_ms })),
}, null, 2))

const revokeTx = buildRevokeTx({ wrapperId, mandateId, ownerAddress })
const revokeSubmitted = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: revokeTx,
  options: { showEffects: true },
})
const revokeResolved = await waitForTx(client, revokeSubmitted.digest)
assert(revokeResolved.effects?.status?.status === 'success', 'revoke_policy transaction failed', txMeta(revokeResolved))

const revokeEvent = (revokeResolved.events || []).find((e) => String(e.type).endsWith('::policy::PolicyRevoked'))
assert(revokeEvent, 'PolicyRevoked event was not emitted', revokeResolved.events)
assert(revokeEvent.parsedJson?.wrapper_id === wrapperId, 'PolicyRevoked wrapper id mismatch', revokeEvent.parsedJson)
assert(revokeEvent.parsedJson?.mandate_id === mandateId, 'PolicyRevoked mandate id mismatch', revokeEvent.parsedJson)

console.log(JSON.stringify({
  phase: 'revoked',
  tx: txMeta(revokeResolved),
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  policy_revoked_event: {
    type: revokeEvent.type,
    wrapper_id: revokeEvent.parsedJson?.wrapper_id,
    mandate_id: revokeEvent.parsedJson?.mandate_id,
    owner: revokeEvent.parsedJson?.owner,
  },
}, null, 2))

const mandateAfterRevoke = await readMandate(client, mandateId)
assert(mandateAfterRevoke?.revoked === true, 'Mandate was not revoked on-chain after revoke tx', mandateAfterRevoke)

const apiAfterRevoke = await waitFor('revoked policy in Worker APIs', async () => {
  const [list, ownerActivity, detailActivity] = await Promise.all([
    getJson(`/api/policies?owner=${ownerAddress}`),
    getJson(`/api/activity?owner=${ownerAddress}`),
    getJson(`/api/policies/${wrapperId}/activity`),
  ])
  const policy = list.policies?.find((p) => p.wrapper_id === wrapperId)
  const ownerCreate = findOwnerActivity(ownerActivity.activity, createResolved.digest, 'created')
  const ownerRevoke = findOwnerActivity(ownerActivity.activity, revokeResolved.digest, 'revoked')
  const detailCreate = detailActivity.events?.find((e) => e.tx === createResolved.digest && e.type === 'PolicyCreated')
  const detailRevoke = detailActivity.events?.find((e) => e.tx === revokeResolved.digest && e.type === 'PolicyRevoked')
  if (policy?.revoked === true && policy?.status === 'revoked' && ownerCreate && ownerRevoke && detailCreate && detailRevoke) {
    return { policy, ownerActivity, detailActivity, detailCreate, detailRevoke }
  }
  return null
})

compareFields('Worker policy after revoke', importantPolicyFields(apiAfterRevoke.policy), {
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  owner: ownerAddress,
  agent: delegatedAgentAddress,
  pool_id: strategy.pool_id,
  budget_coin_type: strategy.budget_coin_type,
  budget_ceiling: strategy.budget_ceiling,
  spent_amount: '0',
  max_slippage_bps: strategy.execution.max_slippage_bps,
  strategy_hash: strategy.strategy_hash,
  revoked: true,
  status: 'revoked',
  runtime_state: 'Revoked',
})

const chronologicalEvents = [...apiAfterRevoke.detailActivity.events].sort((a, b) => Number(a.timestamp_ms ?? 0) - Number(b.timestamp_ms ?? 0))
const createIndex = chronologicalEvents.findIndex((e) => e.tx === createResolved.digest && e.type === 'PolicyCreated')
const revokeIndex = chronologicalEvents.findIndex((e) => e.tx === revokeResolved.digest && e.type === 'PolicyRevoked')
assert(createIndex >= 0 && revokeIndex > createIndex, 'PolicyRevoked activity was not chronologically after PolicyCreated', chronologicalEvents)

const stableSnapshots = []
for (let i = 0; i < 3; i += 1) {
  const [list, detailActivity] = await Promise.all([
    getJson(`/api/policies?owner=${ownerAddress}`),
    getJson(`/api/policies/${wrapperId}/activity`),
  ])
  const listed = list.policies?.find((p) => p.wrapper_id === wrapperId)
  assert(listed, 'Post-revoke list read did not include current-run policy')
  stableSnapshots.push({
    list_policy: importantPolicyFields(listed),
    detail_policy: importantPolicyFields(detailActivity.policy),
    event_txs: detailActivity.events.map((e) => `${e.type}:${e.tx}`),
  })
  if (i < 2) await delay(1_500)
}

const baseline = JSON.stringify(stableSnapshots[0])
for (const [index, snapshot] of stableSnapshots.entries()) {
  assert(JSON.stringify(snapshot) === baseline, `Post-revoke read ${index + 1} was not stable`, { baseline: stableSnapshots[0], snapshot })
}

console.log(JSON.stringify({
  phase: 'post_revoke_stability',
  stable_read_count: stableSnapshots.length,
  stable_policy: stableSnapshots[0].list_policy,
  chronological_activity: chronologicalEvents.map((e) => ({ type: e.type, tx: e.tx, timestamp_ms: e.timestamp_ms })),
}, null, 2))

console.log(JSON.stringify({
  phase: 'pass',
  assertions: [
    'VAL-POLICY-001',
    'VAL-POLICY-002',
    'VAL-POLICY-003',
    'VAL-POLICY-004',
    'VAL-POLICY-005',
    'VAL-POLICY-006',
    'VAL-POLICY-007',
    'VAL-POLICY-008',
    'VAL-POLICY-010',
    'VAL-POLICY-011',
    'VAL-POLICY-012',
    'VAL-POLICY-013',
    'VAL-POLICY-014',
  ],
  current_run_marker: currentRunMarker,
  wrapper_id: wrapperId,
  mandate_id: mandateId,
  create_tx_digest: createResolved.digest,
  revoke_tx_digest: revokeResolved.digest,
  strategy_hash: strategy.strategy_hash,
}, null, 2))
