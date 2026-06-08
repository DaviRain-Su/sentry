import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bridgeSequenceStoreKey,
  loadBridgeSequenceState,
  saveBridgeSequenceState,
} from '../src/bridge-sequence-store.mjs';

const dir = await mkdtemp(path.join(tmpdir(), 'sentry-bridge-seq-'));
const storePath = path.join(dir, 'bridge-sequences.json');
const relayTokenHash = 'a'.repeat(64);
const relayTokenKey = bridgeSequenceStoreKey(relayTokenHash);

assert.match(relayTokenKey, /^[a-f0-9]{64}$/);
assert.notEqual(relayTokenKey, relayTokenHash);

const missing = await loadBridgeSequenceState({ storePath, relayTokenHash });
assert.equal(missing.status, 'missing');
assert.equal(missing.outbound_seq, 0);
assert.equal(missing.inbound_seq, 0);

const saved = await saveBridgeSequenceState(
  { relayTokenHash, outboundSeq: 7, inboundSeq: 3 },
  { storePath }
);
assert.equal(saved.status, 'ok');
assert.equal(saved.outbound_seq, 7);
assert.equal(saved.inbound_seq, 3);

const lowered = await saveBridgeSequenceState(
  { relayTokenHash, outboundSeq: 2, inboundSeq: 1 },
  { storePath }
);
assert.equal(lowered.outbound_seq, 7);
assert.equal(lowered.inbound_seq, 3);

const raised = await saveBridgeSequenceState(
  { relayTokenHash, outboundSeq: 8, inboundSeq: 9 },
  { storePath }
);
assert.equal(raised.outbound_seq, 8);
assert.equal(raised.inbound_seq, 9);

const loaded = await loadBridgeSequenceState({ storePath, relayTokenHash });
assert.equal(loaded.status, 'ok');
assert.equal(loaded.outbound_seq, 8);
assert.equal(loaded.inbound_seq, 9);

const text = await readFile(storePath, 'utf8');
assert.equal(text.includes(relayTokenHash), false);
assert.equal(text.includes(relayTokenKey), true);

const disabled = await loadBridgeSequenceState({ storePath, relayTokenHash: 'not-a-hash' });
assert.equal(disabled.status, 'disabled');
assert.equal(disabled.code, 'BRIDGE_SEQUENCE_KEY_REQUIRED');

console.log('ALL BRIDGE SEQUENCE STORE TESTS PASS');
