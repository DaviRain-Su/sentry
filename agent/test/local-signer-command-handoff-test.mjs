import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import {
  resolveLocalSignerCommand,
  submitPreparedTransactionWithSignerCommand,
} from '../src/local-signer-command-handoff.mjs';

const timestamp = '2026-06-03T00:00:00.000Z';
const solanaOwner = '11111111111111111111111111111111';
const solanaSignature =
  '5KJvsngHeMpm884wtmM1ke22tjhMgZorT1fdS1T8yPzJkQdY1LZQmibZQj1A7wB8Qz3n8YdDsZc8QmvM1Qx3abc';
const ethereumAccount = '0x0000000000000000000000000000000000000001';
const ethereumTxHash = '0x1111111111111111111111111111111111111111111111111111111111111111';

function mockSignerSpawn(handler) {
  const calls = [];
  const spawnImpl = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let stdinBody = '';
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        stdinBody += chunk.toString();
        callback();
      },
      final(callback) {
        const payload = JSON.parse(stdinBody);
        calls.push({ cmd, args, env: options.env, payload });
        Promise.resolve(handler({ cmd, args, env: options.env, payload }))
          .then((result = {}) => {
            if (result.stderr) child.stderr.emit('data', Buffer.from(result.stderr));
            if (result.stdout) child.stdout.emit('data', Buffer.from(result.stdout));
            child.emit('close', result.exitCode ?? 0, result.signal ?? null);
          })
          .catch((error) => {
            child.emit('error', error);
          });
        callback();
      },
    });
    child.kill = () => {
      child.killed = true;
    };
    return child;
  };
  return { calls, spawnImpl };
}

