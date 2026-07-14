// Board planning (one job): the Board Director plans the scene as compact object STUBS —
// a tiny contract it rarely misses. Content comes later, one focused call per stub.
// The stub shape is enforced by a Zod schema through LangChain structured output
// (function-calling mode — the only structured method DashScope supports).

import { z } from 'zod';

import { HINT_GUIDES } from './hint-guides.js';

const PLAN_SCHEMA = z.object({
  objects: z.array(z.object({
    id: z.string(),
    renderHint: z.string(),
    region: z.string(),
    purpose: z.string(),
  })).min(1),
});

export async function planBoard({ sourcePack, regions, brief, imageIndex, call }) {
  const system = `You are the Board Director of an AI tutor. PLAN the board for ONE teaching scene — as compact object stubs only (content comes later, one call per object).
Output ONLY JSON: {"objects":[{"id","renderHint","region","purpose"}]}
- 2 to 5 stubs: a short title first, then the teaching content objects.
- renderHint ∈ ${Object.keys(HINT_GUIDES).join('/')}: pick the RIGHT form for the idea —
  "chart" for curves/quantities · "manipulable" when the core idea IS "what happens when X
  changes" (the student drags the parameter and the curve recomputes — one per lesson, on the
  scene where the cause-effect lives) · "diagram" for processes/structures/interactions ·
  "table" for comparisons · "math" for formulas/derivations · "image" to teach FROM an
  available source figure · "quiz" for a checkpoint · "callout" for a mistake/insight ·
  "text"/"list" sparingly.
- SOURCE FIGURES FIRST (non-negotiable when availableImages is non-empty): if a source
  figure/page covers this scene's idea, plan an "image" stub teaching FROM it — the
  document's REAL diagram always beats one you would draw. Draw your own diagram/chart
  ONLY for ideas no available figure shows.${brief?.focusFigureIds?.length ? `
- THIS SCENE'S ASSIGNED FIGURES (the Teacher requires them on the board — plan an "image"
  stub for EACH): ${brief.focusFigureIds.join(', ')}` : ''}${brief?.pedagogicalRole === 'practice' ? `
- This is a PRACTICE scene: it MUST include a "quiz" stub.` : ''}
- regions: ${Object.entries(regions).map(([name, region]) => `${name} (${region.role})`).join(' · ')}
- "purpose": ONE sentence saying exactly what this object must show, with the concrete example/values to use.${brief ? `\nTHIS SCENE (${brief.pedagogicalRole ?? 'scene'}): ${brief.title} — ${brief.directive}` : ''}`;
  const user = JSON.stringify({
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
    availableImages: imageIndex.available,
  });
  const { json, usage } = await call({ agent: 'board_director', system, user, maxTokens: 2000, schema: PLAN_SCHEMA });
  const stubs = (Array.isArray(json.objects) ? json.objects : [])
    .filter((stub) => stub && typeof stub === 'object' && HINT_GUIDES[stub.renderHint] && stub.purpose)
    .slice(0, 6);
  if (stubs.length === 0) throw new Error('Board plan produced no usable object stubs');
  return { stubs, usage };
}
