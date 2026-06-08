import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  dispatchAgentTask,
  parseAgentJsonResult,
  parseCommandLine,
} from '../src/agent-dispatcher.mjs';
import { buildEthereumSwapTask } from '../../core/ethereum-trade.js';
import { buildHyperliquidPlaceOrderTask } from '../../core/hyperliquid-trade.js';
import { buildOkxPlaceOrderTask } from '../../core/okx-trade.js';
import { buildSolanaSwapTask } from '../../core/solana-trade.js';

function demoTask(overrides = {}) {
  return {
    task_id: 'task_demo_1',
    policy_id: 'policy_demo',
    venue_id: 'sui-testnet-demo',
    policy_context: {
      policy_id: 'policy_demo',
      venue_id: 'sui-testnet-demo',
    },
    action: {
      type: 'submit_tx',
      params: { dry_run: true },
    },
    constraints: {
      capabilities_required: ['submit_tx'],
      require_receipt: true,
    },
    authorization: {
      authorization_ref: 'sui-testnet-demo:policy-wrapper',
      venue_id: 'sui-testnet-demo',
      authorization_model: 'sentry_contract',
      enforcement_layer: 'chain',
      capabilities_required: ['submit_tx'],
    },
    issued_at_ms: Date.now(),
    expires_at_ms: Date.now() + 60_000,
    ...overrides,
  };
}

assert.deepEqual(parseCommandLine('node "agent task.mjs" --flag'), [
  'node',
  'agent task.mjs',
  '--flag',
]);
assert.equal(
  parseAgentJsonResult('log line\n{"task_id":"task_demo_1","status":"done","tx_digest":"0xabc"}\n')
    .status,
  'ok'
);

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-agent-dispatch-'));

