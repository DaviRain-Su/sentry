import { getVenueById } from './venues.js';

export const RAW_SECRET_FIELD_NAMES = [
  'secret',
  'api_secret',
  'apiSecret',
  'private_key',
  'privateKey',
  'passphrase',
  'password',
  'seed',
  'mnemonic',
  'token',
];

export const DEFAULT_SECRET_HANDLES = [
  {
    venue_id: 'okx',
    key_handle: 'okx_key_1f90',
    display_handle: 'okx_....1f90',
    account_ref: 'okx:subaccount:sentry-main',
    storage: 'os_keychain',
    permissions: ['read', 'place_order', 'cancel_order'],
    ip_allowlist: true,
    rotation_days: 30,
    status: 'linked',
  },
  {
    venue_id: 'hyperliquid',
    key_handle: 'hl_agent_42b0',
    display_handle: 'hl_....42b0',
    account_ref: 'hyperliquid:subaccount:sentry-main',
    read_account_address: '0x0000000000000000000000000000000000000001',
    agent_wallet_address: '0x0000000000000000000000000000000000000042',
    agent_wallet_grant: {
      status: 'active',
      source: 'metadata_attestation',
      verified_at: null,
      permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    },
    storage: 'os_keychain',
    permissions: ['read', 'place_order', 'cancel_order', 'set_leverage'],
    ip_allowlist: false,
    rotation_days: 30,
    status: 'linked',
  },
];

export const DEFAULT_OKX_TRADE_REQUIRED_PERMISSIONS = ['read', 'place_order'];
export const HYPERLIQUID_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const DEFAULT_HYPERLIQUID_AGENT_WALLET_REQUIRED_PERMISSIONS = ['read', 'place_order'];

