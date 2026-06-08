import assert from 'node:assert/strict';
import {
  LOCAL_AGENT_DIRECTORY_LIMIT,
  LOCAL_AGENT_DIRECTORY_NAME,
  markDirectoryEntryRevoked,
  sanitizeDirectoryEntry,
  upsertDirectoryEntry,
} from '../src/agent-session-directory.ts';

assert.equal(LOCAL_AGENT_DIRECTORY_NAME, 'directory:local-agents');
assert.equal(LOCAL_AGENT_DIRECTORY_LIMIT, 64);

const entry = sanitizeDirectoryEntry({
  agent_id: 'default',
  owner: 'dashboard',
  device_name: 'local-daemon',
  agent_public_key_id: 'key_1',
  paired_at: '2026-06-03T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
});
assert.deepEqual(entry, {
  agent_id: 'default',
  owner: 'dashboard',
  device_name: 'local-daemon',
  agent_public_key_id: 'key_1',
  paired_at: '2026-06-03T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
  revoked_at: null,
});

assert.throws(() => sanitizeDirectoryEntry({ owner: 'dashboard' }), /agent_id required/);

const first = upsertDirectoryEntry([], entry);
assert.equal(first.length, 1);
assert.equal(first[0].agent_id, 'default');

const replaced = upsertDirectoryEntry(first, {
  ...entry,
  device_name: 'macbook',
  updated_at: '2026-06-03T00:01:00.000Z',
});
assert.equal(replaced.length, 1);
assert.equal(replaced[0].device_name, 'macbook');

const limited = upsertDirectoryEntry(
  Array.from({ length: 3 }, (_, index) => ({
    agent_id: `agent_${index}`,
    owner: null,
    device_name: null,
    agent_public_key_id: null,
    paired_at: null,
    updated_at: `2026-06-03T00:00:0${index}.000Z`,
    revoked_at: null,
  })),
  {
    agent_id: 'new_agent',
    updated_at: '2026-06-03T00:02:00.000Z',
  },
  3
);
assert.deepEqual(
  limited.map((item) => item.agent_id),
  ['new_agent', 'agent_0', 'agent_1']
);

const revoked = markDirectoryEntryRevoked(
  replaced,
  'default',
  '2026-06-03T00:03:00.000Z'
);
assert.equal(revoked[0].revoked_at, '2026-06-03T00:03:00.000Z');
assert.equal(revoked[0].updated_at, '2026-06-03T00:03:00.000Z');

console.log('ALL AGENT SESSION DIRECTORY TESTS PASS');
