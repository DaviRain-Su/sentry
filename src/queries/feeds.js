import { useMutation, useQuery } from '@tanstack/react-query';
import { getTransaction } from '../api.js';

export const txDetailQueryKey = (tx) => ['tx-detail', tx];

export function useTxDetail(tx) {
  return useQuery({
    queryKey: txDetailQueryKey(tx),
    queryFn: async () => {
      const result = await getTransaction(tx);
      if (result.status !== 'ok') throw new Error(result.message || 'Transaction not found');
      return result.tx;
    },
    enabled: Boolean(tx),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export async function testFeed(feed) {
  if (!feed.test) return null;
  const t0 = performance.now();
  const res = await fetch(feed.test, { method: 'GET' });
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return {
    ms,
    summary: summarizeFeedResult(feed, data),
  };
}

export function summarizeFeedResult(feed, data) {
  if (feed.id === 'llama' && data?.data) {
    const suiPools = data.data.filter((pool) => (pool.chain || '').toLowerCase() === 'sui');
    const topSui = suiPools
      .slice()
      .filter((pool) => (pool.apy || 0) > 0 && (pool.apy || 0) < 300)
      .sort((a, b) => (b.apy || 0) - (a.apy || 0))[0];
    return (
      `${data.data.length.toLocaleString()} pools live · ${suiPools.length} on Sui` +
      (topSui ? ` · top ${topSui.project} ${(topSui.apy || 0).toFixed(1)}%` : '')
    );
  }

  if (feed.id === 'pyth' && Array.isArray(data)) {
    return `${data.length} SUI price feed${data.length === 1 ? '' : 's'} resolved on Hermes`;
  }

  if (feed.id === 'cg') {
    return data.gecko_says ? 'CoinGecko API reachable · ' + data.gecko_says : 'reachable';
  }

  return 'reachable';
}

export function useFeedTestMutation() {
  return useMutation({
    mutationFn: testFeed,
  });
}
