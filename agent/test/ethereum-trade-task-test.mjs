import assert from 'node:assert/strict';
import {
  assertEthereumAccountScope,
  buildEthereumSwapTask,
  isEthereumTxHash,
  normalizeEthereumExecutionResult,
  validateEthereumSwapTask,
  verifyEthereumAgentTaskResult,
  verifyEthereumPreparedTransactionResult,
} from '../../core/ethereum-trade.js';

const accountRef = '0x0000000000000000000000000000000000000001';
const inputToken = '0x0000000000000000000000000000000000000002';
const outputToken = '0x0000000000000000000000000000000000000003';
const txHash = '0x1111111111111111111111111111111111111111111111111111111111111111';
const account = {
  account: accountRef,
  capabilities: ['read', 'sign', 'submit_tx'],
};

assert.equal(assertEthereumAccountScope(account).status, 'ok');
assert.equal(
  assertEthereumAccountScope({ ...account, capabilities: ['read', 'withdraw'] }).code,
  'WITHDRAW_NOT_ALLOWED'
);
assert.equal(
  assertEthereumAccountScope({ ...account, capabilities: ['read', 'sign'] }).code,
  'ETHEREUM_ACCOUNT_CAPABILITIES_REQUIRED'
);
assert.equal(isEthereumTxHash(txHash), true);

const built = buildEthereumSwapTask({
  taskId: 'task_ethereum_swap_1',
  policyId: 'policy_ethereum_swap',
  targetAgent: 'codex',
  account,
  adapter: 'uniswap',
  inputToken,
  outputToken,
  amount: '1000000',
  slippageBps: 50,
  quoteId: 'quote_ethereum_1',
  maxNotionalUsd: '1000',
  maxInputAmount: '1000000',
  minOutputAmount: '990000',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
  simulated: true,
});
assert.equal(built.status, 'ok');
assert.equal(built.task.venue_id, 'ethereum-mainnet');
assert.equal(built.task.target_agent, 'codex');
assert.equal(built.task.action.type, 'submit_tx');
assert.equal(built.task.action.params.intent, 'swap');
assert.equal(built.task.action.params.adapter, 'uniswap');
assert.equal(built.task.action.params.transaction_format, 'evm_transaction_request');
assert.equal(built.task.action.params.prepared_result_required, true);
assert.equal(built.task.constraints.idempotency_key, 'quote_ethereum_1');
assert.equal(built.task.constraints.max_notional_usd, '1000');
assert.equal(built.task.constraints.require_prepared_transaction, true);
assert.deepEqual(built.task.constraints.capabilities_required, ['read', 'sign', 'submit_tx']);
assert.equal(built.task.constraints.no_withdraw, true);
assert.equal(built.task.authorization.authorization_model, 'smart_account_module');
assert.equal(JSON.stringify(built).includes('private_key'), false);

assert.equal(validateEthereumSwapTask(built.task).status, 'ok');
assert.equal(
  validateEthereumSwapTask({
    ...built.task,
    constraints: { capabilities_required: ['submit_tx'] },
    authorization: { ...built.task.authorization, capabilities_required: [] },
  }).code,
  'ETHEREUM_TASK_CAPABILITIES_REQUIRED'
);
assert.equal(
  buildEthereumSwapTask({
    account,
    adapter: 'unknown',
    inputToken,
    outputToken,
    amount: '1000000',
  }).code,
  'ETHEREUM_SWAP_ADAPTER_INVALID'
);
assert.equal(
  buildEthereumSwapTask({
    account,
    adapter: 'uniswap',
    inputToken,
    outputToken: inputToken,
    amount: '1000000',
  }).code,
  'ETHEREUM_SWAP_TOKENS_MUST_DIFFER'
);

