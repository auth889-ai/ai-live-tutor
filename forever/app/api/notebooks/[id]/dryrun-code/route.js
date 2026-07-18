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
    system: `You write ONE short, correct, runnable Python 3 program implementing the algorithm described in the user's material, for step-by-step visualization. Rules: plain functions (the MAIN algorithm as a top-level def, defined LAST), a small concrete example input as module-level variables, and a final top-level call of the main function on that example. THE EXAMPLE MUST EXERCISE THE ALGORITHM: pick input where the answer is NOT found in the first step — the main loop/recursion must run at least 4 iterations with visible state changes (pointers moving, cells filling, nodes visited) before finishing, or the visualization has nothing to show. No input(), no prints needed, no classes, no imports beyond typing. Under 60 lines. Return ONLY JSON {"code": string, "note": string (one line: what the example shows)}.`,
    user: `MATERIAL:\n${String(block.content ?? block.transcript ?? '').slice(0, 15000)}`,
    maxTokens: 1200,
    temperature: 0.2,
  });
  const spec = out?.json ?? out;
  if (!spec?.code || !/def /.test(spec.code)) return Response.json({ error: 'could not derive runnable code from this block' }, { status: 502 });
  // split the module-level example call into the ENTRY: the tracer records the call, so the
  // structural lenses (pointer-array, dp-table, graph...) see arguments — without it the run
  // falls to the line-floor view
  const lines = String(spec.code).split('\n');
  const defNames = new Set([...String(spec.code).matchAll(/^def\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]));
  let entry = '';
  // bottom-up: the LAST top-level call of a function DEFINED in this code is the entry —
  // prints/logging lines are dropped, everything else stays as scaffolding
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const ln = lines[i].trim();
    if (!ln || ln.startsWith('#') || lines[i].startsWith(' ')) continue;
    if (/^print\s*\(/.test(ln)) { lines.splice(i, 1); continue; }
    const m = ln.match(/^(?:[A-Za-z_]\w*\s*=\s*)?(([A-Za-z_]\w*)\(.*\))\s*$/);
    if (m && defNames.has(m[2])) { entry = m[1]; lines.splice(i, 1); break; }
  }
  return Response.json({ code: lines.join('\n').trim().slice(0, 8000), entry: entry.slice(0, 300), note: String(spec.note ?? '').slice(0, 200) });
}
