import { spawn } from 'node:child_process';
import { sanitizeAgentTaskForDispatch, validateAgentTaskResult } from '../../core/agent-task.js';
import {
  SOLANA_CHAIN_ID,
  SOLANA_UNSIGNED_TRANSACTION_FORMAT,
  SOLANA_VENUE_ID,
  normalizeSolanaExecutionResult,
  verifySolanaAgentTaskResult,
} from '../../core/solana-trade.js';
import {
  ETHEREUM_CHAIN_ID,
  ETHEREUM_TRANSACTION_REQUEST_FORMAT,
  ETHEREUM_VENUE_ID,
  normalizeEthereumExecutionResult,
  verifyEthereumAgentTaskResult,
} from '../../core/ethereum-trade.js';
import {
  MAX_AGENT_STDIO_BYTES,
  parseAgentJsonResult,
  parseCommandLine,
} from './agent-dispatcher.mjs';

export const DEFAULT_SIGNER_HANDOFF_TIMEOUT_MS = 30_000;

const RAW_SECRET_ARG_RE =
  /(^--?(token|secret|password|passphrase|private[-_]?key|api[-_]?key)(=|$))|((token|secret|password|passphrase|private[-_]?key|api[-_]?key)=)/i;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function appendBounded(current, chunk, maxBytes = MAX_AGENT_STDIO_BYTES) {
  const next = `${current}${chunk.toString()}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function nowIso(now) {
  const value = typeof now === 'function' ? now() : now || new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNER_HANDOFF_TIMEOUT_MS;
}

function taskVenueId(task = {}) {
  return (
    task.venue_id ||
    task.policy_context?.venue_id ||
    task.authorization?.venue_id ||
    task.authorization?.venue_account_id ||
    null
  );
}

function signerCommandRequiredError(venueId) {
  if (venueId === SOLANA_VENUE_ID) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNER_COMMAND_REQUIRED',
      message:
        'Set SENTRY_SOLANA_SIGNER_COMMAND or pass solanaSignerCommand to submit a prepared Solana transaction.',
      venue_id: SOLANA_VENUE_ID,
    };
  }
  if (venueId === ETHEREUM_VENUE_ID) {
    return {
      status: 'error',
      code: 'ETHEREUM_SIGNER_COMMAND_REQUIRED',
      message:
        'Set SENTRY_ETHEREUM_SIGNER_COMMAND or pass ethereumSignerCommand to submit a prepared Ethereum transaction.',
      venue_id: ETHEREUM_VENUE_ID,
    };
  }
  return {
    status: 'error',
    code: 'SIGNER_COMMAND_UNSUPPORTED_VENUE',
    message: 'Local signer command handoff only supports Solana and Ethereum submit_tx tasks.',
    venue_id: venueId || null,
  };
}

export function resolveLocalSignerCommand(options = {}) {
  const { task, env = process.env } = options;
  const venueId = taskVenueId(task);
  const commandLine =
    stringValue(options.commandLine || options.signerCommand) ||
    (venueId === SOLANA_VENUE_ID
      ? stringValue(options.solanaSignerCommand || env.SENTRY_SOLANA_SIGNER_COMMAND)
      : venueId === ETHEREUM_VENUE_ID
        ? stringValue(options.ethereumSignerCommand || env.SENTRY_ETHEREUM_SIGNER_COMMAND)
        : '');
  if (!commandLine) return signerCommandRequiredError(venueId);

  const parts = parseCommandLine(commandLine);
  if (!parts.length) {
    return {
      status: 'error',
      code: 'SIGNER_COMMAND_INVALID',
      message: 'Local signer command is empty or invalid.',
      venue_id: venueId || null,
    };
  }
  if (parts.some((arg) => RAW_SECRET_ARG_RE.test(arg))) {
    return {
      status: 'error',
      code: 'SIGNER_COMMAND_SECRET_ARG_REJECTED',
      message: 'Local signer command must not include raw token/secret/password arguments.',
      venue_id: venueId || null,
    };
  }
  return {
    status: 'ok',
    venue_id: venueId,
    command_line: commandLine,
    command: parts[0],
    args: parts.slice(1),
  };
}

function solanaQuoteId(task = {}, result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    task.action?.params?.quote_id || task.constraints?.idempotency_key || evidence.quote_id
  );
}

function ethereumQuoteId(task = {}, result = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  return stringValue(
    task.action?.params?.quote_id || task.constraints?.idempotency_key || evidence.quote_id
  );
}

function arrayStrings(value) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function preparedSolanaTransaction(result = {}, verification = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const prepared = isObject(evidence.prepared_transaction) ? evidence.prepared_transaction : {};
  return {
    venue_id: SOLANA_VENUE_ID,
    chain_id: evidence.chain_id || prepared.chain_id || SOLANA_CHAIN_ID,
    quote_id:
      evidence.quote_id || prepared.quote_id || verification.prepared_transaction?.quote_id || null,
    transaction_format: SOLANA_UNSIGNED_TRANSACTION_FORMAT,
    unsigned_transaction_base64:
      evidence.unsigned_transaction_base64 ||
      evidence.transaction_base64 ||
      evidence.swap_transaction_base64 ||
      prepared.unsigned_transaction_base64 ||
      prepared.transaction_base64 ||
      prepared.swap_transaction_base64 ||
      null,
    required_signers: [
      ...arrayStrings(evidence.required_signers),
      ...arrayStrings(prepared.required_signers),
      stringValue(evidence.required_signer || prepared.required_signer),
      stringValue(evidence.signer || prepared.signer),
    ].filter(Boolean),
    simulation_id:
      evidence.simulation_id ||
      prepared.simulation_id ||
      verification.prepared_transaction?.simulation_id ||
      null,
    simulation_status:
      evidence.simulation_status ||
      evidence.simulation?.status ||
      prepared.simulation_status ||
      verification.prepared_transaction?.simulation_status ||
      null,
  };
}

function preparedEthereumTransaction(result = {}, verification = {}) {
  const evidence = isObject(result.evidence) ? result.evidence : {};
  const prepared = isObject(evidence.prepared_transaction) ? evidence.prepared_transaction : {};
  const request = isObject(evidence.transaction_request)
    ? evidence.transaction_request
    : isObject(prepared.transaction_request)
      ? prepared.transaction_request
      : prepared;
  return {
    venue_id: ETHEREUM_VENUE_ID,
    chain_id:
      evidence.chain_id ||
      request.chain_id ||
      request.chainId ||
      prepared.chain_id ||
      ETHEREUM_CHAIN_ID,
    quote_id:
      evidence.quote_id || prepared.quote_id || verification.prepared_transaction?.quote_id || null,
    transaction_format: ETHEREUM_TRANSACTION_REQUEST_FORMAT,
    transaction_request: {
      from: request.from || evidence.from || prepared.from || null,
      to: request.to || evidence.to || prepared.to || null,
      data: request.data || request.calldata || evidence.data || evidence.calldata || null,
      value: request.value || evidence.value || prepared.value || '0',
      gas: request.gas || request.gasLimit || request.gas_limit || null,
      maxFeePerGas: request.maxFeePerGas || request.max_fee_per_gas || null,
      maxPriorityFeePerGas:
        request.maxPriorityFeePerGas || request.max_priority_fee_per_gas || null,
    },
    simulation_id:
      evidence.simulation_id ||
      prepared.simulation_id ||
      verification.prepared_transaction?.simulation_id ||
      null,
    simulation_status:
      evidence.simulation_status ||
      evidence.simulation?.status ||
      prepared.simulation_status ||
      verification.prepared_transaction?.simulation_status ||
      null,
  };
}

function verifyPreparedResult(result, task) {
  const venueId = taskVenueId(task);
  if (venueId === SOLANA_VENUE_ID && task.action?.type === 'submit_tx') {
    return verifySolanaAgentTaskResult(result, task);
  }
  if (venueId === ETHEREUM_VENUE_ID && task.action?.type === 'submit_tx') {
    return verifyEthereumAgentTaskResult(result, task);
  }
  return {
    status: 'error',
    code: 'SIGNER_HANDOFF_UNSUPPORTED_TASK',
    message: 'Local signer command handoff only supports Solana/Ethereum submit_tx tasks.',
  };
}

function verifySubmittedResult(result, task) {
  const venueId = taskVenueId(task);
  if (venueId === SOLANA_VENUE_ID && task.action?.type === 'submit_tx') {
    return verifySolanaAgentTaskResult(result, task);
  }
  if (venueId === ETHEREUM_VENUE_ID && task.action?.type === 'submit_tx') {
    return verifyEthereumAgentTaskResult(result, task);
  }
  return {
    status: 'error',
    code: 'SIGNER_HANDOFF_UNSUPPORTED_TASK',
    message: 'Local signer command handoff only supports Solana/Ethereum submit_tx tasks.',
  };
}

function buildSignerPayload({ task, proposedResult, preparedTransaction }) {
  return {
    type: 'sentry.signer.submit_prepared_transaction',
    task_id: task.task_id,
    venue_id: taskVenueId(task),
    task: sanitizeAgentTaskForDispatch(task),
    proposed_result: proposedResult,
    prepared_transaction: preparedTransaction,
  };
}

function normalizeSignerJsonResult(parsed, task, proposedResult, now) {
  const venueId = taskVenueId(task);
  if (isObject(parsed) && parsed.status && parsed.task_id) return parsed;
  if (venueId === SOLANA_VENUE_ID) {
    return normalizeSolanaExecutionResult(parsed, {
      task_id: task.task_id,
      quote_id: solanaQuoteId(task, proposedResult),
      observed_at: nowIso(now),
    });
  }
  if (venueId === ETHEREUM_VENUE_ID) {
    return normalizeEthereumExecutionResult(parsed, {
      task_id: task.task_id,
      quote_id: ethereumQuoteId(task, proposedResult),
      observed_at: nowIso(now),
    });
  }
  return parsed;
}

export async function submitPreparedTransactionWithSignerCommand(options = {}) {
  const {
    task,
    dispatch,
    env = process.env,
    timeoutMs = DEFAULT_SIGNER_HANDOFF_TIMEOUT_MS,
    spawnImpl = spawn,
    now = new Date(),
  } = options;
  const venueId = taskVenueId(task);
  if (dispatch?.status !== 'ok' || dispatch.agent_result?.status !== 'proposed') {
    return {
      status: 'skipped',
      reason: 'dispatch_result_not_proposed',
      venue_id: venueId || null,
      dispatch,
    };
  }

  const proposedValidation = validateAgentTaskResult(dispatch.agent_result, task);
  if (proposedValidation.status !== 'ok') {
    return {
      status: 'error',
      code: proposedValidation.code,
      message: proposedValidation.message,
      local_decision: 'signer_handoff_failed',
      result_validation: proposedValidation,
      dispatch,
    };
  }
  const preparedVerification = verifyPreparedResult(proposedValidation.result, task);
  if (preparedVerification.status !== 'ok') {
    return {
      status: 'error',
      code: preparedVerification.code,
      message: preparedVerification.message,
      local_decision: 'signer_handoff_failed',
      venue_validation: preparedVerification,
      dispatch,
    };
  }

  const command = resolveLocalSignerCommand({ ...options, task, env });
  if (command.status !== 'ok') {
    return {
      ...command,
      local_decision: 'signer_handoff_failed',
      dispatch,
    };
  }

  const preparedTransaction =
    venueId === SOLANA_VENUE_ID
      ? preparedSolanaTransaction(proposedValidation.result, preparedVerification)
      : preparedEthereumTransaction(proposedValidation.result, preparedVerification);
  const payload = buildSignerPayload({
    task,
    proposedResult: proposedValidation.result,
    preparedTransaction,
  });
  const effectiveTimeoutMs = safeTimeoutMs(timeoutMs);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      if (child?.kill && result.code === 'SIGNER_HANDOFF_TIMEOUT') child.kill('SIGTERM');
      resolve(result);
    }

    const timer = setTimeout(() => {
      finish({
        status: 'error',
        code: 'SIGNER_HANDOFF_TIMEOUT',
        message: `Local signer command did not return within ${effectiveTimeoutMs}ms.`,
        local_decision: 'signer_handoff_failed',
        venue_id: venueId,
        command: command.command,
        args_count: command.args.length,
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
        dispatch,
      });
    }, effectiveTimeoutMs);

    try {
      child = spawnImpl(command.command, command.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } catch (error) {
      clearTimeout(timer);
      finish({
        status: 'error',
        code: 'SIGNER_HANDOFF_SPAWN_FAILED',
        message: error?.message || String(error),
        local_decision: 'signer_handoff_failed',
        venue_id: venueId,
        command: command.command,
        args_count: command.args.length,
        dispatch,
      });
      return;
    }

    child.stdout?.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.on?.('error', (error) => {
      clearTimeout(timer);
      finish({
        status: 'error',
        code: 'SIGNER_HANDOFF_PROCESS_ERROR',
        message: error?.message || String(error),
        local_decision: 'signer_handoff_failed',
        venue_id: venueId,
        command: command.command,
        args_count: command.args.length,
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
        dispatch,
      });
    });
    child.on?.('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish({
          status: 'error',
          code: 'SIGNER_HANDOFF_PROCESS_FAILED',
          message: `Local signer command exited code=${code ?? 'null'} signal=${signal ?? 'null'}.`,
          local_decision: 'signer_handoff_failed',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          exit_code: code,
          signal,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          dispatch,
        });
        return;
      }

      const parsed = parseAgentJsonResult(stdout);
      if (parsed.status !== 'ok') {
        finish({
          ...parsed,
          local_decision: 'signer_handoff_failed',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          dispatch,
        });
        return;
      }

      const candidate = normalizeSignerJsonResult(
        parsed.result,
        task,
        proposedValidation.result,
        now
      );
      const resultValidation = validateAgentTaskResult(candidate, task);
      if (resultValidation.status !== 'ok') {
        finish({
          status: 'error',
          code: resultValidation.code,
          message: resultValidation.message,
          local_decision: 'signer_handoff_failed',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          result_validation: resultValidation,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          dispatch,
        });
        return;
      }
      if (!['submitted', 'done'].includes(resultValidation.result.status)) {
        finish({
          status: 'error',
          code: 'SIGNER_SUBMITTED_RESULT_REQUIRED',
          message: 'Local signer command must return a submitted/done AgentTaskResult.',
          local_decision: 'signer_handoff_failed',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          dispatch,
        });
        return;
      }

      const venueValidation = verifySubmittedResult(resultValidation.result, task);
      if (venueValidation.status !== 'ok') {
        finish({
          status: 'error',
          code: venueValidation.code,
          message: venueValidation.message,
          local_decision: 'signer_handoff_failed',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          venue_validation: venueValidation,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
          dispatch,
        });
        return;
      }

      const submittedDispatch = {
        ...dispatch,
        local_decision: 'accepted_result_signed_and_submitted',
        agent_result: {
          ...resultValidation.result,
          evidence: {
            ...resultValidation.result.evidence,
            signer_handoff: true,
            prepared_quote_id: preparedTransaction.quote_id || null,
          },
        },
      };
      finish({
        status: 'ok',
        local_decision: 'accepted_result_signed_and_submitted',
        venue_id: venueId,
        command: command.command,
        args_count: command.args.length,
        task_id: task.task_id,
        signer_handoff: {
          status: 'ok',
          venue_id: venueId,
          command: command.command,
          args_count: command.args.length,
          prepared_transaction_format: preparedTransaction.transaction_format,
          quote_id: preparedTransaction.quote_id || null,
          secret_material_observed: false,
        },
        dispatch: submittedDispatch,
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
      });
    });

    child.stdin?.end(`${JSON.stringify(payload)}\n`);
  });
}
