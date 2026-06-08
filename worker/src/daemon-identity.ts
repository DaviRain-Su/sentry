import {
  BRIDGE_AGENT_SIGNATURE_ALGORITHM,
  bridgeSigningPayload,
} from '../../core/bridge-envelope.js';
import {
  DAEMON_IDENTITY_ALGORITHM,
  DAEMON_PUBLIC_KEY_ENCODING,
  daemonPairingProofPayload,
  daemonRelayRefreshProofPayload,
} from '../../core/daemon-identity.js';

const encoder = new TextEncoder();
const MAX_PAIRING_PROOF_AGE_MS = 5 * 60_000;
const MAX_PAIRING_PROOF_CLOCK_SKEW_MS = 120_000;

type PairingProofFailure = {
  ok: false;
  code: string;
  message: string;
};

type PairingProofSuccess = {
  ok: true;
  agent_public_key: string;
  agent_public_key_alg: string;
  agent_public_key_encoding: string;
  agent_public_key_id: string | null;
  pairing_proof_issued_at: string;
};

export type PairingProofResult = PairingProofFailure | PairingProofSuccess;
export type RelayRefreshProofResult = PairingProofFailure | { ok: true; proof_issued_at: string };
export type BridgeIdentityEnvelopeResult =
  | PairingProofFailure
  | { ok: true; agent_public_key_id: string | null };

function failure(code: string, message: string): PairingProofFailure {
  return { ok: false, code, message };
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const text = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const padded = `${text}${'='.repeat((4 - (text.length % 4)) % 4)}`;
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function proofTimingOk(
  issuedAt: string,
  nowMs = Date.now(),
  options: {
    codePrefix?: string;
    timestampField?: string;
    proofLabel?: string;
  } = {}
) {
  const codePrefix = options.codePrefix || 'PAIRING_PROOF';
  const timestampField = options.timestampField || 'pairing_proof_issued_at';
  const proofLabel = options.proofLabel || 'Pairing proof';
  const issuedAtMs = Date.parse(String(issuedAt || ''));
  if (!Number.isFinite(issuedAtMs)) {
    return failure(
      `${codePrefix}_ISSUED_AT_REQUIRED`,
      `${timestampField} must be a valid timestamp.`
    );
  }
  if (issuedAtMs > nowMs + MAX_PAIRING_PROOF_CLOCK_SKEW_MS) {
    return failure(`${codePrefix}_IN_FUTURE`, `${proofLabel} timestamp is too far in the future.`);
  }
  if (nowMs - issuedAtMs > MAX_PAIRING_PROOF_AGE_MS + MAX_PAIRING_PROOF_CLOCK_SKEW_MS) {
    return failure(`${codePrefix}_STALE`, `${proofLabel} timestamp is too old.`);
  }
  return { ok: true as const };
}

export async function verifyDaemonPairingProof(
  body: Record<string, any>,
  options: { nowMs?: number } = {}
): Promise<PairingProofResult> {
  const publicKey = String(body.agent_public_key || '');
  const signedNonce = String(body.signed_nonce || '');
  const issuedAt = String(body.pairing_proof_issued_at || '');
  const algorithm = String(body.agent_public_key_alg || DAEMON_IDENTITY_ALGORITHM);
  const encoding = String(body.agent_public_key_encoding || DAEMON_PUBLIC_KEY_ENCODING);
  if (!publicKey || !signedNonce || !issuedAt) {
    return failure(
      'PAIRING_PROOF_REQUIRED',
      'agent_public_key, pairing_proof_issued_at and signed_nonce are required.'
    );
  }
  if (algorithm !== DAEMON_IDENTITY_ALGORITHM || encoding !== DAEMON_PUBLIC_KEY_ENCODING) {
    return failure(
      'PAIRING_PROOF_UNSUPPORTED_KEY',
      'Pairing proof requires an Ed25519 SPKI public key.'
    );
  }
  const timing = proofTimingOk(issuedAt, options.nowMs);
  if (!timing.ok) return timing;

  const publicKeyBytes = base64UrlToBytes(publicKey);
  const signatureBytes = base64UrlToBytes(signedNonce);
  if (!publicKeyBytes || !signatureBytes) {
    return failure(
      'PAIRING_PROOF_BAD_ENCODING',
      'Pairing proof public key or signature is not base64url encoded.'
    );
  }

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      DAEMON_IDENTITY_ALGORITHM,
      false,
      ['verify']
    );
    const payload = daemonPairingProofPayload({
      pairing_code: body.pairing_code,
      agent_id: body.agent_id,
      device_name: body.device_name,
      agent_public_key: publicKey,
      issued_at: issuedAt,
      supported_capabilities: body.supported_capabilities,
    });
    const ok = await crypto.subtle.verify(
      DAEMON_IDENTITY_ALGORITHM,
      key,
      signatureBytes,
      encoder.encode(payload)
    );
    if (!ok) {
      return failure('PAIRING_PROOF_INVALID', 'Pairing proof signature is invalid.');
    }
    return {
      ok: true,
      agent_public_key: publicKey,
      agent_public_key_alg: algorithm,
      agent_public_key_encoding: encoding,
      agent_public_key_id: body.agent_public_key_id || null,
      pairing_proof_issued_at: issuedAt,
    };
  } catch (error) {
    return failure('PAIRING_PROOF_VERIFY_FAILED', (error as Error).message || String(error));
  }
}

