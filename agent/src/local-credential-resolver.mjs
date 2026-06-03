import { readOkxCredentialsFromKeychain } from './os-keychain.mjs';

function sanitizeEnvSegment(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function candidateNames(venueId, keyHandle, suffix) {
  const venue = sanitizeEnvSegment(venueId);
  const handle = sanitizeEnvSegment(keyHandle);
  return [
    handle ? `SENTRY_${venue}_${handle}_${suffix}` : null,
    `SENTRY_${venue}_${suffix}`,
  ].filter(Boolean);
}

function firstValue(env, names) {
  for (const name of names) {
    if (env[name]) return { name, value: env[name] };
  }
  return null;
}

export function okxCredentialEnvNames(keyMetadata = {}) {
  return {
    apiKey: candidateNames('okx', keyMetadata.key_handle, 'API_KEY'),
    secretKey: candidateNames('okx', keyMetadata.key_handle, 'SECRET_KEY'),
    passphrase: candidateNames('okx', keyMetadata.key_handle, 'PASSPHRASE'),
  };
}

export function resolveOkxCredentialsFromEnv(keyMetadata, env = process.env) {
  if (!keyMetadata || keyMetadata.venue_id !== 'okx') {
    return {
      status: 'error',
      code: 'OKX_KEY_METADATA_REQUIRED',
      message: 'OKX credential resolver requires venue_id=okx key metadata.',
    };
  }
  const names = okxCredentialEnvNames(keyMetadata);
  const apiKey = firstValue(env, names.apiKey);
  const secretKey = firstValue(env, names.secretKey);
  const passphrase = firstValue(env, names.passphrase);
  const missing = [];
  if (!apiKey) missing.push({ field: 'apiKey', env: names.apiKey });
  if (!secretKey) missing.push({ field: 'secretKey', env: names.secretKey });
  if (!passphrase) missing.push({ field: 'passphrase', env: names.passphrase });

  if (missing.length) {
    return {
      status: 'error',
      code: 'OKX_CREDENTIAL_ENV_MISSING',
      message:
        'OKX live read requires local environment credentials; secrets are not stored in Sentry metadata.',
      missing,
    };
  }

  return {
    status: 'ok',
    credentials: {
      apiKey: apiKey.value,
      secretKey: secretKey.value,
      passphrase: passphrase.value,
    },
    resolved_from: {
      apiKey: apiKey.name,
      secretKey: secretKey.name,
      passphrase: passphrase.name,
    },
  };
}

export async function resolveOkxCredentials(keyMetadata, options = {}) {
  const { env = process.env, keychain = {} } = options;
  const envResult = resolveOkxCredentialsFromEnv(keyMetadata, env);
  if (envResult.status === 'ok') {
    return {
      ...envResult,
      source: 'env',
    };
  }

  const keychainResult = await readOkxCredentialsFromKeychain(keyMetadata, keychain);
  if (keychainResult.status === 'ok') return keychainResult;

  return {
    status: 'error',
    code: 'OKX_CREDENTIAL_SOURCE_MISSING',
    message:
      'OKX live read requires complete local credentials from env or macOS Keychain; secrets are not stored in Sentry metadata.',
    env: {
      status: envResult.status,
      code: envResult.code,
      missing: envResult.missing,
    },
    keychain: {
      status: keychainResult.status,
      code: keychainResult.code,
      missing: keychainResult.missing,
      refs: keychainResult.refs,
      source: keychainResult.source,
    },
  };
}

export function redactCredentialResolution(result) {
  if (!result || result.status !== 'ok') return result;
  return {
    status: 'ok',
    source: result.source || 'env',
    resolved_from: result.resolved_from,
  };
}
