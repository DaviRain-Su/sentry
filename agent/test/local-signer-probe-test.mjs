import assert from 'node:assert/strict';
import {
  buildLocalSignerProbeSnapshot,
  probeEthereumSigner,
  probeSolanaSigner,
} from '../src/local-signer-probe.mjs';

const solanaOwner = '11111111111111111111111111111111';
const solanaEnv = {
  SENTRY_SOLANA_WALLET_ADDRESS: solanaOwner,
};

const solanaStatic = await probeSolanaSigner({
  env: {
    ...solanaEnv,
    SENTRY_SOLANA_SIGNER_ADDRESS: solanaOwner,
  },
});
assert.equal(solanaStatic.status, 'ok');
assert.equal(solanaStatic.source, 'env_signer_address');
assert.equal(solanaStatic.secret_material_observed, false);

let solanaCommandArgs = null;
const solanaCommand = await probeSolanaSigner({
  env: {
    ...solanaEnv,
    SENTRY_SOLANA_SIGNER_PROBE_COMMAND: 'solana address',
  },
  execFileImpl: async (cmd, args, options) => {
    solanaCommandArgs = { cmd, args, timeout: options.timeout };
    return { stdout: `${solanaOwner}\n`, stderr: '' };
  },
});
assert.equal(solanaCommand.status, 'ok');
assert.equal(solanaCommand.source, 'probe_command');
assert.deepEqual(solanaCommandArgs, { cmd: 'solana', args: ['address'], timeout: 3000 });

const solanaMissingProbe = await probeSolanaSigner({ env: solanaEnv });
assert.equal(solanaMissingProbe.status, 'partial');
assert.equal(solanaMissingProbe.code, 'SOLANA_SIGNER_PROBE_NOT_CONFIGURED');

const solanaMismatch = await probeSolanaSigner({
  env: {
    ...solanaEnv,
    SENTRY_SOLANA_SIGNER_ADDRESS: 'So11111111111111111111111111111111111111112',
  },
});
assert.equal(solanaMismatch.status, 'error');
assert.equal(solanaMismatch.code, 'SOLANA_SIGNER_ACCOUNT_MISMATCH');

const solanaCommandFailure = await probeSolanaSigner({
  env: {
    ...solanaEnv,
    SENTRY_SOLANA_SIGNER_PROBE_COMMAND: 'solana address',
  },
  execFileImpl: async () => {
    throw new Error('secret-value-should-not-leak');
  },
});
assert.equal(solanaCommandFailure.status, 'error');
assert.equal(solanaCommandFailure.code, 'SOLANA_SIGNER_PROBE_FAILED');
assert.equal(JSON.stringify(solanaCommandFailure).includes('secret-value-should-not-leak'), false);

const ethereumAccount = '0x0000000000000000000000000000000000000001';
const ethereumEnv = {
  SENTRY_ETHEREUM_WALLET_ADDRESS: ethereumAccount,
};

const ethereumStatic = await probeEthereumSigner({
  env: {
    ...ethereumEnv,
    SENTRY_ETHEREUM_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000001',
  },
});
assert.equal(ethereumStatic.status, 'ok');
assert.equal(ethereumStatic.source, 'env_signer_address');
assert.equal(ethereumStatic.account_ref, ethereumAccount);

let ethereumCommandArgs = null;
const ethereumCommand = await probeEthereumSigner({
  env: {
    ...ethereumEnv,
    SENTRY_ETHEREUM_SIGNER_PROBE_COMMAND: 'safe-cli signer-address',
  },
  execFileImpl: async (cmd, args, options) => {
    ethereumCommandArgs = { cmd, args, timeout: options.timeout };
    return { stdout: `signer=${ethereumAccount}\n`, stderr: '' };
  },
});
assert.equal(ethereumCommand.status, 'ok');
assert.equal(ethereumCommand.source, 'probe_command');
assert.deepEqual(ethereumCommandArgs, {
  cmd: 'safe-cli',
  args: ['signer-address'],
  timeout: 3000,
});

const ethereumMissingProbe = await probeEthereumSigner({ env: ethereumEnv });
assert.equal(ethereumMissingProbe.status, 'partial');
assert.equal(ethereumMissingProbe.code, 'ETHEREUM_SIGNER_PROBE_NOT_CONFIGURED');

const ethereumMismatch = await probeEthereumSigner({
  env: {
    ...ethereumEnv,
    SENTRY_ETHEREUM_SIGNER_ADDRESS: '0x0000000000000000000000000000000000000002',
  },
});
assert.equal(ethereumMismatch.status, 'error');
assert.equal(ethereumMismatch.code, 'ETHEREUM_SIGNER_ACCOUNT_MISMATCH');

const snapshot = await buildLocalSignerProbeSnapshot({
  env: {
    ...solanaEnv,
    SENTRY_SOLANA_SIGNER_ADDRESS: solanaOwner,
    ...ethereumEnv,
  },
});
assert.equal(snapshot.status, 'partial');
assert.equal(snapshot.probes.length, 2);
assert.equal(snapshot.probes[0].status, 'ok');
assert.equal(snapshot.probes[1].status, 'partial');
assert.equal(JSON.stringify(snapshot).includes('private_key'), false);

console.log('ALL LOCAL SIGNER PROBE TESTS PASS');
