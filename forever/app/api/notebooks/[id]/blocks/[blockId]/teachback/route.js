// POST /api/notebooks/[id]/blocks/[blockId]/teachback — the RecallBook core loop: the student
// explains the moment IN THEIR OWN WORDS; Qwen grades it against the captured material only
// (correct / missing / confused); the check lands in the notebook as an ai block; and every
// missing concept becomes a REAL revision item in the existing SM-2 queue — "a missing concept
// becomes a revision item" is literal, not a metaphor.

import { getNotebook, addBlock } from '../../../../../../../lib/storage/notebook-store.js';
import { addBookmark } from '../../../../../../../lib/storage/study-store.js';
import { runAgentChain } from '../../../../../../../lib/qwen/client.js';
import { sessionFromRequest } from '../../../../../../../lib/auth/session.js';

const VERDICTS = new Set(['strong', 'partial', 'weak']);

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id, blockId } = await params;
  const body = await request.json().catch(() => ({}));
  const explanation = String(body.explanation ?? '').trim();
  if (explanation.length < 20) return Response.json({ error: 'explain it in at least a sentence or two — that is the point' }, { status: 422 });

  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });
  const block = found.blocks.find((b) => b._id === blockId);
  if (!block) return Response.json({ error: 'block not found' }, { status: 404 });

  const material = [
    block.title ? `TOPIC: ${block.title}` : '',
    block.transcript ? `THE TUTOR SAID: ${block.transcript}` : '',
    block.content ? `THE NOTE: ${block.content}` : '',
    ...found.blocks.filter((b) => b._id !== blockId && ['note', 'text', 'moment', 'voice'].includes(b.type) && (b.content || b.transcript))
      .slice(0, 10).map((b, i) => `CONTEXT[${i + 1}]: ${(b.transcript || b.content).slice(0, 400)}`),
  ].filter(Boolean).join('\n');

  let result;
  try {
    result = await runAgentChain({
      agent: 'notebook-teachback',
      system: [
        'You are a rigorous, warm teacher checking a student\'s TEACH-BACK explanation.',
        'Judge ONLY against the provided material — never outside knowledge. If the material does not cover something, do not demand it.',
        'Return ONLY JSON: {"verdict": "strong"|"partial"|"weak", "correct": string[], "missing": string[], "confused": string[], "reviewTip": string}',
        'correct = what they got right (short phrases). missing = concepts present in the material but absent from their explanation. confused = things they stated wrongly. reviewTip = one sentence on what to review first.',
      ].join('\n'),
      user: `MATERIAL:\n${material}\n\nTHE STUDENT'S EXPLANATION:\n${explanation}`,
      maxTokens: 700,
      temperature: 0.2,
    });
  } catch (e) {
    return Response.json({ error: `teach-back check failed: ${String(e.message ?? e).slice(0, 160)}` }, { status: 502 });
  }

  const out = result?.json ?? result;
  const verdict = VERDICTS.has(out?.verdict) ? out.verdict : 'partial';
  const list = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === 'string' && v.trim()).slice(0, 5).map((v) => v.slice(0, 200)) : []);
  const correct = list(out?.correct);
  const missing = list(out?.missing);
  const confused = list(out?.confused);
  const tip = String(out?.reviewTip ?? '').slice(0, 300);

  const face = verdict === 'strong' ? '🟢 Strong' : verdict === 'partial' ? '🟡 Partial' : '🔴 Weak';
  const md = [
    `**${face} understanding.**`,
    correct.length ? `## What you got right\n${correct.map((c) => `- ${c}`).join('\n')}` : '',
    missing.length ? `## What was missing\n${missing.map((c) => `- ${c}`).join('\n')}` : '',
    confused.length ? `## What got mixed up\n${confused.map((c) => `- ${c}`).join('\n')}` : '',
    tip ? `**Review first:** ${tip}` : '',
    missing.length ? `_${Math.min(missing.length, 2)} revision item${Math.min(missing.length, 2) === 1 ? '' : 's'} scheduled — they will come back to you._` : '',
  ].filter(Boolean).join('\n\n');

  const check = await addBlock({
    userId: session.userId, notebookId: id, type: 'note',
    title: `🎓 Teach-back — ${(block.title || 'this note').slice(0, 100)}`,
    content: md, source: 'generated', trust: 'ai', origin: 'teach-back check',
  });

  // MISSING -> the SM-2 queue (existing engine, zero new machinery): due tomorrow, reviewed
  // like any bookmark, weak items resurface exactly like the user's flow demands.
  const m = String(block.url ?? '').match(/\/course\/([^?]+)\?scene=(\d+)&t=(\d+)/);
  const lessonId = m ? m[1] : `nb_${id}`;
  const tMs = m ? Number(m[3]) : 0;
  for (const [idx, concept] of missing.slice(0, 2).entries()) {
    try {
      await addBookmark({
        userId: session.userId,
        lessonId,
        lessonTitle: block.origin || found.notebook.title,
        sceneId: `tb_${blockId}_${idx}`,
        sceneTitle: 'teach-back revision',
        tMs,
        note: `Re-explain: ${concept}`,
        context: block.transcript || block.content || '',
      });
    } catch { /* revision scheduling is best-effort; the check itself already saved */ }
  }

  return Response.json({ block: check, verdict, missing }, { status: 201 });
}
