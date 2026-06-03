import { useQuery } from '@tanstack/react-query';
import { RG } from '../data.js';

const LIVE_CHAINS = new Set(['Sui', 'Aptos', 'Solana', 'Ethereum', 'Base']);

export const defiLlamaPoolsQueryKey = ['defillama', 'yield-pools'];

function titleFromProject(project) {
  return (project || 'pool').replace(
    /(^|[-_])([a-z])/g,
    (m, s, c) => (s ? ' ' : '') + c.toUpperCase()
  );
}

export function mapDefiLlamaPool(pool) {
  const base = +(pool.apyBase || 0);
  const reward = +(pool.apyReward || 0);
  const apy = +(pool.apy || base + reward);
  const sym = (pool.symbol || '?').toUpperCase();
  const isLP = /[-/]/.test(sym);
  const cleanSymbol = sym.replace(/[^A-Z]/g, '');
  const isLST =
    /^(ST|HASUI|VSUI|AFSUI|JITOSOL|AMAPT)/.test(cleanSymbol) || /staked/i.test(pool.poolMeta || '');
  const type = isLST ? 'LST' : isLP ? 'LP' : 'Lending';
  const risk = apy >= 30 || pool.ilRisk === 'yes' ? 'high' : apy >= 12 ? 'med' : 'low';
  const d7 = +(pool.apyPct7D || 0);
  const trend = Array.from({ length: 7 }, (_, i) => +(apy - d7 * (1 - i / 6)).toFixed(2));

  return {
    proto: pool.project || 'pool',
    market: sym,
    type,
    chain: (pool.chain || '').toLowerCase(),
    tvl: (pool.tvlUsd || 0) / 1e6,
    base,
    reward,
    apy,
    risk,
    trend,
    live: true,
    id: pool.pool,
  };
}

export async function fetchDefiLlamaYieldPools() {
  const res = await fetch('https://yields.llama.fi/pools');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json.data || [])
    .filter((pool) => LIVE_CHAINS.has(pool.chain))
    .map(mapDefiLlamaPool)
    .filter((pool) => pool.tvl >= 0.5 && pool.apy < 300 && pool.apy > 0);
}

export function useDefiLlamaYieldPools({ enabled }) {
  return useQuery({
    queryKey: defiLlamaPoolsQueryKey,
    queryFn: fetchDefiLlamaYieldPools,
    enabled: Boolean(enabled),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function mapYieldPoolToOpportunity(pool) {
  const isLP = pool.type === 'LP' || pool.type === 'Vault' || pool.type === 'CLOB';
  return {
    kind: 'yield',
    proto: pool.proto,
    name: titleFromProject(pool.proto),
    sub: `${pool.chain.charAt(0).toUpperCase()}${pool.chain.slice(1)} · ${pool.market}`,
    cat: 'Yield',
    catC: 'var(--sui)',
    edge: pool.apy,
    unit: 'APY',
    risk: pool.risk,
    scenario: isLP ? 'lp' : 'lend',
  };
}

export function demoYieldOpportunities(typeScenario) {
  const chainName = (id) => (RG.chains.find((c) => c.id === id) || {}).name || id;
  return RG.yields.map((yieldRow) => ({
    kind: 'yield',
    proto: yieldRow.proto,
    name: RG.protocols[yieldRow.proto].name,
    sub: `${chainName(yieldRow.chain)} · ${yieldRow.market}`,
    cat: 'Yield',
    catC: 'var(--sui)',
    edge: yieldRow.base + yieldRow.reward,
    unit: 'APY',
    risk: yieldRow.risk,
    scenario: typeScenario[yieldRow.type] || 'lend',
  }));
}
