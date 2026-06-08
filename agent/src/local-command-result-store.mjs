import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { RAW_AGENT_SECRET_FIELDS } from '../../core/agent-task.js';

export const DEFAULT_LOCAL_COMMAND_RESULT_STORE_PATH = join(
  homedir(),
  '.sentry',
  'command-results.json'
);
export const MAX_LOCAL_COMMAND_RESULTS = 100;

const MAX_RESULT_DEPTH = 8;
const MAX_RESULT_ARRAY_ITEMS = 50;
const MAX_RESULT_OBJECT_KEYS = 80;
const MAX_RESULT_STRING_CHARS = 4096;
const MAX_DEPTH = '[MaxDepth]';

const EXTRA_SECRET_FIELDS = [
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'authToken',
  'auth_token',
  'keySecret',
  'key_secret',
  'ownerControlToken',
  'owner_control_token',
  'refreshToken',
  'refresh_token',
  'relayToken',
  'relay_token',
  'sessionToken',
  'session_token',
  'secretKey',
  'secret_key',
  'signerKey',
  'signer_key',
  'signingKey',
  'signing_key',
];

const SECRET_FIELDS = new Set(
  [...RAW_AGENT_SECRET_FIELDS, ...EXTRA_SECRET_FIELDS].map(normalizedFieldName)
);

function normalizedFieldName(key) {
  return String(key || '')
    .replace(/[-_\s.]/g, '')
    .toLowerCase();
}

function stringValue(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function resolveLocalCommandResultStorePath(input) {
  return (
    stringValue(input || process.env.SENTRY_COMMAND_RESULT_STORE) ||
    DEFAULT_LOCAL_COMMAND_RESULT_STORE_PATH
  );
}

export function sanitizeLocalCommandResult(value, depth = 0) {
  if (depth > MAX_RESULT_DEPTH) return MAX_DEPTH;
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length <= MAX_RESULT_STRING_CHARS) return value;
    return `${value.slice(0, MAX_RESULT_STRING_CHARS)}...[Truncated ${
      value.length - MAX_RESULT_STRING_CHARS
    } chars]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return null;

  if (Array.isArray(value)) {
    const result = value
      .slice(0, MAX_RESULT_ARRAY_ITEMS)
      .map((item) => sanitizeLocalCommandResult(item, depth + 1));
    if (value.length > MAX_RESULT_ARRAY_ITEMS) {
      result.push(`[Truncated ${value.length - MAX_RESULT_ARRAY_ITEMS} items]`);
    }
    return result;
  }

  const entries = Object.entries(value);
  const result = {};
  let redactedFields = 0;
  for (const [key, item] of entries.slice(0, MAX_RESULT_OBJECT_KEYS)) {
    if (SECRET_FIELDS.has(normalizedFieldName(key))) {
      redactedFields += 1;
      continue;
    }
    result[key] = sanitizeLocalCommandResult(item, depth + 1);
  }
  if (entries.length > MAX_RESULT_OBJECT_KEYS) {
    result.__truncated_keys = entries.length - MAX_RESULT_OBJECT_KEYS;
  }
  if (redactedFields > 0) result.__redacted_fields = redactedFields;
  return result;
}

function normalizeResultRecord(input = {}) {
  if (!isObject(input)) return null;
  const commandMessageId = stringValue(input.command_message_id || input.commandMessageId);
  const idempotencyKey = stringValue(input.idempotency_key || input.idempotencyKey);
  if (!commandMessageId && !idempotencyKey) return null;
  return {
    command_message_id: commandMessageId,
    idempotency_key: idempotencyKey,
    type: stringValue(input.type),
    result_message_id: stringValue(input.result_message_id || input.resultMessageId),
    recorded_at: stringValue(input.recorded_at) || new Date().toISOString(),
    result_payload: sanitizeLocalCommandResult(
      isObject(input.result_payload) ? input.result_payload : {}
    ),
  };
}

function normalizeStore(value, path) {
  const rawResults = Array.isArray(value?.results) ? value.results : [];
  const results = rawResults.map(normalizeResultRecord).filter(Boolean);
  return {
    status: 'ok',
    metadata_path: path,
    config_status: results.length ? 'loaded' : 'empty',
    version: 1,
    result_count: results.length,
    results,
  };
}

export async function loadLocalCommandResultStore({ storePath } = {}) {
  const resolvedPath = resolveLocalCommandResultStorePath(storePath);
  let text = '';
  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'ok',
        metadata_path: resolvedPath,
        config_status: 'missing',
        version: 1,
        result_count: 0,
        results: [],
      };
    }
    return {
      status: 'error',
      code: 'COMMAND_RESULT_STORE_READ_FAILED',
      message: error?.message || String(error),
      metadata_path: resolvedPath,
      results: [],
      result_count: 0,
    };
  }
  try {
    return normalizeStore(JSON.parse(text), resolvedPath);
  } catch (error) {
    return {
      status: 'error',
      code: 'COMMAND_RESULT_STORE_INVALID',
      message: error?.message || String(error),
      metadata_path: resolvedPath,
      results: [],
      result_count: 0,
    };
  }
}

export async function rememberLocalCommandResult(input = {}, { storePath, maxRecords } = {}) {
  const resolvedPath = resolveLocalCommandResultStorePath(storePath);
  const record = normalizeResultRecord(input);
  if (!record) {
    return {
      status: 'error',
      code: 'COMMAND_RESULT_ID_REQUIRED',
      message: 'command result requires command_message_id or idempotency_key.',
      metadata_path: resolvedPath,
    };
  }

  const loaded = await loadLocalCommandResultStore({ storePath: resolvedPath });
  if (loaded.status !== 'ok') return loaded;
  const next = [
    record,
    ...loaded.results.filter(
      (item) =>
        (!record.command_message_id || item.command_message_id !== record.command_message_id) &&
        (!record.idempotency_key || item.idempotency_key !== record.idempotency_key)
    ),
  ].slice(0, Math.max(1, Number(maxRecords || MAX_LOCAL_COMMAND_RESULTS)));

  await mkdir(dirname(resolvedPath), { recursive: true, mode: 0o700 });
  await writeFile(
    resolvedPath,
    `${JSON.stringify(
      {
        version: 1,
        updated_at: record.recorded_at,
        results: next,
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
  await chmod(resolvedPath, 0o600).catch(() => {});
  return {
    status: 'ok',
    metadata_path: resolvedPath,
    result_count: next.length,
    result: record,
  };
}

export async function findLocalCommandResult(
  { commandMessageId, idempotencyKey } = {},
  { storePath } = {}
) {
  const loaded = await loadLocalCommandResultStore({ storePath });
  if (loaded.status !== 'ok') return loaded;
  const commandId = stringValue(commandMessageId);
  const idem = stringValue(idempotencyKey);
  const result =
    loaded.results.find(
      (item) =>
        (commandId && item.command_message_id === commandId) ||
        (idem && item.idempotency_key === idem)
    ) || null;
  return {
    status: 'ok',
    metadata_path: loaded.metadata_path,
    found: Boolean(result),
    result,
  };
}
