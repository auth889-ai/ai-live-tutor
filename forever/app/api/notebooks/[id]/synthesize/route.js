// /api/notebooks/[id]/synthesize — the notebook MAKES SOMETHING from your inputs, inside
// itself (the eva pattern: input seeds -> generated typed blocks; the NotebookLM law: AI
// output grounded ONLY in your sources, with citations). Qwen writes a study note from the
// notebook's blocks; a deterministic validator rejects citations pointing at nothing; the
// result lands back IN the notebook as a block with trust: 'ai' — provenance never lies.
// Course generation stays a separate, secondary action (/generate). A notebook is not a course.

import { getNotebook, addBlock } from '../../../../../lib/storage/notebook-store.js';
import { runAgentChain } from '../../../../../lib/qwen/client.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';

const MODES = {
  study_note: 'a tight STUDY NOTE: the key ideas organized under short headings, each point in plain teaching language',
  summary: 'a faithful SUMMARY: what these sources say, condensed, nothing added',
  questions: 'a set of 6-10 SELF-TEST QUESTIONS with answers, each answerable from the sources alone',
};

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const mode = MODES[body.mode] ? body.mode : 'study_note';

  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });
  const material = found.blocks.filter((b) => ['note', 'text', 'voice', 'link', 'pdf'].includes(b.type) && (b.content || b.transcript));
  if (material.length === 0) return Response.json({ error: 'add a few blocks first — the synthesizer only speaks from YOUR sources' }, { status: 422 });

  // Number the sources exactly as the citations must reference them.
  const numbered = material.slice(0, 40).map((b, i) => {
    const body_ = (b.type === 'voice' ? (b.transcript || b.content) : b.content) ?? '';
    return `[${i + 1}] (${b.type}${b.title ? ` — ${b.title}` : ''}) ${body_.slice(0, 1500)}`;
  }).join('\n\n');

  let result;
  try {
    result = await runAgentChain({
      agent: 'notebook-synthesizer',
      system: [
        'You are the Notebook Synthesizer for forever, an AI tutor. You will receive the user\'s own numbered source blocks.',
        `Produce ${MODES[mode]}.`,
        'HARD RULES: every claim must come from the numbered blocks — never outside knowledge; cite blocks inline like [2] after the sentence they support; if the blocks do not cover something, do not mention it.',
        'Return ONLY JSON: {"title": string, "markdown": string, "cited": int[]} where cited lists every block number you used.',
      ].join('\n'),
      user: `MY SOURCE BLOCKS:\n\n${numbered}`,
      maxTokens: 2500,
      temperature: 0.3,
    });
  } catch (e) {
    return Response.json({ error: `synthesis failed: ${String(e.message ?? e).slice(0, 160)}` }, { status: 502 });
  }

  const out = result?.json ?? result;
  const title = String(out?.title ?? '').slice(0, 200) || 'Study note';
  const markdown = String(out?.markdown ?? '').trim();
  const cited = Array.isArray(out?.cited) ? out.cited.filter((n) => Number.isInteger(n) && n >= 1 && n <= material.length) : [];
  // Deterministic gate: no text, or citations pointing at nothing -> the note does not ship.
  const inlineRefs = [...markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  if (!markdown || inlineRefs.some((n) => n < 1 || n > material.length)) {
    return Response.json({ error: 'the synthesizer cited sources that do not exist — refused (nothing was saved)' }, { status: 502 });
  }

  const block = await addBlock({
    userId: session.userId,
    notebookId: id,
    type: 'note',
    title: `✨ ${title}`,
    content: `${markdown}\n\n— grounded in your blocks: ${[...new Set([...cited, ...inlineRefs])].sort((a, b) => a - b).map((n) => `[${n}]`).join(' ')}`,
    source: 'generated',
    trust: 'ai',
    origin: `synthesized from ${material.length} block${material.length === 1 ? '' : 's'}`,
  });
  return Response.json({ block }, { status: 201 });
}
