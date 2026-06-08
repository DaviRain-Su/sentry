import { BUDGET_ENFORCEMENT, getAllVenues, getVenueById } from './venues.js';
import { buildVenueKeyRotationProof, findVenueKey } from './local-secrets.js';

export const AUTHORIZATION_MODELS = [
  'ows_policy_only',
  'native_delegation',
  'smart_account_module',
  'sentry_contract',
  'venue_api_key',
];

export const AUTH_CAPABILITIES = [
  'read',
  'sign',
  'submit_tx',
  'place_order',
  'cancel_order',
  'transfer',
  'withdraw',
  'set_leverage',
  'settle',
];

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function hasCapability(venue, capability) {
  return (venue.capabilities || []).includes(capability);
}

function constraintSupportFor(venue) {
  if (venue.authorization_model === 'sentry_contract') {
    return {
      budget: venue.budget_enforcement === BUDGET_ENFORCEMENT.CUSTODY ? 'chain' : 'chain',
      expiry: 'chain',
      revoke: 'chain',
      venue_scope: 'chain',
      audit_log: 'chain',
    };
  }

  if (venue.authorization_model === 'venue_api_key') {
    return {
      budget: venue.budget_enforcement === BUDGET_ENFORCEMENT.VENUE_LIMIT ? 'venue' : 'local',
      expiry: 'local',
      revoke: 'venue',
      venue_scope: 'venue',
      audit_log: 'venue',
    };
  }

  if (venue.chain_enforced) {
    return {
      budget: venue.budget_enforcement === BUDGET_ENFORCEMENT.NONE ? 'none' : 'chain',
      expiry: 'chain',
      revoke: 'chain',
      venue_scope: 'chain',
      audit_log: 'chain',
    };
  }

  if (venue.authorization_model === 'ows_policy_only') {
    return {
      budget: 'local',
      expiry: 'local',
      revoke: 'local',
      venue_scope: 'local',
      audit_log: 'local',
    };
  }

  return {
    budget: 'none',
    expiry: 'none',
    revoke: 'none',
    venue_scope: 'local',
    audit_log: 'local',
  };
}

function defaultAuthorizationRef(venue) {
  if (venue.authorization_model === 'venue_api_key') return `${venue.id}:key-handle`;
  if (venue.authorization_model === 'smart_account_module') return `${venue.id}:smart-account`;
  if (venue.authorization_model === 'native_delegation') return `${venue.id}:delegation`;
  if (venue.authorization_model === 'sentry_contract') return `${venue.id}:policy-wrapper`;
  return `${venue.id}:local-policy`;
}

function dispatchReady(venue) {
  return venue.status === 'live' && venue.adapter_status === 'demo-runtime';
}

function optionList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function localDispatchReady(venueId, options = {}) {
  return [
    ...optionList(options.local_dispatch_ready_venues),
    ...optionList(options.localDispatchReadyVenues),
  ].includes(venueId);
}

function walletAccountForChain(walletStore = {}, chainId) {
  const wallets = Array.isArray(walletStore?.wallets) ? walletStore.wallets : [];
  for (const wallet of wallets) {
    for (const account of wallet.accounts || []) {
      if (account?.chain_id !== chainId) continue;
      return {
        wallet,
        account,
      };
    }
  }
  return null;
}

function issue(venue, code, severity, message) {
  return {
    venue_id: venue.id,
    code,
    severity,
    message,
  };
}

function statusFromIssues(issues, readyStatus = 'metadata_ready') {
  if (issues.some((item) => item.severity === 'blocked' || item.severity === 'error')) {
    return 'blocked';
  }
  if (issues.some((item) => item.severity === 'planned' || item.severity === 'warning')) {
    return 'partial';
  }
  return readyStatus;
}

function issueCodesBySeverity(issues = {}, severity) {
  return optionList(issues)
    .filter((item) => item?.severity === severity)
    .map((item) => item.code)
    .filter(Boolean);
}

function readinessCategoryForState(state = {}) {
  if (state.dispatch_ready) return 'dispatch_ready';
  const issues = optionList(state.access_issues);
  if (
    ['missing', 'blocked', 'error', 'revoked'].includes(state.status) ||
    issues.some((item) => item.severity === 'blocked' || item.severity === 'error')
  ) {
    return 'blocked';
  }
  if (state.status === 'partial' || issues.some((item) => item.severity === 'planned')) {
    return 'planned';
  }
  if (issues.some((item) => item.severity === 'warning')) return 'metadata_ready_with_warnings';
  if (['metadata_ready', 'local_wallet_ref_ready', 'demo_ready'].includes(state.status)) {
    return 'metadata_ready';
  }
  return state.status || 'unknown';
}

