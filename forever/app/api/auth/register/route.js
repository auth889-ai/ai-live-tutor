// POST /api/auth/register { email, password } -> creates the account and signs the user in
// (session cookie set immediately, like every modern signup flow).

import { registerUser } from '../../../../lib/auth/user-store.js';
import { createSessionToken, sessionCookie } from '../../../../lib/auth/session.js';

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Body must be JSON { email, password }' }, { status: 400 });
  }
  try {
    const user = await registerUser({ email: body.email, password: body.password });
    const token = createSessionToken(user);
    return Response.json({ userId: user.userId, email: user.email }, { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } });
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400 });
  }
}
