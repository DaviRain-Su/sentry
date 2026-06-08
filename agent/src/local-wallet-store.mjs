import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { buildWalletReferenceSnapshot, validateWalletReference } from '../../core/wallet-refs.js';

export const DEFAULT_WALLET_CONFIG_PATH = '~/.sentry/wallets.json';

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveWalletConfigPath(input = process.env.SENTRY_WALLET_CONFIG) {
  return expandHome(input || DEFAULT_WALLET_CONFIG_PATH);
}

function normalizeConfig(raw) {
  if (Array.isArray(raw)) return { version: 1, wallets: raw };
  if (!raw || typeof raw !== 'object') return { version: 1, wallets: [] };
  return {
    version: Number(raw.version || 1),
    wallets: Array.isArray(raw.wallets) ? raw.wallets : [],
  };
}

export async function readWalletConfig(options = {}) {
  const configPath = resolveWalletConfigPath(options.configPath);
  try {
    const text = await readFile(configPath, 'utf8');
    const parsed = normalizeConfig(JSON.parse(text));
    return {
      status: 'ok',
      path: configPath,
      records: parsed.wallets,
      config: parsed,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        status: 'missing',
        path: configPath,
        records: [],
        config: { version: 1, wallets: [] },
      };
    }
    return {
      status: 'error',
      path: configPath,
      code: 'WALLET_CONFIG_READ_FAILED',
      message: error?.message || String(error),
      records: [],
      config: { version: 1, wallets: [] },
    };
  }
}

export async function writeWalletConfig(records, options = {}) {
  const configPath = resolveWalletConfigPath(options.configPath);
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify({ version: 1, wallets: records }, null, 2)}\n`;
  const tmp = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, configPath);
  return { status: 'ok', path: configPath, record_count: records.length };
}

export async function loadLocalWalletStore(options = {}) {
  const config = await readWalletConfig(options);
  const snapshot = buildWalletReferenceSnapshot(config.records);
  return {
    ...snapshot,
    metadata_path: config.path,
    config_status: config.status,
    config_error: config.status === 'error' ? config.message : null,
  };
}

function sameWallet(a, b) {
  return a.wallet_id === b.wallet_id;
}

export async function upsertWalletReference(input, options = {}) {
  const current = await readWalletConfig(options);
  if (current.status === 'error') return current;
  const existing = current.records.find(
    (record) => record.wallet_id === (input.wallet_id || input.id || input.ows_wallet_id)
  );
  const validated = validateWalletReference({
    ...input,
    linked_at: existing?.linked_at || input.linked_at,
    updated_at: new Date().toISOString(),
  });
  if (validated.status !== 'ok') return validated;
  const records = [
    ...current.records.filter((record) => !sameWallet(record, validated.wallet)),
    validated.wallet,
  ].sort((a, b) => a.wallet_id.localeCompare(b.wallet_id));
  const write = await writeWalletConfig(records, options);
  return {
    status: 'ok',
    wallet: validated.wallet,
    path: write.path,
    record_count: records.length,
  };
}

export async function removeWalletReference(input, options = {}) {
  const walletId = input?.wallet_id || input?.id || input?.ows_wallet_id;
  if (!walletId) {
    return {
      status: 'error',
      code: 'WALLET_ID_REQUIRED',
      message: 'wallet_id is required.',
    };
  }
  const current = await readWalletConfig(options);
  if (current.status === 'error') return current;
  const records = current.records.filter((record) => record.wallet_id !== walletId);
  const removed = records.length !== current.records.length;
  const write = await writeWalletConfig(records, options);
  return {
    status: 'ok',
    removed,
    path: write.path,
    record_count: records.length,
  };
}

export async function markWalletReferenceRevoked(input, options = {}) {
  const walletId = input?.wallet_id || input?.id || input?.ows_wallet_id;
  if (!walletId) {
    return {
      status: 'error',
      code: 'WALLET_ID_REQUIRED',
      message: 'wallet_id is required.',
    };
  }
  const current = await readWalletConfig(options);
  if (current.status === 'error') return current;
  const now = options.now || input.revoked_at || new Date().toISOString();
  let found = null;
  const records = current.records.map((record) => {
    if (record.wallet_id !== walletId) return record;
    found = record;
    return {
      ...record,
      status: 'revoked',
      revoked_at: record.revoked_at || now,
      revoke_reason: input.reason || record.revoke_reason || 'local_authorization_revoke',
      capabilities: Array.isArray(record.capabilities)
        ? record.capabilities.filter((capability) => capability === 'read')
        : ['read'],
      accounts: (record.accounts || []).map((account) => ({
        ...account,
        capabilities: Array.isArray(account.capabilities)
          ? account.capabilities.filter((capability) => capability === 'read')
          : ['read'],
      })),
    };
  });
  if (!found) {
    return {
      status: 'error',
      code: 'WALLET_REF_NOT_FOUND',
      message: `No local wallet reference found for ${walletId}.`,
      wallet_id: walletId,
    };
  }
  const write = await writeWalletConfig(records, options);
  return {
    status: 'ok',
    wallet_id: walletId,
    revoked: found.status !== 'revoked',
    already_revoked: found.status === 'revoked',
    revoked_at: found.revoked_at || now,
    revoke_reason: input.reason || 'local_authorization_revoke',
    live_authority_revoked: false,
    chain_revoke_required: true,
    path: write.path,
    record_count: records.length,
  };
}
