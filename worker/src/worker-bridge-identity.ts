import {
  BRIDGE_WORKER_SIGNATURE_ALGORITHM,
  bridgeSigningPayload,
  signBridgeEnvelope,
} from '../../core/bridge-envelope.js';
import { DAEMON_PUBLIC_KEY_ENCODING } from '../../core/daemon-identity.js';

const encoder = new TextEncoder();

export type WorkerBridgeIdentity = {
  version: 1;
  algorithm: typeof BRIDGE_WORKER_SIGNATURE_ALGORITHM;
  public_key_encoding: typeof DAEMON_PUBLIC_KEY_ENCODING;
  key_id: string;
  public_key_spki: string;
  private_key_pkcs8: string;
  created_at: string;
};

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const text = String(value || '').trim();
  const padded = `${text}${'='.repeat((4 - (text.length % 4)) % 4)}`;
  const binary = atob(padded.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function keyIdForPublicKey(publicKeyBase64Url: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', base64UrlToBytes(publicKeyBase64Url));
  return base64UrlFromBytes(new Uint8Array(digest));
}

function normalizeWorkerBridgeIdentity(raw: unknown): WorkerBridgeIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const publicKey = String(item.public_key_spki || '');
  const privateKey = String(item.private_key_pkcs8 || '');
  const keyId = String(item.key_id || '');
  if (!publicKey || !privateKey || !keyId) return null;
  return {
    version: 1,
    algorithm: BRIDGE_WORKER_SIGNATURE_ALGORITHM,
    public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
    key_id: keyId,
    public_key_spki: publicKey,
    private_key_pkcs8: privateKey,
    created_at: String(item.created_at || new Date(0).toISOString()),
  };
}

export async function generateWorkerBridgeIdentity(
  now = new Date()
): Promise<WorkerBridgeIdentity> {
  const keyPair = (await crypto.subtle.generateKey(BRIDGE_WORKER_SIGNATURE_ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyDer = (await crypto.subtle.exportKey('spki', keyPair.publicKey)) as ArrayBuffer;
  const privateKeyDer = (await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)) as ArrayBuffer;
  const publicKey = base64UrlFromBytes(new Uint8Array(publicKeyDer));
  const privateKey = base64UrlFromBytes(new Uint8Array(privateKeyDer));
  return {
    version: 1,
    algorithm: BRIDGE_WORKER_SIGNATURE_ALGORITHM,
    public_key_encoding: DAEMON_PUBLIC_KEY_ENCODING,
    key_id: await keyIdForPublicKey(publicKey),
    public_key_spki: publicKey,
    private_key_pkcs8: privateKey,
    created_at: now instanceof Date ? now.toISOString() : new Date(now || Date.now()).toISOString(),
  };
}

export async function loadOrCreateWorkerBridgeIdentity(
  storage: DurableObjectStorage
): Promise<WorkerBridgeIdentity> {
  const current = normalizeWorkerBridgeIdentity(await storage.get('workerBridgeIdentity'));
  if (current) return current;
  const generated = await generateWorkerBridgeIdentity();
  await storage.put('workerBridgeIdentity', generated);
  return generated;
}

export async function signWorkerBridgeEnvelope(
  envelope: Record<string, unknown>,
  relayTokenHash: string | null,
  identity: WorkerBridgeIdentity
): Promise<Record<string, unknown>> {
  const unsigned = {
    ...envelope,
    worker_public_key_id: identity.key_id,
    worker_signature_alg: BRIDGE_WORKER_SIGNATURE_ALGORITHM,
  };
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    base64UrlToBytes(identity.private_key_pkcs8),
    BRIDGE_WORKER_SIGNATURE_ALGORITHM,
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    BRIDGE_WORKER_SIGNATURE_ALGORITHM,
    privateKey,
    encoder.encode(bridgeSigningPayload(unsigned))
  );
  return signBridgeEnvelope(
    {
      ...unsigned,
      worker_signature: base64UrlFromBytes(new Uint8Array(signature)),
    },
    relayTokenHash
  );
}
