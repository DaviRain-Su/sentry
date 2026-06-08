import assert from 'node:assert/strict';
import {
  buildLocalMarketSnapshot,
  fetchHyperliquidMarketSnapshot,
  fetchOkxMarketSnapshot,
  parseMarketList,
} from '../src/local-market-snapshot.mjs';

assert.deepEqual(parseMarketList('BTC, ETH, BTC'), ['BTC', 'ETH']);

const okxUrls = [];
const okxSnapshot = await fetchOkxMarketSnapshot({
  symbols: ['BTC'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (url) => {
    okxUrls.push(url);
    if (url.includes('/api/v5/market/ticker')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            code: '0',
            data: [
              {
                instId: 'BTC-USDT-SWAP',
                last: '100000.5',
                bidPx: '100000',
                askPx: '100001',
                volCcy24h: '1234',
              },
            ],
          };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: '0',
          data: [
            {
              instId: 'BTC-USDT-SWAP',
              fundingRate: '0.0001',
              nextFundingTime: '1780473600000',
            },
          ],
        };
      },
    };
  },
});
assert.equal(okxSnapshot.status, 'ok');
assert.equal(okxSnapshot.markets[0].venue_id, 'okx');
assert.equal(okxSnapshot.markets[0].symbol, 'BTC-USDT-SWAP');
assert.equal(okxSnapshot.markets[0].price, 100000.5);
assert.equal(okxSnapshot.markets[0].funding_rate, 0.0001);
assert.equal(okxUrls.length, 2);
assert.equal(JSON.stringify(okxSnapshot).includes('secret'), false);

const okxTickerFailure = await fetchOkxMarketSnapshot({
  symbols: ['ETH'],
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    async json() {
      return { code: '0', data: [{}] };
    },
  }),
});
assert.equal(okxTickerFailure.status, 'blocked');
assert.equal(okxTickerFailure.access_issues[0].code, 'OKX_MARKET_PRICE_MISSING');

const hyperliquidBodies = [];
const hyperliquidSnapshot = await fetchHyperliquidMarketSnapshot({
  symbols: ['BTC', 'ETH'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (_url, init) => {
    const body = JSON.parse(init.body);
    hyperliquidBodies.push(body);
    if (body.type === 'allMids') {
      return {
        ok: true,
        status: 200,
        async json() {
          return { BTC: '100010', ETH: '3300' };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return [
          { universe: [{ name: 'BTC' }, { name: 'ETH' }] },
          [
            { markPx: '100000', oraclePx: '100005', funding: '0.0002', openInterest: '42' },
            { markPx: '3299', oraclePx: '3301', funding: '-0.00001', openInterest: '12' },
          ],
        ];
      },
    };
  },
});
assert.equal(hyperliquidSnapshot.status, 'ok');
assert.deepEqual(
  hyperliquidBodies.map((body) => body.type).sort(),
  ['allMids', 'metaAndAssetCtxs'].sort()
);
assert.equal(hyperliquidSnapshot.markets[0].venue_id, 'hyperliquid');
assert.equal(hyperliquidSnapshot.markets[0].symbol, 'BTC');
assert.equal(hyperliquidSnapshot.markets[0].price, 100000);
assert.equal(hyperliquidSnapshot.markets[0].funding_rate, 0.0002);

const combined = await buildLocalMarketSnapshot({
  venues: ['okx', 'hyperliquid', 'solana-mainnet'],
  symbols: ['BTC'],
  now: new Date('2026-06-03T00:00:00.000Z'),
  fetchImpl: async (url, init = {}) => {
    if (url.includes('okx.com')) {
      if (url.includes('/market/ticker')) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { code: '0', data: [{ instId: 'BTC-USDT-SWAP', last: '100000' }] };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: '0', data: [{ fundingRate: '0.0001' }] };
        },
      };
    }
    const body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return body.type === 'allMids'
          ? { BTC: '100010' }
          : [{ universe: [{ name: 'BTC' }] }, [{ markPx: '100000', funding: '0.0002' }]];
      },
    };
  },
});
assert.equal(combined.status, 'partial');
assert.equal(combined.market_count, 2);
assert.equal(
  combined.access_issues.some((issue) => issue.code === 'MARKET_VENUE_UNSUPPORTED'),
  true
);

console.log('ALL LOCAL MARKET SNAPSHOT TESTS PASS');
