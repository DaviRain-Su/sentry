import { execFile } from 'node:child_process';
import path from 'node:path';
import { parseCommandLine } from './agent-dispatcher.mjs';

export const DEFAULT_AGENT_PROBE_TIMEOUT_MS = 3000;
export const MAX_AGENT_PROBE_OUTPUT_BYTES = 4000;
export const BASE_DISPATCH_CAPABILITIES = ['read_context', 'return_evidence'];
const SECRET_OUTPUT_RE =
  /(api[_-]?secret|private[_-]?key|password|passphrase|token|mnemonic|seed)\s*[=:]/i;

const KNOWN_AGENT_PROFILES = [
  {
    match: /\bcodex\b/,
    kind: 'codex',
    expected_binary: 'codex',
    expected_capabilities: ['read_context', 'build_transaction', 'return_evidence'],
  },
  {
    match: /\bclaude\b|claude-code/,
    kind: 'claude-code',
    expected_binary: 'claude',
    expected_capabilities: ['read_context', 'build_transaction', 'return_evidence'],
  },
  {
    match: /\bkimi\b/,
    kind: 'kimi',
    expected_binary: 'kimi',
    expected_capabilities: ['read_context', 'return_evidence'],
  },
];

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function bounded(value, maxBytes = MAX_AGENT_PROBE_OUTPUT_BYTES) {
  const text = String(value || '');
  return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

function firstLine(value) {
  const line = stringValue(
    String(value || '')
      .split(/\r?\n/)
      .find((item) => item.trim()) || ''
  );
  return SECRET_OUTPUT_RE.test(line) ? '[redacted-output]' : line;
}

function inferAgentProfile(agent = {}) {
  // Only sniff the agent id/name and the command's program basename — never the
  // full command string, whose absolute paths (interpreter, temp/script dirs) can
  // contain agent-type keywords (e.g. a script under /tmp/claude-*) and misclassify
  // an otherwise custom agent.
  const parts = parseCommandLine(agent.command || '');
  const program = parts.length ? path.basename(parts[0]) : '';
  const text = `${agent.agent_id || ''} ${agent.display_name || ''} ${program}`.toLowerCase();
  return (
    KNOWN_AGENT_PROFILES.find((profile) => profile.match.test(text)) || {
      kind: 'custom',
      expected_binary: null,
      expected_capabilities: BASE_DISPATCH_CAPABILITIES,
    }
  );
}

function capabilityAssessment(agent = {}, profile = inferAgentProfile(agent)) {
  const declared = Array.isArray(agent.capabilities) ? agent.capabilities : [];
  const required = [...new Set([...BASE_DISPATCH_CAPABILITIES, ...profile.expected_capabilities])];
  const missing = required.filter((capability) => !declared.includes(capability));
  return {
    status: missing.length ? 'partial' : 'ok',
    declared_capabilities: declared,
    required_capabilities: required,
    missing_capabilities: missing,
  };
}

function execFilePromise(execFileImpl, file, args, options = {}) {
  return new Promise((resolve) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

export async function probeRegisteredAgent(agent = {}, options = {}) {
  const timeoutMs = Math.max(
    1,
    Number(options.timeoutMs || options.timeout_ms || DEFAULT_AGENT_PROBE_TIMEOUT_MS)
  );
  const profile = inferAgentProfile(agent);
  const capabilities = capabilityAssessment(agent, profile);

  if (!agent || typeof agent !== 'object') {
    return {
      status: 'blocked',
      code: 'BAD_AGENT_METADATA',
      message: 'Agent probe requires registered agent metadata.',
    };
  }
  if (agent.enabled === false) {
    return {
      status: 'blocked',
      code: 'AGENT_DISABLED',
      message: `Agent is disabled locally: ${agent.agent_id || 'unknown'}`,
      agent_id: agent.agent_id || null,
      profile,
      capabilities,
    };
  }

  const parts = parseCommandLine(agent.command || '');
  if (!parts.length) {
    return {
      status: 'blocked',
      code: 'AGENT_COMMAND_REQUIRED',
      message: 'Agent probe requires a registered command.',
      agent_id: agent.agent_id || null,
      profile,
      capabilities,
    };
  }

  const [file, ...baseArgs] = parts;
  const probeArgs = [...baseArgs, '--version'];
  const execFileImpl = options.execFileImpl || execFile;
  const startedAt = new Date(options.now || Date.now()).toISOString();
  const result = await execFilePromise(execFileImpl, file, probeArgs, {
    timeout: timeoutMs,
    maxBuffer: MAX_AGENT_PROBE_OUTPUT_BYTES,
    env: options.env || process.env,
  });
  const stdout = bounded(result.stdout);
  const stderr = bounded(result.stderr);
  const versionOutput = firstLine(stdout) || firstLine(stderr) || null;

  if (result.error) {
    return {
      status: 'blocked',
      code: result.error.killed ? 'AGENT_PROBE_TIMEOUT' : 'AGENT_PROBE_FAILED',
      message: result.error.killed
        ? `Agent probe exceeded ${timeoutMs}ms.`
        : result.error.message || 'Agent probe failed.',
      agent_id: agent.agent_id || null,
      command_probe: {
        file,
        args: ['--version'],
        exit_code: result.error.code ?? null,
        signal: result.error.signal ?? null,
        timeout_ms: timeoutMs,
      },
      profile,
      capabilities,
      version_output: versionOutput,
      stdout_bytes: stdout.length,
      stderr_bytes: stderr.length,
      observed_at: startedAt,
    };
  }

  return {
    status: capabilities.status === 'ok' ? 'ok' : 'partial',
    agent_id: agent.agent_id || null,
    display_name: agent.display_name || agent.agent_id || null,
    command_probe: {
      file,
      args: ['--version'],
      timeout_ms: timeoutMs,
    },
    profile,
    capabilities,
    version_output: versionOutput,
    stdout_bytes: stdout.length,
    stderr_bytes: stderr.length,
    observed_at: startedAt,
  };
}

export async function probeAgentRegistry(registry = {}, options = {}) {
  const requestedAgentId = stringValue(options.agentId || options.agent_id).toLowerCase();
  const agents = (registry.agents || []).filter((agent) =>
    requestedAgentId ? agent.agent_id === requestedAgentId : true
  );
  if (requestedAgentId && !agents.length) {
    return {
      status: 'blocked',
      code: 'AGENT_NOT_REGISTERED',
      message: `Agent is not registered locally: ${requestedAgentId}`,
      agent_id: requestedAgentId,
      probes: [],
      probe_count: 0,
    };
  }

  const probes = [];
  for (const agent of agents) {
    probes.push(await probeRegisteredAgent(agent, options));
  }
  const okCount = probes.filter((probe) => probe.status === 'ok').length;
  const blockedCount = probes.filter((probe) => probe.status === 'blocked').length;
  return {
    status: blockedCount
      ? okCount
        ? 'partial'
        : 'blocked'
      : probes.some((probe) => probe.status === 'partial')
        ? 'partial'
        : 'ok',
    registry_status: registry.status || null,
    metadata_path: registry.metadata_path || null,
    agent_id: requestedAgentId || null,
    probe_count: probes.length,
    ok_count: okCount,
    blocked_count: blockedCount,
    probes,
  };
}
