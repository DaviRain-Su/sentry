import assert from 'node:assert/strict';
import {
  buildLocalPolicyMetadata,
  hasLocalPolicyTemplates,
  localPolicyAuthorizationIssues,
  localPolicyTemplateVenueIds,
} from '../src/local-policy-metadata.js';

const multivenueValues = {
  scenario: 'spot',
  budget: 1000,
  slip: 0.5,
  expiry: 10,
  legs: [
    { venue: 'OKX', side: 'buy', pct: 25 },
    { venue: 'Raydium', side: 'buy', pct: 25 },
    { venue: 'Uniswap', side: 'buy', pct: 25 },
    { venue: 'Hyperliquid', side: 'sell', pct: 25 },
  ],
};
const liveSolanaOwner = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWtApF92LFWz9WZ';
const liveEthereumAccount = '0x2222222222222222222222222222222222222222';

assert.equal(hasLocalPolicyTemplates(multivenueValues), true);
assert.deepEqual(localPolicyTemplateVenueIds(multivenueValues), [
  'okx',
  'solana-mainnet',
  'ethereum-mainnet',
  'hyperliquid',
]);
assert.deepEqual(
  localPolicyAuthorizationIssues(multivenueValues, {}).map((issue) => issue.venue_id),
  ['okx', 'solana-mainnet', 'ethereum-mainnet', 'hyperliquid']
);

const missingVenueKeyIssues = localPolicyAuthorizationIssues(
  multivenueValues,
  missingVenueKeyContext()
);
assert.deepEqual(
  missingVenueKeyIssues.map((issue) => issue.code),
  ['VENUE_KEY_MISSING', 'VENUE_KEY_MISSING']
);
assert.deepEqual(
  missingVenueKeyIssues.map((issue) => issue.venue_id),
  ['okx', 'hyperliquid']
);

const blockedHyperliquidIssues = localPolicyAuthorizationIssues(
  {
    scenario: 'funding-arb',
    legs: [{ venue: 'Hyperliquid', side: 'buy', pct: 100 }],
  },
  blockedHyperliquidContext()
);
assert.deepEqual(
  blockedHyperliquidIssues.map((issue) => issue.code),
  ['HYPERLIQUID_AGENT_WALLET_MISSING']
);

const policy = buildLocalPolicyMetadata({
  values: multivenueValues,
  meta: { name: 'UI multivenue local policy' },
  text: 'Buy OKX, Raydium and Uniswap legs while hedging on Hyperliquid',
  targetAgent: 'codex',
});

assert.equal(policy.target_agent, 'codex');
assert.deepEqual(policy.target_venue_ids, [
  'okx',
  'solana-mainnet',
  'ethereum-mainnet',
  'hyperliquid',
]);
assert.equal(policy.task_templates.length, 4);
assert.deepEqual(
  policy.task_templates.map((template) => template.venue_id),
  ['okx', 'solana-mainnet', 'ethereum-mainnet', 'hyperliquid']
);

const okx = policy.task_templates.find((template) => template.venue_id === 'okx');
assert.equal(okx.action_type, 'place_order');
assert.equal(okx.instrument, 'BTC-USDT');
assert.equal(okx.clientOrderId.startsWith('sentry-ui-'), true);

const solana = policy.task_templates.find((template) => template.venue_id === 'solana-mainnet');
assert.equal(solana.action_type, 'swap');
assert.equal(solana.adapter, 'raydium');
assert.equal(solana.account.owner, '11111111111111111111111111111111');
assert.equal(solana.max_slippage_bps, 50);

const ethereum = policy.task_templates.find((template) => template.venue_id === 'ethereum-mainnet');
assert.equal(ethereum.action_type, 'swap');
assert.equal(ethereum.adapter, 'uniswap');
assert.equal(ethereum.account.account, '0x1111111111111111111111111111111111111111');
assert.equal(ethereum.max_slippage_bps, 50);

const hyperliquid = policy.task_templates.find((template) => template.venue_id === 'hyperliquid');
assert.equal(hyperliquid.action_type, 'place_order');
assert.equal(hyperliquid.coin, 'BTC');
assert.equal(hyperliquid.cloid.startsWith('0x'), true);
assert.equal(hyperliquid.max_slippage_bps, 50);

assert.equal(
  hasLocalPolicyTemplates({ scenario: 'lend', legs: [{ venue: 'OKX', pct: 100 }] }),
  false
);
assert.deepEqual(localPolicyTemplateVenueIds({ scenario: 'lend', legs: [{ venue: 'OKX' }] }), []);

const liveAuthorizationContext = contextPolicyContext();
const contextPolicy = buildLocalPolicyMetadata({
  values: multivenueValues,
  meta: { name: 'UI multivenue local policy with refs' },
  text: 'Use real local refs',
  targetAgent: 'codex',
  authorizationContext: liveAuthorizationContext,
});