function buildStateReadiness(state = {}) {
  const venue = getVenueById(state.venue_id);
  const issues = optionList(state.access_issues);
  const category = readinessCategoryForState(state);
  const blockingIssues = issues.filter(
    (item) => item.severity === 'blocked' || item.severity === 'error'
  );
  const plannedIssues = issues.filter((item) => item.severity === 'planned');
  const warningIssues = issues.filter((item) => item.severity === 'warning');
  const nextSteps = [
    ...blockingIssues.map((item) => item.message),
    ...plannedIssues.map((item) => item.message),
    ...(category === 'metadata_ready' || category === 'metadata_ready_with_warnings'
      ? optionList(venue?.required_next)
      : []),
  ].filter(Boolean);
  return {
    venue_id: state.venue_id,
    venue_name: state.venue_name || venue?.name || state.venue_id,
    category,
    dispatch_ready: Boolean(state.dispatch_ready),
    dispatch_ready_source: state.dispatch_ready ? 'global_registry' : null,
    state_status: state.status || null,
    authorization_ref: state.authorization_ref?.ref || state.authorization_ref?.id || null,
    blocking_issue_count: blockingIssues.length,
    planned_issue_count: plannedIssues.length,
    warning_issue_count: warningIssues.length,
    blocking_issue_codes: [
      ...issueCodesBySeverity(issues, 'blocked'),
      ...issueCodesBySeverity(issues, 'error'),
    ],
    planned_issue_codes: issueCodesBySeverity(issues, 'planned'),
    warning_issue_codes: issueCodesBySeverity(issues, 'warning'),
    next_steps: unique(nextSteps),
  };
}

function buildReadinessSummary(states = []) {
  const targetStates = optionList(states).filter((state) => state.target);
  const stateSummaries = targetStates.map((state) => state.readiness || buildStateReadiness(state));
  const byCategory = stateSummaries.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {});
  return {
    target_count: targetStates.length,
    production_ready:
      targetStates.length > 0 && stateSummaries.every((item) => item.dispatch_ready),
    dispatch_ready_venue_ids: stateSummaries
      .filter((item) => item.dispatch_ready)
      .map((item) => item.venue_id),
    blocked_venue_ids: stateSummaries
      .filter((item) => item.category === 'blocked')
      .map((item) => item.venue_id),
    planned_venue_ids: stateSummaries
      .filter((item) => item.category === 'planned')
      .map((item) => item.venue_id),
    metadata_ready_venue_ids: stateSummaries
      .filter((item) => ['metadata_ready', 'metadata_ready_with_warnings'].includes(item.category))
      .map((item) => item.venue_id),
    by_category: byCategory,
    states: stateSummaries,
  };
}

function permissionsIncludeAll(permissions = [], required = []) {
  return required.every((permission) => permissions.includes(permission));
}

