// Teacher agent (the deep planner). ONE job — turn a SourcePack into a real TEACHING
// SEQUENCE the way the best human teachers do (research-backed pedagogy): motivate ->
// intuition -> worked example -> dry-run/trace -> complexity -> edge cases -> recap ->
// practice. Output is an ordered list of scene briefs (role + directive + focus chunks).
// This is what makes lessons deep and long instead of a short summary.

import { z } from 'zod';

import { runAgentChain } from '../../../qwen/client.js';

export const PEDAGOGICAL_ROLES = [
  'motivate',
  'intuition',
  'worked_example',
  'dry_run',
  'visualize',
  'complexity',
  'edge_cases',
  'recap',
  'practice',
];

const PLAN_SCHEMA = z.object({
  lessonTitle: z.string(),
  scenes: z.array(z.object({
    title: z.string(),
    pedagogicalRole: z.string(),
    directive: z.string(),
    focusChunkIds: z.array(z.string()),
    focusFigureIds: z.array(z.string()).optional(),
  })).min(1),
});

export async function designPedagogy({ sourcePack, minScenes, maxScenes, domain = 'general', register = null }) {
  // Scene budget: explicit args win; else env (MIN_SCENES/MAX_SCENES — for cheap test builds);
  // else the production default. 4 is the floor that can still carry all four required beats.
  minScenes = minScenes ?? (process.env.MIN_SCENES ? Math.max(4, Number(process.env.MIN_SCENES)) : 5);
  maxScenes = maxScenes ?? (process.env.MAX_SCENES ? Math.max(minScenes, Number(process.env.MAX_SCENES)) : 9);
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));
  const { teachingFor, UNIVERSAL_TEACHING_LAW, depthFor, DEPTH_TEMPLATES } = await import('./domain-teaching.js');

  // The document's own figures, offered to the Teacher BY ID so it can assign each scene
  // the figure it should teach FROM (like focusChunkIds, but for pictures — the lever
  // that makes PDF lessons visual instead of self-drawn; live-caught: 24 figures offered
  // at board level, only 1 ever placed — assignment must happen at LESSON level).
  // EVERY figure gets planning-level coverage — captionless ones too (external audit: the
  // caption filter silently excluded them from the coverage guarantee). Fallback caption
  // keeps them plannable; ingest normally captions everything anyway.
  const figures = (sourcePack.assets ?? [])
    .filter((asset) => asset.kind === 'figure')
    .map((asset) => (asset.caption?.trim() ? asset : { ...asset, caption: `Source figure${asset.page ? ` on page ${asset.page}` : ''}` }))
    .map((asset) => ({
      figureId: asset.id,
      caption: asset.caption,
      // The figure's REAL contents (ingest vision inventory) — so the Teacher assigns each
      // figure to the scene its contents actually support, and names its parts in the
      // directive. Planning blind on captions was how the sales chart got narrated as a
      // schema diagram (live-caught 2026-07-24).
      ...(asset.whatItShows ? { whatItShows: asset.whatItShows } : {}),
      ...(asset.components?.length ? { parts: asset.components.map((c) => c.label) } : {}),
      ...(asset.page ? { page: asset.page } : {}),
    }));
  const figureIds = new Set(figures.map((figure) => figure.figureId));

  const system = `You are the Teacher of an AI tutor — a world-class SPECIALIST in this domain (${domain}).
DOMAIN TEACHING STYLE (teach exactly this way): ${register ?? teachingFor(domain)}
${depthFor(domain)}
${DEPTH_TEMPLATES}
DIRECTIVE RULE: every content scene's directive names ONE depth template (e.g. "THREE-CANDIDATES: ...")
and instructs the board accordingly — a scene that only PRESENTS information without a thinking move
is average teaching, and average is rejected.
THE UNIVERSAL LAW (non-negotiable, write directives that OBEY it): ${UNIVERSAL_TEACHING_LAW}

Design a DEEP teaching sequence: ${minScenes}-${maxScenes} scenes that TEACH, not summarize.
THE EXPLANATION SPINE (Rosenshine/DI/worked-example research — each CONTENT scene's directive walks
these moves in this order, compressed to fit the scene):
  retrieve the prerequisite in one beat -> concrete instance FIRST (the mountain before the
  coordinates — never a cold definition) -> one small step + an immediate check the student answers
  -> full worked example, every step modeled -> a MINIMALLY-DIFFERENT near-miss pair (one example,
  one non-example that differs in exactly the boundary feature — juxtapose and treat differently)
  -> a hinge check before moving on.
Follow EVIDENCE-BASED pedagogy (this is what makes it elite, not average):
1. CONCRETE BEFORE ABSTRACT — open with a specific, relatable example (real numbers / a tiny scenario),
   THEN generalize to the rule. Never state an abstract definition cold.
2. BOTTOM-UP — start with the simplest version, add ONE layer of detail per scene (chunk: one idea per scene).
3. For ALGORITHMS / CODING — teach BRUTE-FORCE first, then BETTER, then OPTIMAL, each with its complexity,
   and a step-by-step dry-run/trace on a concrete input.
4. MISCONCEPTION — include a scene that names the common mistake and why it's wrong.
5. Build intuition (the WHY) before mechanics; end with recap + a practice/retrieval scene.
5b. FADED PRACTICE (the strongest-evidenced move): after a worked example, the practice ramp is
   completion problems — the SAME problem type with the LAST step blanked for the student, then the
   last TWO steps, then a full independent problem pitched at ~80% success. Write this ramp into the
   worked_example and practice directives explicitly.
5c. THE QUESTION LADDER for practice/checkpoint scenes: L1 RECALL (a fact just taught) -> L2 APPLY
   (same structure, new surface values) -> L3 HINGE (an MCQ whose every wrong choice encodes ONE
   named misconception, so the answer diagnoses the student) -> L4 SCENARIO (an authentic situation
   with a tradeoff, dressed in a context the source never mentions; the student maps concept ->
   scenario before deciding). Quiz explanations end with a Stretch-It: "why?" or "how would it
   change if…?"
6. FIGURES ARE TEXTBOOK MATERIAL, NOT DECORATION — when you assign a figure, the scene's
   directive must command a FULL part-by-part walkthrough: name the figure's actual parts
   (use its "parts"/"whatItShows" below), what each part is, what it does, and how the parts
   connect — with teaching marks revealed in narration order. Assign a figure ONLY to a scene
   whose idea that figure genuinely shows (check whatItShows — never assign on a wish); a
   one-line mention of an assigned figure is average teaching, and average is rejected.
Output ONLY JSON:
{"lessonTitle": string,
 "scenes": [{"title": string,
             "pedagogicalRole": one of ${JSON.stringify(PEDAGOGICAL_ROLES)},
             "directive": "2-3 sentences telling the Board Director the concrete example to open with, the exact idea to teach, and what to show (trace/diagram/code) — specific, not vague",
             "focusChunkIds": [chunkId, ...],
             "focusFigureIds": [figureId, ...] (OPTIONAL — the source figures this scene teaches FROM)}]}
Rules:
- Order as a real lesson flows: concrete hook → intuition → worked example (brute→better→optimal for code) → misconception → recap → practice.
- Every focusChunkId MUST be a provided chunk id; each scene needs at least one.
- SOURCE FIGURES (when availableFigures is non-empty): the document's own diagrams are the
  strongest teaching material you have. Assign each RELEVANT figure to the scene that should
  teach from it via focusFigureIds — a scene about an idea a figure shows MUST get that
  figure. Only invented visuals may cover ideas no figure shows.
- The final scenes MUST include a recap AND a practice scene whose directive demands a QUIZ
  with concrete questions (a lesson without a checkpoint is rejected).
- Each scene teaches ONE idea well. The directive must name a CONCRETE example with real values — never "explain X in general".`;

  const user = JSON.stringify({
    task: 'Design the deep teaching sequence for this lesson.',
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
    ...(figures.length ? { availableFigures: figures } : {}),
  });

  const { json, usage } = await runAgentChain({
    agent: 'teacher',
    system,
    user,
    schema: PLAN_SCHEMA,
    model: process.env.MODEL_PLANNER || 'qwen3.7-max',
    temperature: 0.4,
    maxTokens: 3000,
  });

  const scenes = (Array.isArray(json.scenes) ? json.scenes : [])
    .map((scene) => ({
      title: String(scene.title || '').trim(),
      pedagogicalRole: PEDAGOGICAL_ROLES.includes(scene.pedagogicalRole) ? scene.pedagogicalRole : 'intuition',
      directive: String(scene.directive || '').trim(),
      focusChunkIds: (scene.focusChunkIds || []).filter((id) => chunkIds.has(id)),
      focusFigureIds: (scene.focusFigureIds || []).filter((id) => figureIds.has(id)),
    }))
    .filter((scene) => scene.title && scene.directive && scene.focusChunkIds.length > 0);

  if (scenes.length === 0) throw new Error('Teacher produced no valid scenes');

  // STRUCTURE GUARANTEES (the universal gate's "no checkpoint/no recap -> reject", enforced
  // deterministically — live-caught: a 7-scene lesson shipped with ZERO quizzes). The plan
  // is repaired structurally: content stays AI-written, the BEATS are non-negotiable.
  if (!scenes.some((scene) => scene.pedagogicalRole === 'recap')) {
    scenes.push({
      title: 'Recap — What You Now Know',
      pedagogicalRole: 'recap',
      directive: 'Summarize the lesson\'s 3-4 core ideas as a compact board (list or table), each tied to the concrete examples taught earlier. End by naming the one misconception to avoid.',
      focusChunkIds: [...chunkIds],
      focusFigureIds: [],
    });
  }
  if (!scenes.some((scene) => scene.pedagogicalRole === 'practice')) {
    scenes.push({
      title: 'Practice — Check Your Understanding',
      pedagogicalRole: 'practice',
      directive: 'Create a QUIZ checkpoint: 2-3 concrete questions with real values from this material, plausible wrong choices, and explanations that teach why the right answer is right.',
      focusChunkIds: [...chunkIds],
      focusFigureIds: [],
    });
  }
  // "No common mistake -> reject" (universal gate): every lesson names and refutes the
  // misconception (g≈0.41, the highest evidence-per-token rubric item in the research).
  if (!scenes.some((scene) => scene.pedagogicalRole === 'edge_cases' || /mistake|misconception|wrong/i.test(scene.title + scene.directive))) {
    const beforeRecap = scenes.findIndex((scene) => scene.pedagogicalRole === 'recap');
    scenes.splice(beforeRecap === -1 ? scenes.length : beforeRecap, 0, {
      title: 'The Common Mistake — And Why It Fails',
      pedagogicalRole: 'edge_cases',
      directive: 'Name the single most common misconception about this material, show a concrete case where following it produces a WRONG result (real values), then show the correct approach on the same case.',
      focusChunkIds: [...chunkIds],
      focusFigureIds: [],
    });
  }
  repairCoverage(scenes, { figures, chunkIds });
  return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes, usage };
}

