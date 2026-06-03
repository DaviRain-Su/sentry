import assert from 'node:assert/strict';
import {
  okxCredentialEnvNames,
  redactCredentialResolution,
  resolveOkxCredentials,
  resolveOkxCredentialsFromEnv,
} from '../src/local-credential-resolver.mjs';
import {
  buildKeychainAddArgs,
  buildKeychainFindArgs,
  checkOkxKeychainStatus,
  okxKeychainRefs,
  storeKeychainSecretInteractively,
} from '../src/os-keychain.mjs';

const key = {
  venue_id: 'okx',
  key_handle: 'okx_key_live',
  display_handle: 'okx_....live',
  account_ref: 'okx:subaccount:live',
  permissions: ['read', 'place_order', 'cancel_order'],
};

const envNames = okxCredentialEnvNames(key);
assert.deepEqual(envNames.apiKey, ['SENTRY_OKX_OKX_KEY_LIVE_API_KEY', 'SENTRY_OKX_API_KEY']);

const envOnly = await resolveOkxCredentials(key, {
  env: {
    SENTRY_OKX_OKX_KEY_LIVE_API_KEY: 'api-value',
    SENTRY_OKX_OKX_KEY_LIVE_SECRET_KEY: 'secret-value',
    SENTRY_OKX_OKX_KEY_LIVE_PASSPHRASE: 'pass-value',
  },
  keychain: {
    platform: 'darwin',
    execFileImpl: async () => {
      throw new Error('keychain should not be called when env credentials are complete');
    },
  },
});
assert.equal(envOnly.status, 'ok');
assert.equal(envOnly.source, 'env');
assert.equal(envOnly.credentials.secretKey, 'secret-value');
assert.equal(JSON.stringify(redactCredentialResolution(envOnly)).includes('secret-value'), false);

const refs = okxKeychainRefs(key);
assert.equal(refs.secretKey.service, 'sh.sentry.venue.okx.okx_key_live');
assert.deepEqual(buildKeychainFindArgs(refs.apiKey), [
  'find-generic-password',
  '-a',
  'api_key',
  '-s',
  refs.apiKey.service,
  '-w',
]);
assert.equal(buildKeychainAddArgs(refs.secretKey).at(-1), '-w');
assert.equal(JSON.stringify(buildKeychainAddArgs(refs.secretKey)).includes('secret-value'), false);

const keychainValues = {
  api_key: 'api-value\n',
  secret_key: 'secret-value\n',
  passphrase: 'pass-value\n',
};
const keychainCalls = [];
const keychain = await resolveOkxCredentials(key, {
  env: {},
  keychain: {
    platform: 'darwin',
    execFileImpl: async (_command, args) => {
      keychainCalls.push(args);
      const account = args[args.indexOf('-a') + 1];
      return { stdout: keychainValues[account], stderr: '' };
    },
  },
});
assert.equal(keychain.status, 'ok');
assert.equal(keychain.source, 'macos_keychain');
assert.equal(keychain.credentials.apiKey, 'api-value');
assert.equal(keychain.credentials.secretKey, 'secret-value');
assert.equal(keychain.credentials.passphrase, 'pass-value');
assert.equal(keychainCalls.length, 3);
assert.equal(JSON.stringify(redactCredentialResolution(keychain)).includes('secret-value'), false);

const missing = await resolveOkxCredentials(key, {
  env: {},
  keychain: {
    platform: 'darwin',
    execFileImpl: async () => {
      const error = new Error('The specified item could not be found in the keychain.');
      error.status = 44;
      error.stderr = 'security: SecKeychainSearchCopyNext: The specified item could not be found.';
      throw error;
    },
  },
});
assert.equal(missing.status, 'error');
assert.equal(missing.code, 'OKX_CREDENTIAL_SOURCE_MISSING');
assert.equal(missing.env.code, 'OKX_CREDENTIAL_ENV_MISSING');
assert.equal(missing.keychain.code, 'OKX_KEYCHAIN_CREDENTIAL_MISSING');
assert.equal(JSON.stringify(missing).includes('secret-value'), false);

const unsupported = await resolveOkxCredentials(key, {
  env: {},
  keychain: { platform: 'linux' },
});
assert.equal(unsupported.status, 'error');
assert.equal(unsupported.code, 'OKX_CREDENTIAL_SOURCE_MISSING');
assert.equal(unsupported.keychain.code, 'KEYCHAIN_UNSUPPORTED');

const status = await checkOkxKeychainStatus(key, {
  platform: 'darwin',
  execFileImpl: async (_command, args) => {
    const account = args[args.indexOf('-a') + 1];
    if (account === 'passphrase') throw new Error('missing passphrase');
    return { stdout: 'value\n', stderr: '' };
  },
});
assert.equal(status.status, 'partial');
assert.equal(status.checked.filter((item) => item.available).length, 2);

let storeCommand = null;
let storeArgs = null;
const stored = storeKeychainSecretInteractively(refs.apiKey, {
  platform: 'darwin',
  stdio: 'pipe',
  spawnImpl: (command, args) => {
    storeCommand = command;
    storeArgs = args;
    return { status: 0, signal: null };
  },
});
assert.equal(stored.status, 'ok');
assert.equal(storeCommand, 'security');
assert.equal(storeArgs.at(-1), '-w');
assert.equal(JSON.stringify(storeArgs).includes('api-value'), false);

const envMissing = resolveOkxCredentialsFromEnv(key, {});
assert.equal(envMissing.code, 'OKX_CREDENTIAL_ENV_MISSING');

console.log('ALL LOCAL CREDENTIAL RESOLVER TESTS PASS');
