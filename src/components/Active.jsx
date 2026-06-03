import { useState, useEffect, useMemo } from 'react';
import { RG } from '../data.js';
import { Icon, TimeChart, ModeBadge, fmtUsd } from './Primitives.jsx';

const STRAT_LIVE = {
  'funding-arb': (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'Aevo',
        side: 'Short',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'funding +18.7% · earns',
      },
      {
        venue: 'Hyperliquid',
        side: 'Long',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'funding −5.1% · pays',
      },
    ],
    delta: { v: '+0.18%', neutral: true },
    pnlU: '+$12.40',
    pnlR: '+$148.20',
    carry: '+$172',
    cost: '−$24',
    orders: [
      {
        side: 'Rebalance',
        venue: 'both legs',
        detail: 'restore neutral at next funding',
        status: 'scheduled',
      },
    ],
    lastTick: 'Collected funding +$2.10 on short leg',
    lastAgo: '4m ago',
    next: 'in 5h 12m',
    approvals: [],
    limits: [
      { k: 'Budget', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Max slippage', val: '0.4%', cap: '0.5%' },
      { k: 'Per-venue cap', val: '48%', cap: '60%', pct: 80 },
      { k: 'Funding-flip guard', val: 'net +13.4%', cap: 'unwind if < 0' },
    ],
  }),
  'spot-arb': (p, sc, used, cap) => ({
    legs: [
      { venue: 'OKX', side: 'Buy', asset: sc, size: '$' + fmtUsd(used, 0), sub: 'cheapest ask' },
      {
        venue: 'Raydium',
        side: 'Sell',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'richest bid',
      },
    ],
    delta: { v: '+0.05%', neutral: true },
    pnlU: '+$3.10',
    pnlR: '+$64.80',
    carry: '+$71',
    cost: '−$6',
    orders: [{ side: 'Buy', venue: 'OKX', detail: 'limit @ 4.182 · 240 SUI', status: 'open' }],
    lastTick: 'Captured +0.21% spread cycle · +$4.10',
    lastAgo: '1m ago',
    next: 'on spread > 0.10%',
    approvals: [],
    limits: [
      { k: 'Budget / cycle', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Min spread', val: '0.21%', cap: '> 0.10%' },
      { k: 'CEX exposure', val: '$4.2k', cap: 'swept daily' },
    ],
  }),
  'lp-manage': (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'Cetus',
        side: 'LP ±6%',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'in range · mid 4.18',
      },
    ],
    delta: { v: 'long 0.5×', neutral: false },
    pnlU: '+$34.60',
    pnlR: '+$210.40',
    carry: '+$244',
    cost: '−$9',
    orders: [],
    lastTick: 'Re-centered range to ±6% around 4.18',
    lastAgo: '22m ago',
    next: 'on ±4% drift',
    approvals: [],
    limits: [
      { k: 'LP capital', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Range band', val: '±6%', cap: 'auto re-center' },
      { k: 'Rebalance trigger', val: 'drift 1.9%', cap: '±4%', pct: 48 },
    ],
  }),
  lending: (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'Scallop',
        side: 'Supply',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: '7.4% APY · top rate',
      },
    ],
    delta: { v: 'none', neutral: true },
    pnlU: '+$8.20',
    pnlR: '+$96.50',
    carry: '+$104',
    cost: '−$1',
    orders: [],
    lastTick: 'Compared rates · Scallop best by +0.6%',
    lastAgo: '18m ago',
    next: 'hourly',
    approvals: [],
    limits: [
      { k: 'Deployed', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Per-venue cap', val: '62%', cap: '70%', pct: 88 },
      { k: 'Migrate threshold', val: '+0.6%', cap: '> +0.5%' },
    ],
  }),
  'rescue-grid': (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'DeepBook',
        side: 'Buy',
        asset: sc,
        size: '$' + fmtUsd(used * 0.55, 0),
        sub: 'rung #1 · @ 3.85',
      },
      {
        venue: 'DeepBook',
        side: 'Buy',
        asset: sc,
        size: '$' + fmtUsd(used * 0.45, 0),
        sub: 'rung #2 · @ 3.74',
      },
    ],
    delta: { v: 'long 1.0×', neutral: false },
    pnlU: '+$41.80',
    pnlR: '$0.00',
    carry: '—',
    cost: '−$3',
    orders: [
      { side: 'Buy', venue: 'DeepBook', detail: 'rung #3 limit @ 3.62 · resting', status: 'open' },
    ],
    lastTick: 'Bought rung #2 · 24.6 SUI @ 3.74',
    lastAgo: '8m ago',
    next: 'on further −2%',
    approvals: [],
    limits: [
      { k: 'Budget', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Max slippage', val: '0.9%', cap: '1.2%', pct: 75 },
      { k: 'Rungs filled', val: '2', cap: '5' },
    ],
  }),
  dca: (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'DeepBook',
        side: 'Buy',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'avg 0.094 · 7 of 14 tranches',
      },
    ],
    delta: { v: 'long 1.0×', neutral: false },
    pnlU: '+$22.10',
    pnlR: '$0.00',
    carry: '—',
    cost: '−$2',
    orders: [
      {
        side: 'Buy',
        venue: 'DeepBook',
        detail: 'next tranche 100 USDC · 06:00 UTC',
        status: 'scheduled',
      },
    ],
    lastTick: 'Bought tranche #7 · 1,010 DEEP @ 0.099',
    lastAgo: '3h ago',
    next: 'in 19h',
    approvals: [],
    limits: [
      { k: 'Budget', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      { k: 'Per-tranche', val: '100', cap: '100', unit: 'USDC' },
      { k: 'Tranches', val: '7', cap: '14', pct: 50 },
    ],
  }),
  hedge: (p, sc, used, cap) => ({
    legs: [
      {
        venue: 'Bluefin',
        side: 'Short',
        asset: sc,
        size: '$' + fmtUsd(used, 0),
        sub: 'offsets spot exposure',
      },
    ],
    delta: { v: '−0.4×', neutral: false },
    pnlU: '+$15.30',
    pnlR: '+$58.00',
    carry: '—',
    cost: '−$5',
    orders: [],
    lastTick: 'Hedge sized to 71% of spot exposure',
    lastAgo: '1h ago',
    next: 'on WAL < $0.55',
    approvals: [],
    limits: [
      { k: 'Budget', val: used, cap: cap, pct: (used / cap) * 100, unit: 'USDC' },
      {
        k: 'Max size',
        val: '$' + fmtUsd(used, 0),
        cap: '$' + fmtUsd(cap, 0),
        pct: (used / cap) * 100,
      },
    ],
  }),
};

