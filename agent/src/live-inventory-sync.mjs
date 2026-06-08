import { buildLocalInventorySnapshot } from '../../core/inventory.js';
import { findVenueKey } from '../../core/local-secrets.js';
import { fetchEthereumReadState } from './ethereum-readonly-adapter.mjs';
import { fetchHyperliquidReadState } from './hyperliquid-readonly-adapter.mjs';
import { redactCredentialResolution, resolveOkxCredentials } from './local-credential-resolver.mjs';
import { fetchOkxAccountBalance } from './okx-readonly-adapter.mjs';
import { fetchSolanaReadState } from './solana-readonly-adapter.mjs';

function okxBalancesToPositions(balanceResult) {
  return (balanceResult.balances || [])
    .filter((balance) => balance.asset)
    .map((balance) => ({
      venue_id: 'okx',
      source_type: 'venue_api',
      account_ref: balance.account_ref,
      asset: balance.asset,
      quantity: balance.equity,
      value_usd: balance.equity_usd,
      available: balance.available_balance,
      locked: balance.frozen_balance,
      observed_at: balanceResult.observed_at,
    }));
}

function wantsVenue(scope, venueId) {
  return !Array.isArray(scope) || !scope.length || scope.includes(venueId);
}

export async function buildLiveInventorySnapshot(options = {}) {
  const {
    secretStore,
    scope = null,
    now = new Date(),
    env = process.env,
    fetchImpl = fetch,
    keychain = {},
    okxCcy,
    simulated = false,
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const base = buildLocalInventorySnapshot({
    secretStore,
    scope,
    now: now.toISOString(),
  });
  const liveReads = [];
  const accessIssues = [...base.access_issues];
  const positions = [...base.positions];

  if (wantsVenue(scope, 'okx')) {
    const key = findVenueKey(secretStore, 'okx');
    if (key) {
      const credentials = await resolveOkxCredentials(key, { env, keychain });
      if (credentials.status !== 'ok') {
        accessIssues.push({
          venue_id: 'okx',
          code: credentials.code,
          severity: 'blocked',
          message: credentials.message,
          missing: credentials.missing,
          env: credentials.env,
          keychain: credentials.keychain,
        });
        liveReads.push({
          venue_id: 'okx',
          status: 'blocked',
          credential_resolution: credentials,
        });
      } else {
        const balance = await fetchOkxAccountBalance({
          credentials: credentials.credentials,
          keyMetadata: key,
          ccy: okxCcy,
          fetchImpl,
          now,
          simulated,
          rateLimiter,
          rateLimitPolicy,
          sleepImpl,
        });
        if (balance.status === 'ok') {
          const okxPositions = okxBalancesToPositions(balance);
          positions.push(...okxPositions);
          liveReads.push({
            venue_id: 'okx',
            status: 'ok',
            balance_count: balance.balance_count,
            observed_at: balance.observed_at,
            credential_resolution: redactCredentialResolution(credentials),
          });
        } else {
          accessIssues.push({
            venue_id: 'okx',
            code: balance.code,
            severity: 'blocked',
            message: balance.message,
            okx_code: balance.okx_code,
            http_status: balance.http_status,
          });
          liveReads.push({
            venue_id: 'okx',
            status: 'error',
            code: balance.code,
            message: balance.message,
          });
        }
      }
    }
  }

  if (wantsVenue(scope, 'hyperliquid')) {
    const key = findVenueKey(secretStore, 'hyperliquid');
    if (key) {
      const readState = await fetchHyperliquidReadState({
        keyMetadata: key,
        env,
        fetchImpl,
        now,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
      if (readState.status === 'ok') {
        positions.push(...readState.positions);
        liveReads.push({
          venue_id: 'hyperliquid',
          status: 'ok',
          position_count: readState.positions.length,
          open_order_count: readState.open_orders.length,
          observed_at: readState.observed_at,
          user: readState.user,
        });
      } else {
        accessIssues.push({
          venue_id: 'hyperliquid',
          code: readState.code,
          severity: 'blocked',
          message: readState.message,
          http_status: readState.http_status,
        });
        liveReads.push({
          venue_id: 'hyperliquid',
          status: 'error',
          code: readState.code,
          message: readState.message,
        });
      }
    }
  }

  if (wantsVenue(scope, 'solana-mainnet')) {
    const solana = await fetchSolanaReadState({
      env,
      fetchImpl,
      now,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    if (solana.status === 'ok') {
      positions.push(...solana.positions);
      liveReads.push({
        venue_id: 'solana-mainnet',
        status: 'ok',
        position_count: solana.positions.length,
        observed_at: solana.observed_at,
        account_ref: solana.account_ref,
        rpc_retry: solana.rpc_retry,
      });
    } else {
      accessIssues.push({
        venue_id: 'solana-mainnet',
        code: solana.code,
        severity: 'blocked',
        message: solana.message,
        http_status: solana.http_status,
        retry: solana.retry,
      });
      liveReads.push({
        venue_id: 'solana-mainnet',
        status: 'error',
        code: solana.code,
        message: solana.message,
        retry: solana.retry,
      });
    }
  }

  if (wantsVenue(scope, 'ethereum-mainnet')) {
    const ethereum = await fetchEthereumReadState({
      env,
      fetchImpl,
      now,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    if (ethereum.status === 'ok') {
      positions.push(...ethereum.positions);
      liveReads.push({
        venue_id: 'ethereum-mainnet',
        status: 'ok',
        position_count: ethereum.positions.length,
        observed_at: ethereum.observed_at,
        account_ref: ethereum.account_ref,
        rpc_retry: ethereum.rpc_retry,
      });
    } else {
      accessIssues.push({
        venue_id: 'ethereum-mainnet',
        code: ethereum.code,
        severity: 'blocked',
        message: ethereum.message,
        http_status: ethereum.http_status,
        retry: ethereum.retry,
      });
      liveReads.push({
        venue_id: 'ethereum-mainnet',
        status: 'error',
        code: ethereum.code,
        message: ethereum.message,
        retry: ethereum.retry,
      });
    }
  }

  return {
    ...base,
    status: accessIssues.some((issue) => issue.severity === 'error' || issue.severity === 'blocked')
      ? 'blocked'
      : accessIssues.length
        ? 'partial'
        : 'ok',
    position_count: positions.length,
    positions,
    access_issues: accessIssues,
    live_reads: liveReads,
  };
}
