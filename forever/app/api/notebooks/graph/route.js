// GET /api/notebooks/graph — the knowledge graph: one node per notebook, one edge per real
// [[link]] (blueprint law: only user-made links draw edges; AI never invents relationships).

import { knowledgeGraph } from '../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../lib/auth/session.js';

export async function GET(request) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  return Response.json(await knowledgeGraph(session.userId));
}
