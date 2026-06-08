import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';

const account = '0x0000000000000000000000000000000000000001';
const inputToken = '0x0000000000000000000000000000000000000002';
const outputToken = '0x0000000000000000000000000000000000000003';

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
  });
}

function startMockRpc() {
  const calls = [];
  const server = createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    const body = JSON.parse(await readBody(req));
    calls.push(body);
    assert.equal(body.method, 'eth_call');
    assert.equal(body.params[0].from, account);
    assert.equal(body.params[0].data.startsWith('0x414bf389'), true);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0x' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        calls,
        rpcUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function runCli(task, rpcUrl) {
  const cli = new URL('../src/index.mjs', import.meta.url);
  const child = spawn(
    process.execPath,
    [
      cli.pathname,
      'ethereum',
      'prepare-swap',
      '--rpc-url',
      rpcUrl,
      '--now',
      '2026-06-04T00:00:00.000Z',
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
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

const built = buildEthereumSwapTask({
  taskId: 'task_ethereum_uniswap_cli_1',
  policyId: 'policy_ethereum_uniswap_cli',
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
  quoteId: 'quote_ethereum_uniswap_cli_1',
  nowMs: 1_780_000_000_000,
  expiresAtMs: 1_780_000_120_000,
});
assert.equal(built.status, 'ok');

const { server, calls, rpcUrl } = await startMockRpc();
try {
  const run = await runCli(built.task, rpcUrl);
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
  assert.equal(result.evidence.quote_id, 'quote_ethereum_uniswap_cli_1');
  assert.equal(result.evidence.transaction_request.from, account);
  assert.equal(result.evidence.transaction_request.data.startsWith('0x414bf389'), true);
  assert.equal(result.evidence.simulation.status, 'ok');
  assert.equal(calls.length, 1);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('ALL ETHEREUM UNISWAP CLI TESTS PASS');