function readVenueKeyAuthorizationState(venue, secretStore = {}, options = {}) {
  const described = describeAuthorizationRef(venue.id);
  const key = findVenueKey(secretStore, venue.id);
  const issues = [];
  if (!key) {
    issues.push(
      issue(
        venue,
        'VENUE_KEY_MISSING',
        'blocked',
        `${venue.name} needs a local metadata key handle before authorization can be used.`
      )
    );
    return {
      venue_id: venue.id,
      venue_name: venue.name,
      target: venue.target,
      status: 'missing',
      authorization_ref: described.authorization_ref,
      account_ref: null,
      key_handle: null,
      capabilities: [],
      grant_state: { status: 'missing', source: 'local_metadata' },
      read_state: { status: 'blocked', live_verified: false },
      rotation_state: null,
      revoke_state: {
        status: 'manual',
        local_metadata_remove: true,
        venue_revoke_required: true,
      },
      dispatch_ready: false,
      access_issues: issues,
    };
  }

  const permissions = Array.isArray(key.permissions) ? key.permissions : [];
  if (key.status === 'revoked') {
    issues.push(
      issue(
        venue,
        'VENUE_KEY_REVOKED_LOCALLY',
        'blocked',
        `${venue.name} key metadata is locally revoked; live venue revocation must still be verified outside Sentry.`
      )
    );
  } else if (key.status && !['linked', 'active'].includes(key.status)) {
    issues.push(
      issue(
        venue,
        'VENUE_KEY_NOT_ACTIVE',
        'blocked',
        `${venue.name} key metadata status is ${key.status}.`
      )
    );
  }
  if (!permissions.includes('read')) {
    issues.push(
      issue(venue, 'READ_PERMISSION_MISSING', 'blocked', `${venue.name} key lacks read scope.`)
    );
  }
  if (permissions.includes('withdraw')) {
    issues.push(
      issue(
        venue,
        'WITHDRAW_SCOPE_REJECTED',
        'blocked',
        `${venue.name} authorization must not include withdrawal scope.`
      )
    );
  }
  if (venue.id === 'okx' && !key.ip_allowlist) {
    issues.push(
      issue(
        venue,
        'IP_ALLOWLIST_NOT_PROVEN',
        'warning',
        'OKX autonomous dispatch should require IP allowlist proof before live trading.'
      )
    );
  }
  const rotationState = buildVenueKeyRotationProof(key, { now: options.now });
  if (rotationState.status === 'expired') {
    issues.push(
      issue(
        venue,
        'VENUE_KEY_ROTATION_EXPIRED',
        'blocked',
        `${venue.name} key rotation window has expired; rotate local venue metadata before dispatch.`
      )
    );
  } else if (rotationState.status === 'due_soon') {
    issues.push(
      issue(
        venue,
        'VENUE_KEY_ROTATION_DUE_SOON',
        'warning',
        `${venue.name} key rotation window is nearing expiry.`
      )
    );
  }

  if (venue.id === 'hyperliquid') {
    if (!key.read_account_address) {
      issues.push(
        issue(
          venue,
          'HYPERLIQUID_READ_ADDRESS_MISSING',
          'blocked',
          'Hyperliquid requires the real master/subaccount read address.'
        )
      );
    }
    if (!key.agent_wallet_address) {
      issues.push(
        issue(
          venue,
          'HYPERLIQUID_AGENT_WALLET_MISSING',
          'blocked',
          'Hyperliquid dispatch requires linked agent-wallet metadata.'
        )
      );
    }
    if (key.agent_wallet?.revoked_at || key.agent_wallet?.grant_status === 'revoked') {
      issues.push(
        issue(
          venue,
          'HYPERLIQUID_AGENT_WALLET_REVOKED_LOCALLY',
          'blocked',
          'Hyperliquid agent-wallet grant is marked revoked in local metadata.'
        )
      );
    } else if (key.agent_wallet?.grant_status !== 'active') {
      issues.push(
        issue(
          venue,
          'HYPERLIQUID_AGENT_WALLET_GRANT_INACTIVE',
          'blocked',
          'Hyperliquid agent-wallet grant is not marked active.'
        )
      );
    }
    const grantPermissions = Array.isArray(key.agent_wallet?.permissions)
      ? key.agent_wallet.permissions
      : permissions;
    if (!permissionsIncludeAll(grantPermissions, ['read', 'place_order'])) {
      issues.push(
        issue(
          venue,
          'HYPERLIQUID_AGENT_WALLET_SCOPE_MISSING',
          'blocked',
          'Hyperliquid agent wallet grant must include read and place_order.'
        )
      );
    }
  }

  const authorizationRef = {
    ...described.authorization_ref,
    id: `${venue.id}:${key.key_handle}`,
    ref: `${venue.id}:${key.key_handle}`,
    dispatch_ready: false,
  };
  return {
    venue_id: venue.id,
    venue_name: venue.name,
    target: venue.target,
    status: statusFromIssues(issues),
    authorization_ref: authorizationRef,
    account_ref: key.account_ref || null,
    key_handle: key.display_handle || key.key_handle,
    capabilities: permissions,
    grant_state: {
      status: key.status || 'linked',
      source: key.permission_proof?.source || 'metadata_attestation',
      verified_at: key.permission_proof?.verified_at || null,
      live_verified: false,
    },
    rotation_state: rotationState,
    read_state: {
      status: permissions.includes('read') ? 'metadata_ready' : 'blocked',
      live_verified: false,
      read_account_address: key.read_account_address || null,
    },
    revoke_state: {
      status: 'manual',
      local_metadata_remove: true,
      venue_revoke_required: true,
    },
    agent_wallet:
      venue.id === 'hyperliquid'
        ? {
            address: key.agent_wallet_address || null,
            grant_status: key.agent_wallet?.grant_status || 'missing',
            proof_source: key.agent_wallet?.proof_source || null,
            verified_at: key.agent_wallet?.verified_at || null,
            live_verified: false,
          }
        : null,
    dispatch_ready: false,
    access_issues: issues,
  };
}

