// Stateless session tokens (pure, tested): HMAC-SHA256-signed payloads in an HttpOnly cookie —
// the iron-session pattern with node:crypto only. Token = base64url(json).base64url(hmac).
// SECURITY (Next.js CVE-2025 lesson): sessions are verified INSIDE every route/data access via
// requireUser(), never by middleware alone.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'forever_session';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function secret(env = process.env) {
  const value = env.SESSION_SECRET;
  if (!value?.trim()) throw new Error('SESSION_SECRET is not set'); // honest failure, no default key
  return value;
}

function sign(data, env) {
  return createHmac('sha256', secret(env)).update(data).digest('base64url');
}

export function createSessionToken({ userId, email }, { env = process.env, now = Date.now() } = {}) {
  const payload = Buffer.from(JSON.stringify({ userId, email, exp: now + WEEK_MS })).toString('base64url');
  return `${payload}.${sign(payload, env)}`;
}

// Returns { userId, email } or null — never throws on a bad/tampered/expired token.
export function verifySessionToken(token, { env = process.env, now = Date.now() } = {}) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  try {
    const expected = Buffer.from(sign(payload, env));
    const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.userId || session.exp < now) return null;
    return { userId: session.userId, email: session.email };
  } catch {
    return null;
  }
}

// Route-handler helper: read + verify the session from a Request's cookies.
export function sessionFromRequest(request, opts = {}) {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return match ? verifySessionToken(decodeURIComponent(match[1]), opts) : null;
}

export function sessionCookie(token) {
  // HttpOnly (no JS access), SameSite=Lax (CSRF-resistant for top-level nav), Path=/; Secure is
  // added in production where HTTPS terminates.
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK_MS / 1000}${secure}`;
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
