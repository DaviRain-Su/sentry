import {
  verifyHyperliquidAgentWalletGrantProof,
  verifyVenueKeyOperationalProof,
} from '../../core/local-secrets.js';
import { validateEthereumSwapTask } from '../../core/ethereum-trade.js';
import { validateSolanaSwapTask } from '../../core/solana-trade.js';
import { resolveEthereumReadConfig } from './ethereum-readonly-adapter.mjs';
import { verifyHyperliquidLiveAgentWalletGrant } from './hyperliquid-agent-wallet-adapter.mjs';
import { resolveHyperliquidUserAddress } from './hyperliquid-readonly-adapter.mjs';
import { redactCredentialResolution, resolveOkxCredentials } from './local-credential-resolver.mjs';
import { probeEthereumSigner, probeSolanaSigner } from './local-signer-probe.mjs';
import { resolveSolanaReadConfig } from './solana-readonly-adapter.mjs';

function isOkxPlaceOrderTask(task = {}) {
  return task?.venue_id === 'okx' && task?.action?.type === 'place_order';
}

function isHyperliquidPlaceOrderTask(task = {}) {
  return task?.venue_id === 'hyperliquid' && task?.action?.type === 'place_order';
}

function isSolanaSubmitTxTask(task = {}) {
  return task?.venue_id === 'solana-mainnet' && task?.action?.type === 'submit_tx';
}

function isEthereumSubmitTxTask(task = {}) {
  return task?.venue_id === 'ethereum-mainnet' && task?.action?.type === 'submit_tx';
}

function solanaOwnerFromTask(task = {}) {
  return String(
    task.policy_context?.owner ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref ||
      task.action?.params?.owner ||
      ''
  ).trim();
}

function ethereumAccountFromTask(task = {}) {
  return String(
    task.policy_context?.account ||
      task.policy_context?.owner ||
      task.policy_context?.wallet_address ||
      task.authorization?.account_ref ||
      task.action?.params?.account ||
      ''
  )
    .trim()
    .toLowerCase();
}

function venueKeyHandleFromTask(task = {}, venueId) {
  const ref = task.authorization?.authorization_ref || task.authorization?.ref;
  if (typeof ref === 'string' && ref.startsWith(`${venueId}:`)) {
    const keyHandle = ref.slice(`${venueId}:`.length);
    return keyHandle && !['key-handle', 'agent-wallet'].includes(keyHandle) ? keyHandle : null;
  }
  return task.authorization?.key_handle || task.policy_context?.key_handle || null;
}

function resolveVenueDispatchKey(secretStore, task = {}, venueId, label) {
  const keys = (secretStore?.keys || []).filter((key) => key.venue_id === venueId);
  const keyHandle = venueKeyHandleFromTask(task, venueId);
  if (keyHandle) {
    const key = keys.find((item) => item.key_handle === keyHandle) || null;
    if (key) return { status: 'ok', key };
    return {
      status: 'error',
      code: `${label}_KEY_METADATA_REQUIRED`,
      message: `${label} local dispatch requires linked metadata for key_handle=${keyHandle}.`,
    };
  }

  const accountRef = task.policy_context?.account_ref || task.authorization?.account_ref || null;
  if (accountRef) {
    const key = keys.find((item) => item.account_ref === accountRef) || null;
    if (key) return { status: 'ok', key };
    return {
      status: 'error',
      code: `${label}_KEY_METADATA_REQUIRED`,
      message: `${label} local dispatch requires linked metadata for account_ref=${accountRef}.`,
    };
  }

  if (keys.length === 1) return { status: 'ok', key: keys[0] };
  if (keys.length > 1) {
    return {
      status: 'error',
      code: `${label}_KEY_HANDLE_REQUIRED`,
      message: `${label} local dispatch found multiple local keys; task must specify authorization_ref or account_ref.`,
    };
  }
  return {
    status: 'error',
    code: `${label}_KEY_METADATA_REQUIRED`,
    message: `${label} local dispatch requires linked local ${label} key metadata.`,
  };
}

function readinessError(payload = {}) {
  return {
    status: 'error',
    local_decision: 'blocked_before_dispatch',
    dispatch_ready_source: 'local_daemon',
    ...payload,
  };
}

