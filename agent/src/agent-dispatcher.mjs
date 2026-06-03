import { spawn } from 'node:child_process';
import {
  sanitizeAgentTaskForDispatch,
  validateAgentTask,
  validateAgentTaskResult,
} from '../../core/agent-task.js';
import { verifyEthereumAgentTaskResult } from '../../core/ethereum-trade.js';
import { verifyHyperliquidAgentTaskResult } from '../../core/hyperliquid-trade.js';
import { verifyOkxAgentTaskResult } from '../../core/okx-trade.js';
import { verifySolanaAgentTaskResult } from '../../core/solana-trade.js';

export const DEFAULT_AGENT_DISPATCH_TIMEOUT_MS = 30_000;
export const MAX_AGENT_STDIO_BYTES = 64_000;

export function parseCommandLine(commandLine) {
  if (!commandLine || !commandLine.trim()) return [];
  const parts = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = re.exec(commandLine);
  while (match) {
    parts.push(match[1] ?? match[2] ?? match[3]);
    match = re.exec(commandLine);
  }
  return parts;
}

function appendBounded(current, chunk, maxBytes = MAX_AGENT_STDIO_BYTES) {
  const next = `${current}${chunk.toString()}`;
  return next.length > maxBytes ? next.slice(-maxBytes) : next;
}

function verifyVenueResult(result, task) {
  if (task.venue_id === 'okx' && task.action?.type === 'place_order') {
    return verifyOkxAgentTaskResult(result, task);
  }
  if (task.venue_id === 'hyperliquid' && task.action?.type === 'place_order') {
    return verifyHyperliquidAgentTaskResult(result, task);
  }
  if (task.venue_id === 'solana-mainnet' && task.action?.type === 'submit_tx') {
    return verifySolanaAgentTaskResult(result, task);
  }
  if (task.venue_id === 'ethereum-mainnet' && task.action?.type === 'submit_tx') {
    return verifyEthereumAgentTaskResult(result, task);
  }
  return { status: 'ok' };
}

export function parseAgentJsonResult(stdout) {
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return { status: 'ok', result: JSON.parse(lines[index]) };
    } catch {
      // Keep scanning; external agents may print logs before the final JSON line.
    }
  }
  return {
    status: 'error',
    code: 'AGENT_RESULT_JSON_REQUIRED',
    message: 'External Agent stdout must contain a JSON AgentTaskResult line.',
  };
}

export async function dispatchAgentTask(options = {}) {
  const {
    task,
    commandLine,
    timeoutMs = DEFAULT_AGENT_DISPATCH_TIMEOUT_MS,
    spawnImpl = spawn,
    allowPlanned = false,
    localDispatchReadyVenues = [],
  } = options;
  const effectiveTimeoutMs =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : DEFAULT_AGENT_DISPATCH_TIMEOUT_MS;

  const validation = validateAgentTask(task, {
    allow_planned: allowPlanned,
    local_dispatch_ready_venues: localDispatchReadyVenues,
  });
  if (validation.status !== 'ok') {
    return {
      status: 'error',
      code: validation.code,
      message: validation.message,
      local_decision: 'blocked_before_dispatch',
      validation,
    };
  }

  const parts = parseCommandLine(commandLine);
  if (!parts.length) {
    return {
      status: 'error',
      code: 'AGENT_COMMAND_REQUIRED',
      message: 'agent.dispatch requires payload.command or --agent-cmd.',
      local_decision: 'blocked_before_dispatch',
    };
  }

  const [cmd, ...args] = parts;
  const dispatchedTask = sanitizeAgentTaskForDispatch(task);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let child = null;

    function finish(payload) {
      if (settled) return;
      settled = true;
      if (child?.kill && payload.code === 'AGENT_DISPATCH_TIMEOUT') child.kill('SIGTERM');
      resolve(payload);
    }

    const timer = setTimeout(() => {
      finish({
        status: 'error',
        code: 'AGENT_DISPATCH_TIMEOUT',
        message: `External Agent did not return within ${effectiveTimeoutMs}ms.`,
        local_decision: 'timeout',
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
      });
    }, effectiveTimeoutMs);

    try {
      child = spawnImpl(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
    } catch (error) {
      clearTimeout(timer);
      finish({
        status: 'error',
        code: 'AGENT_SPAWN_FAILED',
        message: error?.message || String(error),
        local_decision: 'spawn_failed',
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
        code: 'AGENT_PROCESS_ERROR',
        message: error?.message || String(error),
        local_decision: 'process_error',
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
      });
    });
    child.on?.('close', (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        finish({
          status: 'error',
          code: 'AGENT_PROCESS_FAILED',
          message: `External Agent exited code=${code ?? 'null'} signal=${signal ?? 'null'}.`,
          local_decision: 'process_failed',
          exit_code: code,
          signal,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
        });
        return;
      }

      const parsed = parseAgentJsonResult(stdout);
      if (parsed.status !== 'ok') {
        finish({
          ...parsed,
          local_decision: 'result_rejected',
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
        });
        return;
      }

      const resultValidation = validateAgentTaskResult(parsed.result, dispatchedTask);
      if (resultValidation.status !== 'ok') {
        finish({
          status: 'error',
          code: resultValidation.code,
          message: resultValidation.message,
          local_decision: 'result_rejected',
          result_validation: resultValidation,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
        });
        return;
      }

      const venueValidation = verifyVenueResult(resultValidation.result, dispatchedTask);
      if (venueValidation.status !== 'ok') {
        finish({
          status: 'error',
          code: venueValidation.code,
          message: venueValidation.message,
          local_decision: 'result_rejected',
          venue_validation: venueValidation,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
        });
        return;
      }

      finish({
        status: 'ok',
        local_decision: 'accepted_result',
        task_id: dispatchedTask.task_id,
        authorization: validation.authorization,
        capabilities_required: validation.capabilities_required,
        agent_result: resultValidation.result,
        stdout_bytes: stdout.length,
        stderr_bytes: stderr.length,
      });
    });

    child.stdin?.end(`${JSON.stringify(dispatchedTask)}\n`);
  });
}