try {
  const goodAgent = path.join(dir, 'good-agent.mjs');
  await writeFile(
    goodAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log('agent log before result');
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'done',
    summary: 'submitted demo tx',
    evidence: { tx_digest: '0xabc123' },
  }));
});
`
  );

  const ok = await dispatchAgentTask({
    task: demoTask(),
    commandLine: `${process.execPath} ${goodAgent}`,
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.local_decision, 'accepted_result');
  assert.equal(ok.agent_result.evidence.tx_digest, '0xabc123');
  assert.equal(JSON.stringify(ok).includes('agent log before result'), false);

  let spawned = false;
  const blocked = await dispatchAgentTask({
    task: demoTask({
      task_id: 'task_okx_1',
      venue_id: 'okx',
      policy_context: { venue_id: 'okx' },
      action: { type: 'place_order', params: { symbol: 'BTC-USDC' } },
      constraints: { capabilities_required: ['place_order'] },
      authorization: {
        authorization_ref: 'okx:key-handle',
        venue_id: 'okx',
        authorization_model: 'venue_api_key',
        enforcement_layer: 'venue',
        capabilities_required: ['place_order'],
      },
    }),
    commandLine: `${process.execPath} ${goodAgent}`,
    spawnImpl: () => {
      spawned = true;
      throw new Error('should not spawn');
    },
  });
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.code, 'ADAPTER_NOT_DISPATCH_READY');
  assert.equal(blocked.local_decision, 'blocked_before_dispatch');
  assert.equal(spawned, false);

  const secretAgent = path.join(dir, 'secret-agent.mjs');
  await writeFile(
    secretAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    task_id: 'task_demo_1',
    status: 'done',
    evidence: { tx_digest: '0xabc123' },
    api_secret: 'do-not-return-this',
  }));
});
`
  );
  const rejected = await dispatchAgentTask({
    task: demoTask(),
    commandLine: `${process.execPath} ${secretAgent}`,
  });
  assert.equal(rejected.status, 'error');
  assert.equal(rejected.code, 'RAW_SECRET_FIELD_REJECTED');
  assert.equal(JSON.stringify(rejected).includes('do-not-return-this'), false);

  const noEvidenceAgent = path.join(dir, 'no-evidence-agent.mjs');
  await writeFile(
    noEvidenceAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({ task_id: 'task_demo_1', status: 'done' }));
});
`
  );
  const noEvidence = await dispatchAgentTask({
    task: demoTask(),
    commandLine: `${process.execPath} ${noEvidenceAgent}`,
  });
  assert.equal(noEvidence.status, 'error');
  assert.equal(noEvidence.code, 'EXECUTION_EVIDENCE_REQUIRED');

  const okxTask = buildOkxPlaceOrderTask({
    taskId: 'task_okx_dispatch_1',
    keyMetadata: {
      venue_id: 'okx',
      key_handle: 'okx_key_dispatch',
      account_ref: 'okx:subaccount:dispatch',
      permissions: ['read', 'place_order', 'cancel_order'],
    },
    instrument: 'BTC-USDT',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    clientOrderId: 'sentry-okx-dispatch-1',
  });
  assert.equal(okxTask.status, 'ok');

  let okxSpawnedBeforeReady = false;
  const okxBlockedBeforeReady = await dispatchAgentTask({
    task: okxTask.task,
    commandLine: `${process.execPath} ${goodAgent}`,
    spawnImpl: () => {
      okxSpawnedBeforeReady = true;
      throw new Error('should not spawn');
    },
  });
  assert.equal(okxBlockedBeforeReady.status, 'error');
  assert.equal(okxBlockedBeforeReady.code, 'ADAPTER_NOT_DISPATCH_READY');
  assert.equal(okxSpawnedBeforeReady, false);

  const okxAgent = path.join(dir, 'okx-agent.mjs');
  await writeFile(
    okxAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: 'okx-order-123',
      client_order_id: task.action.params.clOrdId,
    },
  }));
});
`
  );
  const okxDispatch = await dispatchAgentTask({
    task: okxTask.task,
    commandLine: `${process.execPath} ${okxAgent}`,
    localDispatchReadyVenues: ['okx'],
  });
  assert.equal(okxDispatch.status, 'ok');
  assert.equal(okxDispatch.authorization.dispatch_ready_source, 'local_daemon');
  assert.equal(okxDispatch.agent_result.evidence.venue_order_id, 'okx-order-123');

  const badOkxAgent = path.join(dir, 'bad-okx-agent.mjs');
  await writeFile(
    badOkxAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    task_id: 'task_okx_dispatch_1',
    status: 'submitted',
    evidence: {
      venue_id: 'okx',
      venue_order_id: 'okx-order-123',
      client_order_id: 'wrong-client-id',
    },
  }));
});
`
  );
  const badOkxDispatch = await dispatchAgentTask({
    task: okxTask.task,
    commandLine: `${process.execPath} ${badOkxAgent}`,
    localDispatchReadyVenues: ['okx'],
  });
  assert.equal(badOkxDispatch.status, 'error');
  assert.equal(badOkxDispatch.code, 'OKX_CLIENT_ORDER_ID_MISMATCH');

  const hyperliquidTask = buildHyperliquidPlaceOrderTask({
    taskId: 'task_hl_dispatch_1',
    keyMetadata: {
      venue_id: 'hyperliquid',
      key_handle: 'hl_agent_dispatch',
      account_ref: 'hyperliquid:subaccount:dispatch',
      read_account_address: '0x0000000000000000000000000000000000000001',
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    },
    coin: 'BTC',
    side: 'buy',
    orderType: 'limit',
    size: '0.01',
    price: '99000',
    cloid: '0x00000000000000000000000000000011',
  });
  assert.equal(hyperliquidTask.status, 'ok');

  const hyperliquidAgent = path.join(dir, 'hyperliquid-agent.mjs');
  await writeFile(
    hyperliquidAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'submitted',
    evidence: {
      venue_id: 'hyperliquid',
      venue_order_id: 'hl-order-123',
      client_order_id: task.action.params.cloid,
      coin: task.action.params.coin,
    },
  }));
});
`
  );
  const hyperliquidDispatch = await dispatchAgentTask({
    task: hyperliquidTask.task,
    commandLine: `${process.execPath} ${hyperliquidAgent}`,
    localDispatchReadyVenues: ['hyperliquid'],
  });
  assert.equal(hyperliquidDispatch.status, 'ok');
  assert.equal(hyperliquidDispatch.authorization.dispatch_ready_source, 'local_daemon');
  assert.equal(hyperliquidDispatch.agent_result.evidence.venue_order_id, 'hl-order-123');

  const badHyperliquidAgent = path.join(dir, 'bad-hyperliquid-agent.mjs');
  await writeFile(
    badHyperliquidAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    task_id: 'task_hl_dispatch_1',
    status: 'submitted',
    evidence: {
      venue_id: 'hyperliquid',
      venue_order_id: 'hl-order-123',
      client_order_id: '0x00000000000000000000000000000012',
      coin: 'BTC',
    },
  }));
});
`
  );
  const badHyperliquidDispatch = await dispatchAgentTask({
    task: hyperliquidTask.task,
    commandLine: `${process.execPath} ${badHyperliquidAgent}`,
    localDispatchReadyVenues: ['hyperliquid'],
  });
  assert.equal(badHyperliquidDispatch.status, 'error');
  assert.equal(badHyperliquidDispatch.code, 'HYPERLIQUID_CLOID_MISMATCH');

  const solanaTask = buildSolanaSwapTask({
    taskId: 'task_solana_dispatch_1',
    account: {
      owner: '11111111111111111111111111111111',
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    adapter: 'jupiter',
    inputMint: 'So11111111111111111111111111111111111111112',
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    amount: '1000000',
    quoteId: 'quote_solana_dispatch_1',
  });
  assert.equal(solanaTask.status, 'ok');
  const solanaSignature =
    '5KJvsngHeMpm884wtmM1ke22tjhMgZorT1fdS1T8yPzJkQdY1LZQmibZQj1A7wB8Qz3n8YdDsZc8QmvM1Qx3abc';
  const solanaAgent = path.join(dir, 'solana-agent.mjs');
  await writeFile(
    solanaAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'submitted',
    evidence: {
      venue_id: 'solana-mainnet',
      signature: '${solanaSignature}',
      quote_id: task.action.params.quote_id,
      confirmation_status: 'confirmed',
    },
  }));
});
`
  );
  const solanaDispatch = await dispatchAgentTask({
    task: solanaTask.task,
    commandLine: `${process.execPath} ${solanaAgent}`,
    localDispatchReadyVenues: ['solana-mainnet'],
  });
  assert.equal(solanaDispatch.status, 'ok');
  assert.equal(solanaDispatch.authorization.dispatch_ready_source, 'local_daemon');
  assert.equal(solanaDispatch.agent_result.evidence.signature, solanaSignature);

  const solanaProposedAgent = path.join(dir, 'solana-proposed-agent.mjs');
  await writeFile(
    solanaProposedAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'proposed',
    evidence: {
      venue_id: 'solana-mainnet',
      chain_id: 'solana:mainnet',
      quote_id: task.action.params.quote_id,
      unsigned_transaction_base64: 'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      required_signers: [task.action.params.owner],
      simulation: { status: 'ok', units_consumed: 1000 },
    },
  }));
});
`
  );
  const solanaProposedDispatch = await dispatchAgentTask({
    task: solanaTask.task,
    commandLine: `${process.execPath} ${solanaProposedAgent}`,
    localDispatchReadyVenues: ['solana-mainnet'],
  });
  assert.equal(solanaProposedDispatch.status, 'ok');
  assert.equal(solanaProposedDispatch.agent_result.status, 'proposed');
  assert.equal(
    solanaProposedDispatch.agent_result.evidence.unsigned_transaction_base64.includes('AAAA'),
    true
  );

  const badSolanaAgent = path.join(dir, 'bad-solana-agent.mjs');
  await writeFile(
    badSolanaAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    task_id: 'task_solana_dispatch_1',
    status: 'submitted',
    evidence: {
      venue_id: 'solana-mainnet',
      signature: '${solanaSignature}',
      quote_id: 'wrong-quote',
    },
  }));
});
`
  );
  const badSolanaDispatch = await dispatchAgentTask({
    task: solanaTask.task,
    commandLine: `${process.execPath} ${badSolanaAgent}`,
    localDispatchReadyVenues: ['solana-mainnet'],
  });
  assert.equal(badSolanaDispatch.status, 'error');
  assert.equal(badSolanaDispatch.code, 'SOLANA_QUOTE_ID_MISMATCH');

  const ethereumTask = buildEthereumSwapTask({
    taskId: 'task_ethereum_dispatch_1',
    account: {
      account: '0x0000000000000000000000000000000000000001',
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    adapter: 'uniswap',
    inputToken: '0x0000000000000000000000000000000000000002',
    outputToken: '0x0000000000000000000000000000000000000003',
    amount: '1000000',
    quoteId: 'quote_ethereum_dispatch_1',
  });
  assert.equal(ethereumTask.status, 'ok');
  const ethereumTxHash = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const ethereumAgent = path.join(dir, 'ethereum-agent.mjs');
  await writeFile(
    ethereumAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'done',
    evidence: {
      venue_id: 'ethereum-mainnet',
      chain_id: 'eip155:1',
      tx_hash: '${ethereumTxHash}',
      transaction_hash: '${ethereumTxHash}',
      quote_id: task.action.params.quote_id,
      receipt_status: '0x1',
    },
  }));
});
`
  );
  const ethereumDispatch = await dispatchAgentTask({
    task: ethereumTask.task,
    commandLine: `${process.execPath} ${ethereumAgent}`,
    localDispatchReadyVenues: ['ethereum-mainnet'],
  });
  assert.equal(ethereumDispatch.status, 'ok');
  assert.equal(ethereumDispatch.authorization.dispatch_ready_source, 'local_daemon');
  assert.equal(ethereumDispatch.agent_result.evidence.tx_hash, ethereumTxHash);

  const badEthereumProposedAgent = path.join(dir, 'bad-ethereum-proposed-agent.mjs');
  await writeFile(
    badEthereumProposedAgent,
    `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk.toString(); });
