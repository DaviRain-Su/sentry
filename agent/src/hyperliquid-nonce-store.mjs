import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_HYPERLIQUID_NONCE_STORE_PATH = '~/.sentry/hyperliquid-nonces.json';

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveHyperliquidNonceStorePath(
  input = process.env.SENTRY_HYPERLIQUID_NONCE_STORE
) {
  return expandHome(input || DEFAULT_HYPERLIQUID_NONCE_STORE_PATH);
}

function normalizeStore(raw) {
  if (Array.isArray(raw)) return { version: 1, records: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, records: [] };
  return {
    version: Number(raw.version || 1),
    records: Array.isArray(raw.records) ? raw.records : [],
  };
}

function nowIso(now = new Date()) {
  const value = typeof now === 'function' ? now() : now;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value || Date.now());
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function stringValue(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function nonceRecordKey(input = {}) {
  const authRef = stringValue(input.authorization_ref || input.authorizationRef);
  const nonce = stringValue(input.nonce);
  if (!authRef || !nonce) return null;
  return `${authRef}:${nonce}`;
}

export function hyperliquidNonceIdentity({ task = {}, request = {} } = {}) {
  const authorizationRef =
    task.authorization?.authorization_ref ||
    task.authorization_ref ||
    task.policy_context?.authorization_ref ||
    'hyperliquid:unknown';
  const nonce = request.nonce || request.body?.nonce;
  const clientOrderId =
    request.idempotency_key ||
    task.constraints?.idempotency_key ||
    task.action?.params?.cloid ||
    task.action?.params?.client_order_id ||
    null;
  return {
    record_key: nonceRecordKey({ authorization_ref: authorizationRef, nonce }),
    authorization_ref: authorizationRef,
    task_id: task.task_id || null,
    client_order_id: clientOrderId,
    nonce: Number(nonce),
    expires_after_ms: request.expires_after_ms || request.body?.expiresAfter || null,
  };
}

export async function readHyperliquidNonceStore(options = {}) {
  const storePath = resolveHyperliquidNonceStorePath(options.storePath);
  try {
    const text = await readFile(storePath, 'utf8');
    const parsed = normalizeStore(JSON.parse(text));
    return {
      status: 'ok',
      path: storePath,
      records: parsed.records,
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: storePath,
        records: [],
        config: { version: 1, records: [] },
      };
    }
    return {
      status: 'error',
      code: 'HYPERLIQUID_NONCE_STORE_READ_FAILED',
      message: error?.message || String(error),
      path: storePath,
      records: [],
      config: { version: 1, records: [] },
    };
  }
}

export async function writeHyperliquidNonceStore(records, options = {}) {
  const storePath = resolveHyperliquidNonceStorePath(options.storePath);
  const dir = path.dirname(storePath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, records }, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, storePath);
  return { status: 'ok', path: storePath, record_count: records.length };
}

function duplicateError(existing, identity) {
  return {
    status: 'error',
    code: 'HYPERLIQUID_NONCE_ALREADY_USED',
    message: 'Hyperliquid signed exchange nonce has already been claimed or submitted locally.',
    record_key: identity.record_key,
    existing_status: existing.status || null,
    task_id: existing.task_id || null,
    client_order_id: existing.client_order_id || null,
    nonce: existing.nonce || identity.nonce,
    claimed_at: existing.claimed_at || null,
    updated_at: existing.updated_at || null,
    submitted_at: existing.submitted_at || null,
  };
}

export async function claimHyperliquidExchangeNonce(options = {}) {
  const { task, request, storePath, now = new Date() } = options;
  if (!storePath) return { status: 'skipped', reason: 'nonce_store_not_configured' };
  const identity = hyperliquidNonceIdentity({ task, request });
  if (!identity.record_key || !Number.isSafeInteger(identity.nonce) || identity.nonce <= 0) {
    return {
      status: 'error',
      code: 'HYPERLIQUID_NONCE_IDENTITY_INVALID',
      message:
        'Hyperliquid nonce store requires authorization_ref and positive safe-integer nonce.',
    };
  }

  const store = await readHyperliquidNonceStore({ storePath });
  if (store.status === 'error') return store;
  const existing = store.records.find((record) => record.record_key === identity.record_key);
  if (existing) return duplicateError(existing, identity);

  const timestamp = nowIso(now);
  const record = {
    ...identity,
    status: 'claimed',
    claimed_at: timestamp,
    updated_at: timestamp,
  };
  const records = [...store.records, record].sort((a, b) =>
    String(a.record_key).localeCompare(String(b.record_key))
  );
  const write = await writeHyperliquidNonceStore(records, { storePath });
  return {
    status: 'ok',
    path: write.path,
    record,
  };
}

export async function finalizeHyperliquidExchangeNonce(options = {}) {
  const { claim, result, storePath, now = new Date() } = options;
  if (!storePath || !claim || claim.status === 'skipped') {
    return { status: 'skipped', reason: 'nonce_store_not_configured' };
  }
  if (claim.status !== 'ok' || !claim.record?.record_key) return claim;
  const store = await readHyperliquidNonceStore({ storePath });
  if (store.status === 'error') return store;

  const timestamp = nowIso(now);
  const resultStatus = result?.status || 'error';
  const recordStatus = ['submitted', 'done'].includes(resultStatus)
    ? resultStatus
    : resultStatus === 'error'
      ? 'submit_failed'
      : 'submit_rejected';
  const records = store.records.map((record) => {
    if (record.record_key !== claim.record.record_key) return record;
    return {
      ...record,
      status: recordStatus,
      updated_at: timestamp,
      submitted_at: ['submitted', 'done'].includes(resultStatus)
        ? timestamp
        : record.submitted_at || null,
      result_status: resultStatus,
      result_code: result?.code || null,
      venue_order_id:
        result?.evidence?.venue_order_id || result?.venue_order_id || record.venue_order_id || null,
      order_state: result?.evidence?.order_state || record.order_state || null,
    };
  });
  const write = await writeHyperliquidNonceStore(records, { storePath });
  const record = records.find((item) => item.record_key === claim.record.record_key);
  return {
    status: 'ok',
    path: write.path,
    record,
  };
}
