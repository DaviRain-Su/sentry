import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseCommandLine } from './agent-dispatcher.mjs';

export const DEFAULT_AGENT_REGISTRY_PATH = '~/.sentry/agents.json';
export const DEFAULT_AGENT_CAPABILITIES = [
  'read_context',
  'build_transaction',
  'sign_with_local_tool',
  'submit_order',
  'return_evidence',
];

const RAW_SECRET_ARG_RE =
  /(^--?(token|secret|password|passphrase|private[-_]?key|api[-_]?key)(=|$))|((token|secret|password|passphrase|private[-_]?key|api[-_]?key)=)/i;

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveAgentRegistryPath(input = process.env.SENTRY_AGENT_REGISTRY) {
  return expandHome(input || DEFAULT_AGENT_REGISTRY_PATH);
}

function normalizeAgentConfig(raw) {
  if (Array.isArray(raw)) return { version: 1, agents: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, agents: [] };
  return {
    version: Number(raw.version || 1),
    agents: Array.isArray(raw.agents) ? raw.agents : [],
  };
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeAgentId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function commandContainsSecretArg(command) {
  return parseCommandLine(command).some((arg) => RAW_SECRET_ARG_RE.test(arg));
}

export function parseCapabilityList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function validateRegisteredAgentMetadata(input = {}) {
  const agentId = normalizeAgentId(input.agent_id || input.id || input.type);
  if (!agentId) {
    return {
      status: 'error',
      code: 'AGENT_ID_REQUIRED',
      message: 'agent_id is required.',
    };
  }

  const command = String(input.command || input.command_line || '').trim();
  if (!command) {
    return {
      status: 'error',
      code: 'AGENT_COMMAND_REQUIRED',
      message: 'Agent command is required.',
    };
  }
  if (commandContainsSecretArg(command)) {
    return {
      status: 'error',
      code: 'RAW_SECRET_ARG_REJECTED',
      message: 'Agent command must not include raw token/secret/password/passphrase arguments.',
    };
  }

  const capabilities = unique(parseCapabilityList(input.capabilities));
  return {
    status: 'ok',
    agent: {
      agent_id: agentId,
      display_name: input.display_name || input.name || agentId,
      command,
      capabilities: capabilities.length ? capabilities : DEFAULT_AGENT_CAPABILITIES,
      enabled: input.enabled !== false,
      registered_at: input.registered_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export async function readAgentRegistryConfig(options = {}) {
  const configPath = resolveAgentRegistryPath(options.configPath);
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = normalizeAgentConfig(JSON.parse(text));
    return {
      status: 'ok',
      path: configPath,
      records: parsed.agents,
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: configPath,
        records: [],
        config: { version: 1, agents: [] },
      };
    }
    return {
      status: 'error',
      path: configPath,
      code: 'AGENT_REGISTRY_READ_FAILED',
      message: error?.message || String(error),
      records: [],
      config: { version: 1, agents: [] },
    };
  }
}

export async function writeAgentRegistryConfig(records, options = {}) {
  const configPath = resolveAgentRegistryPath(options.configPath);
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, agents: records }, null, 2)}\n`;
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, configPath);
  return { status: 'ok', path: configPath, record_count: records.length };
}

export async function loadAgentRegistry(options = {}) {
  const config = await readAgentRegistryConfig(options);
  const validated = config.records.map((record) => validateRegisteredAgentMetadata(record));
  const agents = validated.filter((entry) => entry.status === 'ok').map((entry) => entry.agent);
  const issues = validated.filter((entry) => entry.status !== 'ok');
  return {
    status: config.status === 'error' || issues.length ? 'partial' : 'ok',
    metadata_path: config.path,
    config_status: config.status,
    config_error: config.status === 'error' ? config.message : null,
    agent_count: agents.length,
    enabled_count: agents.filter((agent) => agent.enabled).length,
    agents,
    issues,
    raw_secret_policy: 'never put tokens, API keys, passwords or passphrases in agent command args',
  };
}

function sameAgent(a, b) {
  return a.agent_id === b.agent_id;
}

export async function upsertRegisteredAgent(input, options = {}) {
  const validated = validateRegisteredAgentMetadata(input);
  if (validated.status !== 'ok') return validated;
  const current = await readAgentRegistryConfig(options);
  if (current.status === 'error') return current;

  const existing = current.records.find(
    (record) => normalizeAgentId(record.agent_id) === validated.agent.agent_id
  );
  const nextRecord = {
    ...validated.agent,
    registered_at: existing?.registered_at || validated.agent.registered_at,
  };
  const records = [
    ...current.records.filter(
      (record) => !sameAgent({ agent_id: normalizeAgentId(record.agent_id) }, nextRecord)
    ),
    nextRecord,
  ].sort((a, b) => a.agent_id.localeCompare(b.agent_id));
  const write = await writeAgentRegistryConfig(records, options);
  return {
    status: 'ok',
    agent: nextRecord,
    path: write.path,
    record_count: records.length,
  };
}

export async function removeRegisteredAgent(input, options = {}) {
  const agentId = normalizeAgentId(input?.agent_id || input?.id || input?.type);
  if (!agentId) {
    return {
      status: 'error',
      code: 'AGENT_ID_REQUIRED',
      message: 'agent_id is required.',
    };
  }
  const current = await readAgentRegistryConfig(options);
  if (current.status === 'error') return current;
  const records = current.records.filter((record) => normalizeAgentId(record.agent_id) !== agentId);
  const removed = records.length !== current.records.length;
  const write = await writeAgentRegistryConfig(records, options);
  return {
    status: 'ok',
    removed,
    path: write.path,
    record_count: records.length,
  };
}

export function findRegisteredAgent(registry, agentId) {
  const normalized = normalizeAgentId(agentId);
  if (!normalized) return null;
  return (registry?.agents || []).find((agent) => agent.agent_id === normalized) || null;
}

export function resolveRegisteredAgentCommand(registry, agentId) {
  const agent = findRegisteredAgent(registry, agentId);
  if (!agent) {
    return {
      status: 'error',
      code: 'AGENT_NOT_REGISTERED',
      message: `Agent is not registered locally: ${agentId}`,
      agent_id: normalizeAgentId(agentId),
    };
  }
  if (!agent.enabled) {
    return {
      status: 'error',
      code: 'AGENT_DISABLED',
      message: `Agent is disabled locally: ${agent.agent_id}`,
      agent_id: agent.agent_id,
    };
  }
  return {
    status: 'ok',
    agent_id: agent.agent_id,
    command: agent.command,
    capabilities: agent.capabilities,
  };
}

export function resolveAgentDispatchCommand({
  payload = {},
  registry,
  defaultAgentCommand = '',
} = {}) {
  const targetAgent =
    payload.target_agent || payload.agent_id || payload.task?.target_agent || null;
  if (targetAgent) return resolveRegisteredAgentCommand(registry, targetAgent);
  if (payload.command) {
    return {
      status: 'ok',
      command: payload.command,
      unregistered_command: true,
    };
  }
  if (defaultAgentCommand) {
    return {
      status: 'ok',
      command: defaultAgentCommand,
      unregistered_command: true,
    };
  }
  return {
    status: 'error',
    code: 'AGENT_COMMAND_REQUIRED',
    message:
      'agent.dispatch requires target_agent registered locally, payload.command, or --agent-cmd.',
  };
}