process.stdin.on('end', () => {
  const task = JSON.parse(input);
  console.log(JSON.stringify({
    task_id: task.task_id,
    status: 'proposed',
    evidence: {
      venue_id: 'ethereum-mainnet',
      chain_id: 'eip155:1',
      quote_id: task.action.params.quote_id,
      transaction_request: {
        from: '0x0000000000000000000000000000000000000005',
        to: '0x0000000000000000000000000000000000000004',
        data: '0x095ea7b3',
        value: '0',
      },
      simulation: { status: 'success' },
    },
  }));
});
`
  );
  const badEthereumProposedDispatch = await dispatchAgentTask({
    task: ethereumTask.task,
    commandLine: `${process.execPath} ${badEthereumProposedAgent}`,
    localDispatchReadyVenues: ['ethereum-mainnet'],
  });
  assert.equal(badEthereumProposedDispatch.status, 'error');
  assert.equal(badEthereumProposedDispatch.code, 'ETHEREUM_FROM_ADDRESS_MISMATCH');

  const badEthereumAgent = path.join(dir, 'bad-ethereum-agent.mjs');
  await writeFile(
    badEthereumAgent,
    `
process.stdin.resume();
process.stdin.on('end', () => {
  console.log(JSON.stringify({
    task_id: 'task_ethereum_dispatch_1',
    status: 'done',
    evidence: {
      venue_id: 'ethereum-mainnet',
      chain_id: 'eip155:1',
      tx_hash: '${ethereumTxHash}',
      quote_id: 'wrong-quote',
      receipt_status: '0x1',
    },
  }));
});
`
  );
  const badEthereumDispatch = await dispatchAgentTask({
    task: ethereumTask.task,
    commandLine: `${process.execPath} ${badEthereumAgent}`,
    localDispatchReadyVenues: ['ethereum-mainnet'],
  });
  assert.equal(badEthereumDispatch.status, 'error');
  assert.equal(badEthereumDispatch.code, 'ETHEREUM_QUOTE_ID_MISMATCH');

  const badTask = await dispatchAgentTask({
    task: demoTask({ api_secret: 'never-send-this' }),
    commandLine: `${process.execPath} ${goodAgent}`,
  });
  assert.equal(badTask.status, 'error');
  assert.equal(badTask.code, 'RAW_SECRET_FIELD_REJECTED');
  assert.equal(JSON.stringify(badTask).includes('never-send-this'), false);

  console.log('ALL AGENT DISPATCHER TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
