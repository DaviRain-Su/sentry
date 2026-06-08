import {
  verifyHyperliquidAgentWalletGrantProof,
  verifyVenueKeyOperationalProof,
} from '../../core/local-secrets.js';
import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_VENUE_ID,
  validateEthereumSwapTask,
} from '../../core/ethereum-trade.js';
import {
  SOLANA_CHAIN_ID,
  SOLANA_VENUE_ID,
  validateSolanaSwapTask,
} from '../../core/solana-trade.js';
import { findWalletAccount } from '../../core/wallet-refs.js';
import {
  ETHEREUM_MAINNET_RPC_URL,
  resolveEthereumReadConfig,
} from './ethereum-readonly-adapter.mjs';
import { verifyHyperliquidLiveAgentWalletGrant } from './hyperliquid-agent-wallet-adapter.mjs';
import { resolveHyperliquidUserAddress } from './hyperliquid-readonly-adapter.mjs';
import { redactCredentialResolution, resolveOkxCredentials } from './local-credential-resolver.mjs';
import { probeEthereumSigner, probeSolanaSigner } from './local-signer-probe.mjs';
import { verifyOkxLiveReadProof } from './okx-readonly-adapter.mjs';
import { resolveSolanaReadConfig, SOLANA_MAINNET_RPC_URL } from './solana-readonly-adapter.mjs';

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

