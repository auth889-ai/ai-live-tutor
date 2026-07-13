// Teacher agent (the deep planner). ONE job — turn a SourcePack into a real TEACHING
// SEQUENCE the way the best human teachers do (research-backed pedagogy): motivate ->
// intuition -> worked example -> dry-run/trace -> complexity -> edge cases -> recap ->
// practice. Output is an ordered list of scene briefs (role + directive + focus chunks).
// This is what makes lessons deep and long instead of a short summary.

import { callQwenJson } from '../../../qwen/client.js';

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

export async function designPedagogy({ sourcePack, minScenes = 5, maxScenes = 9, domain = 'general' }) {
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));
  const { teachingFor, UNIVERSAL_TEACHING_LAW } = await import('./domain-teaching.js');

  // The document's own figures, offered to the Teacher BY ID so it can assign each scene
  // the figure it should teach FROM (like focusChunkIds, but for pictures — the lever
  // that makes PDF lessons visual instead of self-drawn; live-caught: 24 figures offered
  // at board level, only 1 ever placed — assignment must happen at LESSON level).
  const figures = (sourcePack.assets ?? [])
    .filter((asset) => asset.kind === 'figure' && asset.caption?.trim())
    .map((asset) => ({ figureId: asset.id, caption: asset.caption, ...(asset.page ? { page: asset.page } : {}) }));
  const figureIds = new Set(figures.map((figure) => figure.figureId));

  const system = `You are the Teacher of an AI tutor — a world-class SPECIALIST in this domain (${domain}).
DOMAIN TEACHING STYLE (teach exactly this way): ${teachingFor(domain)}
THE UNIVERSAL LAW (non-negotiable, write directives that OBEY it): ${UNIVERSAL_TEACHING_LAW}

Design a DEEP teaching sequence: ${minScenes}-${maxScenes} scenes that TEACH, not summarize.
Follow EVIDENCE-BASED pedagogy (this is what makes it elite, not average):
1. CONCRETE BEFORE ABSTRACT — open with a specific, relatable example (real numbers / a tiny scenario),
   THEN generalize to the rule. Never state an abstract definition cold.
2. BOTTOM-UP — start with the simplest version, add ONE layer of detail per scene (chunk: one idea per scene).
3. For ALGORITHMS / CODING — teach BRUTE-FORCE first, then BETTER, then OPTIMAL, each with its complexity,
   and a step-by-step dry-run/trace on a concrete input.
4. MISCONCEPTION — include a scene that names the common mistake and why it's wrong.
5. Build intuition (the WHY) before mechanics; end with recap + a practice/retrieval scene.
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

  const { json, usage } = await callQwenJson({
    agent: 'teacher',
    system,
    user,
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
  return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes, usage };
}