const solanaTaskBuilt = buildSolanaSwapTask({
  taskId: 'task_solana_signer_handoff_1',
  account: {
    owner: solanaOwner,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'jupiter',
  inputMint: 'So11111111111111111111111111111111111111112',
  outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  amount: '1000000',
  quoteId: 'quote_solana_signer_handoff_1',
});
assert.equal(solanaTaskBuilt.status, 'ok');
const solanaUnsigned = Buffer.from('unsigned-solana-transaction-payload').toString('base64');
const solanaProposedDispatch = {
  status: 'ok',
  local_decision: 'accepted_result',
  task_id: solanaTaskBuilt.task.task_id,
  agent_result: {
    task_id: solanaTaskBuilt.task.task_id,
    status: 'proposed',
    evidence: {
      venue_id: 'solana-mainnet',
      chain_id: 'solana:mainnet',
      quote_id: 'quote_solana_signer_handoff_1',
      unsigned_transaction_base64: solanaUnsigned,
      required_signers: [solanaOwner],
      simulation: { status: 'ok' },
    },
  },
};

const solanaMock = mockSignerSpawn(({ payload }) => {
  assert.equal(payload.type, 'sentry.signer.submit_prepared_transaction');
  assert.equal(payload.venue_id, 'solana-mainnet');
  assert.equal(payload.prepared_transaction.unsigned_transaction_base64, solanaUnsigned);
  assert.deepEqual(payload.prepared_transaction.required_signers, [solanaOwner]);
  assert.equal(JSON.stringify(payload).includes('private_key'), false);
  return {
    stdout: `logs before json\n${JSON.stringify({ signature: solanaSignature })}\n`,
  };
});
const solanaSubmitted = await submitPreparedTransactionWithSignerCommand({
  task: solanaTaskBuilt.task,
  dispatch: solanaProposedDispatch,
  env: { SENTRY_SOLANA_SIGNER_COMMAND: 'ows-solana submit' },
  spawnImpl: solanaMock.spawnImpl,
  now: new Date(timestamp),
});
assert.equal(solanaSubmitted.status, 'ok');
assert.equal(solanaSubmitted.dispatch.agent_result.status, 'submitted');
assert.equal(solanaSubmitted.dispatch.agent_result.evidence.signature, solanaSignature);
assert.equal(
  solanaSubmitted.signer_handoff.prepared_transaction_format,
  'solana_unsigned_transaction_base64'
);
assert.deepEqual(solanaMock.calls[0].args, ['submit']);

const missingSolanaCommand = await submitPreparedTransactionWithSignerCommand({
  task: solanaTaskBuilt.task,
  dispatch: solanaProposedDispatch,
  env: {},
  spawnImpl: solanaMock.spawnImpl,
});
assert.equal(missingSolanaCommand.status, 'error');
assert.equal(missingSolanaCommand.code, 'SOLANA_SIGNER_COMMAND_REQUIRED');

const secretArg = resolveLocalSignerCommand({
  task: solanaTaskBuilt.task,
  commandLine: 'ows-solana submit --private-key abc',
});
assert.equal(secretArg.status, 'error');
assert.equal(secretArg.code, 'SIGNER_COMMAND_SECRET_ARG_REJECTED');

const ethereumTaskBuilt = buildEthereumSwapTask({
  taskId: 'task_ethereum_signer_handoff_1',
  account: {
    account: ethereumAccount,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'uniswap',
  inputToken: '0x0000000000000000000000000000000000000002',
  outputToken: '0x0000000000000000000000000000000000000003',
  amount: '1000000',
  quoteId: 'quote_ethereum_signer_handoff_1',
});
assert.equal(ethereumTaskBuilt.status, 'ok');
const ethereumProposedDispatch = {
  status: 'ok',
  local_decision: 'accepted_result',
  task_id: ethereumTaskBuilt.task.task_id,
  agent_result: {
    task_id: ethereumTaskBuilt.task.task_id,
    status: 'proposed',
    evidence: {
      venue_id: 'ethereum-mainnet',
      chain_id: 'eip155:1',
      quote_id: 'quote_ethereum_signer_handoff_1',
      transaction_request: {
        from: ethereumAccount,
        to: '0xe592427a0aece92de3edee1f18e0157c05861564',
        data: '0x414bf389',
        value: '0',
      },
      simulation: { status: 'ok' },
    },
  },
};
const ethereumMock = mockSignerSpawn(({ payload }) => {
  assert.equal(payload.venue_id, 'ethereum-mainnet');
  assert.equal(payload.prepared_transaction.transaction_request.from, ethereumAccount);
  assert.equal(payload.prepared_transaction.transaction_request.data, '0x414bf389');
  return {
    stdout: `${JSON.stringify({ tx_hash: ethereumTxHash, status: 'submitted' })}\n`,
  };
});
const ethereumSubmitted = await submitPreparedTransactionWithSignerCommand({
  task: ethereumTaskBuilt.task,
  dispatch: ethereumProposedDispatch,
  env: { SENTRY_ETHEREUM_SIGNER_COMMAND: 'safe-cli send-json' },
  spawnImpl: ethereumMock.spawnImpl,
  now: new Date(timestamp),
});
assert.equal(ethereumSubmitted.status, 'ok');
assert.equal(ethereumSubmitted.dispatch.agent_result.status, 'submitted');
assert.equal(ethereumSubmitted.dispatch.agent_result.evidence.tx_hash, ethereumTxHash);
assert.equal(
  ethereumSubmitted.signer_handoff.prepared_transaction_format,
  'evm_transaction_request'
);
assert.deepEqual(ethereumMock.calls[0].args, ['send-json']);

const signerReturnedProposed = mockSignerSpawn(() => ({
  stdout: `${JSON.stringify(ethereumProposedDispatch.agent_result)}\n`,
}));
const rejectedProposed = await submitPreparedTransactionWithSignerCommand({
  task: ethereumTaskBuilt.task,
  dispatch: ethereumProposedDispatch,
  env: { SENTRY_ETHEREUM_SIGNER_COMMAND: 'safe-cli send-json' },
  spawnImpl: signerReturnedProposed.spawnImpl,
});
assert.equal(rejectedProposed.status, 'error');
assert.equal(rejectedProposed.code, 'SIGNER_SUBMITTED_RESULT_REQUIRED');

console.log('ALL LOCAL SIGNER COMMAND HANDOFF TESTS PASS');