function NeutralityMeter({ delta }) {
  // marker offset from center; neutral strategies sit near 0
  const off = delta.neutral ? 4 : 30;
  const c = delta.neutral ? 'var(--safe)' : 'var(--warn)';
  return (
    <div>
      <div
        style={{ position: 'relative', height: 8, background: 'var(--bg-0)', borderRadius: 100 }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: -3,
            width: 1,
            height: 14,
            background: 'var(--border-hi)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(50% + ${off}px)`,
            top: '50%',
            transform: 'translate(-50%,-50%)',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: c,
            boxShadow: `0 0 8px ${c}`,
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 7 }}>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
          short
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: c }}>
          {delta.neutral ? 'market-neutral' : 'directional'}
        </span>
        <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>
          long
        </span>
      </div>
    </div>
  );
}

// cross-chain / cross-venue inventory layout per strategy
const INVENTORY = {
  'funding-arb': {
    nodes: [
      { id: 'sui', label: 'Sui', sub: 'short leg · Aevo', amt: 1000, c: '#5AA6FF' },
      { id: 'hl', label: 'Hyperliquid', sub: 'long leg', amt: 920, c: '#7CF5D0' },
      { id: 'free', label: 'Sui wallet', sub: 'free buffer', amt: 480, c: '#2EE6CE' },
    ],
    flows: [{ from: 'free', to: 'hl', amt: 80, via: 'deBridge', status: 'in-flight', eta: '~24s' }],
  },
  'spot-arb': {
    nodes: [
      { id: 'okx', label: 'OKX', sub: 'buy venue · CEX', amt: 1000, c: '#AEB7C2' },
      { id: 'sol', label: 'Solana', sub: 'sell · Raydium', amt: 860, c: '#9945FF' },
      { id: 'free', label: 'Sui wallet', sub: 'settlement', amt: 140, c: '#2EE6CE' },
    ],
    flows: [
      { from: 'okx', to: 'sol', amt: 240, via: 'Wormhole', status: 'in-flight', eta: '~41s' },
    ],
  },
};

