import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { RAW_AGENT_SECRET_FIELDS } from '../../core/agent-task.js';
import { getVenueById } from '../../core/venues.js';

export const DEFAULT_LOCAL_POLICY_STORE_PATH = '~/.sentry/policies.json';
export const DEFAULT_POLICY_TICK_INTERVAL_MS = 60_000;
export const MIN_POLICY_TICK_INTERVAL_MS = 1_000;
export const LOCAL_POLICY_STATUSES = ['active', 'paused', 'revoked'];

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveLocalPolicyStorePath(input = process.env.SENTRY_POLICY_STORE) {
  return expandHome(input || DEFAULT_LOCAL_POLICY_STORE_PATH);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfig(raw) {
  if (Array.isArray(raw)) return { version: 1, policies: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, policies: [] };
  return {
    version: Number(raw.version || 1),
    policies: Array.isArray(raw.policies) ? raw.policies : [],
  };
}

function secretFieldPath(value, prefix = '') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  for (const [key, child] of entries) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (!Array.isArray(value) && RAW_AGENT_SECRET_FIELDS.includes(key)) return currentPath;
    const nested = secretFieldPath(child, currentPath);
    if (nested) return nested;
  }
  return null;
}

function normalizePolicyId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeTaskTemplates(input = {}) {
  const candidates = [];
  if (isObject(input.task_template)) candidates.push(input.task_template);
  if (Array.isArray(input.task_templates)) candidates.push(...input.task_templates);
  if (Array.isArray(input.planned_tasks)) candidates.push(...input.planned_tasks);
  if (isObject(input.strategy?.task_template)) candidates.push(input.strategy.task_template);
  if (Array.isArray(input.strategy?.task_templates))
    candidates.push(...input.strategy.task_templates);
  if (Array.isArray(input.strategy?.planned_tasks))
    candidates.push(...input.strategy.planned_tasks);
  return candidates.filter(isObject);
}

