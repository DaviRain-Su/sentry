import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signDetached } from 'node:crypto';
import {
  daemonPairingProofPayload,
  daemonRelayRefreshProofPayload,
} from '../../core/daemon-identity.js';
import {
  checkToken,
  randomToken,
  relayProtocolFromRequest,
  redactToken,
  sha256Hex,
  tokenFromRequest,
} from '../src/daemon-auth.ts';
import {
  bridgeSigningPayload,
  relayTokenProtocol,
  signBridgeEnvelope,
  validateBridgeEnvelopeSequence,
  validateBridgeEnvelopeTiming,
  verifyBridgeEnvelope,
} from '../../core/bridge-envelope.js';
import {
  verifyDaemonBridgeIdentityEnvelope,
  verifyDaemonPairingProof,
  verifyDaemonRelayRefreshProof,
} from '../src/daemon-identity.ts';
import {
  generateWorkerBridgeIdentity,
  signWorkerBridgeEnvelope,
} from '../src/worker-bridge-identity.ts';

const withHeader = new Request('https://worker.test/api/local-agents/default/connect', {
  headers: { Authorization: 'Bearer rt_header_test' },
});
assert.equal(tokenFromRequest(withHeader), 'rt_header_test');

const withQuery = new Request('https://worker.test/api/local-agents/default/connect?token=rt_query');
assert.equal(tokenFromRequest(withQuery), 'rt_query');

const withProtocol = new Request('https://worker.test/api/local-agents/default/connect', {
  headers: { 'Sec-WebSocket-Protocol': `unused, ${relayTokenProtocol('rt_protocol')}` },
});
assert.equal(tokenFromRequest(withProtocol), 'rt_protocol');
assert.equal(relayProtocolFromRequest(withProtocol), relayTokenProtocol('rt_protocol'));

const token = randomToken('rt');
assert.match(token, /^rt_/);
const hash = await sha256Hex(token);

const valid = await checkToken({ token, expectedHash: hash, expiresAtMs: Date.now() + 1000 });
assert.equal(valid.ok, true);

const missing = await checkToken({ token: null, expectedHash: hash });
assert.equal(missing.ok, false);
assert.equal(missing.code, 'MISSING_TOKEN');

const invalid = await checkToken({ token: 'wrong', expectedHash: hash });
assert.equal(invalid.ok, false);
assert.equal(invalid.code, 'INVALID_TOKEN');

const expired = await checkToken({ token, expectedHash: hash, expiresAtMs: Date.now() - 1 });
assert.equal(expired.ok, false);
assert.equal(expired.code, 'TOKEN_EXPIRED');

const notConfigured = await checkToken({ token, expectedHash: null });
assert.equal(notConfigured.ok, false);
assert.equal(notConfigured.code, 'TOKEN_NOT_CONFIGURED');

const envelope = await signBridgeEnvelope(
  {
    kind: 'hello',
    message_id: 'msg_1',
    seq: 1,
    issued_at: '2026-06-04T00:00:00.000Z',
    payload: { daemon_version: '0.1.0' },
  },
  hash
);
assert.equal(typeof envelope.signature, 'string');
assert.equal((await verifyBridgeEnvelope(envelope, hash)).ok, true);
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
const tampered = { ...envelope, payload: { daemon_version: '0.2.0' } };
const tamperedCheck = await verifyBridgeEnvelope(tampered, hash);
assert.equal(tamperedCheck.ok, false);
assert.equal(tamperedCheck.code, 'BRIDGE_SIGNATURE_INVALID');
const missingSignature = await verifyBridgeEnvelope({ ...envelope, signature: '' }, hash);
assert.equal(missingSignature.ok, false);
assert.equal(missingSignature.code, 'BRIDGE_SIGNATURE_REQUIRED');

const commandEnvelope = await signBridgeEnvelope(
  {
    kind: 'command',
    message_id: 'cmd_1',
    seq: 2,
    issued_at: '2026-06-04T00:00:01.000Z',
    expires_at: '2026-06-04T00:02:01.000Z',
    payload: { type: 'agent.status' },
  },
  hash
);
assert.equal(
  validateBridgeEnvelopeTiming(commandEnvelope, {
    nowMs: Date.parse('2026-06-04T00:00:30.000Z'),
    requireExpiresAt: true,
  }).ok,
  true
);
const commandWithoutExpiry = validateBridgeEnvelopeTiming(
  { ...commandEnvelope, expires_at: undefined },
  {
    nowMs: Date.parse('2026-06-04T00:00:30.000Z'),
    requireExpiresAt: true,
  }
);
assert.equal(commandWithoutExpiry.ok, false);
assert.equal(commandWithoutExpiry.code, 'BRIDGE_EXPIRES_AT_REQUIRED');
const expiredCommand = validateBridgeEnvelopeTiming(commandEnvelope, {
  nowMs: Date.parse('2026-06-04T00:03:00.000Z'),
  maxClockSkewMs: 0,
  requireExpiresAt: true,
});
assert.equal(expiredCommand.ok, false);
assert.equal(expiredCommand.code, 'BRIDGE_COMMAND_EXPIRED');

