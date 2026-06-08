import assert from 'node:assert/strict';
import {
  createPublicKey,
  generateKeyPairSync,
  sign as signDetached,
  verify as verifyDetached,
} from 'node:crypto';
import {
  relayTokenProtocol,
  sha256Hex,
  signDaemonBridgeEnvelope,
  validateBridgeEnvelopeSequence,
  validateBridgeEnvelopeTiming,
  verifyDaemonBridgeEnvelope,
  verifyWorkerBridgeEnvelope,
} from '../src/bridge-envelope.mjs';
import {
  bridgeSigningPayload,
  signBridgeEnvelope,
  verifyBridgeEnvelope,
} from '../../core/bridge-envelope.js';
import { generateDaemonIdentity } from '../src/daemon-identity-store.mjs';

const relayToken = 'rt_bridge_test';
const relayTokenHash = sha256Hex(relayToken);
assert.match(relayTokenHash, /^[0-9a-f]{64}$/);
assert.equal(relayTokenProtocol(relayToken), `sentry-rt.${relayToken}`);

const envelope = signDaemonBridgeEnvelope(
  {
    kind: 'heartbeat',
    message_id: 'heartbeat_1',
    seq: 1,
    issued_at: '2026-06-04T00:00:00.000Z',
    payload: {
      daemon_version: '0.1.0',
      target_venue_ids: ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx'],
    },
  },
  relayTokenHash
);
assert.equal(typeof envelope.signature, 'string');
assert.equal((await verifyBridgeEnvelope(envelope, relayTokenHash)).ok, true);
assert.equal(
  validateBridgeEnvelopeTiming(envelope, {
    nowMs: Date.parse('2026-06-04T00:00:30.000Z'),
  }).ok,
  true
);
assert.deepEqual(validateBridgeEnvelopeSequence(envelope, 0), { ok: true, seq: 1 });
const replayCheck = validateBridgeEnvelopeSequence(envelope, 1);
assert.equal(replayCheck.ok, false);
assert.equal(replayCheck.code, 'BRIDGE_REPLAY_DETECTED');
const missingSeqCheck = validateBridgeEnvelopeSequence({ ...envelope, seq: undefined }, 0);
assert.equal(missingSeqCheck.ok, false);
assert.equal(missingSeqCheck.code, 'BRIDGE_SEQUENCE_REQUIRED');

const tampered = {
  ...envelope,
  payload: {
    ...envelope.payload,
    target_venue_ids: ['okx'],
  },
};
const tamperedCheck = await verifyBridgeEnvelope(tampered, relayTokenHash);
assert.equal(tamperedCheck.ok, false);
assert.equal(tamperedCheck.code, 'BRIDGE_SIGNATURE_INVALID');

const identity = generateDaemonIdentity(new Date('2026-06-04T00:00:00.000Z'));
const identityEnvelope = signDaemonBridgeEnvelope(
  {
    kind: 'heartbeat',
    message_id: 'heartbeat_identity_1',
    seq: 2,
    issued_at: '2026-06-04T00:00:10.000Z',
    payload: {
      daemon_version: '0.1.0',
      target_venue_ids: ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx'],
    },
  },
  relayTokenHash,
  identity
);
assert.equal(identityEnvelope.agent_public_key_id, identity.key_id);
assert.equal(identityEnvelope.agent_signature_alg, 'Ed25519');
assert.equal(typeof identityEnvelope.agent_signature, 'string');
assert.equal((await verifyBridgeEnvelope(identityEnvelope, relayTokenHash)).ok, true);
const identityPublicKey = createPublicKey({
  key: Buffer.from(identity.public_key_spki, 'base64url'),
  format: 'der',
  type: 'spki',
});
assert.equal(
  verifyDetached(
    null,
    Buffer.from(bridgeSigningPayload(identityEnvelope)),
    identityPublicKey,
    Buffer.from(identityEnvelope.agent_signature, 'base64url')
  ),
  true
);
assert.equal(
  verifyDetached(
    null,
    Buffer.from(
      bridgeSigningPayload({
        ...identityEnvelope,
        payload: { ...identityEnvelope.payload, target_venue_ids: ['okx'] },
      })
    ),
    identityPublicKey,
    Buffer.from(identityEnvelope.agent_signature, 'base64url')
  ),
  false
);

const workerCommand = await signBridgeEnvelope(
  {
    kind: 'command',
    message_id: 'cmd_1',
    seq: 1,
    issued_at: '2026-06-04T00:00:01.000Z',
    expires_at: '2026-06-04T00:02:01.000Z',
    idempotency_key: 'idem_1',
    payload: { type: 'agent.status' },
  },
  relayTokenHash
);
assert.equal(verifyDaemonBridgeEnvelope(workerCommand, relayTokenHash).ok, true);
const { publicKey: workerPublicKeyObject, privateKey: workerPrivateKeyObject } =
  generateKeyPairSync('ed25519');
