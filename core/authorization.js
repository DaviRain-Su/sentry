import { BUDGET_ENFORCEMENT, getAllVenues, getVenueById } from './venues.js';

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

function localDispatchReady(venueId, options = {}) {
  return [
    ...optionList(options.local_dispatch_ready_venues),
    ...optionList(options.localDispatchReadyVenues),
  ].includes(venueId);
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