export function parsePolicyVenueList(value) {
  if (Array.isArray(value)) return unique(value.map((item) => String(item).trim()).filter(Boolean));
  if (!value) return [];
  return unique(
    String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function normalizeIsoDate(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function addMs(isoDate, ms) {
  return new Date(Date.parse(isoDate) + ms).toISOString();
}

function safeNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

export function validateLocalPolicyMetadata(input = {}, options = {}) {
  if (!isObject(input)) {
    return {
      status: 'error',
      code: 'BAD_LOCAL_POLICY',
      message: 'Local policy metadata must be an object.',
    };
  }

  const secretPath = secretFieldPath(input);
  if (secretPath) {
    return {
      status: 'error',
      code: 'RAW_SECRET_REJECTED',
      message: `Local policy metadata must not include raw secret field: ${secretPath}`,
      path: secretPath,
    };
  }

  const policyId = normalizePolicyId(input.policy_id || input.id || input.strategy_hash);
  if (!policyId) {
    return {
      status: 'error',
      code: 'POLICY_ID_REQUIRED',
      message: 'policy_id is required.',
    };
  }

  const status = String(input.status || 'active').toLowerCase();
  if (!LOCAL_POLICY_STATUSES.includes(status)) {
    return {
      status: 'error',
      code: 'BAD_POLICY_STATUS',
      message: `Policy status must be one of: ${LOCAL_POLICY_STATUSES.join(', ')}`,
    };
  }

  const targetVenueIds = parsePolicyVenueList(
    input.target_venue_ids || input.target_venues || input.venue_ids || input.venue_id
  );
  if (!targetVenueIds.length) {
    return {
      status: 'error',
      code: 'TARGET_VENUE_REQUIRED',
      message: 'At least one target venue is required.',
    };
  }
  const unknownVenueIds = targetVenueIds.filter((venueId) => !getVenueById(venueId));
  if (unknownVenueIds.length) {
    return {
      status: 'error',
      code: 'UNKNOWN_TARGET_VENUE',
      message: `Unknown target venue(s): ${unknownVenueIds.join(', ')}`,
      unknown_venue_ids: unknownVenueIds,
    };
  }

  const tickIntervalMs = safeNumber(
    input.tick_interval_ms || input.tickIntervalMs || input.tick_interval,
    DEFAULT_POLICY_TICK_INTERVAL_MS
  );
  if (!Number.isSafeInteger(tickIntervalMs) || tickIntervalMs < MIN_POLICY_TICK_INTERVAL_MS) {
    return {
      status: 'error',
      code: 'BAD_TICK_INTERVAL',
      message: `tick_interval_ms must be an integer >= ${MIN_POLICY_TICK_INTERVAL_MS}.`,
    };
  }

  const nowIso =
    options.now instanceof Date
      ? options.now.toISOString()
      : new Date(options.now || Date.now()).toISOString();
  const createdAt = normalizeIsoDate(input.created_at, nowIso);
  const lastTickAt = normalizeIsoDate(input.last_tick_at, null);
  const nextTickFallback = lastTickAt ? addMs(lastTickAt, tickIntervalMs) : nowIso;
  const nextTickAfter = normalizeIsoDate(
    input.next_tick_after || input.next_tick_at,
    nextTickFallback
  );
  if (!createdAt || !nextTickAfter) {
    return {
      status: 'error',
      code: 'BAD_POLICY_TIMESTAMP',
      message: 'Policy timestamps must be valid ISO-compatible dates.',
    };
  }

  return {
    status: 'ok',
    policy: {
      policy_id: policyId,
      display_name: input.display_name || input.name || policyId,
      status,
      target_agent: input.target_agent || input.agent_id || null,
      target_venue_ids: targetVenueIds,
      strategy_hash: input.strategy_hash || null,
      strategy: isObject(input.strategy) ? input.strategy : null,
      task_templates: normalizeTaskTemplates(input),
      constraints: isObject(input.constraints) ? input.constraints : {},
      trigger: isObject(input.trigger) ? input.trigger : {},
      tick_interval_ms: tickIntervalMs,
      next_tick_after: nextTickAfter,
      last_tick_at: lastTickAt,
      last_tick_status: input.last_tick_status || null,
      created_at: createdAt,
      updated_at: normalizeIsoDate(input.updated_at, nowIso) || nowIso,
      paused_at: normalizeIsoDate(input.paused_at, null),
      revoked_at: normalizeIsoDate(input.revoked_at, null),
      source: input.source || 'local_daemon',
    },
  };
}

export async function readLocalPolicyConfig(options = {}) {
  const configPath = resolveLocalPolicyStorePath(options.configPath);
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = normalizeConfig(JSON.parse(text));
    return {
      status: 'ok',
      path: configPath,
      records: parsed.policies,
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: configPath,
        records: [],
        config: { version: 1, policies: [] },
      };
    }
    return {
      status: 'error',
      path: configPath,
      code: 'POLICY_STORE_READ_FAILED',
      message: error?.message || String(error),
      records: [],
      config: { version: 1, policies: [] },
    };
  }
}

export async function writeLocalPolicyConfig(records, options = {}) {
  const configPath = resolveLocalPolicyStorePath(options.configPath);
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, policies: records }, null, 2)}\n`;
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, configPath);
  return { status: 'ok', path: configPath, record_count: records.length };
}

export async function loadLocalPolicyStore(options = {}) {
  const config = await readLocalPolicyConfig(options);
  const validated = config.records.map((record) =>
    validateLocalPolicyMetadata(record, { now: options.now })
  );
  const policies = validated.filter((entry) => entry.status === 'ok').map((entry) => entry.policy);
  const issues = validated.filter((entry) => entry.status !== 'ok');
  return {
    status: config.status === 'error' || issues.length ? 'partial' : 'ok',
    metadata_path: config.path,
    config_status: config.status,
    config_error: config.status === 'error' ? config.message : null,
    policy_count: policies.length,
    active_count: policies.filter((policy) => policy.status === 'active').length,
    paused_count: policies.filter((policy) => policy.status === 'paused').length,
    revoked_count: policies.filter((policy) => policy.status === 'revoked').length,
    policies,
    issues,
    raw_secret_policy:
      'never put wallet private keys, API secrets, tokens or passphrases in policy metadata',
  };
}

function samePolicy(a, b) {
  return a.policy_id === b.policy_id;
}

export async function upsertLocalPolicy(input, options = {}) {
  const current = await readLocalPolicyConfig(options);
  if (current.status === 'error') return current;
  const existing = current.records.find(
    (record) =>
      normalizePolicyId(record.policy_id || record.id) ===
      normalizePolicyId(input.policy_id || input.id)
  );
  const validated = validateLocalPolicyMetadata(
    {
      ...input,
      created_at: existing?.created_at || input.created_at,
    },
    { now: options.now }
  );
  if (validated.status !== 'ok') return validated;

  const records = [
    ...current.records.filter(
      (record) =>
        !samePolicy(
          { policy_id: normalizePolicyId(record.policy_id || record.id) },
          validated.policy
        )
    ),
    validated.policy,
  ].sort((a, b) => a.policy_id.localeCompare(b.policy_id));
  const write = await writeLocalPolicyConfig(records, options);
  return {
    status: 'ok',
    policy: validated.policy,
    path: write.path,
    record_count: records.length,
  };
}

export async function updateLocalPolicyStatus(input, options = {}) {
  const policyId = normalizePolicyId(input?.policy_id || input?.id);
  const nextStatus = String(input?.status || '').toLowerCase();
  if (!policyId) {
    return {
      status: 'error',
      code: 'POLICY_ID_REQUIRED',
      message: 'policy_id is required.',
    };
  }
  if (!LOCAL_POLICY_STATUSES.includes(nextStatus)) {
    return {
      status: 'error',
      code: 'BAD_POLICY_STATUS',
      message: `Policy status must be one of: ${LOCAL_POLICY_STATUSES.join(', ')}`,
    };
  }
  const current = await readLocalPolicyConfig(options);
  if (current.status === 'error') return current;
  const nowIso =
    options.now instanceof Date
      ? options.now.toISOString()
      : new Date(options.now || Date.now()).toISOString();
  let matched = false;
  const records = current.records.map((record) => {
    if (normalizePolicyId(record.policy_id || record.id) !== policyId) return record;
    matched = true;
    return {
      ...record,
      policy_id: policyId,
      status: nextStatus,
      updated_at: nowIso,
      paused_at: nextStatus === 'paused' ? nowIso : record.paused_at || null,
      revoked_at: nextStatus === 'revoked' ? nowIso : record.revoked_at || null,
    };
  });
  if (!matched) {
    return {
      status: 'error',
      code: 'POLICY_NOT_FOUND',
      message: `No local policy found: ${policyId}`,
      policy_id: policyId,
    };
  }
  const write = await writeLocalPolicyConfig(records, options);
  const policy = (await loadLocalPolicyStore({ ...options, now: nowIso })).policies.find(
    (candidate) => candidate.policy_id === policyId
  );
  return {
    status: 'ok',
    policy,
    path: write.path,
    record_count: records.length,
  };
}

export function buildLocalPolicyTickSnapshot({
  policies = [],
  now = new Date(),
  limit = 100,
} = {}) {
  const nowIso = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const nowMs = Date.parse(nowIso);
  const active = policies.filter((policy) => policy.status === 'active');
  const due = active
    .filter((policy) => Date.parse(policy.next_tick_after) <= nowMs)
    .sort((a, b) => Date.parse(a.next_tick_after) - Date.parse(b.next_tick_after));
  const cappedLimit = Math.max(0, Number(limit) || 100);
  const selected = cappedLimit > 0 ? due.slice(0, cappedLimit) : [];
  const future = active
    .filter((policy) => Date.parse(policy.next_tick_after) > nowMs)
    .sort((a, b) => Date.parse(a.next_tick_after) - Date.parse(b.next_tick_after));
  return {
    status: 'ok',
    observed_at: nowIso,
    active_count: active.length,
    due_count: due.length,
    selected_count: selected.length,
    next_due_at: future[0]?.next_tick_after || null,
    skipped: {
      paused_count: policies.filter((policy) => policy.status === 'paused').length,
      revoked_count: policies.filter((policy) => policy.status === 'revoked').length,
    },
    due_policies: selected.map((policy) => ({
      policy_id: policy.policy_id,
      display_name: policy.display_name,
      target_agent: policy.target_agent,
      target_venue_ids: policy.target_venue_ids,
      tick_interval_ms: policy.tick_interval_ms,
      next_tick_after: policy.next_tick_after,
      last_tick_at: policy.last_tick_at,
      last_tick_status: policy.last_tick_status,
    })),
  };
}

export async function loadLocalPolicyTickSnapshot(options = {}) {
  const store = await loadLocalPolicyStore(options);
  const tick = buildLocalPolicyTickSnapshot({
    policies: store.policies,
    now: options.now,
    limit: options.limit,
  });
  return {
    ...tick,
    metadata_path: store.metadata_path,
    policy_count: store.policy_count,
    config_status: store.config_status,
    store_status: store.status,
    issues: store.issues,
  };
}

export async function markLocalPolicyTick(input, options = {}) {
  const policyId = normalizePolicyId(input?.policy_id || input?.id);
  if (!policyId) {
    return {
      status: 'error',
      code: 'POLICY_ID_REQUIRED',
      message: 'policy_id is required.',
    };
  }
  const current = await readLocalPolicyConfig(options);
  if (current.status === 'error') return current;
  const nowIso =
    options.now instanceof Date
      ? options.now.toISOString()
      : new Date(options.now || Date.now()).toISOString();
  let matched = false;
  const records = current.records.map((record) => {
    if (normalizePolicyId(record.policy_id || record.id) !== policyId) return record;
    matched = true;
    const tickIntervalMs = Number(record.tick_interval_ms || DEFAULT_POLICY_TICK_INTERVAL_MS);
    return {
      ...record,
      policy_id: policyId,
      last_tick_at: nowIso,
      last_tick_status: input.status || 'observed',
      next_tick_after: addMs(nowIso, tickIntervalMs),
      updated_at: nowIso,
    };
  });
  if (!matched) {
    return {
      status: 'error',
      code: 'POLICY_NOT_FOUND',
      message: `No local policy found: ${policyId}`,
      policy_id: policyId,
    };
  }
  const write = await writeLocalPolicyConfig(records, options);
  const policy = (await loadLocalPolicyStore({ ...options, now: nowIso })).policies.find(
    (candidate) => candidate.policy_id === policyId
  );
  return {
    status: 'ok',
    policy,
    path: write.path,
    record_count: records.length,
  };
}
