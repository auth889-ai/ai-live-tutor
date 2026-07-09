// POST /api/trace { tool, params } -> a fresh ExecutionTrace from the DETERMINISTIC engines.
// This is what makes a dry-run scene a live instrument: the student changes the input (start
// node, BFS<->DFS, fib arguments, memoization on/off) and the SAME engine that built the
// lesson re-traces instantly. No LLM in this path. Signed-in users only; recursion re-runs
// execute real code, so they require the sandbox (same rule as /api/run).

import { sessionFromRequest } from '../../../lib/auth/session.js';
import { selectRunner } from '../../../lib/execution/run-code.js';
import { retrace } from '../../../lib/execution/trace/retrace.js';

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Sign in to explore traces' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error: 'Body must be { tool, params }' }, { status: 400 });

  // Any tool that EXECUTES code (recursion tracker, pointer-walk settrace run) needs the
  // sandbox — same rule as /api/run. Traversal is a native walk, no code execution.
  if (['recursion', 'pointerwalk', 'graphwalk', 'linkedlist', 'divideconquer'].includes(body.tool) && selectRunner() === 'local') {
    return Response.json({ error: 'This retrace runs real code and needs the sandbox (set CODE_SANDBOX=docker or JUDGE0_URL)' }, { status: 503 });
  }

  try {
    const trace = await retrace({ tool: body.tool, params: body.params });
    return Response.json({ trace });
  } catch (error) {
    return Response.json({ error: String(error.message || error).slice(0, 300) }, { status: 400 });
  }
}