export async function getLocalDispatchReadiness(options = {}) {
  const {
    task,
    secretStore,
    env = process.env,
    keychain = {},
    fetchImpl = fetch,
    now = new Date(),
    verifyHyperliquidLiveGrant = false,
    requireSignerProbe = false,
    signerProbeTimeoutMs = 3000,
    execFileImpl = null,
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;

  if (!isOkxPlaceOrderTask(task)) {
    if (isHyperliquidPlaceOrderTask(task)) {
      return getHyperliquidLocalDispatchReadiness({
        task,
        secretStore,
        env,
        fetchImpl,
        now,
        verifyHyperliquidLiveGrant,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
    }
    if (isSolanaSubmitTxTask(task)) {
      return getSolanaLocalDispatchReadiness({
        task,
        env,
        execFileImpl,
        requireSignerProbe,
        signerProbeTimeoutMs,
      });
    }
    if (isEthereumSubmitTxTask(task)) {
      return getEthereumLocalDispatchReadiness({
        task,
        env,
        execFileImpl,
        requireSignerProbe,
        signerProbeTimeoutMs,
      });
    }
    return {
      status: 'skipped',
      reason: 'not_required_for_task',
      ready_venue_ids: [],
    };
  }

  const keyResolution = resolveVenueDispatchKey(secretStore, task, 'okx', 'OKX');
  if (keyResolution.status !== 'ok') {
    return readinessError({
      code: keyResolution.code,
      message: keyResolution.message,
      venue_id: 'okx',
      ready_venue_ids: [],
    });
  }
  const keyMetadata = keyResolution.key;

  const operationalProof = verifyVenueKeyOperationalProof(keyMetadata, {
    venue_id: 'okx',
    required_permissions: ['read', 'place_order'],
    require_ip_allowlist: true,
  });
  if (operationalProof.status !== 'ok') {
    return readinessError({
      code: operationalProof.code,
      message: operationalProof.message,
      venue_id: 'okx',
      key_handle: keyMetadata.key_handle,
      operational_proof: operationalProof,
      ready_venue_ids: [],
    });
  }

  const credentials = await resolveOkxCredentials(keyMetadata, { env, keychain });
  if (credentials.status !== 'ok') {
    return readinessError({
      code: credentials.code,
      message: credentials.message,
      venue_id: 'okx',
      key_handle: keyMetadata.key_handle,
      credential_resolution: credentials,
      operational_proof: operationalProof,
      ready_venue_ids: [],
    });
  }

  return {
    status: 'ok',
    venue_id: 'okx',
    key_handle: keyMetadata.key_handle,
    account_ref: keyMetadata.account_ref,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: ['okx'],
    operational_proof: {
      status: operationalProof.status,
      venue_id: operationalProof.venue_id,
      key_handle: operationalProof.key_handle,
      account_ref: operationalProof.account_ref,
      required_permissions: operationalProof.required_permissions,
      ip_allowlist: operationalProof.ip_allowlist,
      permission_proof: operationalProof.permission_proof,
      ip_allowlist_proof: operationalProof.ip_allowlist_proof,
    },
    credential_resolution: redactCredentialResolution(credentials),
  };
}

async function getSolanaLocalDispatchReadiness(options = {}) {
  const {
    task,
    env = process.env,
    execFileImpl = null,
    requireSignerProbe = false,
    signerProbeTimeoutMs = 3000,
  } = options;
  const taskCheck = validateSolanaSwapTask(task);
  if (taskCheck.status !== 'ok') {
    return readinessError({
      code: taskCheck.code,
      message: taskCheck.message,
      venue_id: 'solana-mainnet',
      ready_venue_ids: [],
    });
  }
  const config = resolveSolanaReadConfig(env);
  if (config.status !== 'ok') {
    return readinessError({
      code: config.code,
      message: config.message,
      venue_id: 'solana-mainnet',
      ready_venue_ids: [],
    });
  }
  const owner = solanaOwnerFromTask(task);
  if (owner && owner !== config.owner) {
    return readinessError({
      code: 'SOLANA_LOCAL_ACCOUNT_MISMATCH',
      message: 'Solana task owner must match the locally configured wallet address.',
      venue_id: 'solana-mainnet',
      expected_owner: owner,
      configured_owner: config.owner,
      ready_venue_ids: [],
    });
  }
  const signerProbe = await probeSolanaSigner({
    env,
    execFileImpl,
    timeoutMs: signerProbeTimeoutMs,
  });
  if (requireSignerProbe && signerProbe.status !== 'ok') {
    return readinessError({
      code: signerProbe.code || 'SOLANA_SIGNER_PROBE_REQUIRED',
      message: signerProbe.message || 'Solana local dispatch requires signer probe proof.',
      venue_id: 'solana-mainnet',
      signer_probe: signerProbe,
      ready_venue_ids: [],
    });
  }
  return {
    status: 'ok',
    venue_id: 'solana-mainnet',
    account_ref: config.owner,
    wallet_address: config.owner,
    rpc_url: config.rpc_url,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: ['solana-mainnet'],
    local_account_proof: {
      status: 'ok',
      venue_id: 'solana-mainnet',
      account_ref: config.owner,
      rpc_url: config.rpc_url,
      source: 'env',
      owner: config.owner,
      required_capabilities: ['read', 'sign', 'submit_tx'],
      signer_probe: signerProbe,
    },
  };
}

async function getEthereumLocalDispatchReadiness(options = {}) {
  const {
    task,
    env = process.env,
    execFileImpl = null,
    requireSignerProbe = false,
    signerProbeTimeoutMs = 3000,
  } = options;
  const taskCheck = validateEthereumSwapTask(task);
  if (taskCheck.status !== 'ok') {
    return readinessError({
      code: taskCheck.code,
      message: taskCheck.message,
      venue_id: 'ethereum-mainnet',
      ready_venue_ids: [],
    });
  }
  const config = resolveEthereumReadConfig(env);
  if (config.status !== 'ok') {
    return readinessError({
      code: config.code,
      message: config.message,
      venue_id: 'ethereum-mainnet',
      ready_venue_ids: [],
    });
  }
  const account = ethereumAccountFromTask(task);
  if (account && account !== config.owner) {
    return readinessError({
      code: 'ETHEREUM_LOCAL_ACCOUNT_MISMATCH',
      message: 'Ethereum task account must match the locally configured wallet address.',
      venue_id: 'ethereum-mainnet',
      expected_account: account,
      configured_account: config.owner,
      ready_venue_ids: [],
    });
  }
  const signerProbe = await probeEthereumSigner({
    env,
    execFileImpl,
    timeoutMs: signerProbeTimeoutMs,
  });
  if (requireSignerProbe && signerProbe.status !== 'ok') {
    return readinessError({
      code: signerProbe.code || 'ETHEREUM_SIGNER_PROBE_REQUIRED',
      message: signerProbe.message || 'Ethereum local dispatch requires signer probe proof.',
      venue_id: 'ethereum-mainnet',
      signer_probe: signerProbe,
      ready_venue_ids: [],
    });
  }
  return {
    status: 'ok',
    venue_id: 'ethereum-mainnet',
    account_ref: config.owner,
    wallet_address: config.owner,
    rpc_url: config.rpc_url,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: ['ethereum-mainnet'],
    local_account_proof: {
      status: 'ok',
      venue_id: 'ethereum-mainnet',
      account_ref: config.owner,
      rpc_url: config.rpc_url,
      source: 'env',
      account: config.owner,
      required_capabilities: ['read', 'sign', 'submit_tx'],
      signer_probe: signerProbe,
    },
  };
}

async function getHyperliquidLocalDispatchReadiness(options = {}) {
  const {
    task,
    secretStore,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    verifyHyperliquidLiveGrant = false,
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const keyResolution = resolveVenueDispatchKey(secretStore, task, 'hyperliquid', 'HYPERLIQUID');
  if (keyResolution.status !== 'ok') {
    return readinessError({
      code: keyResolution.code,
      message: keyResolution.message,
      venue_id: 'hyperliquid',
      ready_venue_ids: [],
    });
  }
  const keyMetadata = keyResolution.key;

  const operationalProof = verifyVenueKeyOperationalProof(keyMetadata, {
    venue_id: 'hyperliquid',
    required_permissions: ['read', 'place_order'],
    require_ip_allowlist: false,
  });
  if (operationalProof.status !== 'ok') {
    return readinessError({
      code: operationalProof.code,
      message: operationalProof.message,
      venue_id: 'hyperliquid',
      key_handle: keyMetadata.key_handle,
      operational_proof: operationalProof,
      ready_venue_ids: [],
    });
  }

  const user = resolveHyperliquidUserAddress(keyMetadata, env);
  if (user.status !== 'ok') {
    return readinessError({
      code: user.code,
      message: user.message,
      venue_id: 'hyperliquid',
      key_handle: keyMetadata.key_handle,
      operational_proof: operationalProof,
      ready_venue_ids: [],
    });
  }

  const agentWalletGrant = verifyHyperliquidAgentWalletGrantProof(keyMetadata, {
    required_permissions: ['read', 'place_order'],
  });
  if (agentWalletGrant.status !== 'ok') {
    return readinessError({
      code: agentWalletGrant.code,
      message: agentWalletGrant.message,
      venue_id: 'hyperliquid',
      key_handle: keyMetadata.key_handle,
      operational_proof: operationalProof,
      agent_wallet_grant: agentWalletGrant,
      ready_venue_ids: [],
    });
  }

  let agentWalletLiveGrant = null;
  if (verifyHyperliquidLiveGrant) {
    agentWalletLiveGrant = await verifyHyperliquidLiveAgentWalletGrant({
      keyMetadata,
      env,
      fetchImpl,
      now,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    if (agentWalletLiveGrant.status !== 'ok') {
      return readinessError({
        code: agentWalletLiveGrant.code,
        message: agentWalletLiveGrant.message,
        venue_id: 'hyperliquid',
        key_handle: keyMetadata.key_handle,
        operational_proof: operationalProof,
        agent_wallet_grant: agentWalletGrant,
        agent_wallet_live_grant: agentWalletLiveGrant,
        ready_venue_ids: [],
      });
    }
  }

  return {
    status: 'ok',
    venue_id: 'hyperliquid',
    key_handle: keyMetadata.key_handle,
    account_ref: keyMetadata.account_ref,
    read_account_address: user.user,
    agent_wallet_address: agentWalletGrant.agent_wallet_address,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: ['hyperliquid'],
    operational_proof: {
      status: operationalProof.status,
      venue_id: operationalProof.venue_id,
      key_handle: operationalProof.key_handle,
      account_ref: operationalProof.account_ref,
      required_permissions: operationalProof.required_permissions,
      ip_allowlist: operationalProof.ip_allowlist,
      permission_proof: operationalProof.permission_proof,
      ip_allowlist_proof: operationalProof.ip_allowlist_proof,
    },
    agent_wallet_grant: agentWalletGrant,
    ...(agentWalletLiveGrant ? { agent_wallet_live_grant: agentWalletLiveGrant } : {}),
  };
}
