export const DAEMON_IDENTITY_ALGORITHM = 'Ed25519';
export const DAEMON_PUBLIC_KEY_ENCODING = 'spki-der-base64url';
export const DAEMON_PAIRING_PROOF_VERSION = 1;

function sortedPlainValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sortedPlainValue(item));
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortedPlainValue(item)])
  );
}

export function normalizeDaemonCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return [];
  return [...new Set(capabilities.map((item) => String(item).trim()).filter(Boolean))].sort();
}

export function daemonPairingProofPayload(input = {}) {
  return JSON.stringify(
    sortedPlainValue({
      version: DAEMON_PAIRING_PROOF_VERSION,
      algorithm: DAEMON_IDENTITY_ALGORITHM,
      public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
      pairing_code: String(input.pairing_code || ''),
      agent_id: String(input.agent_id || ''),
      device_name: String(input.device_name || ''),
      agent_public_key: String(input.agent_public_key || ''),
      issued_at: String(input.issued_at || ''),
      supported_capabilities: normalizeDaemonCapabilities(input.supported_capabilities),
    })
  );
}

export function daemonRelayRefreshProofPayload(input = {}) {
  return JSON.stringify(
    sortedPlainValue({
      version: DAEMON_PAIRING_PROOF_VERSION,
      algorithm: DAEMON_IDENTITY_ALGORITHM,
      public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
      agent_id: String(input.agent_id || ''),
      agent_public_key: String(input.agent_public_key || ''),
      challenge_id: String(input.challenge_id || ''),
      challenge: String(input.challenge || ''),
      issued_at: String(input.issued_at || ''),
    })
  );
}
