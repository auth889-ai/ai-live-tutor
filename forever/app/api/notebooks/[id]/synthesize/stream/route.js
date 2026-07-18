// GET /api/notebooks/[id]/synthesize/stream — the SANKOFA ARC on the notebook, honestly:
// every status event is a real pipeline stage (no fake theater), every section is written by
// its own grounded model call and streamed the moment it exists, citations validated per
// section, and the finished note lands back in the notebook as an ai-provenance block.
// SSE events: status {stage,...} · plan {title, headings} · section {heading, markdown}
//             · rejected {heading, reason} · done {blockId} · error {message}
// mode=ask&question=... turns it into eva's follow-up: one grounded answer section.

import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

import { getNotebook, addBlock, getBlockVectors } from '../../../../../../lib/storage/notebook-store.js';
import { buildSynthesisGraph } from '../../../../../../lib/notebook/synthesis-graph.js';
import { embedTexts, cosine } from '../../../../../../lib/qwen/embeddings.js';
import { sessionFromRequest } from '../../../../../../lib/auth/session.js';

export const dynamic = 'force-dynamic';

// One generation per notebook at a time (eva's 409 pattern): in-process lock with stale
// release — a crashed stream can never wedge a notebook for more than 10 minutes.
const generating = new Map();

const MODES = {
  study_note: 'a tight STUDY NOTE',
  detailed: 'a DETAILED DEEP-DIVE: thorough explanations, worked reasoning, and every example the sources contain',
  summary: 'a faithful SUMMARY (nothing added)',
  questions: 'SELF-TEST QUESTIONS with answers',
  ask: 'a direct ANSWER to the user\'s question',
  continue: 'a CONTINUATION of the user\'s own draft — extend their thinking in their direction',
};
// Length discipline (redesign spec): sections must be scannable, never essays.
const LIMITS = {
  study_note: 'STRICT LENGTH: 80-140 words for this section. No repetition.',
  detailed: 'STRICT LENGTH: 280-450 words for this section. No repetition.',
  summary: 'STRICT LENGTH: 30-60 words for this section.',
  questions: 'QUESTIONS AND SHORT ANSWERS ONLY — no essay prose.',
  ask: 'STRICT LENGTH: at most 150 words.',
  continue: 'STRICT LENGTH: 100-200 words.',
};
// One source of heading truth (redesign spec): the section body must never re-state its title.
function stripDuplicateHeading(title, md) {
  const norm = (x) => String(x).replace(/^#+\s*/, '').trim().toLowerCase();
  const lines = String(md).split('\n');
  while (lines.length && (norm(lines[0]) === norm(title) || lines[0].trim() === '')) lines.shift();
  return lines.join('\n').trim();
}

export async function GET(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  const mode = MODES[url.searchParams.get('mode')] ? url.searchParams.get('mode') : 'study_note';
  const isDraft = url.searchParams.get('draft') === '1';
  const question = String(url.searchParams.get('question') ?? '').slice(0, 500);

  const startedAt = generating.get(id);
  if (startedAt && Date.now() - startedAt < 3 * 60 * 1000) {
    return Response.json({ error: 'this notebook is already generating — wait for it to finish' }, { status: 409 });
  }
  generating.set(id, Date.now());
  // closing the tab mid-run must free the notebook — a stuck lock read as "no output"
  request.signal?.addEventListener?.('abort', () => generating.delete(id));

  const found = await getNotebook(session.userId, id);
  if (!found) { generating.delete(id); return Response.json({ error: 'not found' }, { status: 404 }); }
  const TEXTY = (b) => ['note', 'text', 'voice', 'link', 'pdf', 'moment', 'image'].includes(b.type) && (b.content || b.transcript);
  const selectedIds = String(url.searchParams.get('blocks') ?? '').split(',').filter(Boolean);
  const focusId = url.searchParams.get('focus');
  // USER-AIMED synthesis (never "random topics"): when blocks are selected, ONLY they are the
  // material; a focus block becomes the explicit subject and everything else is context.
  let material = found.blocks.filter(TEXTY);
  if (selectedIds.length) {
    const chosen = material.filter((b) => selectedIds.includes(b._id));
    if (chosen.length) material = chosen;
  }
  if (material.length === 0) { generating.delete(id); return Response.json({ error: 'the selected blocks hold no text to work from' }, { status: 422 }); }
  const focus = focusId ? material.find((b) => b._id === focusId) ?? found.blocks.find((b) => b._id === focusId && TEXTY(b)) : null;
  if (focus && !material.some((b) => b._id === focus._id)) material = [focus, ...material];
  // RETRIEVAL (RAG-lite, deterministic): when there is a query (a question or a focus block),
  // rank blocks by term overlap and keep only the relevant top-K — the writer never sees
  // unrelated material, so it cannot wander onto it.
  const queryText = question || (focus ? `${focus.title ?? ''} ${focus.transcript ?? ''} ${focus.content ?? ''}` : '');
  if (queryText.trim() && !selectedIds.length) {
    // SEMANTIC retrieval first: cosine over each block's stored text-embedding-v4 vector —
    // meaning-based, so "how do I know an edge is critical?" finds the bridge blocks even
    // with zero shared words. Lexical overlap remains the fallback for unembedded blocks.
    let ranked = null;
    try {
      const vectors = await getBlockVectors(session.userId, id);
      const withVec = material.filter((b) => vectors.has(b._id));
      if (withVec.length >= 2) {
        const [qv] = await embedTexts([queryText]);
        if (qv) ranked = withVec.map((b) => ({ b, hit: cosine(qv, vectors.get(b._id)) })).filter((x) => x.hit > 0.25);
      }
    } catch { /* fall back to lexical */ }
    if (!ranked) {
      const terms = (t) => new Set(String(t ?? '').toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []);
      const queryTerms = terms(queryText);
      ranked = material.map((b) => {
        const bt = terms(`${b.title ?? ''} ${b.transcript ?? ''} ${b.content ?? ''}`);
        let hit = 0;
        for (const w of queryTerms) if (bt.has(w)) hit += 1;
        return { b, hit };
      }).filter((x) => x.hit > 0);
    }
    material = ranked.sort((a, z) => z.hit - a.hit).slice(0, 10).map((x) => x.b);
    if (focus && !material.some((b) => b._id === focus._id)) material.unshift(focus);
    if (material.length === 0) material = focus ? [focus] : found.blocks.filter(TEXTY).slice(0, 10);
  }

  // per-block budget: a focused run on 1-2 blocks deserves the WHOLE block (a pasted
  // lecture transcript is 20k chars — slicing it to 2.5k made block-scoped AI useless)
  const perBlockCap = material.length <= 2 ? 20000 : 2500;
  // Sankofa's beat law (eva narrative_planner.py): a huge single block becomes numbered
  // PARTS cut at line boundaries, so the planner plans across the WHOLE lecture and each
  // section quotes its own beat — the note grows with the material.
  if (material.length <= 2) {
    const exploded = [];
    for (const b of material) {
      const text = String(b.content ?? b.transcript ?? '');
      if (text.length > 9000) {
        const lines = text.split('\n');
        const nParts = Math.min(4, Math.ceil(text.length / 7000));
        const per = Math.ceil(lines.length / nParts);
        for (let k = 0; k < nParts; k += 1) {
          exploded.push({ ...b, title: `${b.title ?? b.type} — part ${k + 1}/${nParts}`, content: lines.slice(k * per, (k + 1) * per).join('\n'), attachments: k === 0 ? b.attachments : [] });
        }
      } else exploded.push(b);
    }
    if (exploded.length > material.length) material = exploded;
  }
  const sectionRange = material.length >= 3 && found.blocks.length !== material.length ? '5 to 8' : null;
  const numbered = material.slice(0, 40).map((b, i) => {
    let body = (['voice', 'moment'].includes(b.type) ? [b.transcript, b.content].filter(Boolean).join(' — ') : b.content) ?? '';
    for (const att of (b.attachments ?? []).slice(0, 5)) {
      if (att.content) body += `\n[attached ${att.kind}${att.title ? ` — ${att.title}` : ''}]: ${att.content.slice(0, 1000)}`;
    }
    const focusTag = focus && b._id === focus._id ? ' ★FOCUS' : '';
    return `[${i + 1}] (${b.type}${b.title ? ` — ${b.title}` : ''}${focusTag}) ${body.slice(0, perBlockCap)}`;
  }).join('\n\n');
  const intent = String(found.notebook?.intent ?? '').slice(0, 300);
  let AIM = intent ? `THE USER'S GOAL for this notebook: "${intent}" — aim every heading and sentence at it. ` : '';
  if (focus) AIM += `THE SUBJECT is the ★FOCUS block — explain ITS content in depth; every section must be about it; other blocks are supporting context only. `;
  const GROUND = 'HARD RULES: only facts from the numbered blocks — never outside knowledge; cite like [2] after the sentence each fact supports; omit what the blocks do not cover. Output ONLY JSON.';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send('status', { stage: 'reading', blocks: material.length });
        const draftBlock = mode === 'continue' && url.searchParams.get('blockId')
          ? found.blocks.find((b) => b._id === url.searchParams.get('blockId')) : null;
        if (mode === 'continue' && !draftBlock?.content) throw new Error('continue needs one of your own blocks');

        // THE MULTI-AGENT GRAPH: planner -> evidence gate -> parallel writers -> reviewer.
        const graph = buildSynthesisGraph();
        const corpus = material.map((b) => `${b.title ?? ''} ${b.transcript ?? ''} ${b.content ?? ''}`).join(' ').toLowerCase().replace(/\s+/g, ' ');
        const finalState = await graph.invoke({
          numbered, corpus, materialCount: material.length,
          mode, modeText: MODES[mode], limits: LIMITS[mode], aim: AIM, question, draftBlock, sectionRange,
          emit: send,
        }, { recursionLimit: 20 });

        const kept = finalState.withImages ?? [];
        if (kept.length === 0) throw new Error('every section failed the gates — nothing was saved');
        const allRefs = [...new Set(kept.flatMap((k) => k.refs))].sort((a, b) => a - b);
        // belt+braces: a section body must never re-carry its own heading into the note
        const deHead = (heading, md) => String(md).split('\n')
          .filter((ln, i) => !(i < 3 && ln.replace(/^#+\s*/, '').trim().toLowerCase() === String(heading).trim().toLowerCase()))
          .join('\n').trim();
        const markdown = kept.map((k) => `## ${k.heading}\n${k.imageUrl ? `![${k.heading}](${k.imageUrl})\n` : ''}${deHead(k.heading, k.markdown)}`).join('\n\n');
        const title = finalState.planTitle ?? 'Study note';
        if (isDraft) {
          send('done', { draft: { title, markdown: `${markdown}\n\n— grounded in your blocks: ${allRefs.map((n) => `[${n}]`).join(' ')}`, mode } });
          return;
        }
        const block = await addBlock({
          userId: session.userId,
          notebookId: id,
          type: 'note',
          title: `✨ ${title}`,
          content: `${markdown}\n\n— grounded in your blocks: ${allRefs.map((n) => `[${n}]`).join(' ')}`,
          source: 'generated',
          trust: 'ai',
          origin: mode === 'ask' ? `answer · from ${material.length} blocks` : mode === 'continue' ? 'AI continuation of your note — your words untouched' : `synthesized from ${material.length} block${material.length === 1 ? '' : 's'}`,
        });
        send('done', { blockId: block?._id ?? null });
      } catch (e) {
        send('error', { message: String(e?.message ?? e).slice(0, 200) });
      } finally {
        generating.delete(id);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
