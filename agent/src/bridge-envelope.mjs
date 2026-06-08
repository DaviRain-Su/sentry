import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as signDetached,
  timingSafeEqual,
  verify as verifyDetached,
} from 'node:crypto';
import {
  BRIDGE_AGENT_SIGNATURE_ALGORITHM,
  BRIDGE_WORKER_SIGNATURE_ALGORITHM,
  bridgeSigningPayload,
  relayTokenProtocol,
  validateBridgeEnvelopeSequence,
  validateBridgeEnvelopeTiming,
} from '../../core/bridge-envelope.js';

export { relayTokenProtocol };
export { validateBridgeEnvelopeSequence };
export { validateBridgeEnvelopeTiming };

export function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function signDaemonIdentityEnvelope(envelope, identity) {
  if (!identity?.private_key_pkcs8 || !identity?.key_id) return { ...envelope };
  const unsigned = {
    ...envelope,
    agent_public_key_id: identity.key_id,
    agent_signature_alg: BRIDGE_AGENT_SIGNATURE_ALGORITHM,
  };
  const privateKey = createPrivateKey({
    key: fromBase64Url(identity.private_key_pkcs8),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    ...unsigned,
    agent_signature: signDetached(
      null,
      Buffer.from(bridgeSigningPayload(unsigned)),
      privateKey
    ).toString('base64url'),
  };
}

export function signDaemonBridgeEnvelope(envelope, relayTokenHash, identity = null) {
  const identitySigned = signDaemonIdentityEnvelope(envelope, identity);
  if (!relayTokenHash) return identitySigned;
  return {
    ...identitySigned,
    signature: createHmac('sha256', relayTokenHash)
      .update(bridgeSigningPayload(identitySigned))
      .digest('base64url'),
  };
}

export function verifyDaemonBridgeEnvelope(envelope, relayTokenHash) {
  if (!relayTokenHash) {
    return {
      ok: false,
      code: 'BRIDGE_SIGNATURE_NOT_CONFIGURED',
      message: 'Bridge signature key is not configured for this session.',
    };
  }
  if (!envelope || typeof envelope !== 'object' || !envelope.signature) {
    return {
      ok: false,
      code: 'BRIDGE_SIGNATURE_REQUIRED',
      message: 'Signed bridge envelope required.',
    };
  }
  const signed = signDaemonBridgeEnvelope(envelope, relayTokenHash);
  const actual = Buffer.from(String(envelope.signature));
  const expected = Buffer.from(String(signed.signature));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return {
      ok: false,
      code: 'BRIDGE_SIGNATURE_INVALID',
      message: 'Bridge envelope signature is invalid.',
    };
  }
  return { ok: true };
}

export function verifyWorkerBridgeEnvelope(
  envelope,
  { workerPublicKey = null, workerPublicKeyId = null } = {}
) {
  const publicKey = String(workerPublicKey || envelope?.payload?.worker_public_key || '');
  const expectedKeyId = String(workerPublicKeyId || envelope?.payload?.worker_public_key_id || '');
  const keyId = String(envelope?.worker_public_key_id || '');
  const signatureAlg = String(envelope?.worker_signature_alg || '');
  const signature = String(envelope?.worker_signature || '');

  if (!publicKey) {
    return {
      ok: false,
      code: 'BRIDGE_WORKER_PUBLIC_KEY_REQUIRED',
      message: 'Worker-origin bridge envelope requires a Worker public key before verification.',
    };
  }
  if (!keyId || !signatureAlg || !signature) {
    return {
      ok: false,
      code: 'BRIDGE_WORKER_SIGNATURE_REQUIRED',
      message:
        'Worker-origin bridge envelope requires worker_public_key_id, worker_signature_alg and worker_signature.',
    };
  }
  if (signatureAlg !== BRIDGE_WORKER_SIGNATURE_ALGORITHM) {
    return {
      ok: false,
      code: 'BRIDGE_WORKER_SIGNATURE_UNSUPPORTED',
      message: 'Worker-origin bridge envelope requires an Ed25519 Worker signature.',
    };
  }
  if (expectedKeyId && keyId !== expectedKeyId) {
    return {
      ok: false,
      code: 'BRIDGE_WORKER_PUBLIC_KEY_MISMATCH',
      message: 'Worker-origin bridge envelope key id does not match the accepted Worker identity.',
    };
  }

  try {
    const key = createPublicKey({
      key: fromBase64Url(publicKey),
      format: 'der',
      type: 'spki',
    });
    const ok = verifyDetached(
      null,
      Buffer.from(bridgeSigningPayload(envelope)),
      key,
      fromBase64Url(signature)
    );
    if (!ok) {
      return {
        ok: false,
        code: 'BRIDGE_WORKER_SIGNATURE_INVALID',
        message: 'Worker-origin bridge envelope signature is invalid.',
      };
    }
    return { ok: true, worker_public_key: publicKey, worker_public_key_id: keyId };
  } catch (error) {
    return {
      ok: false,
      code: 'BRIDGE_WORKER_SIGNATURE_VERIFY_FAILED',
      message: error?.message || String(error),
    };
  }
}