const normalized = normalizeEthereumExecutionResult(
  {
    hash: txHash,
    block_number: '0x123',
    receipt_status: '0x1',
    quote_id: 'quote_ethereum_1',
  },
  {
    task_id: built.task.task_id,
    observed_at: '2026-06-03T00:00:00.000Z',
  }
);
assert.equal(normalized.status, 'done');
assert.equal(normalized.evidence.tx_hash, txHash);
assert.equal(normalized.evidence.block_number, '0x123');
assert.equal(verifyEthereumAgentTaskResult(normalized, built.task).status, 'ok');

const prepared = {
  task_id: built.task.task_id,
  status: 'proposed',
  evidence: {
    venue_id: 'ethereum-mainnet',
    chain_id: 'eip155:1',
    quote_id: 'quote_ethereum_1',
    transaction_request: {
      from: accountRef,
      to: '0x0000000000000000000000000000000000000004',
      data: '0x095ea7b3',
      value: '0',
    },
    simulation: {
      status: 'success',
      gas_used: '21000',
    },
  },
};
assert.equal(verifyEthereumPreparedTransactionResult(prepared, built.task).status, 'ok');
assert.equal(verifyEthereumAgentTaskResult(prepared, built.task).status, 'ok');
assert.equal(
  verifyEthereumPreparedTransactionResult(
    {
      ...prepared,
      evidence: {
        ...prepared.evidence,
        transaction_request: {
          ...prepared.evidence.transaction_request,
          from: '0x0000000000000000000000000000000000000005',
        },
      },
    },
    built.task
  ).code,
  'ETHEREUM_FROM_ADDRESS_MISMATCH'
);
assert.equal(
  verifyEthereumPreparedTransactionResult(
    {
      ...prepared,
      evidence: {
        ...prepared.evidence,
        transaction_request: {
          ...prepared.evidence.transaction_request,
          data: '0x',
        },
      },
    },
    built.task
  ).code,
  'ETHEREUM_CALLDATA_REQUIRED'
);
assert.equal(
  verifyEthereumPreparedTransactionResult(
    {
      ...prepared,
      evidence: {
        ...prepared.evidence,
        simulation: { status: 'reverted', err: 'execution reverted' },
      },
    },
    built.task
  ).code,
  'ETHEREUM_SIMULATION_FAILED'
);

const reverted = normalizeEthereumExecutionResult(
  {
    tx_hash: txHash,
    error: 'execution reverted',
    quote_id: 'quote_ethereum_1',
  },
  {
    task_id: built.task.task_id,
  }
);
assert.equal(reverted.status, 'error');
assert.equal(reverted.evidence.err, 'execution reverted');
assert.equal(verifyEthereumAgentTaskResult(reverted, built.task).status, 'ok');

assert.equal(
  normalizeEthereumExecutionResult({
    tx_hash: 'bad-hash',
  }).code,
  'ETHEREUM_TX_HASH_REQUIRED'
);
assert.equal(
  verifyEthereumAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        quote_id: 'wrong-quote',
      },
    },
    built.task
  ).code,
  'ETHEREUM_QUOTE_ID_MISMATCH'
);
assert.equal(
  verifyEthereumAgentTaskResult(
    {
      task_id: built.task.task_id,
      status: 'submitted',
      evidence: { venue_id: 'ethereum-mainnet' },
    },
    built.task
  ).code,
  'ETHEREUM_TX_HASH_REQUIRED'
);
assert.equal(
  verifyEthereumAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        venue_id: 'solana-mainnet',
      },
    },
    built.task
  ).code,
  'ETHEREUM_RESULT_VENUE_MISMATCH'
);
assert.equal(
  verifyEthereumAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        chain_id: 'eip155:8453',
      },
    },
    built.task
  ).code,
  'ETHEREUM_RESULT_CHAIN_MISMATCH'
);
assert.equal(
  verifyEthereumAgentTaskResult(
    {
      ...normalized,
      evidence: {
        ...normalized.evidence,
        receipt_status: '0x0',
      },
    },
    built.task
  ).code,
  'ETHEREUM_TRANSACTION_REVERTED'
);

console.log('ALL ETHEREUM TRADE TASK TESTS PASS');
