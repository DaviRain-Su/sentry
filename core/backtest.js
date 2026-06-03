// Pure historical backtest for a risk_response ("rescue grid") strategy over a
// daily price series. Env-agnostic (frontend + Worker). The price series is
// real market data fetched elsewhere; this module only simulates the strategy.
//
// Model: walk the series tracking the running peak. Whenever price draws down
// >= threshold% from that peak (and budget remains), the agent deploys one
// slice of budget into the asset, then resets the reference peak (so a long
// drawdown buys once, not every day). Portfolio value = cash + held*price.

export function runBacktest(prices, { thresholdPct = 8, budget = 500, slicePct = 20 } = {}) {
  if (!Array.isArray(prices) || prices.length < 2) return null;
  const th = Math.max(0.1, Number(thresholdPct) || 8) / 100;
  const sliceUsd = Math.max(0, (Number(budget) || 0) * (slicePct / 100));
  let cash = Number(budget) || 0;
  let held = 0,
    trades = 0,
    spent = 0,
    peak = prices[0];
  const curve = [];
  for (let i = 0; i < prices.length; i++) {
    const px = prices[i];
    if (px > peak) peak = px;
    const drop = (peak - px) / peak;
    if (drop >= th && cash >= sliceUsd && sliceUsd > 0) {
      held += sliceUsd / px;
      cash -= sliceUsd;
      spent += sliceUsd;
      trades++;
      peak = px; // reset reference after acting
    }
    curve.push(cash + held * px);
  }
  const start = Number(budget) || curve[0] || 1;
  const end = curve[curve.length - 1];
  const ret = ((end - start) / start) * 100;
  const bh = ((prices[prices.length - 1] - prices[0]) / prices[0]) * 100;
  let mdPeak = curve[0],
    maxDd = 0;
  for (const v of curve) {
    if (v > mdPeak) mdPeak = v;
    maxDd = Math.max(maxDd, (mdPeak - v) / mdPeak);
  }
  const stats = [
    { k: 'Return', v: (ret >= 0 ? '+' : '') + ret.toFixed(1) + '%' },
    { k: 'Triggers', v: String(trades) },
    { k: 'Deployed', v: '$' + Math.round(spent) },
    { k: 'Max DD', v: '-' + (maxDd * 100).toFixed(1) + '%' },
  ];
  const verdict =
    trades === 0
      ? `Over the window, SUI never drew down ${(th * 100).toFixed(0)}% from a local peak, so the grid would not have fired. Buy-and-hold returned ${bh.toFixed(1)}%.`
      : `The grid would have fired ${trades} time${trades === 1 ? '' : 's'}, deploying $${Math.round(spent)} on dips and ending ${ret >= 0 ? 'up' : 'down'} ${Math.abs(ret).toFixed(1)}% vs ${bh.toFixed(1)}% buy-and-hold.`;
  return { curve, stats, verdict, trades };
}
