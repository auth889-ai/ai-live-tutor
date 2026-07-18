// POST /api/notebooks/[id]/dryrun-code — the engine=truth law for notebook visualizations:
// the AI only WRITES the algorithm's code for the selected block; the visualization itself
// comes from REAL execution (Pyodide + the universal recorder) in the student's browser.

import { getNotebook } from '../../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';
import { runAgentChain } from '../../../../../lib/qwen/client.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'notebook not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const block = found.blocks.find((b) => String(b._id) === String(body.blockId));
  if (!block) return Response.json({ error: 'block not found' }, { status: 404 });

  const out = await runAgentChain({
    agent: 'notebook-dryrun-coder',
    system: `You write ONE short, correct, runnable Python 3 program implementing the algorithm described in the user's material, for step-by-step visualization. Rules: plain functions (the MAIN algorithm as a top-level def, defined LAST), a small concrete example input as module-level variables, and a final top-level call of the main function on that example. No input(), no prints needed, no classes, no imports beyond typing. Under 60 lines. Return ONLY JSON {"code": string, "note": string (one line: what the example shows)}.`,
    user: `MATERIAL:\n${String(block.content ?? block.transcript ?? '').slice(0, 15000)}`,
    maxTokens: 1200,
    temperature: 0.2,
  });
  const spec = out?.json ?? out;
  if (!spec?.code || !/def /.test(spec.code)) return Response.json({ error: 'could not derive runnable code from this block' }, { status: 502 });
  return Response.json({ code: String(spec.code).slice(0, 8000), note: String(spec.note ?? '').slice(0, 200) });
}
