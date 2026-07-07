import assert from 'node:assert/strict';
import test from 'node:test';

import { hashPassword, verifyPassword } from '../../lib/auth/password.js';
import { createSessionToken, verifySessionToken, sessionFromRequest, SESSION_COOKIE } from '../../lib/auth/session.js';

const env = { SESSION_SECRET: 'test-secret-for-unit-tests' };

// --- passwords ---

test('a password verifies against its own hash and nothing else', () => {
  const stored = hashPassword('correct horse battery');
  assert.ok(verifyPassword('correct horse battery', stored));
  assert.ok(!verifyPassword('wrong password!', stored));
});

test('short passwords are rejected at hashing time', () => {
  assert.throws(() => hashPassword('short'), /at least 8 characters/);
});

test('two hashes of the same password differ (unique salt)', () => {
  assert.notEqual(hashPassword('correct horse battery'), hashPassword('correct horse battery'));
});

// --- sessions ---

test('a session token round-trips and carries the user', () => {
  const token = createSessionToken({ userId: 'user_1', email: 'a@b.co' }, { env });
  const session = verifySessionToken(token, { env });
  assert.deepEqual(session, { userId: 'user_1', email: 'a@b.co' });
});

test('a tampered token is rejected', () => {
  const token = createSessionToken({ userId: 'user_1', email: 'a@b.co' }, { env });
  const [payload] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ userId: 'user_2', email: 'evil@x.co', exp: Date.now() + 1e7 })).toString('base64url');
  assert.equal(verifySessionToken(`${forged}.${token.split('.')[1]}`, { env }), null);
  assert.equal(verifySessionToken(`${payload}.AAAA`, { env }), null);
});

test('an expired token is rejected', () => {
  const past = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const token = createSessionToken({ userId: 'user_1', email: 'a@b.co' }, { env, now: past });
  assert.equal(verifySessionToken(token, { env }), null);
});

test('a token signed with a different secret is rejected', () => {
  const token = createSessionToken({ userId: 'user_1', email: 'a@b.co' }, { env: { SESSION_SECRET: 'other-secret' } });
  assert.equal(verifySessionToken(token, { env }), null);
});

test('sessionFromRequest reads the cookie; absent/garbage cookies yield null', () => {
  const token = createSessionToken({ userId: 'user_1', email: 'a@b.co' }, { env });
  const request = new Request('http://test', { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` } });
  assert.equal(sessionFromRequest(request, { env }).userId, 'user_1');
  assert.equal(sessionFromRequest(new Request('http://test'), { env }), null);
  assert.equal(sessionFromRequest(new Request('http://test', { headers: { cookie: `${SESSION_COOKIE}=garbage` } }), { env }), null);
});
