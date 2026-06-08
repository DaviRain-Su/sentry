import {
  findVenueKey,
  verifyHyperliquidAgentWalletGrantProof,
  verifyVenueKeyOperationalProof,
} from '../../core/local-secrets.js';
import { fetchEthereumTransactionReceipt } from './ethereum-receipt-adapter.mjs';
import { verifyHyperliquidLiveAgentWalletGrant } from './hyperliquid-agent-wallet-adapter.mjs';
import { submitHyperliquidSignedExchangeAction } from './hyperliquid-exchange-submit-adapter.mjs';
import { fetchHyperliquidOrderStatus } from './hyperliquid-order-status-adapter.mjs';
import { submitPreparedTransactionWithSignerCommand } from './local-signer-command-handoff.mjs';
import { redactCredentialResolution, resolveOkxCredentials } from './local-credential-resolver.mjs';
import { fetchOkxOrderStatus } from './okx-order-status-adapter.mjs';
import { fetchSolanaTransactionReceipt } from './solana-receipt-adapter.mjs';

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

function shouldVerifyOkxReceipt(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    isOkxPlaceOrderTask(task) &&
    ['submitted', 'done'].includes(dispatch.agent_result?.status)
  );
}

function shouldVerifyHyperliquidReceipt(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    isHyperliquidPlaceOrderTask(task) &&
    ['submitted', 'done'].includes(dispatch.agent_result?.status)
  );
}

function shouldVerifySolanaReceipt(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    isSolanaSubmitTxTask(task) &&
    ['submitted', 'done'].includes(dispatch.agent_result?.status)
  );
}

function shouldVerifyEthereumReceipt(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    isEthereumSubmitTxTask(task) &&
    ['submitted', 'done'].includes(dispatch.agent_result?.status)
  );
}

function shouldSubmitHyperliquidSignedPayload(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    isHyperliquidPlaceOrderTask(task) &&
    dispatch.agent_result?.status === 'proposed' &&
    dispatch.agent_result?.evidence?.signed_exchange_payload
  );
}

function shouldSubmitPreparedTransactionWithSigner(task = {}, dispatch = {}) {
  return (
    dispatch?.status === 'ok' &&
    (isSolanaSubmitTxTask(task) || isEthereumSubmitTxTask(task)) &&
    dispatch.agent_result?.status === 'proposed'
  );
}

function receiptError(payload = {}) {
  return {
    status: 'error',
    local_decision: 'receipt_verification_failed',
    ...payload,
  };
}