function includesRawSecretField(input) {
  if (!input || typeof input !== 'object') return false;
  return Object.entries(input).some(([key, value]) => {
    if (RAW_SECRET_FIELD_NAMES.includes(key)) return true;
    if (Array.isArray(value)) return value.some((item) => includesRawSecretField(item));
    return includesRawSecretField(value);
  });
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function listValue(values) {
  if (Array.isArray(values)) return values;
  if (typeof values === 'string') {
    return values
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeHyperliquidAgentWallet(input = {}, permissions = []) {
  const source = input.agent_wallet || {};
  const grant = input.agent_wallet_grant || input.agentWalletGrant || source.grant || {};
  const address = normalizeString(
    input.agent_wallet_address || input.agentWalletAddress || source.address
  );
  if (address && !HYPERLIQUID_ADDRESS_RE.test(address)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_ADDRESS_INVALID',
      message: 'Hyperliquid agent wallet address must be a 42-character hex address.',
    };
  }
  const grantPermissions = unique(
    listValue(grant.permissions || input.agent_wallet_permissions).length
      ? listValue(grant.permissions || input.agent_wallet_permissions)
      : permissions
  );
  return {
    status: 'ok',
    agent_wallet: {
      address: address || null,
      grant_status:
        normalizeString(
          grant.status ||
            grant.grant_status ||
            input.agent_wallet_status ||
            source.grant_status ||
            source.status
        ) || 'missing',
      proof_source:
        normalizeString(
          grant.source ||
            grant.proof_source ||
            source.proof_source ||
            input.agent_wallet_proof_source
        ) || 'metadata_attestation',
      verified_at:
        grant.verified_at || source.verified_at || input.agent_wallet_verified_at || null,
      permissions: grantPermissions,
      revoked_at: grant.revoked_at || source.revoked_at || input.agent_wallet_revoked_at || null,
      expires_at:
        grant.expires_at ||
        grant.expires_at_ms ||
        source.expires_at ||
        source.expires_at_ms ||
        input.agent_wallet_expires_at ||
        null,
    },
  };
}

export function validateVenueKeyMetadata(input) {
  if (!input || typeof input !== 'object') {
    return {
      status: 'error',
      code: 'BAD_KEY_METADATA',
      message: 'Key metadata must be an object.',
    };
  }
  if (includesRawSecretField(input)) {
    return {
      status: 'error',
      code: 'RAW_SECRET_REJECTED',
      message: 'Raw secrets must stay in OS keychain/keyring and cannot be stored in metadata.',
    };
  }

  const venue = getVenueById(input.venue_id);
  if (!venue) {
    return {
      status: 'error',
      code: 'UNKNOWN_VENUE',
      message: `Unknown venue: ${input.venue_id}`,
    };
  }
  if (venue.authorization_model !== 'venue_api_key') {
    return {
      status: 'error',
      code: 'VENUE_KEY_UNSUPPORTED',
      message: `${venue.name} does not use venue API key authorization.`,
    };
  }
  if (!input.key_handle || typeof input.key_handle !== 'string') {
    return {
      status: 'error',
      code: 'KEY_HANDLE_REQUIRED',
      message: 'key_handle is required; raw API secrets are not accepted.',
    };
  }

  const permissions = unique(input.permissions);
  if (permissions.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Withdraw permission is never accepted for autonomous venue keys.',
    };
  }
  const unsupported = permissions.filter(
    (permission) => !(venue.capabilities || []).includes(permission)
  );
  if (unsupported.length) {
    return {
      status: 'error',
      code: 'PERMISSION_SCOPE_DENIED',
      message: `Permissions exceed venue capabilities: ${unsupported.join(', ')}`,
      unsupported_permissions: unsupported,
    };
  }

  const hyperliquidAgentWallet =
    venue.id === 'hyperliquid'
      ? normalizeHyperliquidAgentWallet(input, permissions)
      : { status: 'ok', agent_wallet: null };
  if (hyperliquidAgentWallet.status !== 'ok') return hyperliquidAgentWallet;

  return {
    status: 'ok',
    key: {
      venue_id: venue.id,
      venue_name: venue.name,
      key_handle: input.key_handle,
      display_handle: input.display_handle || input.key_handle,
      account_ref: input.account_ref || `${venue.id}:account`,
      read_account_address: input.read_account_address || input.account_address || null,
      agent_wallet_address: hyperliquidAgentWallet.agent_wallet?.address || null,
      agent_wallet: hyperliquidAgentWallet.agent_wallet,
      storage: input.storage || 'os_keychain',
      permissions,
      ip_allowlist: Boolean(input.ip_allowlist),
      permission_proof:
        input.permission_proof && typeof input.permission_proof === 'object'
          ? {
              source: input.permission_proof.source || 'metadata_attestation',
              verified_at: input.permission_proof.verified_at || null,
              permissions: unique(input.permission_proof.permissions || permissions),
            }
          : {
              source: 'metadata_attestation',
              verified_at: null,
              permissions,
            },
      ip_allowlist_proof:
        input.ip_allowlist_proof && typeof input.ip_allowlist_proof === 'object'
          ? {
              source: input.ip_allowlist_proof.source || 'metadata_attestation',
              verified_at: input.ip_allowlist_proof.verified_at || null,
            }
          : {
              source: 'metadata_attestation',
              verified_at: null,
            },
      rotation_days: Number(input.rotation_days || 30),
      status: input.status || 'linked',
    },
  };
}

export function buildLocalSecretStoreSnapshot(records = DEFAULT_SECRET_HANDLES) {
  const validated = records.map((record) => validateVenueKeyMetadata(record));
  const keys = validated.filter((result) => result.status === 'ok').map((result) => result.key);
  const issues = validated.filter((result) => result.status !== 'ok');
  return {
    status: issues.length ? 'partial' : 'ok',
    storage: 'os_keychain',
    metadata_path: '~/.sentry/venues.json',
    raw_secret_policy: 'never in metadata, never over Worker bridge, never in browser storage',
    key_count: keys.length,
    keys,
    issues,
  };
}

export function findVenueKey(secretStore, venueId) {
  return (secretStore?.keys || []).find((key) => key.venue_id === venueId) || null;
}

export function verifyVenueKeyOperationalProof(keyMetadata, options = {}) {
  const {
    venue_id: venueId = keyMetadata?.venue_id,
    required_permissions: requiredPermissions = DEFAULT_OKX_TRADE_REQUIRED_PERMISSIONS,
    require_ip_allowlist: requireIpAllowlist = venueId === 'okx',
  } = options;
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'KEY_METADATA_REQUIRED',
      message: 'Venue key metadata is required for operational proof.',
    };
  }
  if (venueId && keyMetadata.venue_id !== venueId) {
    return {
      status: 'error',
      code: 'KEY_VENUE_MISMATCH',
      message: `Expected key metadata for ${venueId}.`,
      expected_venue_id: venueId,
      actual_venue_id: keyMetadata.venue_id || null,
    };
  }
  if (keyMetadata.status && keyMetadata.status !== 'linked') {
    return {
      status: 'error',
      code: 'KEY_NOT_LINKED',
      message: 'Venue key metadata must be linked before dispatch.',
      key_status: keyMetadata.status,
    };
  }
  const permissions = unique(keyMetadata.permissions);
  if (permissions.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: 'Venue key metadata must not include withdrawal permission.',
    };
  }
  const missing = requiredPermissions.filter((permission) => !permissions.includes(permission));
  if (missing.length) {
    return {
      status: 'error',
      code: 'KEY_PERMISSION_PROOF_MISSING',
      message: `Venue key metadata is missing required permissions: ${missing.join(', ')}`,
      missing_permissions: missing,
      required_permissions: requiredPermissions,
    };
  }
  if (requireIpAllowlist && !keyMetadata.ip_allowlist) {
    return {
      status: 'error',
      code: 'IP_ALLOWLIST_REQUIRED',
      message: 'Venue key metadata must attest IP allowlisting before autonomous dispatch.',
      require_ip_allowlist: true,
    };
  }
  return {
    status: 'ok',
    venue_id: keyMetadata.venue_id,
    key_handle: keyMetadata.key_handle,
    account_ref: keyMetadata.account_ref,
    required_permissions: requiredPermissions,
    ip_allowlist: Boolean(keyMetadata.ip_allowlist),
    permission_proof: keyMetadata.permission_proof || {
      source: 'metadata_attestation',
      verified_at: null,
      permissions,
    },
    ip_allowlist_proof: keyMetadata.ip_allowlist_proof || {
      source: 'metadata_attestation',
      verified_at: null,
    },
  };
}