function InventoryFlow({ strategy, policy }) {
  const [openNode, setOpenNode] = useState(null);
  const key = strategy === 'spot-arb' ? 'spot-arb' : 'funding-arb';
  let inv = INVENTORY[key];
  // if the policy carries user-configured legs, reflect their venues + sizes
  if (policy && policy.legs && policy.legs.length) {
    const budget = policy.budgetCap;
    const lev = policy.leverage || 1;
    const nodes = policy.legs.map((l, i) => ({
      id: 'n' + i,
      label: l.venue,
      sub:
        l.side === 'long'
          ? key === 'spot-arb'
            ? 'buy leg'
            : 'long leg'
          : key === 'spot-arb'
            ? 'sell leg'
            : 'short leg',
      amt: Math.round(((budget * l.pct) / 100) * lev),
      c: ['#5AA6FF', '#7CF5D0', '#9945FF', '#FFC24B'][i % 4],
    }));
    const free = Math.round(budget * 0.25);
    nodes.push({ id: 'free', label: 'Sui wallet', sub: 'free buffer', amt: free, c: '#2EE6CE' });
    inv = {
      nodes,
      flows: [
        {
          from: 'free',
          to: nodes[0].id,
          amt: Math.round(free * 0.3),
          via: key === 'spot-arb' ? 'Wormhole' : 'deBridge',
          status: 'in-flight',
          eta: '~24s',
        },
      ],
    };
  }
  const total = inv.nodes.reduce((s, n) => s + n.amt, 0);
  const W = 460,
    H = 150,
    nodeW = 116,
    nodeH = 64;
  const gap = (W - nodeW) / Math.max(1, inv.nodes.length - 1);
  const cx = (i) => (inv.nodes.length === 1 ? W / 2 : nodeW / 2 + i * gap);
  const cy = H / 2;
  const idx = Object.fromEntries(inv.nodes.map((n, i) => [n.id, i]));

  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}>
            <Icon name="globe" size={16} />
          </span>
          <div className="card-title">Cross-chain inventory</div>
        </div>
        <span className="badge badge-accent" style={{ fontSize: 9 }}>
          <span className="dot pulse"></span>
          {inv.flows.length} bridging
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: H, display: 'block', overflow: 'visible' }}
      >
        {/* flow connectors */}
        {inv.flows.map((f, i) => {
          const x1 = cx(idx[f.from]),
            x2 = cx(idx[f.to]);
          const midY = cy - nodeH / 2 - 16;
          const d = `M ${x1} ${cy - nodeH / 2} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${cy - nodeH / 2}`;
          return (
            <g key={i}>
              <path
                d={d}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                className="flow-live"
                opacity="0.9"
              />
              <circle cx={(x1 + x2) / 2} cy={midY + 4} r="3" fill="var(--accent)" />
            </g>
          );
        })}
        {/* nodes */}
        {inv.nodes.map((n, i) => {
          const x = cx(i) - nodeW / 2,
            y = cy - nodeH / 2;
          const sel = openNode === n.id;
          return (
            <g
              key={n.id}
              style={{ cursor: 'pointer' }}
              onClick={() => setOpenNode(sel ? null : n.id)}
            >
              <rect
                x={x}
                y={y}
                width={nodeW}
                height={nodeH}
                rx="11"
                fill={sel ? 'var(--accent-dim)' : 'var(--glass-hi)'}
                stroke={sel ? 'var(--accent)' : 'var(--border)'}
                strokeWidth={sel ? 1.5 : 1}
              />
              <circle cx={x + 14} cy={y + 16} r="4" fill={n.c} />
              <text
                x={x + 24}
                y={y + 20}
                fill="var(--t0)"
                fontSize="11.5"
                fontWeight="600"
                fontFamily="var(--f-body)"
              >
                {n.label}
              </text>
              <text x={x + 12} y={y + 36} fill="var(--t2)" fontSize="9" fontFamily="var(--f-body)">
                {n.sub}
              </text>
              <text
                x={x + 12}
                y={y + 53}
                fill="var(--t0)"
                fontSize="13"
                fontWeight="600"
                fontFamily="var(--f-mono)"
              >
                ${fmtUsd(n.amt, 0)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* node detail (click a node) */}
      {(() => {
        const n = inv.nodes.find((x) => x.id === openNode);
        if (!n) return null;
        const isCex = /Binance|OKX|Bybit/.test(n.label);
        const isWallet = /wallet/i.test(n.label) || n.id === 'free';
        const holdings = isWallet
          ? [['USDC', '100%', 'idle buffer']]
          : isCex
            ? [
                ['USDC margin', '100%', 'cross'],
                ['unrealized', n.amt > 1500 ? '+0.4%' : '−0.1%', 'mark-to-market'],
              ]
            : [
                ['collateral', '100%', n.sub],
                ['funding accrued', '+$2.1', 'this window'],
              ];
        return (
          <div
            className="fade-up"
            style={{
              marginTop: 10,
              padding: '12px 14px',
              borderRadius: 'var(--r-md)',
              background: 'var(--glass)',
              border: `1px solid color-mix(in srgb, ${n.c} 40%, var(--border))`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: isCex ? 2 : '50%',
                  background: n.c,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{n.label}</span>
              <span className="badge badge-neutral" style={{ fontSize: 8.5 }}>
                {isCex ? 'CEX' : isWallet ? 'wallet' : 'on-chain'}
              </span>
              <div style={{ flex: 1 }} />
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                ${fmtUsd(n.amt, 0)}
              </span>
              <button
                onClick={() => setOpenNode(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--t2)',
                  padding: 2,
                }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {holdings.map(([k, v, note], j) => (
                <div
                  key={j}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}
                >
                  <span style={{ color: 'var(--t1)', flex: 1 }}>{k}</span>
                  <span className="mono" style={{ color: 'var(--t0)', fontWeight: 600 }}>
                    {v}
                  </span>
                  <span style={{ color: 'var(--t3)', fontSize: 10, width: 96, textAlign: 'right' }}>
                    {note}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: 'var(--t2)',
                marginTop: 9,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Icon name="clock" size={11} />
              last reconciled 6s ago · {isCex ? 'swept daily to wallet' : 'settles on-chain'}
            </div>
          </div>
        );
      })()}

      {/* in-flight transfers */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {inv.flows.map((f, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 'var(--r-sm)',
              background: 'var(--glass)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="dot pulse" style={{ background: 'var(--accent)' }}></span>
            <span style={{ fontSize: 11.5, color: 'var(--t1)', flex: 1 }}>
              <span className="mono" style={{ fontWeight: 600 }}>
                ${fmtUsd(f.amt, 0)}
              </span>{' '}
              {inv.nodes[idx[f.from]].label} → {inv.nodes[idx[f.to]].label}{' '}
              <span style={{ color: 'var(--t3)' }}>· via {f.via}</span>
            </span>
            <span className="badge badge-accent" style={{ fontSize: 9 }}>
              {f.status} {f.eta}
            </span>
          </div>
        ))}
        <div
          style={{
            fontSize: 10.5,
            color: 'var(--t2)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 2,
          }}
        >
          <Icon name="shield" size={12} style={{ color: 'var(--sui)' }} />
          Total inventory ${fmtUsd(total, 0)} · the agent bridges only between its own legs, never
          to an external address.
        </div>
      </div>
    </div>
  );
}

function LivePnLCard({ L, active }) {
  // seed a 28-point series ending near the strategy's unrealized PnL
  const target = parseFloat(String(L.pnlU).replace(/[^0-9.-]/g, '')) || 12;
  const seed = useMemo(() => {
    const a = [];
    let v = target * 0.2;
    for (let i = 0; i < 28; i++) {
      v += target / 28 + Math.sin(i * 1.7) * target * 0.06;
      a.push(+v.toFixed(2));
    }
    a[a.length - 1] = target;
    return a;
  }, [target]);
  const [series, setSeries] = useState(seed);
  useEffect(() => {
    setSeries(seed);
  }, [seed]);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => {
      setSeries((s) => {
        const last = s[s.length - 1];
        const next = +(
          last +
          (Math.random() - 0.42) * Math.max(0.4, Math.abs(target) * 0.04)
        ).toFixed(2);
        return [...s.slice(1), next];
      });
    }, 2500);
    return () => clearInterval(iv);
  }, [active, target]);

  const cur = series[series.length - 1];
  const up = cur >= series[0];
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}>
            <Icon name="activity" size={16} />
          </span>
          <div className="card-title">Live PnL</div>
          {active && (
            <span className="badge badge-accent" style={{ fontSize: 9 }}>
              <span className="dot pulse"></span>streaming
            </span>
          )}
        </div>
        <span
          className="mono display"
          style={{ fontSize: 18, fontWeight: 600, color: up ? 'var(--safe)' : 'var(--danger)' }}
        >
          {cur >= 0 ? '+' : '−'}${fmtUsd(Math.abs(cur))}
        </span>
      </div>
      <TimeChart
        data={series}
        w={460}
        height={120}
        color={up ? 'var(--safe)' : 'var(--danger)'}
        fmt={(v) => (v >= 0 ? '+$' : '−$') + Math.abs(v).toFixed(1)}
        xLabels={['−70m', 'now']}
        baseline={0}
      />
    </div>
  );
}

export function ActiveStrategy({
  p,
  activity,
  onBack,
  onToggle,
  onRebalance,
  onRevoke,
  onTx,
  onToast,
}) {
  if (!p) return null;
  const sm = {
    'rescue-grid': { icon: 'grid', label: 'Rescue Grid' },
    dca: { icon: 'target', label: 'DCA Ladder' },
    hedge: { icon: 'shield', label: 'Hedge' },
    'funding-arb': { icon: 'swap', label: 'Funding Arb' },
    'spot-arb': { icon: 'scale', label: 'Spot Arb' },
    'lp-manage': { icon: 'droplet', label: 'LP Manager' },
    lending: { icon: 'percent', label: 'Yield Router' },
  }[p.strategy] || { icon: 'grid', label: 'Strategy' };
  const sc = (p.scope && p.scope[0]) || p.scope || '—';
  const builder = STRAT_LIVE[p.strategy] || STRAT_LIVE['rescue-grid'];
  const L = builder(p, sc, p.budgetUsed, p.budgetCap);
  // if the user configured legs in the builder, render those instead of the template defaults
  if (p.legs && p.legs.length) {
    const isSpot = p.strategy === 'spot-arb';
    const budget = p.budgetCap;
    L.legs = p.legs.map((l) => ({
      venue: l.venue,
      side: isSpot ? (l.side === 'long' ? 'Buy' : 'Sell') : l.side === 'long' ? 'Long' : 'Short',
      asset: sc,
      size: '$' + fmtUsd(((budget * l.pct) / 100) * (p.leverage || 1), 0),
      sub: l.pct + '% · ' + (p.leverage && p.leverage > 1 ? p.leverage + '× lev' : 'spot'),
    }));
    const sumLong = p.legs.filter((l) => l.side === 'long').reduce((s, l) => s + l.pct, 0);
    const sumShort = p.legs.filter((l) => l.side === 'short').reduce((s, l) => s + l.pct, 0);
    const net = sumLong - sumShort;
    const neutral = Math.abs(net) <= 5;
    L.delta = { v: neutral ? '≈ 0%' : (net > 0 ? '+' : '−') + Math.abs(net) + '%', neutral };
  }
  const active = p.status === 'active';
  const log = (activity || []).filter((a) => a.policy === p.name).slice(0, 6);
  const sideC = (side) =>
    /short|sell/i.test(side)
      ? 'var(--danger)'
      : /long|buy|supply|lp/i.test(side)
        ? 'var(--safe)'
        : 'var(--t1)';

  // shared market clock — ticks while live so KPIs / leg marks update together
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setClock((c) => c + 1), 2500);
    return () => clearInterval(iv);
  }, [active]);
  const jit = (i) => {
    const x = Math.sin((clock + 1) * 9.13 + i * 4.7);
    return x;
  };
  // live-jittered net exposure + unrealized PnL
  const baseU = parseFloat(String(L.pnlU).replace(/[^0-9.-]/g, '')) || 0;
  const liveU = baseU + (active ? +(jit(1) * Math.max(0.4, Math.abs(baseU) * 0.05)).toFixed(2) : 0);
  const baseDelta = L.delta.neutral
    ? 0
    : parseFloat(String(L.delta.v).replace(/[^0-9.-]/g, '')) || 0;
  const liveDeltaN = L.delta.neutral ? +(jit(2) * 0.3).toFixed(2) : baseDelta;
  const liveDelta = {
    v: (liveDeltaN >= 0 ? '+' : '−') + Math.abs(liveDeltaN).toFixed(2) + '%',
    neutral: Math.abs(liveDeltaN) <= 5,
  };
  // attach a live mark price to each leg
  const markBase = { SUI: 4.182, DEEP: 0.1043, BTC: 68420, ETH: 3290, WAL: 0.627 }[sc] || 4.182;
  L.legs = L.legs.map((l, i) => {
    const mk = markBase * (1 + (active ? jit(i + 3) * 0.0011 : 0));
    return { ...l, mark: markBase < 1 ? mk.toFixed(4) : mk.toFixed(markBase > 1000 ? 0 : 3) };
  });

  const kpis = [
    { k: 'Net exposure', v: liveDelta.v, c: liveDelta.neutral ? 'var(--safe)' : 'var(--warn)' },
    {
      k: 'Unrealized PnL',
      v: (liveU >= 0 ? '+' : '−') + '$' + fmtUsd(Math.abs(liveU)),
      c: liveU >= 0 ? 'var(--safe)' : 'var(--danger)',
    },
    { k: 'Realized PnL', v: L.pnlR, c: L.pnlR.startsWith('+') ? 'var(--safe)' : 'var(--t0)' },
    { k: 'Carry / costs', v: L.carry + ' / ' + L.cost, c: 'var(--accent)' },
  ];

  const Card = ({ title, icon, right, children, pad = 18 }) => (
    <div className="card" style={{ padding: pad }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && (
            <span style={{ color: 'var(--accent)' }}>
              <Icon name={icon} size={16} />
            </span>
          )}
          <div className="card-title">{title}</div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn btn-sm btn-ghost" style={{ padding: 9 }}>
          <Icon name="chevL" size={16} />
        </button>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 13,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--accent-dim)',
            color: 'var(--accent)',
          }}
        >
          <Icon name={sm.icon} size={24} />
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 className="display" style={{ fontSize: 21, fontWeight: 600 }}>
              {p.name}
            </h2>
            <span
              className={`badge ${active ? 'badge-safe' : 'badge-warn'}`}
              style={{ fontSize: 9.5 }}
            >
              <span className={`dot ${active ? 'pulse' : ''}`}></span>
              {active ? 'live' : 'paused'}
            </span>
            <ModeBadge mode={p.mode} />
            {p.requireApproval && (
              <span className="badge badge-warn" style={{ fontSize: 9.5 }}>
                <Icon name="eye" size={10} />
                supervised
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--sui)' }}>
              {p.id}
            </span>
            <span style={{ fontSize: 11.5, color: 'var(--t2)' }}>
              · {sm.label} · scope {sc}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={() => onToggle && onToggle(p)}>
            <Icon name={active ? 'pause' : 'refresh'} size={13} /> {active ? 'Pause' : 'Resume'}
          </button>
          <button
            className="btn btn-sm"
            onClick={() => onRebalance && onRebalance(p)}
            disabled={!active}
            style={{
              opacity: active ? 1 : 0.5,
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
              background: 'var(--accent-dim)',
            }}
          >
            <Icon name="swap" size={13} /> Rebalance now
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              onToast && onToast('Activity exported — signed CSV + on-chain digests', 'var(--sui)')
            }
          >
            <Icon name="link" size={13} /> Export
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => {
              onRevoke && onRevoke(p.id);
              onBack && onBack();
            }}
          >
            <Icon name="x" size={13} stroke={2.4} /> Revoke
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {kpis.map((s) => (
          <div key={s.k} className="card" style={{ padding: '14px 16px' }}>
            <div className="eyebrow">{s.k}</div>
            <div
              className="mono display"
              style={{ fontSize: 18, fontWeight: 600, marginTop: 8, color: s.c }}
            >
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, alignItems: 'start' }}
      >
        {/* left */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <LivePnLCard L={L} active={active} />

          <Card title="Live position legs" icon="layers" pad={0}>
            <div style={{ padding: '0 0 4px' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 0.8fr 1fr 1.4fr',
                  padding: '0 18px 10px',
                }}
              >
                {['Venue', 'Side', 'Size', 'Detail'].map((h, i) => (
                  <div
                    key={h}
                    className="eyebrow"
                    style={{ fontSize: 9, textAlign: i === 3 ? 'right' : 'left' }}
                  >
                    {h}
                  </div>
                ))}
              </div>
              {L.legs.map((l, i) => (
                <div
                  key={i}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 0.8fr 1fr 1.4fr',
                    alignItems: 'center',
                    padding: '12px 18px',
                    borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{l.venue}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: sideC(l.side) }}>
                    {l.side}
                  </div>
                  <div className="mono" style={{ fontSize: 12 }}>
                    {l.size}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>
                      {l.mark ? '$' + l.mark : ''}
                      {active && l.mark && (
                        <span
                          className="dot pulse"
                          style={{
                            background: 'var(--accent)',
                            marginLeft: 5,
                            verticalAlign: 'middle',
                          }}
                        ></span>
                      )}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>
                      {l.sub}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Open orders"
            icon="grid"
            right={
              <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                {L.orders.length}
              </span>
            }
          >
            {L.orders.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>
                No resting orders — position is passive until the next trigger.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {L.orders.map((o, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '11px 13px',
                      borderRadius: 'var(--r-sm)',
                      background: 'var(--glass)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: sideC(o.side),
                        minWidth: 56,
                      }}
                    >
                      {o.side.toUpperCase()}
                    </span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12.5 }}>{o.detail}</div>
                      <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
                        {o.venue}
                      </div>
                    </div>
                    <span
                      className={`badge ${o.status === 'open' ? 'badge-accent' : 'badge-neutral'}`}
                      style={{ fontSize: 9 }}
                    >
                      {o.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Recent activity"
            icon="activity"
            right={
              log.length > 0 && (
                <a
                  href="#"
                  onClick={(e) => e.preventDefault()}
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--sui)', textDecoration: 'none' }}
                >
                  {log.length} events
                </a>
              )
            }
          >
            {log.length === 0 ? (
              <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>
                No executions logged yet — the agent is monitoring.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {log.map((a, i) => {
                  const fm = {
                    exec: ['var(--accent)', 'bolt'],
                    rebalance: ['var(--sui)', 'swap'],
                    bridge: ['var(--accent)', 'globe'],
                    guardian: ['var(--danger)', 'shield'],
                    policy: ['var(--sui)', 'grid'],
                  }[a.kind] || ['var(--t1)', 'eye'];
                  return (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        gap: 11,
                        padding: '10px 0',
                        borderTop: i ? '1px solid var(--border)' : 'none',
                      }}
                    >
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 7,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'var(--glass-hi)',
                          color: fm[0],
                        }}
                      >
                        <Icon name={fm[1]} size={13} />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</div>
                        <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
                          {a.t}
                          {a.tx && (
                            <>
                              {' '}
                              ·{' '}
                              <span
                                onClick={() => onTx && onTx(a.tx)}
                                style={{ color: 'var(--sui)', cursor: 'pointer' }}
                              >
                                {a.tx}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {a.amount !== 0 && (
                        <span
                          className="mono"
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: a.amount > 0 ? 'var(--safe)' : 'var(--danger)',
                          }}
                        >
                          {a.amount > 0 ? '+' : '−'}${fmtUsd(Math.abs(a.amount))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* right */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {(p.strategy === 'funding-arb' || p.strategy === 'spot-arb') && (
            <InventoryFlow strategy={p.strategy} policy={p} />
          )}
          <Card
            title="Net exposure"
            icon="swap"
            right={
              <span
                className={`badge ${active ? 'badge-accent' : 'badge-neutral'}`}
                style={{ fontSize: 9.5 }}
              >
                <span className={`dot ${active ? 'pulse' : ''}`}></span>
                {active ? 'LIVE' : 'paused'}
              </span>
            }
          >
            <div
              className="mono display"
              style={{
                fontSize: 22,
                fontWeight: 600,
                marginBottom: 14,
                color: liveDelta.neutral ? 'var(--safe)' : 'var(--warn)',
              }}
            >
              {liveDelta.v}
            </div>
            <NeutralityMeter delta={liveDelta} />
          </Card>

          <Card title="Execution ticks" icon="clock">
            <div style={{ display: 'flex', gap: 11, marginBottom: 12 }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--accent-dim)',
                  color: 'var(--accent)',
                }}
              >
                <Icon name="check" size={13} stroke={2.4} />
              </span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{L.lastTick}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)', marginTop: 1 }}>
                  last tick · {L.lastAgo}
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '11px 13px',
                borderRadius: 'var(--r-sm)',
                background: 'var(--glass)',
                border: '1px dashed var(--border-hi)',
              }}
            >
              <span style={{ color: 'var(--t2)' }}>
                <Icon name="clock" size={15} />
              </span>
              <div style={{ fontSize: 12.5, color: 'var(--t1)' }}>
                Next tick <strong style={{ color: 'var(--t0)' }}>{L.next}</strong>
              </div>
            </div>
          </Card>

          <Card title="Pending approvals" icon="shield">
            {p.requireApproval ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 11,
                    padding: '11px 13px',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--warn-dim)',
                    border: '1px solid color-mix(in srgb, var(--warn) 35%, var(--border))',
                  }}
                >
                  <span style={{ color: 'var(--warn)', flexShrink: 0 }}>
                    <Icon name="eye" size={15} />
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                      {L.orders.length > 0 ? L.orders[0].detail : 'Next action staged'}
                    </div>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>
                      supervised · awaiting your sign-off
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-sm btn-primary"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() =>
                      onToast &&
                      onToast('Approved — agent executing the staged order', 'var(--accent)')
                    }
                  >
                    <Icon name="check" size={13} stroke={2.4} /> Approve
                  </button>
                  <button
                    className="btn btn-sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                    onClick={() =>
                      onToast &&
                      onToast('Rejected — order discarded, agent keeps monitoring', 'var(--warn)')
                    }
                  >
                    Reject
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 9, fontSize: 12, color: 'var(--t1)' }}>
                <span style={{ color: 'var(--safe)', flexShrink: 0 }}>
                  <Icon name="check" size={14} stroke={2.4} />
                </span>
                Nothing waiting — this policy runs autonomously and every action so far stayed
                inside its limits.
              </div>
            )}
          </Card>

          <Card title="Active Guardian limits" icon="shield">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {L.limits.map((lm, i) => (
                <div key={i}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 12,
                      marginBottom: lm.pct != null ? 6 : 0,
                    }}
                  >
                    <span style={{ color: 'var(--t1)' }}>{lm.k}</span>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      <span style={{ color: 'var(--t0)', fontWeight: 600 }}>
                        {typeof lm.val === 'number' ? fmtUsd(lm.val, 0) : lm.val}
                      </span>
                      <span style={{ color: 'var(--t2)' }}>
                        {' '}
                        / {typeof lm.cap === 'number' ? fmtUsd(lm.cap, 0) : lm.cap}
                        {lm.unit ? ' ' + lm.unit : ''}
                      </span>
                    </span>
                  </div>
                  {lm.pct != null && (
                    <div
                      style={{
                        height: 5,
                        background: 'var(--bg-0)',
                        borderRadius: 100,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: Math.min(100, lm.pct) + '%',
                          height: '100%',
                          borderRadius: 100,
                          background:
                            lm.pct > 85
                              ? 'var(--danger)'
                              : lm.pct > 65
                                ? 'var(--warn)'
                                : 'var(--accent)',
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------- Portfolio summary (top of Policies page) ---------- */
export function PortfolioSummary({ policies, onLive, source = null }) {
  const active = policies.filter((p) => p.status === 'active');
  const sourceKind = source?.kind || 'worker';
  const sourceTitle =
    sourceKind === 'demo'
      ? 'Portfolio · demo'
      : sourceKind === 'fallback'
        ? 'Portfolio · fallback'
        : sourceKind === 'error'
          ? 'Portfolio · live read error'
          : 'Portfolio · live';
  const sourceBadgeClass = source?.badgeClass || 'badge-accent';
  const sourceBadgeLabel =
    sourceKind === 'demo' ? `${active.length} demo` : `${active.length} running`;
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!active.length) return;
    const iv = setInterval(() => setClock((c) => c + 1), 2500);
    return () => clearInterval(iv);
  }, [active.length]);

  const rows = active.map((p, i) => {
    const sc = (p.scope && p.scope[0]) || '—';
    const b = (STRAT_LIVE[p.strategy] || STRAT_LIVE['rescue-grid'])(
      p,
      sc,
      p.budgetUsed,
      p.budgetCap
    );
    const baseU = parseFloat(String(b.pnlU).replace(/[^0-9.-]/g, '')) || 0;
    const j = Math.sin((clock + 1) * 7.1 + i * 3.3);
    const pnl = baseU + j * Math.max(0.4, Math.abs(baseU) * 0.05);
    return { p, pnl, neutral: b.delta.neutral };
  });
  const totalPnl = rows.reduce((s, r) => s + r.pnl, 0);
  const deployed = active.reduce((s, p) => s + p.budgetUsed, 0);
  const cap = policies.reduce((s, p) => s + p.budgetCap, 0);
  const neutralN = rows.filter((r) => r.neutral).length;
  const series = useMemo(
    () =>
      Array.from({ length: 24 }, (_, k) => +(100 + Math.sin(k * 0.6) * 1.2 + k * 0.12).toFixed(2)),
    []
  );

  if (!active.length) return null;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}>
            <Icon name="activity" size={16} />
          </span>
          <div className="card-title">{sourceTitle}</div>
          <span className={`badge ${sourceBadgeClass}`} style={{ fontSize: 9 }}>
            <span className={`dot ${sourceKind === 'demo' ? '' : 'pulse'}`}></span>
            {sourceBadgeLabel}
          </span>
        </div>
        <span
          className="mono display"
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: totalPnl >= 0 ? 'var(--safe)' : 'var(--danger)',
          }}
        >
          {totalPnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(totalPnl))}
        </span>
      </div>
      <div
        style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 18, alignItems: 'center' }}
      >
        <TimeChart
          data={series}
          w={320}
          height={92}
          color="var(--safe)"
          fmt={(v) => v.toFixed(1)}
          xLabels={['−1h', 'now']}
          baseline={100}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {[
            [
              'Aggregate PnL',
              (totalPnl >= 0 ? '+' : '−') + '$' + fmtUsd(Math.abs(totalPnl)),
              totalPnl >= 0 ? 'var(--safe)' : 'var(--danger)',
            ],
            ['Capital deployed', '$' + fmtUsd(deployed, 0) + ' / $' + fmtUsd(cap, 0), 'var(--t0)'],
            ['Market-neutral', neutralN + ' / ' + active.length + ' strategies', 'var(--sui)'],
          ].map(([k, v, c]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
              }}
            >
              <span style={{ color: 'var(--t2)' }}>{k}</span>
              <span className="mono" style={{ fontWeight: 600, color: c }}>
                {v}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* per-strategy contribution bars */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--border)',
        }}
      >
        {rows.map((r, i) => {
          const sm =
            {
              'rescue-grid': 'grid',
              dca: 'target',
              hedge: 'shield',
              'funding-arb': 'swap',
              'spot-arb': 'scale',
              'lp-manage': 'droplet',
              lending: 'percent',
            }[r.p.strategy] || 'grid';
          const w = Math.min(
            100,
            (Math.abs(r.pnl) / (Math.max(...rows.map((x) => Math.abs(x.pnl))) || 1)) * 100
          );
          return (
            <div
              key={r.p.id}
              onClick={() => onLive && onLive(r.p)}
              className="mkt-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '7px 9px',
                borderRadius: 'var(--r-sm)',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--glass-hi)',
                  color: 'var(--accent)',
                }}
              >
                <Icon name={sm} size={13} />
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.p.name}
              </span>
              <div
                style={{
                  width: 80,
                  height: 5,
                  background: 'var(--bg-0)',
                  borderRadius: 100,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: w + '%',
                    height: '100%',
                    background: r.pnl >= 0 ? 'var(--safe)' : 'var(--danger)',
                  }}
                />
              </div>
              <span
                className="mono"
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  width: 64,
                  textAlign: 'right',
                  color: r.pnl >= 0 ? 'var(--safe)' : 'var(--danger)',
                }}
              >
                {r.pnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(r.pnl))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
