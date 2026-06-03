// Unit tests for the pure backtest simulator. Run: node core/backtest.test.mjs
import assert from 'node:assert';
import { runBacktest } from './backtest.js';

let pass = 0,
  fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
    pass++;
  } catch (e) {
    console.log('FAIL ' + name + ' — ' + e.message);
    fail++;
  }
}

t('empty / too-short series returns null', () => {
  assert.strictEqual(runBacktest([]), null);
  assert.strictEqual(runBacktest([1]), null);
  assert.strictEqual(runBacktest(null), null);
});

t('curve length matches input length', () => {
  const r = runBacktest([1, 2, 3, 4, 5], { thresholdPct: 8, budget: 500 });
  assert.strictEqual(r.curve.length, 5);
});

t('rising market never triggers the grid', () => {
  const r = runBacktest([100, 110, 120, 130], { thresholdPct: 8, budget: 500 });
  assert.strictEqual(r.trades, 0);
  // no buys -> all cash held -> portfolio flat at budget -> ~0% return
  assert.ok(Math.abs(r.curve[r.curve.length - 1] - 500) < 1e-6);
  assert.match(r.verdict, /would not have fired/);
});

t('falling market fires and deploys budget', () => {
  const r = runBacktest([100, 90, 80, 70], { thresholdPct: 8, budget: 500 });
  assert.ok(r.trades > 0, 'expected at least one trigger');
  const deployed = r.stats.find((s) => s.k === 'Deployed').v;
  assert.notStrictEqual(deployed, '$0');
  assert.match(r.verdict, /fired/);
});

t('higher threshold triggers no more often than lower (monotonic)', () => {
  const series = [100, 95, 88, 84, 79, 75, 72, 70];
  const lo = runBacktest(series, { thresholdPct: 5, budget: 500 }).trades;
  const hi = runBacktest(series, { thresholdPct: 20, budget: 500 }).trades;
  assert.ok(lo >= hi, `expected trades(5%)=${lo} >= trades(20%)=${hi}`);
});

t('never deploys more than the budget', () => {
  const r = runBacktest([100, 80, 60, 40, 20, 10], { thresholdPct: 5, budget: 500 });
  const deployed = Number(r.stats.find((s) => s.k === 'Deployed').v.replace('$', ''));
  assert.ok(deployed <= 500, `deployed ${deployed} exceeded budget 500`);
});

t('stats always include the four expected keys', () => {
  const r = runBacktest([100, 92, 88, 95], { thresholdPct: 8, budget: 500 });
  const keys = r.stats.map((s) => s.k).sort();
  assert.deepStrictEqual(keys, ['Deployed', 'Max DD', 'Return', 'Triggers']);
});

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