export function verifyHyperliquidAgentWalletGrantProof(keyMetadata, options = {}) {
  const {
    required_permissions:
      requiredPermissions = DEFAULT_HYPERLIQUID_AGENT_WALLET_REQUIRED_PERMISSIONS,
  } = options;
  if (!keyMetadata || typeof keyMetadata !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      message: 'Hyperliquid key metadata is required for agent-wallet grant proof.',
    };
  }
  if (keyMetadata.venue_id !== 'hyperliquid') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_KEY_METADATA_MISMATCH',
      message: 'Hyperliquid agent-wallet grant proof can only use venue_id=hyperliquid metadata.',
      actual_venue_id: keyMetadata.venue_id || null,
    };
  }

  const agentWallet = keyMetadata.agent_wallet || {};
  const address = normalizeString(keyMetadata.agent_wallet_address || agentWallet.address);
  if (!address) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_GRANT_REQUIRED',
      message: 'Hyperliquid dispatch requires a linked agent wallet grant proof.',
    };
  }
  if (!HYPERLIQUID_ADDRESS_RE.test(address)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_ADDRESS_INVALID',
      message: 'Hyperliquid agent wallet address must be a 42-character hex address.',
    };
  }

  const readAccountAddress = normalizeString(keyMetadata.read_account_address);
  if (readAccountAddress && readAccountAddress.toLowerCase() === address.toLowerCase()) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_READ_ADDRESS_CONFLICT',
      message:
        'Hyperliquid agent wallet address must not be used as the master/subaccount read address.',
    };
  }

  const grantStatus = normalizeString(agentWallet.grant_status || agentWallet.status);
  if (!['active', 'linked', 'verified'].includes(grantStatus)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_GRANT_NOT_ACTIVE',
      message: 'Hyperliquid agent wallet grant must be active before autonomous dispatch.',
      grant_status: grantStatus || 'missing',
    };
  }
  if (agentWallet.revoked_at) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_REVOKED',
      message: 'Hyperliquid agent wallet grant is marked revoked in local metadata.',
      revoked_at: agentWallet.revoked_at,
    };
  }

  const grantPermissions = unique(agentWallet.permissions);
  if (grantPermissions.includes('withdraw') || grantPermissions.includes('transfer')) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_SCOPE_DENIED',
      message: 'Hyperliquid agent wallet grant must not include withdraw or transfer scope.',
    };
  }
  const missing = requiredPermissions.filter(
    (permission) => !grantPermissions.includes(permission)
  );
  if (missing.length) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_PERMISSION_MISSING',
      message: `Hyperliquid agent wallet grant is missing required permissions: ${missing.join(', ')}`,
      missing_permissions: missing,
      required_permissions: requiredPermissions,
    };
  }

  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    key_handle: keyMetadata.key_handle,
    account_ref: keyMetadata.account_ref,
    agent_wallet_address: address,
    grant_status: grantStatus,
    proof_source: agentWallet.proof_source || 'metadata_attestation',
    verified_at: agentWallet.verified_at || null,
    required_permissions: requiredPermissions,
    permissions: grantPermissions,
    expires_at: agentWallet.expires_at || null,
  };
}
