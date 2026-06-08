import assert from 'node:assert/strict';
import {
  ETHEREUM_MAINNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  getTokenByAddress,
  getTokenBySymbol,
  getTokenRegistrySnapshot,
  parseTokenList,
} from '../../core/token-registry.js';

const snapshot = getTokenRegistrySnapshot();
assert.equal(snapshot.status, 'ok');
assert.equal(snapshot.token_count >= 5, true);
assert.equal(snapshot.chains.includes(SOLANA_MAINNET_CHAIN_ID), true);
assert.equal(snapshot.chains.includes(ETHEREUM_MAINNET_CHAIN_ID), true);

const solanaUsdc = getTokenBySymbol(SOLANA_MAINNET_CHAIN_ID, 'USDC');
assert.equal(solanaUsdc.address, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
assert.equal(solanaUsdc.decimals, 6);

const solanaSol = getTokenByAddress(
  SOLANA_MAINNET_CHAIN_ID,
  'So11111111111111111111111111111111111111112'
);
assert.equal(solanaSol.symbol, 'SOL');
assert.equal(getTokenBySymbol(SOLANA_MAINNET_CHAIN_ID, 'WSOL').symbol, 'SOL');

const ethereumWeth = getTokenBySymbol(ETHEREUM_MAINNET_CHAIN_ID, 'WETH');
assert.equal(ethereumWeth.address, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
assert.equal(
  getTokenByAddress(ETHEREUM_MAINNET_CHAIN_ID, '0xC02aaa39b223FE8D0A0E5C4F27eAD9083C756Cc2').symbol,
  'WETH'
);

assert.deepEqual(
  parseTokenList('USDT:0x0000000000000000000000000000000000000002:6', {
    chain_id: ETHEREUM_MAINNET_CHAIN_ID,
    venue_id: 'ethereum-mainnet',
  }),
  [
    {
      chain_id: ETHEREUM_MAINNET_CHAIN_ID,
      venue_id: 'ethereum-mainnet',
      symbol: 'USDT',
      address: '0x0000000000000000000000000000000000000002',
      decimals: 6,
      native: false,
      aliases: [],
    },
  ]
);

const parsedJson = parseTokenList(
  JSON.stringify([
    {
      chain_id: SOLANA_MAINNET_CHAIN_ID,
      venue_id: 'solana-mainnet',
      symbol: 'BONK',
      address: 'DezXAZ8z7PnrnRJjz3pK1A9MvmZx8d3vX8T6JrUjXjZj',
      decimals: 5,
    },
  ])
);
assert.equal(parsedJson[0].symbol, 'BONK');
assert.equal(parsedJson[0].decimals, 5);

console.log('ALL TOKEN REGISTRY TESTS PASS');
