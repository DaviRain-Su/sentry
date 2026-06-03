import assert from 'node:assert/strict';
import {
  checkToken,
  randomToken,
  redactToken,
  sha256Hex,
  tokenFromRequest,
} from '../src/daemon-auth.ts';

const withHeader = new Request('https://worker.test/api/local-agents/default/connect', {
  headers: { Authorization: 'Bearer rt_header_test' },
});
assert.equal(tokenFromRequest(withHeader), 'rt_header_test');

const withQuery = new Request('https://worker.test/api/local-agents/default/connect?token=rt_query');
assert.equal(tokenFromRequest(withQuery), 'rt_query');

const token = randomToken('rt');
assert.match(token, /^rt_/);
const hash = await sha256Hex(token);

const valid = await checkToken({ token, expectedHash: hash, expiresAtMs: Date.now() + 1000 });
assert.equal(valid.ok, true);

const missing = await checkToken({ token: null, expectedHash: hash });
assert.equal(missing.ok, false);
assert.equal(missing.code, 'MISSING_TOKEN');

const invalid = await checkToken({ token: 'wrong', expectedHash: hash });
assert.equal(invalid.ok, false);
assert.equal(invalid.code, 'INVALID_TOKEN');

const expired = await checkToken({ token, expectedHash: hash, expiresAtMs: Date.now() - 1 });
assert.equal(expired.ok, false);
assert.equal(expired.code, 'TOKEN_EXPIRED');

const notConfigured = await checkToken({ token, expectedHash: null });
assert.equal(notConfigured.ok, false);
assert.equal(notConfigured.code, 'TOKEN_NOT_CONFIGURED');

assert.equal(redactToken('rt_daemon_abcdef'), 'rt_dae…cdef');