const workerPublicKey = Buffer.from(
  workerPublicKeyObject.export({ type: 'spki', format: 'der' })
).toString('base64url');
const workerPublicKeyId = 'worker_kid_test';
const workerIdentityEnvelope = {
  kind: 'command',
  message_id: 'cmd_identity_1',
  seq: 2,
  issued_at: '2026-06-04T00:00:11.000Z',
  expires_at: '2026-06-04T00:02:11.000Z',
  worker_public_key_id: workerPublicKeyId,
  worker_signature_alg: 'Ed25519',
  payload: { type: 'agent.status' },
};
const signedWorkerIdentityEnvelope = {
  ...workerIdentityEnvelope,
  worker_signature: signDetached(
    null,
    Buffer.from(bridgeSigningPayload(workerIdentityEnvelope)),
    workerPrivateKeyObject
  ).toString('base64url'),
};
assert.equal(
  verifyWorkerBridgeEnvelope(signedWorkerIdentityEnvelope, {
    workerPublicKey,
    workerPublicKeyId,
  }).ok,
  true
);
const sessionAcceptedEnvelope = {
  ...signedWorkerIdentityEnvelope,
  kind: 'session_accepted',
  payload: {
    agent_id: 'default',
    worker_public_key: workerPublicKey,
    worker_public_key_id: workerPublicKeyId,
  },
};
sessionAcceptedEnvelope.worker_signature = signDetached(
  null,
  Buffer.from(bridgeSigningPayload(sessionAcceptedEnvelope)),
  workerPrivateKeyObject
).toString('base64url');
assert.equal(verifyWorkerBridgeEnvelope(sessionAcceptedEnvelope).ok, true);
const missingWorkerSignature = verifyWorkerBridgeEnvelope(workerCommand, {
  workerPublicKey,
  workerPublicKeyId,
});
assert.equal(missingWorkerSignature.ok, false);
assert.equal(missingWorkerSignature.code, 'BRIDGE_WORKER_SIGNATURE_REQUIRED');
const tamperedWorkerSignature = verifyWorkerBridgeEnvelope(
  {
    ...signedWorkerIdentityEnvelope,
    payload: { type: 'agent.dispatch' },
  },
  {
    workerPublicKey,
    workerPublicKeyId,
  }
);
assert.equal(tamperedWorkerSignature.ok, false);
assert.equal(tamperedWorkerSignature.code, 'BRIDGE_WORKER_SIGNATURE_INVALID');
const mismatchedWorkerSignature = verifyWorkerBridgeEnvelope(signedWorkerIdentityEnvelope, {
  workerPublicKey,
  workerPublicKeyId: 'worker_kid_other',
});
assert.equal(mismatchedWorkerSignature.ok, false);
assert.equal(mismatchedWorkerSignature.code, 'BRIDGE_WORKER_PUBLIC_KEY_MISMATCH');
assert.equal(
  validateBridgeEnvelopeTiming(workerCommand, {
    nowMs: Date.parse('2026-06-04T00:00:30.000Z'),
    requireExpiresAt: true,
  }).ok,
  true
);
const missingCommandExpiry = validateBridgeEnvelopeTiming(
  { ...workerCommand, expires_at: undefined },
  {
    nowMs: Date.parse('2026-06-04T00:00:30.000Z'),
    requireExpiresAt: true,
  }
);
assert.equal(missingCommandExpiry.ok, false);
assert.equal(missingCommandExpiry.code, 'BRIDGE_EXPIRES_AT_REQUIRED');
const expiredCommand = validateBridgeEnvelopeTiming(workerCommand, {
  nowMs: Date.parse('2026-06-04T00:03:00.000Z'),
  maxClockSkewMs: 0,
  requireExpiresAt: true,
});
assert.equal(expiredCommand.ok, false);
assert.equal(expiredCommand.code, 'BRIDGE_COMMAND_EXPIRED');
const staleIssuedAt = validateBridgeEnvelopeTiming(workerCommand, {
  nowMs: Date.parse('2026-06-04T00:10:30.000Z'),
  maxClockSkewMs: 0,
  maxAgeMs: 60_000,
  requireExpiresAt: true,
});
assert.equal(staleIssuedAt.ok, false);
assert.equal(staleIssuedAt.code, 'BRIDGE_ISSUED_AT_STALE');
const tamperedCommand = {
  ...workerCommand,
  payload: { type: 'agent.dispatch' },
};
const tamperedCommandCheck = verifyDaemonBridgeEnvelope(tamperedCommand, relayTokenHash);
assert.equal(tamperedCommandCheck.ok, false);
assert.equal(tamperedCommandCheck.code, 'BRIDGE_SIGNATURE_INVALID');
const missingSignatureCheck = verifyDaemonBridgeEnvelope(
  { ...workerCommand, signature: '' },
  relayTokenHash
);
assert.equal(missingSignatureCheck.ok, false);
assert.equal(missingSignatureCheck.code, 'BRIDGE_SIGNATURE_REQUIRED');

console.log('ALL BRIDGE ENVELOPE TESTS PASS');