function upperSnake(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function chainAccountCapabilities(account = {}) {
  return Array.isArray(account.capabilities) ? account.capabilities : [];
}

function checkWalletRefCapabilities({ account, venueLabel }) {
  const capabilities = chainAccountCapabilities(account);
  if (capabilities.includes('withdraw')) {
    return {
      status: 'error',
      code: 'WITHDRAW_NOT_ALLOWED',
      message: `${venueLabel} OWS wallet reference must not include withdrawal capability.`,
    };
  }
  const missing = ['read', 'sign', 'submit_tx'].filter(
    (capability) => !capabilities.includes(capability)
  );
  if (missing.length) {
    return {
      status: 'error',
      code: `${upperSnake(venueLabel)}_OWS_WALLET_CAPABILITIES_REQUIRED`,
      message: `${venueLabel} OWS wallet reference requires capabilities: ${missing.join(', ')}`,
      missing_capabilities: missing,
    };
  }
  return { status: 'ok', capabilities };
}

function walletRefProof({ walletStore, chainId, address, venueLabel }) {
  const matched = findWalletAccount(walletStore, { chain_id: chainId, address });
  if (matched.status !== 'ok') return matched;
  if (matched.wallet.status && matched.wallet.status !== 'linked') {
    return {
      status: 'error',
      code: `${upperSnake(venueLabel)}_OWS_WALLET_NOT_LINKED`,
      message: `${venueLabel} OWS wallet reference is not linked.`,
      wallet_id: matched.wallet.wallet_id,
      wallet_status: matched.wallet.status,
    };
  }
  const capabilityProof = checkWalletRefCapabilities({
    account: matched.account,
    venueLabel,
  });
  if (capabilityProof.status !== 'ok') return capabilityProof;
  return {
    status: 'ok',
    source: 'ows_wallet_ref',
    wallet_id: matched.wallet.wallet_id,
    provider: matched.wallet.provider,
    display_name: matched.wallet.display_name,
    vault_path: matched.wallet.vault_path,
    policy_ids: matched.wallet.policy_ids,
    account_ref: matched.account.address,
    caip10: matched.account.caip10,
    chain_id: matched.account.chain_id,
    capabilities: capabilityProof.capabilities,
    signing_handoff: 'external_agent_ows',
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
    verifyOkxLiveRead = false,
    requireSignerProbe = false,
    signerProbeTimeoutMs = 3000,
    walletStore = null,
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
        walletStore,
        execFileImpl,
        requireSignerProbe,
        signerProbeTimeoutMs,
      });
    }
    if (isEthereumSubmitTxTask(task)) {
      return getEthereumLocalDispatchReadiness({
        task,
        env,
        walletStore,
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
    now,
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

  let liveReadProof = null;
  if (verifyOkxLiveRead) {
    liveReadProof = await verifyOkxLiveReadProof({
      credentials: credentials.credentials,
      keyMetadata,
      fetchImpl,
      now,
      simulated: false,
      rateLimiter,
      rateLimitPolicy,
      sleepImpl,
    });
    if (liveReadProof.status !== 'ok') {
      return readinessError({
        code: liveReadProof.code,
        message: liveReadProof.message,
        venue_id: 'okx',
        key_handle: keyMetadata.key_handle,
        credential_resolution: redactCredentialResolution(credentials),
        operational_proof: operationalProof,
        live_read_proof: liveReadProof,
        ready_venue_ids: [],
      });
    }
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
      rotation_proof: operationalProof.rotation_proof,
    },
    credential_resolution: redactCredentialResolution(credentials),
    ...(liveReadProof ? { live_read_proof: liveReadProof } : {}),
  };
}

async function getSolanaLocalDispatchReadiness(options = {}) {
  const {
    task,
    env = process.env,
    walletStore = null,
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
  const owner = solanaOwnerFromTask(task);
  const envConfig = resolveSolanaReadConfig(env);
  let config = null;
  let walletRef = null;
  if (envConfig.status === 'ok' && (!owner || owner === envConfig.owner)) {
    config = {
      owner: envConfig.owner,
      rpc_url: envConfig.rpc_url,
      source: 'env',
    };
  } else {
    const proof = walletRefProof({
      walletStore,
      chainId: SOLANA_CHAIN_ID,
      address: owner,
      venueLabel: 'Solana',
    });
    if (proof.status !== 'ok') {
      if (proof.status !== 'missing') {
        return readinessError({
          code: proof.code,
          message: proof.message,
          venue_id: SOLANA_VENUE_ID,
          wallet_ref: proof,
          ready_venue_ids: [],
        });
      }
      if (envConfig.status !== 'ok') {
        return readinessError({
          code: envConfig.code,
          message: envConfig.message,
          venue_id: SOLANA_VENUE_ID,
          wallet_ref: proof,
          ready_venue_ids: [],
        });
      }
      return readinessError({
        code: 'SOLANA_LOCAL_ACCOUNT_MISMATCH',
        message:
          'Solana task owner must match the locally configured wallet address or a linked OWS wallet reference.',
        venue_id: SOLANA_VENUE_ID,
        expected_owner: owner,
        configured_owner: envConfig.owner,
        wallet_ref: proof,
        ready_venue_ids: [],
      });
    }
    walletRef = proof;
    config = {
      owner: proof.account_ref,
      rpc_url: env.SENTRY_SOLANA_RPC_URL || SOLANA_MAINNET_RPC_URL,
      source: 'ows_wallet_ref',
    };
  }
  if (owner && owner !== config.owner) {
    return readinessError({
      code: 'SOLANA_LOCAL_ACCOUNT_MISMATCH',
      message: 'Solana task owner must match the locally configured wallet address.',
      venue_id: SOLANA_VENUE_ID,
      expected_owner: owner,
      configured_owner: config.owner,
      ready_venue_ids: [],
    });
  }
  const signerProbeEnv =
    config.source === 'ows_wallet_ref'
      ? {
          ...env,
          SENTRY_SOLANA_WALLET_ADDRESS: config.owner,
          SENTRY_SOLANA_RPC_URL: config.rpc_url,
        }
      : env;
  const signerProbe = await probeSolanaSigner({
    env: signerProbeEnv,
    execFileImpl,
    timeoutMs: signerProbeTimeoutMs,
  });
  if (requireSignerProbe && signerProbe.status !== 'ok') {
    return readinessError({
      code: signerProbe.code || 'SOLANA_SIGNER_PROBE_REQUIRED',
      message: signerProbe.message || 'Solana local dispatch requires signer probe proof.',
      venue_id: SOLANA_VENUE_ID,
      signer_probe: signerProbe,
      wallet_ref: walletRef,
      ready_venue_ids: [],
    });
  }
  return {
    status: 'ok',
    venue_id: SOLANA_VENUE_ID,
    account_ref: config.owner,
    wallet_address: config.owner,
    rpc_url: config.rpc_url,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: [SOLANA_VENUE_ID],
    local_account_proof: {
      status: 'ok',
      venue_id: SOLANA_VENUE_ID,
      account_ref: config.owner,
      rpc_url: config.rpc_url,
      source: config.source,
      owner: config.owner,
      required_capabilities: ['read', 'sign', 'submit_tx'],
      signer_probe: signerProbe,
      wallet_ref: walletRef,
    },
  };
}

async function getEthereumLocalDispatchReadiness(options = {}) {
  const {
    task,
    env = process.env,
    walletStore = null,
    execFileImpl = null,
    requireSignerProbe = false,
    signerProbeTimeoutMs = 3000,
  } = options;
  const taskCheck = validateEthereumSwapTask(task);
  if (taskCheck.status !== 'ok') {
    return readinessError({
      code: taskCheck.code,
      message: taskCheck.message,
      venue_id: ETHEREUM_VENUE_ID,
      ready_venue_ids: [],
    });
  }
  const account = ethereumAccountFromTask(task);
  const envConfig = resolveEthereumReadConfig(env);
  let config = null;
  let walletRef = null;
  if (envConfig.status === 'ok' && (!account || account === envConfig.owner)) {
    config = {
      owner: envConfig.owner,
      rpc_url: envConfig.rpc_url,
      source: 'env',
    };
  } else {
    const proof = walletRefProof({
      walletStore,
      chainId: ETHEREUM_CHAIN_ID,
      address: account,
      venueLabel: 'Ethereum',
    });
    if (proof.status !== 'ok') {
      if (proof.status !== 'missing') {
        return readinessError({
          code: proof.code,
          message: proof.message,
          venue_id: ETHEREUM_VENUE_ID,
          wallet_ref: proof,
          ready_venue_ids: [],
        });
      }
      if (envConfig.status !== 'ok') {
        return readinessError({
          code: envConfig.code,
          message: envConfig.message,
          venue_id: ETHEREUM_VENUE_ID,
          wallet_ref: proof,
          ready_venue_ids: [],
        });
      }
      return readinessError({
        code: 'ETHEREUM_LOCAL_ACCOUNT_MISMATCH',
        message:
          'Ethereum task account must match the locally configured wallet address or a linked OWS wallet reference.',
        venue_id: ETHEREUM_VENUE_ID,
        expected_account: account,
        configured_account: envConfig.owner,
        wallet_ref: proof,
        ready_venue_ids: [],
      });
    }
    walletRef = proof;
    config = {
      owner: proof.account_ref.toLowerCase(),
      rpc_url: env.SENTRY_ETHEREUM_RPC_URL || ETHEREUM_MAINNET_RPC_URL,
      source: 'ows_wallet_ref',
    };
  }
  if (account && account !== config.owner) {
    return readinessError({
      code: 'ETHEREUM_LOCAL_ACCOUNT_MISMATCH',
      message: 'Ethereum task account must match the locally configured wallet address.',
      venue_id: ETHEREUM_VENUE_ID,
      expected_account: account,
      configured_account: config.owner,
      ready_venue_ids: [],
    });
  }
  const signerProbeEnv =
    config.source === 'ows_wallet_ref'
      ? {
          ...env,
          SENTRY_ETHEREUM_WALLET_ADDRESS: config.owner,
          SENTRY_ETHEREUM_RPC_URL: config.rpc_url,
        }
      : env;
  const signerProbe = await probeEthereumSigner({
    env: signerProbeEnv,
    execFileImpl,
    timeoutMs: signerProbeTimeoutMs,
  });
  if (requireSignerProbe && signerProbe.status !== 'ok') {
    return readinessError({
      code: signerProbe.code || 'ETHEREUM_SIGNER_PROBE_REQUIRED',
      message: signerProbe.message || 'Ethereum local dispatch requires signer probe proof.',
      venue_id: ETHEREUM_VENUE_ID,
      signer_probe: signerProbe,
      wallet_ref: walletRef,
      ready_venue_ids: [],
    });
  }
  return {
    status: 'ok',
    venue_id: ETHEREUM_VENUE_ID,
    account_ref: config.owner,
    wallet_address: config.owner,
    rpc_url: config.rpc_url,
    dispatch_ready_source: 'local_daemon',
    ready_venue_ids: [ETHEREUM_VENUE_ID],
    local_account_proof: {
      status: 'ok',
      venue_id: ETHEREUM_VENUE_ID,
      account_ref: config.owner,
      rpc_url: config.rpc_url,
      source: config.source,
      account: config.owner,
      required_capabilities: ['read', 'sign', 'submit_tx'],
      signer_probe: signerProbe,
      wallet_ref: walletRef,
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
    now,
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
      rotation_proof: operationalProof.rotation_proof,
    },
    agent_wallet_grant: agentWalletGrant,
    ...(agentWalletLiveGrant ? { agent_wallet_live_grant: agentWalletLiveGrant } : {}),
  };
}