assert.deepEqual(localPolicyAuthorizationIssues(multivenueValues, liveAuthorizationContext), []);

const contextOkx = contextPolicy.task_templates.find((template) => template.venue_id === 'okx');
assert.equal(contextOkx.key_handle, 'okx_live_key');
assert.equal(contextOkx.authorization_ref, 'okx:okx_live_key');
assert.equal(contextOkx.account_ref, 'okx:subaccount:live');

const contextHyperliquid = contextPolicy.task_templates.find(
  (template) => template.venue_id === 'hyperliquid'
);
assert.equal(contextHyperliquid.key_handle, 'hl_live_key');
assert.equal(contextHyperliquid.authorization_ref, 'hyperliquid:hl_live_key');
assert.equal(contextHyperliquid.account_ref, 'hyperliquid:subaccount:live');
assert.equal(contextHyperliquid.read_account_address, '0x3333333333333333333333333333333333333333');
assert.equal(contextHyperliquid.agent_wallet_address, '0x4444444444444444444444444444444444444444');

const contextSolana = contextPolicy.task_templates.find(
  (template) => template.venue_id === 'solana-mainnet'
);
assert.equal(contextSolana.account.owner, liveSolanaOwner);
assert.equal(contextSolana.account.wallet_id, 'ows-live');
assert.equal(contextSolana.account.caip10, `solana:mainnet:${liveSolanaOwner}`);

const contextEthereum = contextPolicy.task_templates.find(
  (template) => template.venue_id === 'ethereum-mainnet'
);
assert.equal(contextEthereum.account.account, liveEthereumAccount);
assert.equal(contextEthereum.account.wallet_id, 'ows-live');
assert.equal(contextEthereum.account.caip10, `eip155:1:${liveEthereumAccount}`);

console.log('local-policy-metadata-test: ok');

function contextPolicyContext() {
  return {
    authorizationState: {
      states: [
        {
          venue_id: 'okx',
          authorization_ref: { ref: 'okx:okx_live_key' },
          key_handle: 'okx_display_only',
          account_ref: 'okx:subaccount:live',
        },
        {
          venue_id: 'hyperliquid',
          authorization_ref: { ref: 'hyperliquid:hl_live_key' },
          key_handle: 'hl_display_only',
          account_ref: 'hyperliquid:subaccount:live',
          read_state: {
            read_account_address: '0x3333333333333333333333333333333333333333',
          },
          agent_wallet: {
            address: '0x4444444444444444444444444444444444444444',
          },
        },
      ],
    },
    walletRefs: {
      wallets: [
        {
          wallet_id: 'ows-live',
          display_name: 'OWS live wallet',
          accounts: [
            {
              chain_id: 'solana:mainnet',
              address: liveSolanaOwner,
              caip10: `solana:mainnet:${liveSolanaOwner}`,
              capabilities: ['read', 'sign', 'submit_tx'],
            },
            {
              chain_id: 'eip155:1',
              address: liveEthereumAccount,
              caip10: `eip155:1:${liveEthereumAccount}`,
              capabilities: ['read', 'sign', 'submit_tx'],
            },
          ],
        },
      ],
    },
  };
}

function missingVenueKeyContext() {
  return {
    authorizationState: {
      states: [
        {
          venue_id: 'okx',
          status: 'missing',
          authorization_ref: { ref: 'okx:key-handle' },
          key_handle: null,
          access_issues: [
            {
              venue_id: 'okx',
              code: 'VENUE_KEY_MISSING',
              severity: 'blocked',
              message: 'OKX needs a local metadata key handle before authorization can be used.',
            },
          ],
        },
        {
          venue_id: 'hyperliquid',
          status: 'missing',
          authorization_ref: { ref: 'hyperliquid:key-handle' },
          key_handle: null,
          access_issues: [
            {
              venue_id: 'hyperliquid',
              code: 'VENUE_KEY_MISSING',
              severity: 'blocked',
              message:
                'Hyperliquid needs a local metadata key handle before authorization can be used.',
            },
          ],
        },
      ],
    },
    walletRefs: contextPolicyContext().walletRefs,
  };
}

function blockedHyperliquidContext() {
  return {
    authorizationState: {
      states: [
        {
          venue_id: 'hyperliquid',
          status: 'blocked',
          authorization_ref: { ref: 'hyperliquid:hl_live_key' },
          key_handle: 'hl_display_only',
          read_state: {
            read_account_address: '0x3333333333333333333333333333333333333333',
          },
          access_issues: [
            {
              venue_id: 'hyperliquid',
              code: 'HYPERLIQUID_AGENT_WALLET_MISSING',
              severity: 'blocked',
              message: 'Hyperliquid dispatch requires linked agent-wallet metadata.',
            },
          ],
        },
      ],
    },
  };
}
