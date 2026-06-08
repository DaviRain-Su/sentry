import assert from 'node:assert/strict';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import {
  DEFAULT_UNISWAP_V3_ROUTER,
  buildUniswapV3TransactionRequest,
  encodeUniswapV3ExactInputSingle,
  ethereumUniswapErrorResult,
  methodSelector,
  prepareEthereumUniswapSwap,
  simulateEthereumTransactionRequest,
} from '../src/ethereum-uniswap-calldata-builder.mjs';

const account = '0x0000000000000000000000000000000000000001';
const inputToken = '0x0000000000000000000000000000000000000002';
const outputToken = '0x0000000000000000000000000000000000000003';

const built = buildEthereumSwapTask({
  taskId: 'task_ethereum_uniswap_prepare_1',
  policyId: 'policy_ethereum_uniswap',
  account: {
    account,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'uniswap',
  inputToken,
  outputToken,
  amount: '1000000',
  minOutputAmount: '990000',
  slippageBps: 50,
  quoteId: 'quote_ethereum_uniswap_1',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
});
assert.equal(built.status, 'ok');

assert.equal(methodSelector(), '414bf389');

const calldata = encodeUniswapV3ExactInputSingle({
  tokenIn: inputToken,
  tokenOut: outputToken,
  fee: 3000,
  recipient: account,
  deadline: '1780000120',
  amountIn: '1000000',
  amountOutMinimum: '990000',
  sqrtPriceLimitX96: '0',
});
assert.equal(calldata.startsWith('0x414bf389'), true);
assert.equal(calldata.length, 10 + 64 * 8);
assert.equal(calldata.includes(inputToken.slice(2).padStart(64, '0')), true);
assert.equal(calldata.includes(outputToken.slice(2).padStart(64, '0')), true);

const request = buildUniswapV3TransactionRequest(built.task, {
  deadline: '1780000120',
});
assert.equal(request.status, 'ok');
assert.equal(request.transaction_request.from, account);
assert.equal(request.transaction_request.to, DEFAULT_UNISWAP_V3_ROUTER);
assert.equal(request.transaction_request.data, calldata);
assert.equal(request.transaction_request.value, '0x0');
assert.equal(request.uniswap.amount_out_minimum, '990000');

const missingMin = buildEthereumSwapTask({
  taskId: 'task_ethereum_uniswap_prepare_missing_min',
  account: {
    account,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'uniswap',
  inputToken,
  outputToken,
  amount: '1000000',
});
assert.equal(missingMin.status, 'ok');
assert.equal(buildUniswapV3TransactionRequest(missingMin.task).code, 'UNISWAP_MIN_OUTPUT_REQUIRED');

const simulated = await simulateEthereumTransactionRequest({
  request: request.transaction_request,
  rpcUrl: 'https://ethereum.test/rpc',
  fetchImpl: async (url, init = {}) => {
    assert.equal(url, 'https://ethereum.test/rpc');
    const body = JSON.parse(init.body);
    assert.equal(body.method, 'eth_call');
    assert.equal(body.params[0].from, account);
    assert.equal(body.params[0].to, DEFAULT_UNISWAP_V3_ROUTER);
    assert.equal(body.params[0].data, calldata);
    assert.equal(body.params[1], 'latest');
    return {
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' }),
    };
  },
});
assert.equal(simulated.status, 'ok');
assert.equal(simulated.simulation.status, 'ok');

const prepared = await prepareEthereumUniswapSwap({
  task: built.task,
  rpcUrl: 'https://ethereum.test/rpc',
  now: new Date('2026-06-04T00:00:00.000Z'),
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x' }),
  }),
});
assert.equal(prepared.status, 'ok');
assert.equal(prepared.result.status, 'proposed');
assert.equal(prepared.result.observed_at, '2026-06-04T00:00:00.000Z');
assert.equal(prepared.result.evidence.transaction_request.from, account);
assert.equal(prepared.result.evidence.transaction_request.to, DEFAULT_UNISWAP_V3_ROUTER);
assert.equal(prepared.result.evidence.transaction_request.data.startsWith('0x414bf389'), true);
assert.equal(prepared.result.evidence.quote_id, 'quote_ethereum_uniswap_1');
assert.equal(prepared.prepared_transaction.from, account);

const rpcFailed = await prepareEthereumUniswapSwap({
  task: built.task,
  rpcUrl: 'https://ethereum.test/rpc',
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32000, message: 'execution reverted' },
    }),
  }),
});
assert.equal(rpcFailed.code, 'ETHEREUM_SIMULATION_FAILED');

const offline = await prepareEthereumUniswapSwap({
  task: built.task,
  simulated: true,
});
assert.equal(offline.status, 'ok');
assert.equal(offline.result.evidence.simulation.status, 'simulated');

const errorResult = ethereumUniswapErrorResult(built.task, rpcFailed);
assert.equal(errorResult.task_id, built.task.task_id);
assert.equal(errorResult.status, 'error');
assert.equal(errorResult.evidence.quote_id, 'quote_ethereum_uniswap_1');

console.log('ALL ETHEREUM UNISWAP CALLDATA BUILDER TESTS PASS');
