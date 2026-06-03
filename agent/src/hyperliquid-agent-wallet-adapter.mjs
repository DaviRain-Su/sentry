import { verifyHyperliquidAgentWalletGrantProof } from '../../core/local-secrets.js';
import {
  HYPERLIQUID_INFO_URL,
  isHyperliquidAddress,
  resolveHyperliquidUserAddress,
} from './hyperliquid-readonly-adapter.mjs';
import {
  fetchHyperliquidJsonWithBackoff,
  hyperliquidRetrySummary,
} from './hyperliquid-rate-limit.mjs';

function lowerAddress(value) {
  const text = String(value || '').trim();
  return isHyperliquidAddress(text) ? text.toLowerCase() : null;
}

function roleOwner(body = {}) {
  return lowerAddress(
    body.data?.user ||
      body.data?.master ||
      body.data?.owner ||
      body.user ||
      body.master ||
      body.owner
  );
}

export function hyperliquidUserRoleRequest(input = {}) {
  const metadataProof = input.keyMetadata
    ? verifyHyperliquidAgentWalletGrantProof(input.keyMetadata, {
        required_permissions: input.required_permissions || ['read', 'place_order'],
      })
    : null;
  if (metadataProof && metadataProof.status !== 'ok') return metadataProof;
  const user = lowerAddress(
    input.user ||
      input.agent_wallet_address ||
      input.agentWalletAddress ||
      metadataProof?.agent_wallet_address
  );
  if (!user) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_ADDRESS_REQUIRED',
      message: 'Hyperliquid userRole query requires the agent wallet address.',
    };
  }
  return {
    status: 'ok',
    method: 'POST',
    url: HYPERLIQUID_INFO_URL,
    headers: { 'content-type': 'application/json' },
    body: {
      type: 'userRole',
      user,
    },
    agent_wallet_address: user,
  };
}

export function normalizeHyperliquidUserRoleResponse(body = {}, options = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 'error',
      code: 'HYPERLIQUID_USER_ROLE_BAD_RESPONSE',
      message: 'Hyperliquid userRole response must be an object.',
    };
  }
  const role = String(body.role || body.type || '')
    .trim()
    .toLowerCase();
  if (!role) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_USER_ROLE_MISSING',
      message: 'Hyperliquid userRole response did not include role.',
      hyperliquid_body: body,
    };
  }
  const agentWalletAddress = lowerAddress(
    options.agent_wallet_address || options.agentWalletAddress || options.user
  );
  const expectedOwners = (options.expected_owners || options.expectedOwners || [])
    .map(lowerAddress)
    .filter(Boolean);
  const owner = roleOwner(body);
  if (role !== 'agent') {
    return {
      status: 'error',
      code:
        role === 'missing'
          ? 'HYPERLIQUID_AGENT_WALLET_REVOKED'
          : 'HYPERLIQUID_AGENT_WALLET_NOT_LINKED',
      message: `Hyperliquid agent wallet userRole must be agent, got ${role}.`,
      role,
      agent_wallet_address: agentWalletAddress,
      owner,
    };
  }
  if (!owner) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_OWNER_MISSING',
      message: 'Hyperliquid agent userRole response did not include owner user address.',
      role,
      agent_wallet_address: agentWalletAddress,
    };
  }
  if (expectedOwners.length && !expectedOwners.includes(owner)) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_AGENT_WALLET_OWNER_MISMATCH',
      message: 'Hyperliquid agent wallet is not granted to the expected master/subaccount address.',
      role,
      agent_wallet_address: agentWalletAddress,
      expected_owners: expectedOwners,
      actual_owner: owner,
    };
  }
  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    role,
    agent_wallet_address: agentWalletAddress,
    user: owner,
    owner,
    observed_at: options.observed_at || new Date().toISOString(),
    proof_source: 'hyperliquid_userRole',
    permissions: options.permissions || [],
  };
}

export const normalizeHyperliquidUserRole = normalizeHyperliquidUserRoleResponse;

function observedAt(now) {
  const value = typeof now === 'function' ? now() : now;
  if (value?.toISOString) return value.toISOString();
  if (value) return String(value);
  return new Date().toISOString();
}

export async function verifyHyperliquidLiveAgentWalletGrant(options = {}) {
  const {
    keyMetadata,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const metadataProof = verifyHyperliquidAgentWalletGrantProof(keyMetadata, {
    required_permissions: ['read', 'place_order'],
  });
  if (metadataProof.status !== 'ok') return metadataProof;
  const user = resolveHyperliquidUserAddress(keyMetadata, env);
  if (user.status !== 'ok') return user;
  const request = hyperliquidUserRoleRequest({
    keyMetadata,
  });
  if (request.status !== 'ok') return request;

  const fetched = await fetchHyperliquidJsonWithBackoff({
    policy: rateLimitPolicy,
    sleep: sleepImpl,
    rateLimiter,
    bucket: `hyperliquid:userRole:${request.agent_wallet_address}`,
    fetchOnce: async () => {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      const body = await response.json();
      return { response, body };
    },
  });
  if (fetched.error) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_USER_ROLE_NETWORK_ERROR',
      message: fetched.error?.message || String(fetched.error),
      retry: hyperliquidRetrySummary(fetched),
      metadata_proof: metadataProof,
    };
  }
  const { response, body } = fetched;
  if (!response.ok) {
    return {
      status: 'error',
      code:
        response.status === 429 ? 'HYPERLIQUID_RATE_LIMITED' : 'HYPERLIQUID_USER_ROLE_HTTP_ERROR',
      http_status: response.status,
      message: body?.error || body?.message || `Hyperliquid HTTP ${response.status}`,
      hyperliquid_body: body,
      retry: hyperliquidRetrySummary(fetched),
      metadata_proof: metadataProof,
    };
  }

  const normalized = normalizeHyperliquidUserRoleResponse(body, {
    agent_wallet_address: metadataProof.agent_wallet_address,
    expected_owners: [user.user],
    observed_at: observedAt(now),
    permissions: metadataProof.permissions,
  });
  if (normalized.status !== 'ok') {
    return {
      ...normalized,
      retry: hyperliquidRetrySummary(fetched),
      metadata_proof: metadataProof,
    };
  }
  return {
    ...normalized,
    retry: hyperliquidRetrySummary(fetched),
    metadata_proof: metadataProof,
  };
}
