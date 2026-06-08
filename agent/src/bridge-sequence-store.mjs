import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_BRIDGE_SEQUENCE_STORE_PATH = '~/.sentry/bridge-sequences.json';
export const BRIDGE_SEQUENCE_STORE_LIMIT = 64;

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveBridgeSequenceStorePath(input = process.env.SENTRY_BRIDGE_SEQUENCE_STORE) {
  return expandHome(input || DEFAULT_BRIDGE_SEQUENCE_STORE_PATH);
}

export function bridgeSequenceStoreKey(relayTokenHash) {
  const hash = String(relayTokenHash || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  return createHash('sha256').update(`sentry-bridge-sequence:${hash}`).digest('hex');
}

function normalizeConfig(raw) {
  if (Array.isArray(raw)) return { version: 1, sequences: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, sequences: [] };
  return {
    version: Number(raw.version || 1),
    sequences: Array.isArray(raw.sequences) ? raw.sequences : [],
  };
}

function safeSeq(value) {
  const seq = Number(value || 0);
  return Number.isSafeInteger(seq) && seq > 0 ? seq : 0;
}

function normalizeRecord(input = {}) {
  const relayTokenKey = String(input.relay_token_key || '').trim();
  if (!/^[a-f0-9]{64}$/i.test(relayTokenKey)) return null;
  return {
    relay_token_key: relayTokenKey,
    outbound_seq: safeSeq(input.outbound_seq),
    inbound_seq: safeSeq(input.inbound_seq),
    updated_at: input.updated_at || new Date().toISOString(),
  };
}

export async function readBridgeSequenceConfig(options = {}) {
  const storePath = resolveBridgeSequenceStorePath(options.storePath);
  try {
    const text = await readFile(storePath, 'utf8');
    const parsed = normalizeConfig(JSON.parse(text));
    return {
      status: 'ok',
      path: storePath,
      records: parsed.sequences.map(normalizeRecord).filter(Boolean),
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: storePath,
        records: [],
        config: { version: 1, sequences: [] },
      };
    }
    return {
      status: 'error',
      path: storePath,
      code: 'BRIDGE_SEQUENCE_STORE_READ_FAILED',
      message: error?.message || String(error),
      records: [],
      config: { version: 1, sequences: [] },
    };
  }
}

export async function writeBridgeSequenceConfig(records, options = {}) {
  const storePath = resolveBridgeSequenceStorePath(options.storePath);
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, sequences: records }, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, storePath);
  return { status: 'ok', path: storePath, record_count: records.length };
}

export async function loadBridgeSequenceState(options = {}) {
  const relayTokenKey = bridgeSequenceStoreKey(options.relayTokenHash);
  if (!relayTokenKey) {
    return {
      status: 'disabled',
      code: 'BRIDGE_SEQUENCE_KEY_REQUIRED',
      outbound_seq: 0,
      inbound_seq: 0,
    };
  }
  const current = await readBridgeSequenceConfig(options);
  if (current.status === 'error') {
    return { ...current, outbound_seq: 0, inbound_seq: 0 };
  }
  const record = current.records.find((item) => item.relay_token_key === relayTokenKey);
  return {
    status: record ? 'ok' : 'missing',
    path: current.path,
    relay_token_key: relayTokenKey,
    outbound_seq: safeSeq(record?.outbound_seq),
    inbound_seq: safeSeq(record?.inbound_seq),
    updated_at: record?.updated_at || null,
  };
}

export async function saveBridgeSequenceState(input = {}, options = {}) {
  const relayTokenKey = bridgeSequenceStoreKey(input.relayTokenHash);
  if (!relayTokenKey) {
    return {
      status: 'disabled',
      code: 'BRIDGE_SEQUENCE_KEY_REQUIRED',
      outbound_seq: 0,
      inbound_seq: 0,
    };
  }
  const current = await readBridgeSequenceConfig(options);
  if (current.status === 'error') return current;
  const existing = current.records.find((item) => item.relay_token_key === relayTokenKey);
  const nextRecord = {
    relay_token_key: relayTokenKey,
    outbound_seq: Math.max(safeSeq(existing?.outbound_seq), safeSeq(input.outboundSeq)),
    inbound_seq: Math.max(safeSeq(existing?.inbound_seq), safeSeq(input.inboundSeq)),
    updated_at: new Date().toISOString(),
  };
  const records = [
    nextRecord,
    ...current.records.filter((item) => item.relay_token_key !== relayTokenKey),
  ]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
    .slice(0, BRIDGE_SEQUENCE_STORE_LIMIT);
  const write = await writeBridgeSequenceConfig(records, options);
  return {
    status: 'ok',
    path: write.path,
    relay_token_key: relayTokenKey,
    outbound_seq: nextRecord.outbound_seq,
    inbound_seq: nextRecord.inbound_seq,
  };
}
