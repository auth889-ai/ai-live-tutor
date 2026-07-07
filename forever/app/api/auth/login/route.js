// POST /api/auth/login { email, password } -> verifies credentials, sets the session cookie.
// Wrong email and wrong password return the same 401 (no account probing).

import { authenticateUser } from '../../../../lib/auth/user-store.js';
import { createSessionToken, sessionCookie } from '../../../../lib/auth/session.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON { email, password }' }, { status: 400 });
  }
  const user = await authenticateUser({ email: body.email, password: body.password });
  if (!user) return Response.json({ error: 'Invalid email or password' }, { status: 401 });
  const token = createSessionToken(user);
  return Response.json({ userId: user.userId, email: user.email }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