const workerIdentity = await generateWorkerBridgeIdentity(
  new Date('2026-06-04T00:00:00.000Z')
);
const workerIdentityCommand = await signWorkerBridgeEnvelope(
  {
    kind: 'command',
    message_id: 'cmd_worker_identity_1',
    seq: 3,
    issued_at: '2026-06-04T00:00:02.000Z',
    expires_at: '2026-06-04T00:02:02.000Z',
    payload: { type: 'agent.status' },
  },
  hash,
  workerIdentity
);
assert.equal(workerIdentityCommand.worker_public_key_id, workerIdentity.key_id);
assert.equal(workerIdentityCommand.worker_signature_alg, 'Ed25519');
assert.equal(typeof workerIdentityCommand.worker_signature, 'string');
assert.equal((await verifyBridgeEnvelope(workerIdentityCommand, hash)).ok, true);
const tamperedWorkerIdentityCommand = await verifyBridgeEnvelope(
  {
    ...workerIdentityCommand,
    payload: { type: 'agent.dispatch' },
  },
  hash
);
assert.equal(tamperedWorkerIdentityCommand.ok, false);
assert.equal(tamperedWorkerIdentityCommand.code, 'BRIDGE_SIGNATURE_INVALID');

const { publicKey: pairingPublicKey, privateKey: pairingPrivateKey } =
  generateKeyPairSync('ed25519');
const agentPublicKey = Buffer.from(
  pairingPublicKey.export({ type: 'spki', format: 'der' })
).toString('base64url');
const pairingProofIssuedAt = '2026-06-04T00:00:00.000Z';
const pairingProofPayload = {
  pairing_code: 'pair_test',
  agent_id: 'default',
  device_name: 'test-daemon',
  agent_public_key: agentPublicKey,
  issued_at: pairingProofIssuedAt,
  supported_capabilities: ['agent.status', 'agent.dispatch'],
};
const signedNonce = signDetached(
  null,
  Buffer.from(daemonPairingProofPayload(pairingProofPayload)),
  pairingPrivateKey
).toString('base64url');
const pairingProof = await verifyDaemonPairingProof(
  {
    pairing_code: 'pair_test',
    agent_id: 'default',
    device_name: 'test-daemon',
    supported_capabilities: ['agent.dispatch', 'agent.status'],
    agent_public_key: agentPublicKey,
    agent_public_key_alg: 'Ed25519',
    agent_public_key_encoding: 'spki-der-base64url',
    pairing_proof_issued_at: pairingProofIssuedAt,
    signed_nonce: signedNonce,
  },
  { nowMs: Date.parse('2026-06-04T00:01:00.000Z') }
);
assert.equal(pairingProof.ok, true);
assert.equal(pairingProof.agent_public_key, agentPublicKey);

const tamperedPairingProof = await verifyDaemonPairingProof(
  {
    pairing_code: 'pair_test',
    agent_id: 'default',
    device_name: 'other-daemon',
    supported_capabilities: ['agent.dispatch', 'agent.status'],
    agent_public_key: agentPublicKey,
    agent_public_key_alg: 'Ed25519',
    agent_public_key_encoding: 'spki-der-base64url',
    pairing_proof_issued_at: pairingProofIssuedAt,
    signed_nonce: signedNonce,
  },
  { nowMs: Date.parse('2026-06-04T00:01:00.000Z') }
);
assert.equal(tamperedPairingProof.ok, false);
assert.equal(tamperedPairingProof.code, 'PAIRING_PROOF_INVALID');

const stalePairingProof = await verifyDaemonPairingProof(
  {
    pairing_code: 'pair_test',
    agent_id: 'default',
    device_name: 'test-daemon',
    supported_capabilities: ['agent.dispatch', 'agent.status'],
    agent_public_key: agentPublicKey,
    agent_public_key_alg: 'Ed25519',
    agent_public_key_encoding: 'spki-der-base64url',
    pairing_proof_issued_at: pairingProofIssuedAt,
    signed_nonce: signedNonce,
  },
  { nowMs: Date.parse('2026-06-04T00:10:00.000Z') }
);
assert.equal(stalePairingProof.ok, false);
assert.equal(stalePairingProof.code, 'PAIRING_PROOF_STALE');