export async function verifyDaemonRelayRefreshProof(
  body: Record<string, any>,
  options: {
    agentId: string;
    agentPublicKey: string;
    nowMs?: number;
  }
): Promise<RelayRefreshProofResult> {
  const publicKey = String(options.agentPublicKey || '');
  const signedNonce = String(body.signed_nonce || '');
  const issuedAt = String(body.refresh_proof_issued_at || '');
  const challengeId = String(body.challenge_id || '');
  const challenge = String(body.challenge || '');
  if (!publicKey || !signedNonce || !issuedAt || !challengeId || !challenge) {
    return failure(
      'RELAY_REFRESH_PROOF_REQUIRED',
      'challenge_id, challenge, refresh_proof_issued_at and signed_nonce are required.'
    );
  }
  const timing = proofTimingOk(issuedAt, options.nowMs, {
    codePrefix: 'RELAY_REFRESH_PROOF',
    timestampField: 'refresh_proof_issued_at',
    proofLabel: 'Relay refresh proof',
  });
  if (!timing.ok) return timing;
  const publicKeyBytes = base64UrlToBytes(publicKey);
  const signatureBytes = base64UrlToBytes(signedNonce);
  if (!publicKeyBytes || !signatureBytes) {
    return failure(
      'RELAY_REFRESH_PROOF_BAD_ENCODING',
      'Relay refresh proof public key or signature is not base64url encoded.'
    );
  }
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      DAEMON_IDENTITY_ALGORITHM,
      false,
      ['verify']
    );
    const payload = daemonRelayRefreshProofPayload({
      agent_id: options.agentId,
      agent_public_key: publicKey,
      challenge_id: challengeId,
      challenge,
      issued_at: issuedAt,
    });
    const ok = await crypto.subtle.verify(
      DAEMON_IDENTITY_ALGORITHM,
      key,
      signatureBytes,
      encoder.encode(payload)
    );
    if (!ok) {
      return failure('RELAY_REFRESH_PROOF_INVALID', 'Relay refresh proof signature is invalid.');
    }
    return { ok: true, proof_issued_at: issuedAt };
  } catch (error) {
    return failure('RELAY_REFRESH_PROOF_VERIFY_FAILED', (error as Error).message || String(error));
  }
}

export async function verifyDaemonBridgeIdentityEnvelope(
  envelope: Record<string, any>,
  options: {
    agentPublicKey?: string | null;
    agentPublicKeyId?: string | null;
  } = {}
): Promise<BridgeIdentityEnvelopeResult> {
  const publicKey = String(options.agentPublicKey || '');
  if (!publicKey) return { ok: true, agent_public_key_id: null };

  const signature = String(envelope?.agent_signature || '');
  const signatureAlg = String(envelope?.agent_signature_alg || '');
  const keyId = String(envelope?.agent_public_key_id || '');
  const expectedKeyId = String(options.agentPublicKeyId || '');
  if (!signature || !signatureAlg || !keyId) {
    return failure(
      'BRIDGE_AGENT_SIGNATURE_REQUIRED',
      'Daemon-origin bridge envelope requires agent_public_key_id, agent_signature_alg and agent_signature.'
    );
  }
  if (signatureAlg !== BRIDGE_AGENT_SIGNATURE_ALGORITHM) {
    return failure(
      'BRIDGE_AGENT_SIGNATURE_UNSUPPORTED',
      'Daemon-origin bridge envelope requires an Ed25519 agent signature.'
    );
  }
  if (expectedKeyId && keyId !== expectedKeyId) {
    return failure(
      'BRIDGE_AGENT_PUBLIC_KEY_MISMATCH',
      'Daemon-origin bridge envelope key id does not match the paired daemon identity.'
    );
  }

  const publicKeyBytes = base64UrlToBytes(publicKey);
  const signatureBytes = base64UrlToBytes(signature);
  if (!publicKeyBytes || !signatureBytes) {
    return failure(
      'BRIDGE_AGENT_SIGNATURE_BAD_ENCODING',
      'Daemon-origin bridge public key or signature is not base64url encoded.'
    );
  }

  try {
    const key = await crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      DAEMON_IDENTITY_ALGORITHM,
      false,
      ['verify']
    );
    const ok = await crypto.subtle.verify(
      DAEMON_IDENTITY_ALGORITHM,
      key,
      signatureBytes,
      encoder.encode(bridgeSigningPayload(envelope))
    );
    if (!ok) {
      return failure(
        'BRIDGE_AGENT_SIGNATURE_INVALID',
        'Daemon-origin bridge envelope signature is invalid.'
      );
    }
    return { ok: true, agent_public_key_id: keyId };
  } catch (error) {
    return failure(
      'BRIDGE_AGENT_SIGNATURE_VERIFY_FAILED',
      (error as Error).message || String(error)
    );
  }
}