function readChainWalletAuthorizationState(venue, walletStore = {}) {
  const described = describeAuthorizationRef(venue.id);
  const linked = walletAccountForChain(walletStore, venue.chain_id);
  const issues = [];
  if (!linked) {
    issues.push(
      issue(
        venue,
        'WALLET_ACCOUNT_REF_MISSING',
        'blocked',
        `${venue.name} needs a linked OWS wallet reference for ${venue.chain_id}.`
      )
    );
    return {
      venue_id: venue.id,
      venue_name: venue.name,
      target: venue.target,
      status: 'missing',
      authorization_ref: described.authorization_ref,
      account_ref: null,
      wallet_ref: null,
      capabilities: [],
      grant_state: { status: 'missing', source: 'ows_wallet_ref' },
      read_state: { status: 'blocked', live_verified: false },
      revoke_state: { status: 'local_only', local_metadata_remove: true },
      dispatch_ready: false,
      access_issues: issues,
    };
  }

  const accountCapabilities = Array.isArray(linked.account.capabilities)
    ? linked.account.capabilities
    : [];
  const walletCapabilities = Array.isArray(linked.wallet.capabilities)
    ? linked.wallet.capabilities
    : [];
  const capabilities = unique([...walletCapabilities, ...accountCapabilities]);
  if (linked.wallet.status === 'revoked') {
    issues.push(
      issue(
        venue,
        'WALLET_REF_REVOKED_LOCALLY',
        'blocked',
        `${venue.name} wallet reference is locally revoked; chain/native revoke must still be verified outside Sentry.`
      )
    );
  } else if (linked.wallet.status && linked.wallet.status !== 'linked') {
    issues.push(
      issue(
        venue,
        'WALLET_REF_NOT_LINKED',
        'blocked',
        `${venue.name} wallet reference status is ${linked.wallet.status}.`
      )
    );
  }
  const required = ['read', 'sign', 'submit_tx'];
  const missing = required.filter((capability) => !capabilities.includes(capability));
  if (missing.length) {
    issues.push(
      issue(
        venue,
        'WALLET_CAPABILITY_MISSING',
        'blocked',
        `${venue.name} wallet reference is missing capabilities: ${missing.join(', ')}.`
      )
    );
  }
  issues.push(
    issue(
      venue,
      venue.id === 'ethereum-mainnet'
        ? 'SMART_ACCOUNT_GRANT_NOT_INSTALLED'
        : 'NATIVE_DELEGATION_GRANT_NOT_INSTALLED',
      'planned',
      `${venue.name} has local wallet metadata, but production chain grant/read/revoke is not installed.`
    )
  );

  const authorizationRef = {
    ...described.authorization_ref,
    id: `${venue.id}:${linked.wallet.wallet_id}:${linked.account.address}`,
    ref: `${venue.id}:${linked.wallet.wallet_id}:${linked.account.address}`,
    dispatch_ready: false,
  };
  return {
    venue_id: venue.id,
    venue_name: venue.name,
    target: venue.target,
    status: statusFromIssues(issues, 'local_wallet_ref_ready'),
    authorization_ref: authorizationRef,
    account_ref: linked.account.caip10,
    wallet_ref: {
      wallet_id: linked.wallet.wallet_id,
      provider: linked.wallet.provider,
      display_name: linked.wallet.display_name,
      account: {
        caip10: linked.account.caip10,
        chain_id: linked.account.chain_id,
        address: linked.account.address,
      },
    },
    capabilities,
    grant_state: {
      status: 'local_wallet_ref_ready',
      source: 'ows_wallet_ref',
      chain_grant_installed: false,
    },
    read_state: {
      status: capabilities.includes('read') ? 'metadata_ready' : 'blocked',
      live_verified: false,
    },
    revoke_state: {
      status: 'local_only',
      local_metadata_remove: true,
      chain_revoke_required: true,
    },
    dispatch_ready: false,
    access_issues: issues,
  };
}

