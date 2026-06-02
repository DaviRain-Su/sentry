import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBalances, getMarket, getSummary, listActivity, listPolicies } from '../api.js'

export const EMPTY_SUMMARY = {
  active_policies: 0,
  total_policies: 0,
  total_authorized: 0,
  total_deployed: 0,
  positions: [],
}

export const EMPTY_LIVE_DASHBOARD = {
  policies: [],
  activity: [],
  summary: EMPTY_SUMMARY,
  market: null,
  holdings: [],
  funding: null,
  meta: { source: null, error: null },
}

export const liveDashboardQueryKey = (owner, mode) => ['live-dashboard', owner, mode]
export const liveDashboardOwnerKey = (owner) => ['live-dashboard', owner]
const liveDashboardResourceKey = (owner, mode, resource) => ['live-dashboard', owner, mode, resource]
const LIVE_STALE_TIME = 8_000
const LIVE_REFETCH_INTERVAL = 15_000

export function mapLivePolicy(p, spentUnits = 0, status = 'active', mode = 'cloud') {
  const safeStatus = ['active', 'revoked', 'expired', 'paused'].includes(status) ? status : 'paused'
  return {
    id: p.wrapper_id.slice(0, 6) + '…' + p.wrapper_id.slice(-4),
    _wrapperId: p.wrapper_id,
    _mandateId: p.mandate_id,
    name: 'SUI Crash Rescue Grid',
    strategy: 'rescue-grid',
    status: safeStatus,
    mode,
    budgetCap: Number(p.budget_ceiling) / 1e6,
    budgetUsed: Number(spentUnits) / 1e6,
    scope: ['SUI/USDC'],
    maxSlippage: p.max_slippage_bps / 100,
    expires: new Date(Number(p.expires_at_ms)).toISOString(),
    created: '2026-06-02',
    execs: 0,
    owner: p.owner,
  }
}

export async function fetchLiveDashboard({ owner, mode }) {
  const [pr, ar, sr, mr, br] = await Promise.all([
    listPolicies(owner),
    listActivity(owner),
    getSummary(owner),
    getMarket(),
    getBalances(owner),
  ])

  const results = [pr, ar, sr, mr, br]
  const fallback = results.find((r) => r?.source === 'chain_fallback')
  const worker = results.find((r) => r?.source === 'worker')
  const meta = {
    source: fallback ? 'chain_fallback' : worker ? 'worker' : null,
    error: fallback?.worker_error || null,
  }

  const summary = sr.status === 'ok' ? sr.summary : EMPTY_SUMMARY
  const positions = {}
  if (sr.status === 'ok') {
    sr.summary.positions.forEach((po) => { positions[po.wrapper_id] = po })
  }

  return {
    policies: pr.status === 'ok'
      ? pr.policies.map((p) => mapLivePolicy(
          p,
          positions[p.wrapper_id]?.spent_amount ?? 0,
          positions[p.wrapper_id]?.status ?? 'active',
          mode,
        ))
      : [],
    activity: ar.status === 'ok' ? ar.activity : [],
    summary,
    market: mr.status === 'ok' ? mr.market : null,
    holdings: br.status === 'ok' ? br.holdings : [],
    funding: br.status === 'ok' ? br.funding || null : null,
    meta,
    raw: { policies: pr, activity: ar, summary: sr, market: mr, balances: br },
  }
}

export function useLiveDashboard({ owner, mode, enabled }) {
  const active = Boolean(enabled && owner)
  const queryOptions = (resource, queryFn) => ({
    queryKey: liveDashboardResourceKey(owner, mode, resource),
    queryFn,
    enabled: active,
    staleTime: LIVE_STALE_TIME,
    refetchInterval: active ? LIVE_REFETCH_INTERVAL : false,
    refetchOnWindowFocus: false,
  })

  const policiesQuery = useQuery(queryOptions('policies', () => listPolicies(owner)))
  const activityQuery = useQuery(queryOptions('activity', () => listActivity(owner)))
  const summaryQuery = useQuery(queryOptions('summary', () => getSummary(owner)))
  const marketQuery = useQuery(queryOptions('market', () => getMarket()))
  const balancesQuery = useQuery(queryOptions('balances', () => getBalances(owner)))

  const queries = [policiesQuery, activityQuery, summaryQuery, marketQuery, balancesQuery]
  const loading = {
    policies: active && policiesQuery.isPending,
    activity: active && activityQuery.isPending,
    summary: active && summaryQuery.isPending,
    market: active && marketQuery.isPending,
    balances: active && balancesQuery.isPending,
  }
  loading.any = Object.values(loading).some(Boolean)
  loading.initial = active && queries.every((q) => q.isPending)

  const data = useMemo(() => {
    const pr = policiesQuery.data
    const ar = activityQuery.data
    const sr = summaryQuery.data
    const mr = marketQuery.data
    const br = balancesQuery.data
    const results = [pr, ar, sr, mr, br].filter(Boolean)
    const fallback = results.find((r) => r?.source === 'chain_fallback')
    const worker = results.find((r) => r?.source === 'worker')
    const meta = {
      source: fallback ? 'chain_fallback' : worker ? 'worker' : null,
      error: fallback?.worker_error || null,
    }

    const summary = sr?.status === 'ok' ? sr.summary : EMPTY_SUMMARY
    const positions = {}
    if (sr?.status === 'ok') {
      sr.summary.positions.forEach((po) => { positions[po.wrapper_id] = po })
    }

    return {
      policies: pr?.status === 'ok'
        ? pr.policies.map((p) => mapLivePolicy(
            p,
            positions[p.wrapper_id]?.spent_amount ?? 0,
            positions[p.wrapper_id]?.status ?? 'active',
            mode,
          ))
        : [],
      activity: ar?.status === 'ok' ? ar.activity : [],
      summary,
      market: mr?.status === 'ok' ? mr.market : null,
      holdings: br?.status === 'ok' ? br.holdings : [],
      funding: br?.status === 'ok' ? br.funding || null : null,
      meta,
      raw: { policies: pr, activity: ar, summary: sr, market: mr, balances: br },
    }
  }, [policiesQuery.data, activityQuery.data, summaryQuery.data, marketQuery.data, balancesQuery.data, mode])

  const errorQuery = queries.find((q) => q.isError)
  const hasResult = [policiesQuery.data, activityQuery.data, summaryQuery.data, marketQuery.data, balancesQuery.data].some(Boolean)
  const isError = active && !hasResult && !!errorQuery

  return {
    data,
    isPending: loading.initial,
    isLoading: loading.initial,
    isFetching: active && queries.some((q) => q.isFetching),
    isError,
    error: errorQuery?.error,
    loading,
    queries: {
      policies: policiesQuery,
      activity: activityQuery,
      summary: summaryQuery,
      market: marketQuery,
      balances: balancesQuery,
    },
  }
}
