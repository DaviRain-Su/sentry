import assert from 'node:assert/strict';
import { createPublicKey, verify as verifyDetached } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  daemonPairingProofPayload,
  daemonRelayRefreshProofPayload,
} from '../../core/daemon-identity.js';
import {
  loadOrCreateDaemonIdentity,
  signDaemonPairingProof,
  signDaemonRelayRefreshProof,
} from '../src/daemon-identity-store.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-daemon-identity-'));
const storePath = path.join(dir, 'identity.json');

const created = await loadOrCreateDaemonIdentity({
  storePath,
  now: new Date('2026-06-04T00:00:00.000Z'),
});
assert.equal(created.status, 'created');
assert.match(created.identity.key_id, /^[A-Za-z0-9_-]+$/);
assert.equal(created.identity.algorithm, 'Ed25519');
assert.equal(created.identity.public_key_encoding, 'spki-der-base64url');

const permissions = (await stat(storePath)).mode & 0o777;
assert.equal(permissions, 0o600);

const loaded = await loadOrCreateDaemonIdentity({ storePath });
assert.equal(loaded.status, 'ok');
assert.equal(loaded.identity.key_id, created.identity.key_id);

const proof = signDaemonPairingProof({
  identity: loaded.identity,
  pairingCode: 'pair_test',
  agentId: 'default',
  deviceName: 'test-daemon',
  supportedCapabilities: ['agent.dispatch', 'agent.status'],
  issuedAt: '2026-06-04T00:01:00.000Z',
});
assert.equal(proof.agent_public_key, loaded.identity.public_key_spki);
assert.equal(proof.agent_public_key_id, loaded.identity.key_id);
assert.match(proof.signed_nonce, /^[A-Za-z0-9_-]+$/);

const payload = daemonPairingProofPayload({
  pairing_code: 'pair_test',
  agent_id: 'default',
  device_name: 'test-daemon',
  agent_public_key: proof.agent_public_key,
  issued_at: proof.pairing_proof_issued_at,
  supported_capabilities: ['agent.status', 'agent.dispatch'],
});
const publicKey = createPublicKey({
  key: Buffer.from(proof.agent_public_key, 'base64url'),
  format: 'der',
  type: 'spki',
});
assert.equal(
  verifyDetached(
    null,
    Buffer.from(payload),
    publicKey,
    Buffer.from(proof.signed_nonce, 'base64url')
  ),
  true
);

const refreshProof = signDaemonRelayRefreshProof({
  identity: loaded.identity,
  agentId: 'default',
  challengeId: 'rtc_test',
  challenge: 'rch_test',
  issuedAt: '2026-06-04T00:02:00.000Z',
});
assert.equal(refreshProof.agent_public_key_id, loaded.identity.key_id);
assert.match(refreshProof.signed_nonce, /^[A-Za-z0-9_-]+$/);

const refreshPayload = daemonRelayRefreshProofPayload({
  agent_id: 'default',
  agent_public_key: loaded.identity.public_key_spki,
  challenge_id: 'rtc_test',
  challenge: 'rch_test',
  issued_at: refreshProof.refresh_proof_issued_at,
});
assert.equal(
  verifyDetached(
    null,
    Buffer.from(refreshPayload),
    publicKey,
    Buffer.from(refreshProof.signed_nonce, 'base64url')
  ),
  true
);

const raw = await readFile(storePath, 'utf8');
assert.equal(raw.includes('pair_test'), false);
assert.equal(raw.includes('rch_test'), false);
assert.equal(raw.includes(proof.signed_nonce), false);
assert.equal(raw.includes(refreshProof.signed_nonce), false);

console.log('ALL DAEMON IDENTITY STORE TESTS PASS');
