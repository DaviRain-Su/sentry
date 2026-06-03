import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  buildLocalSecretStoreSnapshot,
  validateVenueKeyMetadata,
} from '../../core/local-secrets.js';

export const DEFAULT_VENUE_CONFIG_PATH = '~/.sentry/venues.json';

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveVenueConfigPath(input = process.env.SENTRY_VENUE_CONFIG) {
  return expandHome(input || DEFAULT_VENUE_CONFIG_PATH);
}

function normalizeConfig(raw) {
  if (Array.isArray(raw)) return { version: 1, venues: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, venues: [] };
  return {
    version: Number(raw.version || 1),
    venues: Array.isArray(raw.venues) ? raw.venues : [],
  };
}

export async function readVenueConfig(options = {}) {
  const configPath = resolveVenueConfigPath(options.configPath);
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = normalizeConfig(JSON.parse(text));
    return {
      status: 'ok',
      path: configPath,
      records: parsed.venues,
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: configPath,
        records: [],
        config: { version: 1, venues: [] },
      };
    }
    return {
      status: 'error',
      path: configPath,
      code: 'VENUE_CONFIG_READ_FAILED',
      message: error?.message || String(error),
      records: [],
      config: { version: 1, venues: [] },
    };
  }
}

export async function writeVenueConfig(records, options = {}) {
  const configPath = resolveVenueConfigPath(options.configPath);
  const dir = path.dirname(configPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, venues: records }, null, 2)}\n`;
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, configPath);
  return { status: 'ok', path: configPath, record_count: records.length };
}

export async function loadLocalSecretStore(options = {}) {
  const config = await readVenueConfig(options);
  const snapshot = buildLocalSecretStoreSnapshot(config.records);
  return {
    ...snapshot,
    metadata_path: config.path,
    config_status: config.status,
    config_error: config.status === 'error' ? config.message : null,
  };
}

function sameKey(a, b) {
  return a.venue_id === b.venue_id && a.key_handle === b.key_handle;
}

export async function upsertVenueKeyMetadata(input, options = {}) {
  const validated = validateVenueKeyMetadata(input);
  if (validated.status !== 'ok') return validated;
  const current = await readVenueConfig(options);
  if (current.status === 'error') return current;

  const nextRecord = validated.key;
  const records = [
    ...current.records.filter((record) => !sameKey(record, nextRecord)),
    nextRecord,
  ].sort((a, b) => `${a.venue_id}:${a.key_handle}`.localeCompare(`${b.venue_id}:${b.key_handle}`));
  const write = await writeVenueConfig(records, options);
  return {
    status: 'ok',
    key: nextRecord,
    path: write.path,
    record_count: records.length,
  };
}

export async function removeVenueKeyMetadata(input, options = {}) {
  const venueId = input?.venue_id;
  const keyHandle = input?.key_handle;
  if (!venueId || !keyHandle) {
    return {
      status: 'error',
      code: 'VENUE_AND_KEY_REQUIRED',
      message: 'venue_id and key_handle are required.',
    };
  }
  const current = await readVenueConfig(options);
  if (current.status === 'error') return current;
  const records = current.records.filter(
    (record) => record.venue_id !== venueId || record.key_handle !== keyHandle
  );
  const removed = records.length !== current.records.length;
  const write = await writeVenueConfig(records, options);
  return {
    status: 'ok',
    removed,
    path: write.path,
    record_count: records.length,
  };
}

export function parsePermissionList(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}