// COVERAGE GUARANTEE (user requirement 2026-07-26: "it must explain ALL things from the
// user's input"): every source figure and every chunk is OWNED by some scene — enforced
// deterministically like the beat guarantees, never left to the model's attention span.
// Unassigned figures go to the scene whose story matches their caption; genuinely homeless
// figures get their own professor-at-the-wall-chart scene (capped — beyond the cap they are
// attached round-robin so NOTHING from the document is silently dropped).
const MAX_ADDED_FIGURE_SCENES = 3;
export function repairCoverage(scenes, { figures = [], chunkIds = new Set() } = {}) {
  const tokensOf = (s) => new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t.length >= 4));
  const tail = (s) => ['edge_cases', 'recap', 'practice'].includes(s.pedagogicalRole);
  const assigned = new Set(scenes.flatMap((s) => s.focusFigureIds ?? []));
  let addedScenes = 0;
  for (const figure of figures) {
    if (assigned.has(figure.figureId)) continue;
    const figTokens = tokensOf(`${figure.caption ?? ''} ${figure.whatItShows ?? ''}`);
    let best = null;
    let bestOverlap = 0;
    for (const scene of scenes) {
      if (tail(scene) || scene.coverageAdded) continue;
      const overlap = [...tokensOf(`${scene.title} ${scene.directive}`)].filter((t) => figTokens.has(t)).length;
      if (overlap > bestOverlap) { best = scene; bestOverlap = overlap; }
    }
    if (best && bestOverlap >= 1) {
      best.focusFigureIds = [...(best.focusFigureIds ?? []), figure.figureId];
      best.directive += ` ALSO place and teach the assigned source figure ("${String(figure.caption ?? '').slice(0, 80)}") part by part on this board.`;
    } else if (addedScenes < MAX_ADDED_FIGURE_SCENES) {
      addedScenes += 1;
      const at = scenes.findIndex(tail);
      scenes.splice(at === -1 ? scenes.length : at, 0, {
        coverageAdded: true,
        title: `The Figure, Explained: ${String(figure.caption ?? 'source figure').slice(0, 60)}`,
        pedagogicalRole: 'visualize',
        directive: `Teach the source figure "${String(figure.caption ?? '').slice(0, 80)}" the way a professor works a wall chart: place it, walk EVERY labeled part in order (what it is, what it does, how it connects), tie each part to the source's own words, and write your own 2-4 takeaway notes beside it.`,
        focusChunkIds: [...chunkIds],
        focusFigureIds: [figure.figureId],
      });
    } else {
      const fewest = scenes.filter((s) => !tail(s)).sort((a, b) => (a.focusFigureIds?.length ?? 0) - (b.focusFigureIds?.length ?? 0))[0];
      if (fewest) {
        fewest.focusFigureIds = [...(fewest.focusFigureIds ?? []), figure.figureId];
        fewest.directive += ` ALSO place and teach the source figure ("${String(figure.caption ?? '').slice(0, 80)}").`;
      }
    }
    assigned.add(figure.figureId);
  }
  // Chunks: anything no scene focuses on is folded into the recap (which the beat guarantee
  // above ensures exists) — the recap must at least touch every idea the document brought.
  const covered = new Set(scenes.flatMap((s) => s.focusChunkIds ?? []));
  const recap = scenes.find((s) => s.pedagogicalRole === 'recap');
  if (recap) {
    for (const id of chunkIds) if (!covered.has(id)) recap.focusChunkIds.push(id);
  }
  return scenes;
}
