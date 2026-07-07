// POST /api/auth/logout -> clears the session cookie.

import { clearedSessionCookie } from '../../../../lib/auth/session.js';

export async function POST() {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearedSessionCookie() } });
}
