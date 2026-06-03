import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveEthereumReadConfig, isEthereumAddress } from './ethereum-readonly-adapter.mjs';
import { parseCommandLine } from './agent-dispatcher.mjs';
import { resolveSolanaReadConfig, isSolanaAddress } from './solana-readonly-adapter.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_SIGNER_PROBE_TIMEOUT_MS = 3000;
const SOLANA_VENUE_ID = 'solana-mainnet';
const ETHEREUM_VENUE_ID = 'ethereum-mainnet';
const ETHEREUM_ADDRESS_RE = /0x[a-fA-F0-9]{40}/;
const SOLANA_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

function safeTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SIGNER_PROBE_TIMEOUT_MS;
}

function envValue(env = {}, name) {
  return String(env[name] || '').trim();
}

function normalizeEthereumAddress(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function commandLabel(commandLine) {
  const parts = parseCommandLine(commandLine);
  if (!parts.length) return null;
  return { cmd: parts[0], args: parts.slice(1) };
}

function extractSolanaAddress(text) {
  const matches = String(text || '').match(new RegExp(SOLANA_ADDRESS_RE, 'g')) || [];
  return matches.find((candidate) => isSolanaAddress(candidate)) || null;
}

function extractEthereumAddress(text) {
  const match = String(text || '').match(ETHEREUM_ADDRESS_RE);
  return match ? normalizeEthereumAddress(match[0]) : null;
}

async function runProbeCommand({ commandLine, execFileImpl, timeoutMs, env }) {
  const command = commandLabel(commandLine);
  if (!command) {
    return {
      status: 'error',
      code: 'SIGNER_PROBE_COMMAND_INVALID',
      message: 'Signer probe command is empty or invalid.',
    };
  }

  try {
    const result = await (execFileImpl || execFileAsync)(command.cmd, command.args, {
      timeout: safeTimeoutMs(timeoutMs),
      env,
    });
    return {
      status: 'ok',
      command: command.cmd,
      args_count: command.args.length,
      stdout: String(result?.stdout || ''),
    };
  } catch (error) {
    return {
      status: 'error',
      code: 'SIGNER_PROBE_COMMAND_FAILED',
      message: 'Signer probe command failed.',
      command: command.cmd,
      args_count: command.args.length,
      exit_code: Number.isInteger(error?.code) ? error.code : null,
      signal: error?.signal || null,
    };
  }
}

function staticSignerAddressProof({ venueId, expected, actual, source }) {
  if (!actual) return null;
  const normalizedActual =
    venueId === ETHEREUM_VENUE_ID ? normalizeEthereumAddress(actual) : String(actual).trim();
  if (normalizedActual !== expected) {
    return {
      status: 'error',
      code:
        venueId === ETHEREUM_VENUE_ID
          ? 'ETHEREUM_SIGNER_ACCOUNT_MISMATCH'
          : 'SOLANA_SIGNER_ACCOUNT_MISMATCH',
      message: 'Configured signer address does not match the task wallet/account.',
      venue_id: venueId,
      expected_account: expected,
      observed_account: normalizedActual,
      source,
      secret_material_observed: false,
    };
  }
  return {
    status: 'ok',
    venue_id: venueId,
    account_ref: expected,
    observed_account: normalizedActual,
    source,
    probe_type: 'non_signing_address_probe',
    can_attempt_external_signing: true,
    secret_material_observed: false,
  };
}

function missingProbeConfig({ venueId, accountRef }) {
  const prefix = venueId === ETHEREUM_VENUE_ID ? 'ETHEREUM' : 'SOLANA';
  return {
    status: 'partial',
    code: `${prefix}_SIGNER_PROBE_NOT_CONFIGURED`,
    message:
      venueId === ETHEREUM_VENUE_ID
        ? 'Set SENTRY_ETHEREUM_SIGNER_ADDRESS or SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND to prove local signer address before dispatch.'
        : 'Set SENTRY_SOLANA_SIGNER_ADDRESS or SENTRY_SOLANA_SIGNER_PROBE_COMMAND to prove local signer address before dispatch.',
    venue_id: venueId,
    account_ref: accountRef,
    source: 'not_configured',
    probe_type: 'non_signing_address_probe',
    can_attempt_external_signing: 'unknown',
    secret_material_observed: false,
  };
}

export async function probeSolanaSigner({
  env = process.env,
  execFileImpl = null,
  timeoutMs = DEFAULT_SIGNER_PROBE_TIMEOUT_MS,
} = {}) {
  const config = resolveSolanaReadConfig(env);
  if (config.status !== 'ok') {
    return {
      status: 'blocked',
      code: config.code,
      message: config.message,
      venue_id: SOLANA_VENUE_ID,
      secret_material_observed: false,
    };
  }

  const signerAddress = envValue(env, 'SENTRY_SOLANA_SIGNER_ADDRESS');
  const staticProof = staticSignerAddressProof({
    venueId: SOLANA_VENUE_ID,
    expected: config.owner,
    actual: signerAddress,
    source: 'env_signer_address',
  });
  if (staticProof) return staticProof;

  const commandLine = envValue(env, 'SENTRY_SOLANA_SIGNER_PROBE_COMMAND');
  if (!commandLine)
    return missingProbeConfig({ venueId: SOLANA_VENUE_ID, accountRef: config.owner });

  const command = await runProbeCommand({ commandLine, execFileImpl, timeoutMs, env });
  if (command.status !== 'ok') {
    return {
      ...command,
      status: 'error',
      code:
        command.code === 'SIGNER_PROBE_COMMAND_INVALID'
          ? command.code
          : 'SOLANA_SIGNER_PROBE_FAILED',
      venue_id: SOLANA_VENUE_ID,
      account_ref: config.owner,
      secret_material_observed: false,
    };
  }

  const observed = extractSolanaAddress(command.stdout);
  if (!observed) {
    return {
      status: 'error',
      code: 'SOLANA_SIGNER_ADDRESS_NOT_FOUND',
      message: 'Solana signer probe command did not return a valid wallet address.',
      venue_id: SOLANA_VENUE_ID,
      account_ref: config.owner,
      source: 'probe_command',
      command: command.command,
      args_count: command.args_count,
      secret_material_observed: false,
    };
  }
  return staticSignerAddressProof({
    venueId: SOLANA_VENUE_ID,
    expected: config.owner,
    actual: observed,
    source: 'probe_command',
  });
}

export async function probeEthereumSigner({
  env = process.env,
  execFileImpl = null,
  timeoutMs = DEFAULT_SIGNER_PROBE_TIMEOUT_MS,
} = {}) {
  const config = resolveEthereumReadConfig(env);
  if (config.status !== 'ok') {
    return {
      status: 'blocked',
      code: config.code,
      message: config.message,
      venue_id: ETHEREUM_VENUE_ID,
      secret_material_observed: false,
    };
  }

  const signerAddress = envValue(env, 'SENTRY_ETHEREUM_SIGNER_ADDRESS');
  const staticProof = staticSignerAddressProof({
    venueId: ETHEREUM_VENUE_ID,
    expected: config.owner,
    actual: signerAddress,
    source: 'env_signer_address',
  });
  if (staticProof) return staticProof;

  const commandLine = envValue(env, 'SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND');
  if (!commandLine) {
    return missingProbeConfig({ venueId: ETHEREUM_VENUE_ID, accountRef: config.owner });
  }

  const command = await runProbeCommand({ commandLine, execFileImpl, timeoutMs, env });
  if (command.status !== 'ok') {
    return {
      ...command,
      status: 'error',
      code:
        command.code === 'SIGNER_PROBE_COMMAND_INVALID'
          ? command.code
          : 'ETHEREUM_SIGNER_PROBE_FAILED',
      venue_id: ETHEREUM_VENUE_ID,
      account_ref: config.owner,
      secret_material_observed: false,
    };
  }

  const observed = extractEthereumAddress(command.stdout);
  if (!observed || !isEthereumAddress(observed)) {
    return {
      status: 'error',
      code: 'ETHEREUM_SIGNER_ADDRESS_NOT_FOUND',
      message: 'Ethereum signer probe command did not return a valid account address.',
      venue_id: ETHEREUM_VENUE_ID,
      account_ref: config.owner,
      source: 'probe_command',
      command: command.command,
      args_count: command.args_count,
      secret_material_observed: false,
    };
  }
  return staticSignerAddressProof({
    venueId: ETHEREUM_VENUE_ID,
    expected: config.owner,
    actual: observed,
    source: 'probe_command',
  });
}

export async function buildLocalSignerProbeSnapshot({
  env = process.env,
  execFileImpl = null,
  timeoutMs = DEFAULT_SIGNER_PROBE_TIMEOUT_MS,
  scope = [SOLANA_VENUE_ID, ETHEREUM_VENUE_ID],
} = {}) {
  const scoped =
    Array.isArray(scope) && scope.length ? scope : [SOLANA_VENUE_ID, ETHEREUM_VENUE_ID];
  const probes = [];
  if (scoped.includes(SOLANA_VENUE_ID)) {
    probes.push(await probeSolanaSigner({ env, execFileImpl, timeoutMs }));
  }
  if (scoped.includes(ETHEREUM_VENUE_ID)) {
    probes.push(await probeEthereumSigner({ env, execFileImpl, timeoutMs }));
  }
  const status = probes.some((probe) => ['blocked', 'error'].includes(probe.status))
    ? 'blocked'
    : probes.some((probe) => probe.status === 'partial')
      ? 'partial'
      : 'ok';
  return {
    status,
    probe_type: 'non_signing_address_probe',
    probes,
  };
}
