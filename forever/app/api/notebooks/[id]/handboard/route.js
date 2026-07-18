// POST /api/notebooks/[id]/handboard — AI plans a handwritten-style note board from the
// user's OWN blocks (grounded, numbered material), the HandBoard engine renders it.
// Same law as everywhere: the model proposes structure, deterministic code disposes.

import { getNotebook, addBlock } from '../../../../../lib/storage/notebook-store.js';
import { sessionFromRequest } from '../../../../../lib/auth/session.js';
import { runAgentChain } from '../../../../../lib/qwen/client.js';
import { bumpDay } from '../../../../../lib/storage/study-store.js';

export async function POST(request, { params }) {
  const session = sessionFromRequest(request);
  if (!session?.userId) return Response.json({ error: 'sign in first' }, { status: 401 });
  const { id } = await params;
  const found = await getNotebook(session.userId, id);
  if (!found) return Response.json({ error: 'notebook not found' }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const page = String(body.page ?? 'Notes').slice(0, 80);

  const wantIds = Array.isArray(body.blockIds) ? new Set(body.blockIds.map(String)) : null;
  let texty = found.blocks.filter((b) => b.origin !== 'page-ink' && String(b.content ?? b.transcript ?? '').trim());
  if (wantIds) texty = texty.filter((b) => wantIds.has(String(b._id)));
  if (texty.length === 0) return Response.json({ error: 'add some material first' }, { status: 400 });
  // a board about ONE block reads the WHOLE block (transcripts are 20k chars)
  const cap = texty.length <= 2 ? 18000 : 900;
  const numbered = texty.slice(0, 40).map((b, i) => `[${i + 1}] ${String(b.title ?? '').slice(0, 80)}\n${String(b.content ?? b.transcript ?? '').slice(0, cap)}`).join('\n\n');

  // Sankofa's law (eva narrative_planner.py): huge text -> beats -> one artifact per
  // beat, each writer seeing only its own slice, cut at line boundaries (_cap_context).
  const full = texty.length === 1 ? String(texty[0].content ?? texty[0].transcript ?? '') : null;
  const parts = [];
  if (full && full.length > 9000) {
    const lines = full.split('\n');
    const per = Math.ceil(lines.length / Math.min(3, Math.ceil(full.length / 9000)));
    for (let i = 0; i < lines.length; i += per) parts.push(lines.slice(i, i + per).join('\n'));
  }
  if (parts.length > 1) {
    const blocks = [];
    for (let i = 0; i < parts.length; i += 1) {
      const partOut = await runAgentChain({
        agent: 'notebook-handboard-planner',
        system: `You design ONE handwritten whiteboard note from PART ${i + 1} of ${parts.length} of a lecture. Return ONLY JSON {"title": string, "sections": [{"heading": string, "para": string (optional, <=200 chars), "bullets": [string] (optional, <=6, each <=70 chars)}], "marks": [{"term": string, "color": "yellow"|"orange"|"blue"|"purple"|"green"|"pink"}], "diagrams": [{"type": "graph", "caption": string, "nodes": [{"label": string (<=3 chars)}], "edges": [[label, label]]}]} — 2-3 sections about THIS PART only. HARD RULES: only facts from the text. Output ONLY JSON.`,
        user: `PART ${i + 1}/${parts.length}:\n\n${parts[i].slice(0, 12000)}`,
        maxTokens: 900,
        temperature: 0.3,
      });
      const ps = partOut?.json ?? partOut;
      if (!ps?.title || !Array.isArray(ps.sections) || ps.sections.length === 0) continue;
      blocks.push(await addBlock({
        userId: session.userId, notebookId: id, type: 'handboard',
        content: JSON.stringify(ps), source: 'generated', trust: 'ai',
        title: `${String(ps.title).slice(0, 100)} · board ${i + 1}/${parts.length}`, page,
      }));
    }
    if (blocks.length === 0) return Response.json({ error: 'no part produced a usable board — try again' }, { status: 502 });
    await bumpDay(session.userId, 'notebook').catch(() => {});
    return Response.json({ blocks, partCount: parts.length }, { status: 201 });
  }

  const out = await runAgentChain({
    agent: 'notebook-handboard-planner',
    system: `You design ONE handwritten whiteboard note from the user's source blocks — like a student's beautiful marker-and-pen board. Return ONLY JSON:
{"title": string, "sections": [{"heading": string, "para": string (optional, <=200 chars), "bullets": [string] (optional, <=6, each <=70 chars)}], "marks": [{"term": string, "color": "yellow"|"orange"|"blue"|"purple"|"green"|"pink"}], "diagrams": [{"type": "graph", "caption": string, "nodes": [{"label": string (<=3 chars)}], "edges": [[label, label]]}]}
2-4 sections. marks = 3-6 KEY TERMS that literally appear in your sections' text, each a different color. 1-2 diagrams only if the material is genuinely about connected structures (graphs, trees, networks) — nodes/edges must reflect the material, never invented examples. HARD RULES: only facts from the numbered blocks, never outside knowledge. Output ONLY JSON.`,
    user: `MY SOURCE BLOCKS:\n\n${numbered.slice(0, 19000)}`,
    maxTokens: 900,
    temperature: 0.3,
  });
  const spec = out?.json ?? out;
  if (!spec?.title || !Array.isArray(spec.sections) || spec.sections.length === 0) {
    return Response.json({ error: 'the board planner returned no usable board — try again' }, { status: 502 });
  }
  const block = await addBlock({
    userId: session.userId, notebookId: id, type: 'handboard',
    content: JSON.stringify(spec), source: 'generated', trust: 'ai',
    title: String(spec.title).slice(0, 120), page,
  });
  await bumpDay(session.userId, 'notebook').catch(() => {});
  return Response.json({ block }, { status: 201 });
}