export async function verifyDispatchReceipt(options = {}) {
  const {
    task,
    dispatch,
    secretStore,
    env = process.env,
    keychain = {},
    fetchImpl = fetch,
    now = new Date(),
    simulated = false,
    hyperliquidNonceStorePath = null,
    verifyHyperliquidLiveGrant = false,
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
    solanaSignerCommand = null,
    ethereumSignerCommand = null,
    signerCommand = null,
    signerTimeoutMs = 30_000,
    signerSpawnImpl,
  } = options;

  if (!shouldVerifyOkxReceipt(task, dispatch)) {
    if (shouldSubmitPreparedTransactionWithSigner(task, dispatch)) {
      const submitted = await submitPreparedTransactionWithSignerCommand({
        task,
        dispatch,
        env,
        now,
        solanaSignerCommand,
        ethereumSignerCommand,
        signerCommand,
        timeoutMs: signerTimeoutMs,
        ...(signerSpawnImpl ? { spawnImpl: signerSpawnImpl } : {}),
      });
      if (submitted.status !== 'ok') {
        return receiptError({
          code: submitted.code || 'LOCAL_SIGNER_HANDOFF_FAILED',
          message: submitted.message || 'Local signer handoff failed.',
          dispatch,
          receipt_verification: {
            status: 'error',
            venue_id: isSolanaSubmitTxTask(task) ? 'solana-mainnet' : 'ethereum-mainnet',
            code: submitted.code || 'LOCAL_SIGNER_HANDOFF_FAILED',
            message: submitted.message,
            signer_handoff: {
              status: 'error',
              venue_id: submitted.venue_id || null,
              code: submitted.code || 'LOCAL_SIGNER_HANDOFF_FAILED',
              command: submitted.command || null,
              args_count: submitted.args_count ?? null,
              secret_material_observed: false,
            },
          },
        });
      }
      const verified = isSolanaSubmitTxTask(task)
        ? await verifySolanaDispatchReceipt({
            task,
            dispatch: submitted.dispatch,
            env,
            fetchImpl,
            now,
            rateLimiter,
            rateLimitPolicy,
            sleepImpl,
          })
        : await verifyEthereumDispatchReceipt({
            task,
            dispatch: submitted.dispatch,
            env,
            fetchImpl,
            now,
            rateLimiter,
            rateLimitPolicy,
            sleepImpl,
          });
      if (verified.status !== 'ok') return verified;
      return {
        ...verified,
        receipt_verification: {
          ...verified.receipt_verification,
          signer_handoff: submitted.signer_handoff,
        },
        dispatch: {
          ...verified.dispatch,
          receipt_verification: {
            ...verified.dispatch.receipt_verification,
            signer_handoff: submitted.signer_handoff,
          },
          agent_result: {
            ...verified.dispatch.agent_result,
            evidence: {
              ...verified.dispatch.agent_result.evidence,
              signer_handoff: true,
            },
          },
        },
      };
    }
    if (shouldSubmitHyperliquidSignedPayload(task, dispatch)) {
      const preflight = await verifyHyperliquidReceiptPreflight({
        dispatch,
        secretStore,
        env,
        fetchImpl,
        now,
        verifyHyperliquidLiveGrant,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
      if (preflight.status !== 'ok') return preflight;

      const submitted = await submitHyperliquidSignedExchangeAction({
        task,
        payload: dispatch.agent_result.evidence.signed_exchange_payload,
        fetchImpl,
        now,
        nonceStorePath: hyperliquidNonceStorePath,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
      if (!['submitted', 'done'].includes(submitted.status)) {
        return receiptError({
          code: submitted.code || 'HYPERLIQUID_SIGNED_SUBMIT_FAILED',
          message: submitted.message || 'Hyperliquid signed exchange submit failed.',
          dispatch,
          receipt_verification: {
            status: 'error',
            venue_id: 'hyperliquid',
            code: submitted.code || 'HYPERLIQUID_SIGNED_SUBMIT_FAILED',
            message: submitted.message,
          },
        });
      }
      const submittedDispatch = {
        ...dispatch,
        agent_result: {
          task_id: submitted.task_id || task.task_id,
          status: submitted.status,
          summary: submitted.summary,
          evidence: {
            ...submitted.evidence,
            signed_exchange_submit: true,
          },
          observed_at: submitted.observed_at,
          warnings: [],
        },
      };
      const verified = await verifyHyperliquidDispatchReceipt({
        task,
        dispatch: submittedDispatch,
        secretStore,
        env,
        fetchImpl,
        now,
        verifyHyperliquidLiveGrant,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
        hyperliquidPreflight: preflight,
      });
      if (verified.status !== 'ok') return verified;
      return {
        ...verified,
        receipt_verification: {
          ...verified.receipt_verification,
          signed_submit: {
            status: 'ok',
            venue_id: 'hyperliquid',
            nonce: submitted.evidence?.nonce || null,
            expires_after_ms: submitted.evidence?.expires_after_ms || null,
            idempotency_key: submitted.idempotency_key || null,
          },
        },
      };
    }
    if (shouldVerifyHyperliquidReceipt(task, dispatch)) {
      return verifyHyperliquidDispatchReceipt({
        task,
        dispatch,
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
    if (shouldVerifySolanaReceipt(task, dispatch)) {
      return verifySolanaDispatchReceipt({
        task,
        dispatch,
        env,
        fetchImpl,
        now,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
    }
    if (shouldVerifyEthereumReceipt(task, dispatch)) {
      return verifyEthereumDispatchReceipt({
        task,
        dispatch,
        env,
        fetchImpl,
        now,
        rateLimiter,
        rateLimitPolicy,
        sleepImpl,
      });
    }
    return {
      status: 'ok',
      dispatch,
      receipt_verification: {
        status: 'skipped',
        reason: dispatch?.status === 'ok' ? 'not_required_for_task' : 'dispatch_not_ok',
      },
    };
  }

  const keyMetadata = findVenueKey(secretStore, 'okx');
  if (!keyMetadata) {
    return receiptError({
      code: 'OKX_KEY_METADATA_REQUIRED',
      message: 'OKX receipt verification requires local OKX key metadata.',
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'okx',
        code: 'OKX_KEY_METADATA_REQUIRED',
      },
    });
  }

  const operationalProof = verifyVenueKeyOperationalProof(keyMetadata, {
    venue_id: 'okx',
    required_permissions: ['read', 'place_order'],
    require_ip_allowlist: true,
    now,
  });
  if (operationalProof.status !== 'ok') {
    return receiptError({
      code: operationalProof.code,
      message: operationalProof.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'okx',
        code: operationalProof.code,
        operational_proof: operationalProof,
      },
    });
  }

  const credentials = await resolveOkxCredentials(keyMetadata, { env, keychain });
  if (credentials.status !== 'ok') {
    return receiptError({
      code: credentials.code,
      message: credentials.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'okx',
        code: credentials.code,
        credential_resolution: credentials,
      },
    });
  }

  const status = await fetchOkxOrderStatus({
    credentials: credentials.credentials,
    keyMetadata,
    task,
    result: dispatch.agent_result,
    fetchImpl,
    now,
    simulated,
  });
  if (status.status !== 'ok') {
    return receiptError({
      code: status.code,
      message: status.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'okx',
        code: status.code,
        message: status.message,
        http_status: status.http_status,
      },
    });
  }

  const receipt = {
    status: 'ok',
    venue_id: 'okx',
    instrument: status.instrument,
    venue_order_id: status.venue_order_id,
    client_order_id: status.client_order_id,
    order_state: status.order_state,
    terminal: status.terminal,
    filled_size: status.filled_size,
    average_price: status.average_price,
    observed_at: status.observed_at,
    idempotency_key: status.idempotency_key,
    credential_resolution: redactCredentialResolution(credentials),
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
  };
  return {
    status: 'ok',
    receipt_verification: receipt,
    dispatch: {
      ...dispatch,
      local_decision: status.terminal
        ? 'accepted_result_verified_terminal'
        : 'accepted_result_verified_open',
      receipt_verification: receipt,
      agent_result: {
        ...dispatch.agent_result,
        evidence: {
          ...dispatch.agent_result.evidence,
          order_state: status.order_state,
          order_terminal: status.terminal,
          order_status_observed_at: status.observed_at,
          filled_size: status.filled_size,
          average_price: status.average_price,
        },
      },
    },
  };
}

async function verifySolanaDispatchReceipt(options = {}) {
  const {
    task,
    dispatch,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const receipt = await fetchSolanaTransactionReceipt({
    task,
    result: dispatch.agent_result,
    env,
    fetchImpl,
    now,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (receipt.status !== 'ok') {
    return receiptError({
      code: receipt.code,
      message: receipt.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'solana-mainnet',
        code: receipt.code,
        message: receipt.message,
        http_status: receipt.http_status,
        rpc_code: receipt.rpc_code,
        retry: receipt.retry,
      },
    });
  }

  const receiptVerification = {
    status: 'ok',
    venue_id: receipt.venue_id,
    chain_id: receipt.chain_id,
    signature: receipt.signature,
    tx_signature: receipt.signature,
    tx_digest: receipt.signature,
    slot: receipt.slot,
    confirmations: receipt.confirmations,
    confirmation_status: receipt.confirmation_status,
    terminal: receipt.terminal,
    observed_at: receipt.observed_at,
    idempotency_key: receipt.idempotency_key,
    retry: receipt.retry,
  };

  return {
    status: 'ok',
    receipt_verification: receiptVerification,
    dispatch: {
      ...dispatch,
      local_decision: receipt.terminal
        ? 'accepted_result_verified_terminal'
        : 'accepted_result_verified_open',
      receipt_verification: receiptVerification,
      agent_result: {
        ...dispatch.agent_result,
        evidence: {
          ...dispatch.agent_result.evidence,
          tx_digest: receipt.signature,
          slot: receipt.slot,
          confirmation_status: receipt.confirmation_status,
          confirmations: receipt.confirmations,
          transaction_terminal: receipt.terminal,
          receipt_observed_at: receipt.observed_at,
        },
      },
    },
  };
}

async function verifyEthereumDispatchReceipt(options = {}) {
  const {
    task,
    dispatch,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const receipt = await fetchEthereumTransactionReceipt({
    task,
    result: dispatch.agent_result,
    env,
    fetchImpl,
    now,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (receipt.status !== 'ok') {
    return receiptError({
      code: receipt.code,
      message: receipt.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'ethereum-mainnet',
        code: receipt.code,
        message: receipt.message,
        http_status: receipt.http_status,
        rpc_code: receipt.rpc_code,
        retry: receipt.retry,
      },
    });
  }

  const receiptVerification = {
    status: 'ok',
    venue_id: receipt.venue_id,
    chain_id: receipt.chain_id,
    tx_hash: receipt.tx_hash,
    transaction_hash: receipt.transaction_hash,
    tx_digest: receipt.tx_hash,
    block_hash: receipt.block_hash,
    block_number: receipt.block_number,
    receipt_status: receipt.receipt_status,
    gas_used: receipt.gas_used,
    effective_gas_price: receipt.effective_gas_price,
    terminal: receipt.terminal,
    observed_at: receipt.observed_at,
    idempotency_key: receipt.idempotency_key,
    retry: receipt.retry,
  };

  return {
    status: 'ok',
    receipt_verification: receiptVerification,
    dispatch: {
      ...dispatch,
      local_decision: receipt.terminal
        ? 'accepted_result_verified_terminal'
        : 'accepted_result_verified_open',
      receipt_verification: receiptVerification,
      agent_result: {
        ...dispatch.agent_result,
        evidence: {
          ...dispatch.agent_result.evidence,
          tx_digest: receipt.tx_hash,
          block_hash: receipt.block_hash,
          block_number: receipt.block_number,
          receipt_status: receipt.receipt_status,
          gas_used: receipt.gas_used,
          transaction_terminal: receipt.terminal,
          receipt_observed_at: receipt.observed_at,
        },
      },
    },
  };
}

async function verifyHyperliquidReceiptPreflight(options = {}) {
  const {
    dispatch,
    secretStore,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    verifyHyperliquidLiveGrant = false,
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
  } = options;
  const keyMetadata = findVenueKey(secretStore, 'hyperliquid');
  if (!keyMetadata) {
    return receiptError({
      code: 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      message: 'Hyperliquid receipt verification requires local Hyperliquid key metadata.',
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'hyperliquid',
        code: 'HYPERLIQUID_KEY_METADATA_REQUIRED',
      },
    });
  }

  const operationalProof = verifyVenueKeyOperationalProof(keyMetadata, {
    venue_id: 'hyperliquid',
    required_permissions: ['read', 'place_order'],
    require_ip_allowlist: false,
    now,
  });
  if (operationalProof.status !== 'ok') {
    return receiptError({
      code: operationalProof.code,
      message: operationalProof.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'hyperliquid',
        code: operationalProof.code,
        operational_proof: operationalProof,
      },
    });
  }

  const agentWalletGrant = verifyHyperliquidAgentWalletGrantProof(keyMetadata, {
    required_permissions: ['read', 'place_order'],
  });
  if (agentWalletGrant.status !== 'ok') {
    return receiptError({
      code: agentWalletGrant.code,
      message: agentWalletGrant.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'hyperliquid',
        code: agentWalletGrant.code,
        agent_wallet_grant: agentWalletGrant,
      },
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
      return receiptError({
        code: agentWalletLiveGrant.code,
        message: agentWalletLiveGrant.message,
        dispatch,
        receipt_verification: {
          status: 'error',
          venue_id: 'hyperliquid',
          code: agentWalletLiveGrant.code,
          agent_wallet_grant: agentWalletGrant,
          agent_wallet_live_grant: agentWalletLiveGrant,
        },
      });
    }
  }

  return {
    status: 'ok',
    keyMetadata,
    operationalProof,
    agentWalletGrant,
    agentWalletLiveGrant,
  };
}

async function verifyHyperliquidDispatchReceipt(options = {}) {
  const {
    task,
    dispatch,
    env = process.env,
    fetchImpl = fetch,
    now = new Date(),
    rateLimiter = null,
    rateLimitPolicy = {},
    sleepImpl,
    hyperliquidPreflight = null,
  } = options;
  const preflight =
    hyperliquidPreflight?.status === 'ok'
      ? hyperliquidPreflight
      : await verifyHyperliquidReceiptPreflight(options);
  if (preflight.status !== 'ok') return preflight;

  const { keyMetadata, operationalProof, agentWalletGrant, agentWalletLiveGrant } = preflight;

  const status = await fetchHyperliquidOrderStatus({
    keyMetadata,
    task,
    result: dispatch.agent_result,
    env,
    fetchImpl,
    now,
    rateLimiter,
    rateLimitPolicy,
    sleepImpl,
  });
  if (status.status !== 'ok') {
    return receiptError({
      code: status.code,
      message: status.message,
      dispatch,
      receipt_verification: {
        status: 'error',
        venue_id: 'hyperliquid',
        code: status.code,
        message: status.message,
        http_status: status.http_status,
      },
    });
  }

  const receipt = {
    status: 'ok',
    venue_id: 'hyperliquid',
    user: status.user,
    coin: status.coin,
    venue_order_id: status.venue_order_id,
    client_order_id: status.client_order_id,
    order_state: status.order_state,
    terminal: status.terminal,
    filled_size: status.filled_size,
    average_price: status.average_price,
    observed_at: status.observed_at,
    idempotency_key: status.idempotency_key,
    operational_proof: {
      status: operationalProof.status,
      venue_id: operationalProof.venue_id,
      key_handle: operationalProof.key_handle,
      account_ref: operationalProof.account_ref,
      required_permissions: operationalProof.required_permissions,
      permission_proof: operationalProof.permission_proof,
    },
    agent_wallet_grant: agentWalletGrant,
    ...(agentWalletLiveGrant ? { agent_wallet_live_grant: agentWalletLiveGrant } : {}),
  };
  return {
    status: 'ok',
    receipt_verification: receipt,
    dispatch: {
      ...dispatch,
      local_decision: status.terminal
        ? 'accepted_result_verified_terminal'
        : 'accepted_result_verified_open',
      receipt_verification: receipt,
      agent_result: {
        ...dispatch.agent_result,
        evidence: {
          ...dispatch.agent_result.evidence,
          order_state: status.order_state,
          order_terminal: status.terminal,
          order_status_observed_at: status.observed_at,
          filled_size: status.filled_size,
          average_price: status.average_price,
        },
      },
    },
  };
}
