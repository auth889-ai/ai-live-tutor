// GET /api/auth/me -> the signed-in user ({ userId, email }) or 401. The UI uses this to decide
// between the login form and the studio.

import { sessionFromRequest } from '../../../../lib/auth/session.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Not signed in' }, { status: 401 });
  return Response.json(session);
}
