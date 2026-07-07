// POST /api/run { language, source } -> { stdout, stderr, timedOut, exitCode }
// The student's OWN code, really executed in the same Docker sandbox the tutor uses
// (no network, hard timeout). Signed-in users only — compute costs real resources.

import { sessionFromRequest } from '../../../lib/auth/session.js';
import { runCode, selectRunner } from '../../../lib/execution/run-code.js';
import { validateRunRequest } from '../../../lib/execution/run-request.js';

export async function POST(request) {
  const session = sessionFromRequest(request);
  if (!session) return Response.json({ error: 'Sign in to run code' }, { status: 401 });

  // STUDENT code is untrusted: it only ever runs in an ISOLATED tier (Judge0/Docker).
  // The local-subprocess dev tier is for tutor-generated snippets, never for this route.
  if (selectRunner() === 'local') {
    return Response.json({ error: 'Code runner is not available: no sandbox configured (set CODE_SANDBOX=docker or JUDGE0_URL)' }, { status: 503 });
  }

  let input;
  try {
    input = validateRunRequest(await request.json().catch(() => null));
  } catch (error) {
    return Response.json({ error: String(error.message || error) }, { status: 400 });
  }

  try {
    const run = await runCode({ language: input.language, source: input.source, timeoutMs: 8000 });
    return Response.json({
      stdout: (run.stdout ?? '').slice(0, 20_000),
      stderr: (run.stderr ?? '').slice(0, 8_000),
      timedOut: run.timedOut === true,
      exitCode: run.exitCode ?? null,
    });
  } catch (error) {
    return Response.json({ error: `Could not run: ${String(error.message || error).slice(0, 300)}` }, { status: 500 });
  }
}
