import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { validateWalletReference } from '../../core/wallet-refs.js';
import {
  loadLocalWalletStore,
  markWalletReferenceRevoked,
  removeWalletReference,
  upsertWalletReference,
} from '../src/local-wallet-store.mjs';

const execFileAsync = promisify(execFile);
const dir = await mkdtemp(path.join(tmpdir(), 'sentry-wallet-store-'));

try {
  const configPath = path.join(dir, 'wallets.json');

  const rawSecret = validateWalletReference({
    wallet_id: 'ows_bad',
    accounts: ['solana:mainnet:So11111111111111111111111111111111111111112'],
    token: 'ows_token_secret',
  });
  assert.equal(rawSecret.status, 'error');
  assert.equal(rawSecret.code, 'RAW_WALLET_SECRET_REJECTED');

  const linked = await upsertWalletReference(
    {
      wallet_id: 'ows_main',
      display_name: 'OWS Main',
      vault_path: '~/.ows',
      accounts: [
        'solana:mainnet:So11111111111111111111111111111111111111112',
        'eip155:1:0x0000000000000000000000000000000000000001',
      ],
      policy_ids: ['policy-a'],
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    { configPath }
  );
  assert.equal(linked.status, 'ok');
  assert.equal(linked.wallet.wallet_id, 'ows_main');
  assert.equal(linked.wallet.accounts.length, 2);
  assert.equal(
    linked.wallet.accounts[0].caip10,
    'solana:mainnet:So11111111111111111111111111111111111111112'
  );

  const mode = (await stat(configPath)).mode & 0o777;
  assert.equal(mode, 0o600);

  const store = await loadLocalWalletStore({ configPath });
  assert.equal(store.status, 'ok');
  assert.equal(store.wallet_count, 1);
  assert.equal(store.account_count, 2);
  assert.equal(JSON.stringify(store).includes('ows_token_secret'), false);

  const revoked = await markWalletReferenceRevoked(
    {
      wallet_id: 'ows_main',
      reason: 'test_revoke',
    },
    { configPath, now: '2026-06-04T00:00:00.000Z' }
  );
  assert.equal(revoked.status, 'ok');
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.live_authority_revoked, false);
  assert.equal(revoked.chain_revoke_required, true);
  const afterRevoke = await loadLocalWalletStore({ configPath });
  assert.equal(afterRevoke.wallets[0].status, 'revoked');
  assert.deepEqual(afterRevoke.wallets[0].capabilities, ['read']);
  assert.deepEqual(afterRevoke.wallets[0].accounts[0].capabilities, ['read']);

  await upsertWalletReference(
    {
      wallet_id: 'ows_main',
      display_name: 'OWS Main',
      vault_path: '~/.ows',
      accounts: [
        'solana:mainnet:So11111111111111111111111111111111111111112',
        'eip155:1:0x0000000000000000000000000000000000000001',
      ],
      policy_ids: ['policy-a'],
      capabilities: ['read', 'sign', 'submit_tx'],
    },
    { configPath }
  );

  const { stdout: listOut } = await execFileAsync(
    process.execPath,
    ['src/index.mjs', 'wallet', 'list', '--wallet-config', configPath, '--json'],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const listed = JSON.parse(listOut);
  assert.equal(listed.wallet_count, 1);
  assert.equal(listed.wallets[0].wallet_id, 'ows_main');

  const cliConfigPath = path.join(dir, 'cli-wallets.json');
  const { stdout: linkOut } = await execFileAsync(
    process.execPath,
    [
      'src/index.mjs',
      'wallet',
      'link',
      '--wallet-id',
      'ows_cli',
      '--accounts',
      'solana:mainnet:So11111111111111111111111111111111111111112,eip155:1:0x0000000000000000000000000000000000000002',
      '--policy-ids',
      'policy-cli',
      '--wallet-config',
      cliConfigPath,
      '--json',
    ],
    { cwd: path.join(import.meta.dirname, '..') }
  );
  const cliLinked = JSON.parse(linkOut);
  assert.equal(cliLinked.status, 'ok');
  assert.equal(cliLinked.wallet.wallet_id, 'ows_cli');
  assert.equal(cliLinked.wallet.accounts.length, 2);

  const removed = await removeWalletReference({ wallet_id: 'ows_main' }, { configPath });
  assert.equal(removed.status, 'ok');
  assert.equal(removed.removed, true);
  const afterRemove = await loadLocalWalletStore({ configPath });
  assert.equal(afterRemove.wallet_count, 0);

  console.log('ALL LOCAL WALLET STORE TESTS PASS');
} finally {
  await rm(dir, { recursive: true, force: true });
}