const refreshProofIssuedAt = '2026-06-04T00:03:00.000Z';
const refreshProofPayload = {
  agent_id: 'default',
  agent_public_key: agentPublicKey,
  challenge_id: 'rtc_test',
  challenge: 'rch_test',
  issued_at: refreshProofIssuedAt,
};
const signedRefreshNonce = signDetached(
  null,
  Buffer.from(daemonRelayRefreshProofPayload(refreshProofPayload)),
  pairingPrivateKey
).toString('base64url');
const refreshProof = await verifyDaemonRelayRefreshProof(
  {
    challenge_id: 'rtc_test',
    challenge: 'rch_test',
    refresh_proof_issued_at: refreshProofIssuedAt,
    signed_nonce: signedRefreshNonce,
  },
  {
    agentId: 'default',
    agentPublicKey,
    nowMs: Date.parse('2026-06-04T00:04:00.000Z'),
  }
);
assert.equal(refreshProof.ok, true);
assert.equal(refreshProof.proof_issued_at, refreshProofIssuedAt);

const tamperedRefreshProof = await verifyDaemonRelayRefreshProof(
  {
    challenge_id: 'rtc_test',
    challenge: 'rch_other',
    refresh_proof_issued_at: refreshProofIssuedAt,
    signed_nonce: signedRefreshNonce,
  },
  {
    agentId: 'default',
    agentPublicKey,
    nowMs: Date.parse('2026-06-04T00:04:00.000Z'),
  }
);
assert.equal(tamperedRefreshProof.ok, false);
assert.equal(tamperedRefreshProof.code, 'RELAY_REFRESH_PROOF_INVALID');

const bridgeIdentityEnvelope = {
  kind: 'heartbeat',
  message_id: 'bridge_identity_1',
  seq: 3,
  issued_at: '2026-06-04T00:04:00.000Z',
  agent_public_key_id: 'kid_test',
  agent_signature_alg: 'Ed25519',
  payload: {
    daemon_version: '0.1.0',
    target_venue_ids: ['solana-mainnet', 'ethereum-mainnet', 'hyperliquid', 'okx'],
  },
};
const signedBridgeIdentityEnvelope = {
  ...bridgeIdentityEnvelope,
  agent_signature: signDetached(
    null,
    Buffer.from(bridgeSigningPayload(bridgeIdentityEnvelope)),
    pairingPrivateKey
  ).toString('base64url'),
};
const bridgeIdentityProof = await verifyDaemonBridgeIdentityEnvelope(
  signedBridgeIdentityEnvelope,
  {
    agentPublicKey,
    agentPublicKeyId: 'kid_test',
  }
);
assert.equal(bridgeIdentityProof.ok, true);
assert.equal(bridgeIdentityProof.agent_public_key_id, 'kid_test');

const missingBridgeIdentityProof = await verifyDaemonBridgeIdentityEnvelope(
  { ...signedBridgeIdentityEnvelope, agent_signature: '' },
  {
    agentPublicKey,
    agentPublicKeyId: 'kid_test',
  }
);
assert.equal(missingBridgeIdentityProof.ok, false);
assert.equal(missingBridgeIdentityProof.code, 'BRIDGE_AGENT_SIGNATURE_REQUIRED');

const mismatchedBridgeIdentityProof = await verifyDaemonBridgeIdentityEnvelope(
  signedBridgeIdentityEnvelope,
  {
    agentPublicKey,
    agentPublicKeyId: 'kid_other',
  }
);
assert.equal(mismatchedBridgeIdentityProof.ok, false);
assert.equal(mismatchedBridgeIdentityProof.code, 'BRIDGE_AGENT_PUBLIC_KEY_MISMATCH');

const tamperedBridgeIdentityProof = await verifyDaemonBridgeIdentityEnvelope(
  {
    ...signedBridgeIdentityEnvelope,
    payload: { ...signedBridgeIdentityEnvelope.payload, target_venue_ids: ['okx'] },
  },
  {
    agentPublicKey,
    agentPublicKeyId: 'kid_test',
  }
);
assert.equal(tamperedBridgeIdentityProof.ok, false);
assert.equal(tamperedBridgeIdentityProof.code, 'BRIDGE_AGENT_SIGNATURE_INVALID');

const staleRefreshProof = await verifyDaemonRelayRefreshProof(
  {
    challenge_id: 'rtc_test',
    challenge: 'rch_test',
    refresh_proof_issued_at: refreshProofIssuedAt,
    signed_nonce: signedRefreshNonce,
  },
  {
    agentId: 'default',
    agentPublicKey,
    nowMs: Date.parse('2026-06-04T00:12:00.000Z'),
  }
);
assert.equal(staleRefreshProof.ok, false);
assert.equal(staleRefreshProof.code, 'RELAY_REFRESH_PROOF_STALE');

assert.equal(redactToken('rt_daemon_abcdef'), 'rt_dae…cdef');
