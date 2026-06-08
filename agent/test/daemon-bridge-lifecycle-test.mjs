import assert from 'node:assert/strict';
import {
  isRevokedCloseEvent,
  isSessionRevokedMessage,
  shouldReconnectBridge,
} from '../src/daemon-bridge-lifecycle.mjs';

assert.equal(isSessionRevokedMessage({ kind: 'session_revoked' }), true);
assert.equal(isSessionRevokedMessage({ kind: 'session_accepted' }), false);

assert.equal(isRevokedCloseEvent({ code: 1008, reason: 'session revoked' }), true);
assert.equal(isRevokedCloseEvent({ code: 1008, reason: 'policy violation' }), false);
assert.equal(isRevokedCloseEvent({ code: 1006, reason: '' }), false);

assert.equal(
  shouldReconnectBridge({
    noReconnect: false,
    bridgeRevoked: false,
    closeEvent: { code: 1006, reason: '' },
  }),
  true
);
assert.equal(
  shouldReconnectBridge({
    noReconnect: true,
    bridgeRevoked: false,
    closeEvent: { code: 1006, reason: '' },
  }),
  false
);
assert.equal(
  shouldReconnectBridge({
    noReconnect: false,
    bridgeRevoked: true,
    closeEvent: { code: 1006, reason: '' },
  }),
  false
);
assert.equal(
  shouldReconnectBridge({
    noReconnect: false,
    bridgeRevoked: false,
    closeEvent: { code: 1008, reason: 'session revoked' },
  }),
  false
);

console.log('ALL DAEMON BRIDGE LIFECYCLE TESTS PASS');
