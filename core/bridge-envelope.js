const encoder = new TextEncoder();

export const RELAY_TOKEN_PROTOCOL_PREFIX = 'sentry-rt.';
export const BRIDGE_AGENT_SIGNATURE_ALGORITHM = 'Ed25519';
export const BRIDGE_WORKER_SIGNATURE_ALGORITHM = 'Ed25519';

const BRIDGE_SIGNATURE_FIELDS = new Set(['signature', 'agent_signature', 'worker_signature']);

function sortedPlainValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sortedPlainValue(item));
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !BRIDGE_SIGNATURE_FIELDS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortedPlainValue(item)])
  );
}

function base64UrlFromBytes(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function relayTokenProtocol(token) {
  return token ? `${RELAY_TOKEN_PROTOCOL_PREFIX}${token}` : null;
}

export function tokenFromProtocolHeader(header) {
  if (!header) return null;
  for (const raw of String(header).split(',')) {
    const protocol = raw.trim();
    if (protocol.startsWith(RELAY_TOKEN_PROTOCOL_PREFIX)) {
      const token = protocol.slice(RELAY_TOKEN_PROTOCOL_PREFIX.length).trim();
      if (token) return token;
    }
  }
  return null;
}

export function bridgeSigningPayload(envelope) {
  return JSON.stringify(sortedPlainValue(envelope ?? {}));
}

export function validateBridgeEnvelopeSequence(envelope, lastSeq = 0) {
  const seq = Number(envelope?.seq);
  if (!Number.isSafeInteger(seq) || seq <= 0) {
    return {
      ok: false,
      code: 'BRIDGE_SEQUENCE_REQUIRED',
      message: 'Bridge envelope requires a positive integer seq.',
    };
  }
  if (seq <= Number(lastSeq || 0)) {
    return {
      ok: false,
      code: 'BRIDGE_REPLAY_DETECTED',
      message: 'Bridge envelope seq was already observed for this live connection.',
      seq,
      last_seq: Number(lastSeq || 0),
    };
  }
  return { ok: true, seq };
}

export function validateBridgeEnvelopeTiming(
  envelope,
  {
    nowMs = Date.now(),
    maxClockSkewMs = 120_000,
    maxAgeMs = 5 * 60_000,
    requireExpiresAt = false,
  } = {}
) {
  const issuedAtMs = Date.parse(String(envelope?.issued_at || ''));
  if (!Number.isFinite(issuedAtMs)) {
    return {
      ok: false,
      code: 'BRIDGE_ISSUED_AT_REQUIRED',
      message: 'Bridge envelope requires a valid issued_at timestamp.',
    };
  }
  if (issuedAtMs > nowMs + maxClockSkewMs) {
    return {
      ok: false,
      code: 'BRIDGE_ISSUED_AT_IN_FUTURE',
      message: 'Bridge envelope issued_at is too far in the future.',
      issued_at_ms: issuedAtMs,
      now_ms: nowMs,
    };
  }
  if (nowMs - issuedAtMs > maxAgeMs + maxClockSkewMs) {
    return {
      ok: false,
      code: 'BRIDGE_ISSUED_AT_STALE',
      message: 'Bridge envelope issued_at is too old for this live connection.',
      issued_at_ms: issuedAtMs,
      now_ms: nowMs,
    };
  }

  const rawExpiresAt = envelope?.expires_at;
  if (rawExpiresAt == null || rawExpiresAt === '') {
    return requireExpiresAt
      ? {
          ok: false,
          code: 'BRIDGE_EXPIRES_AT_REQUIRED',
          message: 'Bridge command envelope requires expires_at.',
        }
      : { ok: true, issued_at_ms: issuedAtMs, expires_at_ms: null };
  }
  const expiresAtMs = Date.parse(String(rawExpiresAt));
  if (!Number.isFinite(expiresAtMs)) {
    return {
      ok: false,
      code: 'BRIDGE_EXPIRES_AT_INVALID',
      message: 'Bridge envelope expires_at is invalid.',
    };
  }
  if (nowMs > expiresAtMs + maxClockSkewMs) {
    return {
      ok: false,
      code: 'BRIDGE_COMMAND_EXPIRED',
      message: 'Bridge command envelope expired before it was processed.',
      expires_at_ms: expiresAtMs,
      now_ms: nowMs,
    };
  }
  return { ok: true, issued_at_ms: issuedAtMs, expires_at_ms: expiresAtMs };
}

export async function signBridgeEnvelope(envelope, relayTokenHash) {
  if (!relayTokenHash) return { ...envelope };
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(relayTokenHash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(bridgeSigningPayload(envelope))
  );
  return {
    ...envelope,
    signature: base64UrlFromBytes(new Uint8Array(signature)),
  };
}

export async function verifyBridgeEnvelope(envelope, relayTokenHash) {
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
  const signed = await signBridgeEnvelope(envelope, relayTokenHash);
  if (!constantTimeEqual(String(envelope.signature), String(signed.signature))) {
    return {
      ok: false,
      code: 'BRIDGE_SIGNATURE_INVALID',
      message: 'Bridge envelope signature is invalid.',
    };
  }
  return { ok: true };
}
