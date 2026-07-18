// POST /api/notebooks/[id]/blocks/[blockId]/improve — AI-ASSISTED editing, consent-first:
// the AI proposes a clearer rewrite of the user's draft (same meaning, NO new facts) and
// returns it to the EDITOR — nothing is saved until the human reads it and presses save.
// The human stays the author; the machine is a copyeditor on a leash.

import { getNotebook } from '../../../../../../../lib/storage/notebook-store.js';
import { runAgentChain } from '../../../../../../../lib/qwen/client.js';
import { sessionFromRequest } from '../../../../../../../lib/auth/session.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const body = await request.json().catch(() => ({}));
  const draft = String(body.draft ?? '').trim();
  if (draft.length < 10) return Response.json({ error: 'nothing to improve yet' }, { status: 422 });

  const found = await getNotebook(session.userId, id);
  if (!found || !found.blocks.some((b) => b._id === blockId)) return Response.json({ error: 'not found' }, { status: 404 });

  let result;
  try {
    result = await runAgentChain({
      agent: 'notebook-copyeditor',
      system: [
        'You are a copyeditor for a student\'s own note. Rewrite it CLEARER: fix grammar, tighten wording, keep their voice and structure.',
        'HARD RULES: do not add facts, examples, or claims that are not in the draft; do not remove [[wiki links]] or [n] citations; keep roughly the same length.',
        'Return ONLY JSON: {"improved": string}.',
      ].join('\n'),
      user: `THE DRAFT:\n${draft.slice(0, 8000)}`,
      maxTokens: 1200,
      temperature: 0.2,
    });
  } catch (e) {
    return Response.json({ error: `improve failed: ${String(e.message ?? e).slice(0, 160)}` }, { status: 502 });
  }
  const improved = String((result?.json ?? result)?.improved ?? '').trim();
  // Guards: no empty output, no runaway rewrite (2.5x length = it invented content).
  if (!improved || improved.length > Math.max(400, draft.length * 2.5)) {
    return Response.json({ error: 'the rewrite failed the same-meaning guard — keeping your words' }, { status: 502 });
  }
  return Response.json({ improved });
}