function readSuiDemoAuthorizationState(venue) {
  const described = describeAuthorizationRef(venue.id);
  return {
    venue_id: venue.id,
    venue_name: venue.name,
    target: venue.target,
    status: 'demo_ready',
    authorization_ref: described.authorization_ref,
    account_ref: null,
    capabilities: described.authorization_ref.capabilities,
    grant_state: {
      status: 'demo_contract_ready',
      source: 'deployment.testnet.json',
      chain_grant_installed: true,
    },
    read_state: { status: 'ready', live_verified: true },
    revoke_state: { status: 'chain_revoke', local_metadata_remove: false },
    dispatch_ready: described.authorization_ref.dispatch_ready,
    access_issues: described.must_not_claim_custody_enforced
      ? [
          issue(
            venue,
            'CHAIN_ACCOUNTING_NOT_CUSTODY',
            'warning',
            'Sui demo records authorization/accounting but does not custody real funds.'
          ),
        ]
      : [],
  };
}

export function describeAuthorizationRef(venueId, options = {}) {
  const venue = getVenueById(venueId);
  if (!venue) {
    return {
      status: 'error',
      code: 'UNKNOWN_VENUE',
      message: `Unknown venue: ${venueId}`,
    };
  }

  const capabilities = unique(venue.capabilities);
  const constraint_support = constraintSupportFor(venue);
  const ref = options.authorization_ref || defaultAuthorizationRef(venue);
  const must_not_claim_chain_enforced =
    venue.enforcement_layer !== 'chain' || !venue.chain_enforced;
  const must_not_claim_custody_enforced =
    !venue.funds_custodied &&
    ![BUDGET_ENFORCEMENT.CUSTODY, BUDGET_ENFORCEMENT.VENUE_LIMIT].includes(
      venue.budget_enforcement
    );
  const warnings = [];

  if (!venue.chain_enforced) {
    warnings.push('Not chain-enforced yet; daemon and venue checks must remain visible.');
  }
  if (venue.budget_enforcement === BUDGET_ENFORCEMENT.CHAIN_ACCOUNTING) {
    warnings.push('Budget is chain accounting, not custody of real funds.');
  }
  if (hasCapability(venue, 'withdraw')) {
    warnings.push('Withdraw capability is high risk and must not be enabled by default.');
  }
  if (!dispatchReady(venue)) {
    warnings.push('Adapter is not dispatch-ready; this is metadata and preflight only.');
  }

  return {
    status: 'ok',
    authorization_ref: {
      id: ref,
      venue_account_id: venue.id,
      venue_id: venue.id,
      venue_kind: venue.kind,
      authorization_model: venue.authorization_model,
      enforcement_layer: venue.enforcement_layer,
      capabilities,
      constraint_support,
      chain_enforced: venue.chain_enforced,
      budget_enforcement: venue.budget_enforcement,
      funds_custodied: venue.funds_custodied,
      ref,
      dispatch_ready: dispatchReady(venue),
      adapter_status: venue.adapter_status,
      target: venue.target,
    },
    human_summary: [
      `${venue.name}: ${venue.authority_model}`,
      `Enforcement layer: ${venue.enforcement_layer}`,
      `Budget guard: ${venue.budget_enforcement}`,
      `Capabilities: ${capabilities.join(', ') || 'none'}`,
    ],
    warnings,
    requires_owner_signature: [
      'native_delegation',
      'smart_account_module',
      'sentry_contract',
    ].includes(venue.authorization_model),
    requires_secret_store: venue.authorization_model === 'venue_api_key',
    requires_contract_deploy: false,
    must_not_claim_chain_enforced,
    must_not_claim_custody_enforced,
  };
}

export function getAuthorizationRegistrySnapshot() {
  const entries = getAllVenues().map((venue) => describeAuthorizationRef(venue.id));
  return {
    status: 'ok',
    production_default: 'local_agent',
    entries,
    ready_for_dispatch: entries
      .map((entry) => entry.authorization_ref)
      .filter((ref) => ref?.dispatch_ready)
      .map((ref) => ref.venue_id),
    target_entries: entries.filter((entry) => entry.authorization_ref?.target),
    legacy_demo_entries: entries.filter((entry) => entry.authorization_ref?.target === false),
  };
}

