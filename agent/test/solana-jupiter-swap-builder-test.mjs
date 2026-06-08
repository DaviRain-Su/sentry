import assert from 'node:assert/strict';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';
import {
  buildJupiterQuoteRequest,
  buildJupiterSwapRequest,
  normalizeJupiterQuoteResponse,
  normalizeJupiterSwapResponse,
  prepareSolanaJupiterSwap,
  solanaJupiterErrorResult,
} from '../src/solana-jupiter-swap-builder.mjs';

const owner = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const built = buildSolanaSwapTask({
  taskId: 'task_solana_jupiter_prepare_1',
  policyId: 'policy_solana_jupiter',
  account: {
    owner,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'jupiter',
  inputMint,
  outputMint,
  amount: '1000000',
  slippageBps: 50,
  quoteId: 'quote_solana_jupiter_1',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
});
assert.equal(built.status, 'ok');

const quoteResponse = {
  inputMint,
  outputMint,
  inAmount: '1000000',
  outAmount: '999000',
  otherAmountThreshold: '990000',
  priceImpactPct: '0.001',
  routePlan: [{ swapInfo: { label: 'Jupiter' } }],
};

const quoteRequest = buildJupiterQuoteRequest(built.task, {
  quoteUrl: 'https://jupiter.test/quote',
});
assert.equal(quoteRequest.status, 'ok');
const quoteUrl = new URL(quoteRequest.url);
assert.equal(quoteUrl.searchParams.get('inputMint'), inputMint);
assert.equal(quoteUrl.searchParams.get('outputMint'), outputMint);
assert.equal(quoteUrl.searchParams.get('amount'), '1000000');
assert.equal(quoteUrl.searchParams.get('slippageBps'), '50');
assert.equal(quoteUrl.searchParams.get('swapMode'), 'ExactIn');

const normalizedQuote = normalizeJupiterQuoteResponse(quoteResponse, built.task);
assert.equal(normalizedQuote.status, 'ok');
assert.equal(normalizedQuote.summary.out_amount, '999000');
assert.equal(
  normalizeJupiterQuoteResponse({ ...quoteResponse, inputMint: outputMint }, built.task).code,
  'JUPITER_QUOTE_INPUT_MINT_MISMATCH'
);
assert.equal(
  normalizeJupiterQuoteResponse({ ...quoteResponse, outAmount: '0' }, built.task).code,
  'JUPITER_QUOTE_OUT_AMOUNT_REQUIRED'
);

const swapRequest = buildJupiterSwapRequest(built.task, quoteResponse, {
  swapUrl: 'https://jupiter.test/swap',
});
assert.equal(swapRequest.status, 'ok');
assert.equal(swapRequest.url, 'https://jupiter.test/swap');
assert.equal(swapRequest.body.userPublicKey, owner);
assert.deepEqual(swapRequest.body.quoteResponse, quoteResponse);
assert.equal(swapRequest.body.wrapAndUnwrapSol, true);

const swapTransaction = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
const normalizedSwap = normalizeJupiterSwapResponse(
  { swapTransaction },
  built.task,
  normalizedQuote
);
assert.equal(normalizedSwap.status, 'ok');
assert.equal(normalizedSwap.result.status, 'proposed');
assert.equal(normalizedSwap.result.evidence.unsigned_transaction_base64, swapTransaction);
assert.deepEqual(normalizedSwap.result.evidence.required_signers, [owner]);
assert.equal(normalizedSwap.result.evidence.quote_id, 'quote_solana_jupiter_1');

assert.equal(
  normalizeJupiterSwapResponse(
    { swapTransaction, simulationError: { message: 'insufficient funds' } },
    built.task,
    normalizedQuote
  ).code,
  'SOLANA_SIMULATION_FAILED'
);
assert.equal(
  normalizeJupiterSwapResponse({}, built.task, normalizedQuote).code,
  'SOLANA_UNSIGNED_TRANSACTION_REQUIRED'
);

const fetchCalls = [];
const prepared = await prepareSolanaJupiterSwap({
  task: built.task,
  env: {
    SENTRY_JUPITER_API_KEY: 'jup_secret_key_should_not_echo',
  },
  quoteUrl: 'https://jupiter.test/quote',
  swapUrl: 'https://jupiter.test/swap',
  now: new Date('2026-06-04T00:00:00.000Z'),
  fetchImpl: async (url, init = {}) => {
    fetchCalls.push({ url, init });
    if (String(url).startsWith('https://jupiter.test/quote')) {
      assert.equal(init.headers['x-api-key'], 'jup_secret_key_should_not_echo');
      return {
        ok: true,
        status: 200,
        json: async () => quoteResponse,
      };
    }
    assert.equal(url, 'https://jupiter.test/swap');
    const body = JSON.parse(init.body);
    assert.equal(body.userPublicKey, owner);
    assert.equal(body.quoteResponse.outAmount, '999000');
    assert.equal(init.headers['x-api-key'], 'jup_secret_key_should_not_echo');
    return {
      ok: true,
      status: 200,
      json: async () => ({ swapTransaction }),
    };
  },
});
assert.equal(prepared.status, 'ok');
assert.equal(prepared.result.status, 'proposed');
assert.equal(prepared.result.observed_at, '2026-06-04T00:00:00.000Z');
assert.equal(prepared.quote.out_amount, '999000');
assert.equal(fetchCalls.length, 2);
assert.equal(JSON.stringify(prepared).includes('jup_secret_key_should_not_echo'), false);

const httpFailed = await prepareSolanaJupiterSwap({
  task: built.task,
  quoteUrl: 'https://jupiter.test/quote',
  fetchImpl: async () => ({
    ok: false,
    status: 429,
    json: async () => ({ code: 'rate_limited', message: 'slow down' }),
  }),
});
assert.equal(httpFailed.code, 'JUPITER_QUOTE_HTTP_ERROR');
assert.equal(httpFailed.http_status, 429);

const errorResult = solanaJupiterErrorResult(built.task, httpFailed);
assert.equal(errorResult.task_id, built.task.task_id);
assert.equal(errorResult.status, 'error');
assert.equal(errorResult.evidence.quote_id, 'quote_solana_jupiter_1');

console.log('ALL SOLANA JUPITER SWAP BUILDER TESTS PASS');
