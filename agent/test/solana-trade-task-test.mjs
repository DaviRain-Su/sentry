import assert from 'node:assert/strict';
import {
  assertSolanaAccountScope,
  buildSolanaSwapTask,
  isSolanaSignature,
  normalizeSolanaExecutionResult,
  validateSolanaSwapTask,
  verifySolanaAgentTaskResult,
} from '../../core/solana-trade.js';

const owner = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const signature =
  '5KJvsngHeMpm884wtmM1ke22tjhMgZorT1fdS1T8yPzJkQdY1LZQmibZQj1A7wB8Qz3n8YdDsZc8QmvM1Qx3abc';
const account = {
  owner,
  capabilities: ['read', 'sign', 'submit_tx'],
};

assert.equal(assertSolanaAccountScope(account).status, 'ok');
assert.equal(
  assertSolanaAccountScope({ ...account, capabilities: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertSolanaAccountScope({ ...account, capabilities: ['read', 'sign'] }).code,
  'SOLANA_ACCOUNT_CAPABILITIES_REQUIRED'
);
assert.equal(isSolanaSignature(signature), true);

const built = buildSolanaSwapTask({
  taskId: 'task_solana_swap_1',
  policyId: 'policy_solana_swap',
  targetAgent: 'codex',
  account,
  adapter: 'jupiter',
  inputMint,
  outputMint,
  amount: '1000000',
  slippageBps: 50,
  quoteId: 'quote_solana_1',
  maxInputAmount: '1000000',
  minOutputAmount: '990000',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
  simulated: true,
});
assert.equal(built.status, 'ok');
assert.equal(built.task.venue_id, 'solana-mainnet');
assert.equal(built.task.target_agent, 'codex');
assert.equal(built.task.action.type, 'submit_tx');
assert.equal(built.task.action.params.intent, 'swap');
assert.equal(built.task.action.params.adapter, 'jupiter');
assert.equal(built.task.constraints.idempotency_key, 'quote_solana_1');
assert.deepEqual(built.task.constraints.capabilities_required, ['read', 'sign', 'submit_tx']);
assert.equal(built.task.constraints.no_withdraw, true);
assert.equal(built.task.authorization.authorization_model, 'native_delegation');
assert.equal(JSON.stringify(built).includes('private_key'), false);

assert.equal(validateSolanaSwapTask(built.task).status, 'ok');
assert.equal(
  validateSolanaSwapTask({
    ...built.task,
    constraints: { capabilities_required: ['submit_tx'] },
    authorization: { ...built.task.authorization, capabilities_required: [] },
  }).code,
  'SOLANA_TASK_CAPABILITIES_REQUIRED'
);
assert.equal(
  buildSolanaSwapTask({
    account,
    adapter: 'unknown',
    inputMint,
    outputMint,
    amount: '1000000',
  }).code,
  'SOLANA_SWAP_ADAPTER_INVALID'
);
assert.equal(
  buildSolanaSwapTask({
    account,
    adapter: 'jupiter',
    inputMint,
    outputMint: inputMint,
    amount: '1000000',
  }).code,
  'SOLANA_SWAP_MINTS_MUST_DIFFER'
);

const normalized = normalizeSolanaExecutionResult(
  {
    signature,
    slot: 123456,
    confirmation_status: 'confirmed',
    quote_id: 'quote_solana_1',
  },
  {
    task_id: built.task.task_id,
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(normalized.status, 'submitted');
assert.equal(normalized.evidence.signature, signature);
assert.equal(normalized.evidence.slot, 123456);
assert.equal(verifySolanaAgentTaskResult(normalized, built.task).status, 'ok');

assert.equal(
  normalizeSolanaExecutionResult({
    signature: 'bad-signature',
  }).code,
  'SOLANA_SIGNATURE_REQUIRED'
);
assert.equal(
  verifySolanaAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        quote_id: 'wrong-quote',
      },
    },
    built.task
  ).code,
  'SOLANA_QUOTE_ID_MISMATCH'
);
assert.equal(
  verifySolanaAgentTaskResult(
    {
      task_id: built.task.task_id,
      status: 'submitted',
      evidence: { venue_id: 'solana-mainnet' },
    },
    built.task
  ).code,
  'SOLANA_SIGNATURE_REQUIRED'
);
assert.equal(
  verifySolanaAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        venue_id: 'ethereum-mainnet',
      },
    },
    built.task
  ).code,
  'SOLANA_RESULT_VENUE_MISMATCH'
);
assert.equal(
  verifySolanaAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        err: { InstructionError: [0, 'Custom'] },
      },
    },
    built.task
  ).code,
  'SOLANA_TRANSACTION_REPORTED_ERROR'
);

console.log('ALL SOLANA TRADE TASK TESTS PASS');
