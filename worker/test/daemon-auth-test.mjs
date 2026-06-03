import assert from 'node:assert/strict';
import { validateDaemonAuth, tokenFromRequest, redactToken } from '../src/daemon-auth.ts';

const withHeader = new Request('https://worker.test/api/local-agents/default/connect', {
  headers: { Authorization: 'Bearer sk_daemon_test' },
});
assert.equal(tokenFromRequest(withHeader), 'sk_daemon_test');

const withQuery = new Request('https://worker.test/api/local-agents/default/connect?token=sk_query');
assert.equal(tokenFromRequest(withQuery), 'sk_query');

const valid = validateDaemonAuth({ req: withHeader, expectedToken: 'sk_daemon_test' });
assert.equal(valid.ok, true);

const invalid = validateDaemonAuth({ req: withHeader, expectedToken: 'different' });
assert.equal(invalid.ok, false);
assert.equal(invalid.status, 401);
assert.equal(invalid.body.code, 'INVALID_DAEMON_TOKEN');

const missingConfig = validateDaemonAuth({ req: withHeader, expectedToken: undefined });
assert.equal(missingConfig.ok, false);
assert.equal(missingConfig.status, 500);
assert.equal(missingConfig.body.code, 'DAEMON_AUTH_NOT_CONFIGURED');

assert.equal(redactToken('sk_daemon_abcdef'), 'sk_dae…cdef');
