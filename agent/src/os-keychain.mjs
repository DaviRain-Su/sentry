import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MACOS_KEYCHAIN_SOURCE = 'macos_keychain';
export const OKX_KEYCHAIN_FIELDS = [
  { field: 'apiKey', account: 'api_key', label: 'OKX API key' },
  { field: 'secretKey', account: 'secret_key', label: 'OKX secret key' },
  { field: 'passphrase', account: 'passphrase', label: 'OKX passphrase' },
];

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function supportsMacOsKeychain(platform = process.platform) {
  return platform === 'darwin';
}

export function keychainServiceForCredential({ venueId, keyHandle }) {
  return `sh.sentry.venue.${sanitizeSegment(venueId)}.${sanitizeSegment(keyHandle)}`;
}

export function okxKeychainRefs(keyMetadata = {}) {
  const service = keychainServiceForCredential({
    venueId: 'okx',
    keyHandle: keyMetadata.key_handle,
  });
  return Object.fromEntries(
    OKX_KEYCHAIN_FIELDS.map((field) => [
      field.field,
      {
        source: MACOS_KEYCHAIN_SOURCE,
        service,
        account: field.account,
        label: field.label,
      },
    ])
  );
}

export function buildKeychainFindArgs(ref) {
  return ['find-generic-password', '-a', ref.account, '-s', ref.service, '-w'];
}

export function buildKeychainAddArgs(ref) {
  // `-w` is intentionally last without a value so macOS prompts interactively.
  return [
    'add-generic-password',
    '-a',
    ref.account,
    '-s',
    ref.service,
    '-U',
    '-l',
    `${ref.service}:${ref.account}`,
    '-w',
  ];
}

export function buildKeychainDeleteArgs(ref) {
  return ['delete-generic-password', '-a', ref.account, '-s', ref.service];
}

function normalizeExecError(error) {
  return {
    code: error?.code ?? error?.status ?? null,
    message: error?.stderr?.trim() || error?.message || String(error),
  };
}

export async function readKeychainSecret(ref, options = {}) {
  const {
    execFileImpl = execFileAsync,
    platform = process.platform,
    command = 'security',
  } = options;
  if (!supportsMacOsKeychain(platform)) {
    return {
      status: 'unsupported',
      code: 'KEYCHAIN_UNSUPPORTED',
      message: 'macOS Keychain is unavailable on this platform.',
      ref,
    };
  }
  try {
    const result = await execFileImpl(command, buildKeychainFindArgs(ref), {
      encoding: 'utf8',
    });
    return {
      status: 'ok',
      value: String(result.stdout || '').replace(/\n$/, ''),
      ref,
    };
  } catch (error) {
    const normalized = normalizeExecError(error);
    return {
      status: 'missing',
      code: 'KEYCHAIN_SECRET_MISSING',
      message: normalized.message,
      keychain_code: normalized.code,
      ref,
    };
  }
}

export async function readOkxCredentialsFromKeychain(keyMetadata, options = {}) {
  if (!keyMetadata || keyMetadata.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_REQUIRED',
      message: 'OKX keychain resolver requires venue_id=okx key metadata.',
    };
  }

  const refs = okxKeychainRefs(keyMetadata);
  const entries = await Promise.all(
    OKX_KEYCHAIN_FIELDS.map(async (field) => ({
      field: field.field,
      result: await readKeychainSecret(refs[field.field], options),
    }))
  );
  const unsupported = entries.find((entry) => entry.result.status === 'unsupported');
  if (unsupported) {
    return {
      status: 'error',
      code: unsupported.result.code,
      message: unsupported.result.message,
      source: MACOS_KEYCHAIN_SOURCE,
      refs,
    };
  }
  const missing = entries
    .filter((entry) => entry.result.status !== 'ok')
    .map((entry) => ({
      field: entry.field,
      source: MACOS_KEYCHAIN_SOURCE,
      service: refs[entry.field].service,
      account: refs[entry.field].account,
      code: entry.result.code,
    }));
  if (missing.length) {
    return {
      status: 'error',
      code: 'OKX_KEYCHAIN_CREDENTIAL_MISSING',
      message: 'OKX credentials are not complete in macOS Keychain.',
      source: MACOS_KEYCHAIN_SOURCE,
      missing,
      refs,
    };
  }
  const byField = Object.fromEntries(entries.map((entry) => [entry.field, entry.result.value]));
  return {
    status: 'ok',
    source: MACOS_KEYCHAIN_SOURCE,
    credentials: {
      apiKey: byField.apiKey,
      secretKey: byField.secretKey,
      passphrase: byField.passphrase,
    },
    resolved_from: refs,
  };
}

export async function checkOkxKeychainStatus(keyMetadata, options = {}) {
  const refs = okxKeychainRefs(keyMetadata);
  const checked = await Promise.all(
    OKX_KEYCHAIN_FIELDS.map(async (field) => {
      const result = await readKeychainSecret(refs[field.field], options);
      return {
        field: field.field,
        source: MACOS_KEYCHAIN_SOURCE,
        service: refs[field.field].service,
        account: refs[field.field].account,
        available: result.status === 'ok',
        status: result.status,
        code: result.code || null,
      };
    })
  );
  return {
    status: checked.every((item) => item.available) ? 'ok' : 'partial',
    source: MACOS_KEYCHAIN_SOURCE,
    key_handle: keyMetadata?.key_handle || null,
    checked,
  };
}

export function storeKeychainSecretInteractively(ref, options = {}) {
  const {
    spawnImpl = spawnSync,
    platform = process.platform,
    command = 'security',
    stdio = 'inherit',
  } = options;
  if (!supportsMacOsKeychain(platform)) {
    return {
      status: 'error',
      code: 'KEYCHAIN_UNSUPPORTED',
      message: 'macOS Keychain is unavailable on this platform.',
    };
  }
  const args = buildKeychainAddArgs(ref);
  const result = spawnImpl(command, args, { stdio });
  if (result.status !== 0) {
    return {
      status: 'error',
      code: 'KEYCHAIN_STORE_FAILED',
      exit_status: result.status,
      signal: result.signal,
      message: 'Failed to store credential in macOS Keychain.',
    };
  }
  return {
    status: 'ok',
    source: MACOS_KEYCHAIN_SOURCE,
    service: ref.service,
    account: ref.account,
  };
}

export function storeOkxCredentialsInteractively(keyMetadata, options = {}) {
  const refs = okxKeychainRefs(keyMetadata);
  const fields =
    options.fields?.length > 0
      ? OKX_KEYCHAIN_FIELDS.filter((field) => options.fields.includes(field.field))
      : OKX_KEYCHAIN_FIELDS;
  const stored = [];
  for (const field of fields) {
    const result = storeKeychainSecretInteractively(refs[field.field], options);
    stored.push({
      field: field.field,
      label: field.label,
      ...result,
    });
    if (result.status !== 'ok') {
      return {
        status: 'error',
        code: result.code,
        message: result.message,
        stored,
      };
    }
  }
  return {
    status: 'ok',
    source: MACOS_KEYCHAIN_SOURCE,
    key_handle: keyMetadata?.key_handle || null,
    stored,
  };
}
