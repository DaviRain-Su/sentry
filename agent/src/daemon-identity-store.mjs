import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as signDetached,
} from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  DAEMON_IDENTITY_ALGORITHM,
  DAEMON_PUBLIC_KEY_ENCODING,
  daemonPairingProofPayload,
  daemonRelayRefreshProofPayload,
} from '../../core/daemon-identity.js';

export const DEFAULT_DAEMON_IDENTITY_STORE_PATH = '~/.sentry/identity.json';

function expandHome(filePath) {
  if (!filePath || filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return path.join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveDaemonIdentityStorePath(input = process.env.SENTRY_IDENTITY_STORE) {
  return expandHome(input || DEFAULT_DAEMON_IDENTITY_STORE_PATH);
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function keyIdForPublicKey(publicKeyBase64Url) {
  return createHash('sha256').update(fromBase64Url(publicKeyBase64Url)).digest('base64url');
}

export function generateDaemonIdentity(now = new Date()) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64Url = toBase64Url(publicKey.export({ type: 'spki', format: 'der' }));
  const privateKeyBase64Url = toBase64Url(privateKey.export({ type: 'pkcs8', format: 'der' }));
  return {
    version: 1,
    algorithm: DAEMON_IDENTITY_ALGORITHM,
    public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
    key_id: keyIdForPublicKey(publicKeyBase64Url),
    public_key_spki: publicKeyBase64Url,
    private_key_pkcs8: privateKeyBase64Url,
    created_at: now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString(),
  };
}

function normalizeIdentity(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const publicKey = String(raw.public_key_spki || '');
  const privateKey = String(raw.private_key_pkcs8 || '');
  if (!publicKey || !privateKey) return null;
  return {
    version: Number(raw.version || 1),
    algorithm: raw.algorithm || DAEMON_IDENTITY_ALGORITHM,
    public_key_encoding: raw.public_key_encoding || DAEMON_PUBLIC_KEY_ENCODING,
    key_id: raw.key_id || keyIdForPublicKey(publicKey),
    public_key_spki: publicKey,
    private_key_pkcs8: privateKey,
    created_at: raw.created_at || null,
  };
}

export async function readDaemonIdentity(options = {}) {
  const storePath = resolveDaemonIdentityStorePath(options.storePath);
  try {
    const identity = normalizeIdentity(JSON.parse(await readFile(storePath, 'utf8')));
    if (!identity) {
      return {
        status: 'error',
        code: 'DAEMON_IDENTITY_INVALID',
        message: 'Daemon identity store is invalid.',
        path: storePath,
      };
    }
    return { status: 'ok', path: storePath, identity };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { status: 'missing', path: storePath, identity: null };
    }
    return {
      status: 'error',
      code: 'DAEMON_IDENTITY_READ_FAILED',
      message: error?.message || String(error),
      path: storePath,
      identity: null,
    };
  }
}

export async function writeDaemonIdentity(identity, options = {}) {
  const storePath = resolveDaemonIdentityStorePath(options.storePath);
  await mkdir(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify(identity, null, 2)}\n`;
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, storePath);
  return { status: 'ok', path: storePath, key_id: identity.key_id };
}

export async function loadOrCreateDaemonIdentity(options = {}) {
  const current = await readDaemonIdentity(options);
  if (current.status === 'ok') return current;
  if (current.status !== 'missing' && options.createIfInvalid === false) return current;
  const identity = generateDaemonIdentity(options.now);
  const write = await writeDaemonIdentity(identity, options);
  return {
    status: 'created',
    path: write.path,
    identity,
  };
}

export function signDaemonPairingProof({
  identity,
  pairingCode,
  agentId,
  deviceName,
  supportedCapabilities,
  issuedAt = new Date().toISOString(),
} = {}) {
  const payload = daemonPairingProofPayload({
    pairing_code: pairingCode,
    agent_id: agentId,
    device_name: deviceName,
    agent_public_key: identity?.public_key_spki,
    issued_at: issuedAt,
    supported_capabilities: supportedCapabilities,
  });
  const privateKey = createPrivateKey({
    key: fromBase64Url(identity?.private_key_pkcs8),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    agent_public_key: identity.public_key_spki,
    agent_public_key_alg: DAEMON_IDENTITY_ALGORITHM,
    agent_public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
    agent_public_key_id: identity.key_id,
    pairing_proof_issued_at: issuedAt,
    signed_nonce: toBase64Url(signDetached(null, Buffer.from(payload), privateKey)),
  };
}

export function signDaemonRelayRefreshProof({
  identity,
  agentId,
  challengeId,
  challenge,
  issuedAt = new Date().toISOString(),
} = {}) {
  const payload = daemonRelayRefreshProofPayload({
    agent_id: agentId,
    agent_public_key: identity?.public_key_spki,
    challenge_id: challengeId,
    challenge,
    issued_at: issuedAt,
  });
  const privateKey = createPrivateKey({
    key: fromBase64Url(identity?.private_key_pkcs8),
    format: 'der',
    type: 'pkcs8',
  });
  return {
    agent_public_key_id: identity.key_id,
    refresh_proof_issued_at: issuedAt,
    signed_nonce: toBase64Url(signDetached(null, Buffer.from(payload), privateKey)),
  };
}