export function buildAuthorizationStateSnapshot(options = {}) {
  const now = options.now || new Date().toISOString();
  const scope = Array.isArray(options.scope)
    ? options.scope.map(normalizeString).filter(Boolean)
    : null;
  const venues = getAllVenues().filter((venue) => !scope || scope.includes(venue.id));
  const unknownScope = (scope || []).filter((venueId) => !getVenueById(venueId));
  const states = venues
    .map((venue) => {
      if (venue.id === 'sui-testnet-demo') return readSuiDemoAuthorizationState(venue);
      if (venue.authorization_model === 'venue_api_key') {
        return readVenueKeyAuthorizationState(venue, options.secretStore, { now });
      }
      return readChainWalletAuthorizationState(venue, options.walletStore);
    })
    .map((state) => ({
      ...state,
      readiness: buildStateReadiness(state),
    }));
  const accessIssues = [
    ...unknownScope.map((venueId) => ({
      venue_id: venueId,
      code: 'UNKNOWN_VENUE',
      severity: 'error',
      message: `Unknown venue: ${venueId}`,
    })),
    ...states.flatMap((state) => state.access_issues || []),
  ];
  return {
    status: accessIssues.some((item) => item.severity === 'error' || item.severity === 'blocked')
      ? 'blocked'
      : accessIssues.length
        ? 'partial'
        : 'ok',
    generated_at: now,
    production_default: 'local_agent',
    state_count: states.length,
    states,
    access_issues: accessIssues,
    target_states: states.filter((state) => getVenueById(state.venue_id)?.target),
    legacy_demo_states: states.filter((state) => getVenueById(state.venue_id)?.target === false),
    readiness_summary: buildReadinessSummary(states),
    raw_secret_policy:
      'authorization state reads metadata only; raw wallet/API secrets must stay local and out of Worker/browser payloads',
  };
}

export function validateTaskAuthorization(task, options = {}) {
  const authorization = task?.authorization || task?.policy_context?.authorization;
  if (!authorization || typeof authorization !== 'object') {
    return {
      status: 'error',
      code: 'MISSING_AUTHORIZATION',
      message: 'AgentTask must include authorization metadata before dispatch.',
    };
  }

  const venueId =
    authorization.venue_id ||
    authorization.venue_account_id ||
    task?.venue_id ||
    task?.policy_context?.venue_id ||
    task?.policy_context?.venue;
  const described = describeAuthorizationRef(venueId, {
    authorization_ref: authorization.authorization_ref || authorization.ref,
  });
  if (described.status !== 'ok') return described;

  const ref = described.authorization_ref;
  const required = unique(
    authorization.capabilities_required || task?.constraints?.capabilities_required || []
  );
  if (!authorization.authorization_ref && !authorization.ref) {
    return {
      status: 'error',
      code: 'MISSING_AUTHORIZATION_REF',
      message: 'authorization_ref is required before dispatch.',
      authorization: ref,
    };
  }
  if (
    authorization.authorization_model &&
    authorization.authorization_model !== ref.authorization_model
  ) {
    return {
      status: 'error',
      code: 'AUTHORIZATION_MODEL_MISMATCH',
      message: 'AgentTask authorization_model does not match the venue account.',
      authorization: ref,
    };
  }
  if (
    authorization.enforcement_layer &&
    authorization.enforcement_layer !== ref.enforcement_layer
  ) {
    return {
      status: 'error',
      code: 'ENFORCEMENT_LAYER_MISMATCH',
      message: 'AgentTask enforcement_layer does not match the venue account.',
      authorization: ref,
    };
  }

  const unsupported = required.filter((capability) => !ref.capabilities.includes(capability));
  if (unsupported.length) {
    return {
      status: 'error',
      code: unsupported.includes('withdraw') ? 'WITHDRAW_NOT_ALLOWED' : 'CAPABILITY_SCOPE_DENIED',
      message: `Authorization does not cover required capabilities: ${unsupported.join(', ')}`,
      authorization: ref,
      unsupported_capabilities: unsupported,
    };
  }

  const locallyReady = localDispatchReady(ref.venue_id, options);
  if (!options.allow_planned && !ref.dispatch_ready && !locallyReady) {
    return {
      status: 'error',
      code: 'ADAPTER_NOT_DISPATCH_READY',
      message: 'Venue authorization metadata exists, but the adapter is not dispatch-ready.',
      authorization: ref,
    };
  }

  const effectiveRef = {
    ...ref,
    dispatch_ready: ref.dispatch_ready || locallyReady,
    dispatch_ready_source: ref.dispatch_ready
      ? 'registry'
      : locallyReady
        ? 'local_daemon'
        : options.allow_planned
          ? 'planned_override'
          : null,
  };

  return {
    status: 'ok',
    authorization: effectiveRef,
    capabilities_required: required,
  };
}
