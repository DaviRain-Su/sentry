import { describeAuthorizationRef } from './authorization.js';
import { buildLocalSecretStoreSnapshot, findVenueKey } from './local-secrets.js';
import { getAllVenues, getVenueById } from './venues.js';

export const INVENTORY_SOURCE_TYPES = {
  CHAIN_RPC: 'chain_rpc',
  VENUE_API: 'venue_api',
  DEMO_CHAIN: 'demo_chain',
};

const CHAIN_READ_ADAPTERS = {
  'solana-mainnet': {
    status: 'read_adapter_ready',
    requirements: ['SENTRY_SOLANA_WALLET_ADDRESS', 'SENTRY_SOLANA_RPC_URL'],
  },
  'ethereum-mainnet': {
    status: 'read_adapter_ready',
    requirements: [
      'SENTRY_ETHEREUM_WALLET_ADDRESS',
      'SENTRY_ETHEREUM_RPC_URL',
      'SENTRY_ETHEREUM_TOKENS',
    ],
  },
};

function adapterForVenue(venue) {
  const authorization = describeAuthorizationRef(venue.id).authorization_ref;
  const base = {
    venue_id: venue.id,
    venue_name: venue.name,
    venue_kind: venue.kind,
    authorization_model: venue.authorization_model,
    enforcement_layer: venue.enforcement_layer,
    capabilities: venue.capabilities || [],
    authorization,
  };

  if (venue.id === 'sui-testnet-demo') {
    return {
      ...base,
      source_type: INVENTORY_SOURCE_TYPES.DEMO_CHAIN,
      status: 'ready',
      read_only: true,
      live_fetch: true,
      requirements: ['sui_rpc'],
    };
  }

  if (CHAIN_READ_ADAPTERS[venue.id]) {
    return {
      ...base,
      source_type: INVENTORY_SOURCE_TYPES.CHAIN_RPC,
      status: CHAIN_READ_ADAPTERS[venue.id].status,
      read_only: true,
      live_fetch: true,
      requirements: CHAIN_READ_ADAPTERS[venue.id].requirements,
    };
  }

  if (venue.authorization_model === 'venue_api_key') {
    return {
      ...base,
      source_type: INVENTORY_SOURCE_TYPES.VENUE_API,
      status: 'needs_key_handle',
      read_only: true,
      live_fetch: false,
      requirements: ['os_keychain_handle', 'subaccount_ref', 'permission_proof'],
    };
  }

  return {
    ...base,
    source_type: INVENTORY_SOURCE_TYPES.CHAIN_RPC,
    status: 'adapter_planned',
    read_only: true,
    live_fetch: false,
    requirements: ['rpc_endpoint', 'wallet_ref', 'balance_parser'],
  };
}

export function getInventoryAdapterRegistry() {
  const adapters = getAllVenues().map(adapterForVenue);
  return {
    status: 'ok',
    adapters,
    target_adapters: adapters.filter((adapter) => getVenueById(adapter.venue_id)?.target),
    legacy_demo_adapters: adapters.filter(
      (adapter) => getVenueById(adapter.venue_id)?.target === false
    ),
  };
}

function configuredVenueApiAdapter(adapter, key) {
  if (!key) {
    return {
      ...adapter,
      status: 'missing_key',
      account_ref: null,
      key_handle: null,
    };
  }
  return {
    ...adapter,
    status: 'configured_readonly',
    account_ref: key.account_ref,
    key_handle: key.display_handle,
    permissions: key.permissions,
    ip_allowlist: key.ip_allowlist,
  };
}

export function buildLocalInventorySnapshot(options = {}) {
  const now = options.now || new Date().toISOString();
  const scope = options.scope || null;
  const secretStore = options.secretStore || buildLocalSecretStoreSnapshot();
  const registry = getInventoryAdapterRegistry();
  const scopedAdapters = registry.adapters.filter((adapter) => {
    if (!scope || !scope.length) return true;
    return scope.includes(adapter.venue_id);
  });
  const unknownScope = (scope || []).filter((venueId) => !getVenueById(venueId));
  const sources = scopedAdapters.map((adapter) => {
    if (adapter.source_type === INVENTORY_SOURCE_TYPES.VENUE_API) {
      return configuredVenueApiAdapter(adapter, findVenueKey(secretStore, adapter.venue_id));
    }
    return adapter;
  });
  const accessIssues = [];

  for (const venueId of unknownScope) {
    accessIssues.push({
      venue_id: venueId,
      code: 'UNKNOWN_VENUE',
      severity: 'error',
      message: `Unknown venue: ${venueId}`,
    });
  }

  for (const source of sources) {
    if (source.status === 'missing_key') {
      accessIssues.push({
        venue_id: source.venue_id,
        code: 'VENUE_KEY_MISSING',
        severity: 'blocked',
        message: `${source.venue_name} needs a local OS keychain handle before inventory sync.`,
      });
    }
    if (source.status === 'adapter_planned') {
      accessIssues.push({
        venue_id: source.venue_id,
        code: 'INVENTORY_ADAPTER_PLANNED',
        severity: 'planned',
        message: `${source.venue_name} inventory adapter is planned but not implemented.`,
      });
    }
  }

  return {
    status: accessIssues.some((issue) => issue.severity === 'error' || issue.severity === 'blocked')
      ? 'blocked'
      : accessIssues.length
        ? 'partial'
        : 'ok',
    generated_at: now,
    source_count: sources.length,
    position_count: 0,
    positions: [],
    sources,
    access_issues: accessIssues,
    secret_store: {
      status: secretStore.status,
      key_count: secretStore.key_count,
      metadata_path: secretStore.metadata_path,
      raw_secret_policy: secretStore.raw_secret_policy,
    },
  };
}
