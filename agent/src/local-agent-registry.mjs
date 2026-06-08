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
export const DEFAULT_AGENT_TASK_CAPABILITIES = [];

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

function uniqueTaskCapabilities(values) {
  const seen = new Set();
  const out = [];
  for (const capability of values || []) {
    if (!capability) continue;
    const key = `${capability.venue_id}:${capability.action_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(capability);
  }
  return out;
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

function normalizeVenueId(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (text === 'solana') return 'solana-mainnet';
  if (text === 'ethereum' || text === 'evm') return 'ethereum-mainnet';
  if (text === 'hl' || text === 'hyperliquid-mainnet') return 'hyperliquid';
  return text;
}

function normalizeActionType(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (!text || text === '*') return '*';
  if (text === 'order') return 'place_order';
  if (text === 'swap') return 'submit_tx';
  return text;
}

function normalizeTaskCapability(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (text === '*' || text === '*:*') return { venue_id: '*', action_type: '*' };
    const [venue, action = '*'] = text.split(/[:/]/);
    const venueId = normalizeVenueId(venue);
    const actionType = normalizeActionType(action);
    return venueId ? { venue_id: venueId, action_type: actionType || '*' } : null;
  }
  if (typeof value === 'object') {
    const venueId = normalizeVenueId(
      value.venue_id || value.venue || value.target_venue_id || value.targetVenueId
    );
    const actionType = normalizeActionType(
      value.action_type || value.actionType || value.action?.type || value.type || '*'
    );
    return venueId ? { venue_id: venueId, action_type: actionType || '*' } : null;
  }
  return null;
}

export function parseTaskCapabilityList(value) {
  const raw = Array.isArray(value) ? value : parseCapabilityList(value);
  return uniqueTaskCapabilities(raw.map(normalizeTaskCapability));
}

function taskRequirement(task = {}) {
  if (!task || typeof task !== 'object') return null;
  const venueId = normalizeVenueId(
    task.venue_id || task.policy_context?.venue_id || task.authorization?.venue_id
  );
  const actionType = normalizeActionType(task.action?.type);
  return venueId && actionType
    ? {
        venue_id: venueId,
        action_type: actionType,
      }
    : null;
}

function taskCapabilityMatches(capability = {}, requirement = {}) {
  const venueMatches = capability.venue_id === '*' || capability.venue_id === requirement.venue_id;
  const actionMatches =
    capability.action_type === '*' || capability.action_type === requirement.action_type;
  return venueMatches && actionMatches;
}

export function assessAgentTaskCapability(agent = {}, task = null) {
  const requirement = taskRequirement(task);
  if (!requirement) {
    return {
      status: 'skipped',
      reason: 'task_not_provided',
      declared_task_capabilities: agent.task_capabilities || [],
      required_task_capability: null,
    };
  }
  const declared = parseTaskCapabilityList(agent.task_capabilities || agent.taskCapabilities);
  if (!declared.length) {
    return {
      status: 'error',
      code: 'AGENT_TASK_CAPABILITY_UNDECLARED',
      message:
        'Registered Agent must declare task_capabilities before autonomous dispatch for this task.',
      agent_id: agent.agent_id || null,
      declared_task_capabilities: [],
      required_task_capability: requirement,
    };
  }
  const matched = declared.find((capability) => taskCapabilityMatches(capability, requirement));
  if (!matched) {
    return {
      status: 'error',
      code: 'AGENT_TASK_CAPABILITY_DENIED',
      message: 'Registered Agent does not declare support for this venue/action task.',
      agent_id: agent.agent_id || null,
      declared_task_capabilities: declared,
      required_task_capability: requirement,
    };
  }
  return {
    status: 'ok',
    agent_id: agent.agent_id || null,
    declared_task_capabilities: declared,
    required_task_capability: requirement,
    matched_task_capability: matched,
  };
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
  const taskCapabilities = parseTaskCapabilityList(
    input.task_capabilities || input.taskCapabilities || input.tasks || input.supported_tasks
  );
  return {
    status: 'ok',
    agent: {
      agent_id: agentId,
      display_name: input.display_name || input.name || agentId,
      command,
      capabilities: capabilities.length ? capabilities : DEFAULT_AGENT_CAPABILITIES,
      task_capabilities: taskCapabilities.length
        ? taskCapabilities
        : DEFAULT_AGENT_TASK_CAPABILITIES,
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

export function resolveRegisteredAgentCommand(registry, agentId, options = {}) {
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
  const taskCapability = assessAgentTaskCapability(agent, options.task);
  if (taskCapability.status === 'error') {
    return {
      status: 'error',
      code: taskCapability.code,
      message: taskCapability.message,
      agent_id: agent.agent_id,
      task_capability: taskCapability,
    };
  }
  return {
    status: 'ok',
    agent_id: agent.agent_id,
    command: agent.command,
    capabilities: agent.capabilities,
    task_capabilities: agent.task_capabilities || [],
    task_capability: taskCapability,
  };
}

export function resolveAgentDispatchCommand({
  payload = {},
  registry,
  defaultAgentCommand = '',
} = {}) {
  const targetAgent =
    payload.target_agent || payload.agent_id || payload.task?.target_agent || null;
  if (targetAgent)
    return resolveRegisteredAgentCommand(registry, targetAgent, { task: payload.task });
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
