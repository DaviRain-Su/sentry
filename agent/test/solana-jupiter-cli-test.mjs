import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';

const owner = '11111111111111111111111111111111';
const inputMint = 'So11111111111111111111111111111111111111112';
const outputMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const swapTransaction = 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function startMockJupiter() {
  const calls = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({ method: req.method, path: url.pathname, headers: req.headers });
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/quote') {
      assert.equal(req.method, 'GET');
      assert.equal(url.searchParams.get('inputMint'), inputMint);
      assert.equal(url.searchParams.get('outputMint'), outputMint);
      assert.equal(url.searchParams.get('amount'), '1000000');
      assert.equal(url.searchParams.get('slippageBps'), '50');
      res.end(
        JSON.stringify({
          inputMint,
          outputMint,
          inAmount: '1000000',
          outAmount: '999000',
          otherAmountThreshold: '990000',
          routePlan: [{}],
        })
      );
      return;
    }
    if (url.pathname === '/swap') {
      assert.equal(req.method, 'POST');
      const body = JSON.parse(await readBody(req));
      assert.equal(body.userPublicKey, owner);
      assert.equal(body.quoteResponse.outAmount, '999000');
      res.end(JSON.stringify({ swapTransaction }));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        calls,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function runCli(task, baseUrl) {
  const cli = new URL('../src/index.mjs', import.meta.url);
  const child = spawn(
    process.execPath,
    [
      cli.pathname,
      'solana',
      'prepare-swap',
      '--jupiter-quote-url',
      `${baseUrl}/quote`,
      '--jupiter-swap-url',
      `${baseUrl}/swap`,
      '--now',
      '2026-06-04T00:00:00.000Z',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SENTRY_JUPITER_API_KEY: 'cli_secret_should_not_echo',
      },
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  child.stdin.end(`${JSON.stringify(task)}\n`);
  return new Promise((resolve) => {
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const built = buildSolanaSwapTask({
  taskId: 'task_solana_jupiter_cli_1',
  policyId: 'policy_solana_jupiter_cli',
  account: {
    owner,
    capabilities: ['read', 'sign', 'submit_tx'],
  },
  adapter: 'jupiter',
  inputMint,
  outputMint,
  amount: '1000000',
  slippageBps: 50,
  quoteId: 'quote_solana_jupiter_cli_1',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
});
assert.equal(built.status, 'ok');

const { server, calls, baseUrl } = await startMockJupiter();
try {
  const run = await runCli(built.task, baseUrl);
  assert.equal(run.code, 0);
  assert.equal(run.stderr, '');
  const lines = run.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(lines.length, 1);
  const result = JSON.parse(lines[0]);
  assert.equal(result.task_id, built.task.task_id);
  assert.equal(result.status, 'proposed');
  assert.equal(result.evidence.unsigned_transaction_base64, swapTransaction);
  assert.equal(result.evidence.quote_id, 'quote_solana_jupiter_cli_1');
  assert.deepEqual(result.evidence.required_signers, [owner]);
  assert.equal(JSON.stringify(result).includes('cli_secret_should_not_echo'), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers['x-api-key'], 'cli_secret_should_not_echo');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('ALL SOLANA JUPITER CLI TESTS PASS');
