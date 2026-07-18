// GET /api/notebooks/[id]/synthesize/stream — the SANKOFA ARC on the notebook, honestly:
// every status event is a real pipeline stage (no fake theater), every section is written by
// its own grounded model call and streamed the moment it exists, citations validated per
// section, and the finished note lands back in the notebook as an ai-provenance block.
// SSE events: status {stage,...} · plan {title, headings} · section {heading, markdown}
//             · rejected {heading, reason} · done {blockId} · error {message}
// mode=ask&question=... turns it into eva's follow-up: one grounded answer section.

import { getNotebook, addBlock } from '../../../../../../lib/storage/notebook-store.js';
import { runAgentChain } from '../../../../../../lib/qwen/client.js';
import { sessionFromRequest } from '../../../../../../lib/auth/session.js';

export const dynamic = 'force-dynamic';

const MODES = {
  study_note: 'a tight STUDY NOTE',
  summary: 'a faithful SUMMARY (nothing added)',
  questions: 'SELF-TEST QUESTIONS with answers',
  ask: 'a direct ANSWER to the user\'s question',
};

export async function GET(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const mode = MODES[url.searchParams.get('mode')] ? url.searchParams.get('mode') : 'study_note';
  const question = String(url.searchParams.get('question') ?? '').slice(0, 500);

  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'not found' }, { status: 404 });
  const material = found.blocks.filter((b) => ['note', 'text', 'voice', 'link', 'pdf'].includes(b.type) && (b.content || b.transcript));
  if (material.length === 0) return Response.json({ error: 'add blocks first' }, { status: 422 });

  const numbered = material.slice(0, 40).map((b, i) => {
    const body = (b.type === 'voice' ? (b.transcript || b.content) : b.content) ?? '';
    return `[${i + 1}] (${b.type}${b.title ? ` — ${b.title}` : ''}) ${body.slice(0, 1500)}`;
  }).join('\n\n');
  const GROUND = 'HARD RULES: only facts from the numbered blocks — never outside knowledge; cite like [2] after the sentence each fact supports; omit what the blocks do not cover. Output ONLY JSON.';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send('status', { stage: 'reading', blocks: material.length });

        // ---- PLAN (eva's arc pass): sections with heading + focus, before any writing ----
        let plan;
        if (mode === 'ask' && question) {
          plan = { title: question.slice(0, 120), sections: [{ heading: 'Answer', focus: `answer: ${question}` }] };
        } else {
          send('status', { stage: 'planning' });
          const planned = await runAgentChain({
            agent: 'notebook-arc-planner',
            system: `You plan ${MODES[mode]} from the user's source blocks. Return ONLY JSON {"title": string, "sections": [{"heading": string, "focus": string}]} — 2 to 4 sections, each focus one sharp line. ${GROUND}`,
            user: `MY SOURCE BLOCKS:\n\n${numbered}`,
            maxTokens: 600,
            temperature: 0.3,
          });
          const p = planned?.json ?? planned;
          plan = { title: String(p?.title ?? 'Study note').slice(0, 200), sections: (Array.isArray(p?.sections) ? p.sections : []).slice(0, 4).filter((x) => x?.heading) };
          if (plan.sections.length === 0) throw new Error('the planner produced no sections');
        }
        send('plan', { title: plan.title, headings: plan.sections.map((x) => x.heading) });

        // ---- WRITE each section against its plan, streaming as they finish ----
        const kept = [];
        for (let i = 0; i < plan.sections.length; i += 1) {
          const sec = plan.sections[i];
          send('status', { stage: 'writing', index: i + 1, total: plan.sections.length, heading: sec.heading });
          const written = await runAgentChain({
            agent: 'notebook-section-writer',
            system: `You write ONE section of ${MODES[mode]}: "${sec.heading}" — focus: ${sec.focus}. ${question ? `The user's question: ${question}. ` : ''}Return ONLY JSON {"markdown": string, "cited": int[]}. ${GROUND}`,
            user: `MY SOURCE BLOCKS:\n\n${numbered}`,
            maxTokens: 900,
            temperature: 0.3,
          });
          const w = written?.json ?? written;
          const md = String(w?.markdown ?? '').trim();
          const refs = [...md.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
          if (!md || refs.some((n) => n < 1 || n > material.length)) {
            send('rejected', { heading: sec.heading, reason: 'cited a source that does not exist — section refused' });
            continue;
          }
          kept.push({ heading: sec.heading, markdown: md, refs });
          send('section', { heading: sec.heading, markdown: md });
        }
        if (kept.length === 0) throw new Error('every section failed the citation gate — nothing was saved');

        // ---- SAVE the assembled note as an ai block (same shape as the non-stream route) ----
        const allRefs = [...new Set(kept.flatMap((k) => k.refs))].sort((a, b) => a - b);
        const markdown = kept.map((k) => `## ${k.heading}\n${k.markdown}`).join('\n\n');
        const block = await addBlock({
          userId: session.userId,
          notebookId: id,
          type: 'note',
          title: `✨ ${plan.title}`,
          content: `${markdown}\n\n— grounded in your blocks: ${allRefs.map((n) => `[${n}]`).join(' ')}`,
          source: 'generated',
          trust: 'ai',
          origin: mode === 'ask' ? `answer · from ${material.length} blocks` : `synthesized from ${material.length} block${material.length === 1 ? '' : 's'}`,
        });
        send('done', { blockId: block?._id ?? null });
      } catch (e) {
        send('error', { message: String(e?.message ?? e).slice(0, 200) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
