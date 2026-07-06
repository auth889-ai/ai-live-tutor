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

export async function designPedagogy({ sourcePack, minScenes = 5, maxScenes = 9 }) {
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));

  const system = `You are the Teacher of an AI tutor — a world-class instructor (Striver for code, Andrew Ng for concepts).
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
             "focusChunkIds": [chunkId, ...]}]}
Rules:
- Order as a real lesson flows: concrete hook → intuition → worked example (brute→better→optimal for code) → misconception → recap → practice.
- Every focusChunkId MUST be a provided chunk id; each scene needs at least one.
- Each scene teaches ONE idea well. The directive must name a CONCRETE example with real values — never "explain X in general".`;

  const user = JSON.stringify({
    task: 'Design the deep teaching sequence for this lesson.',
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
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
    }))
    .filter((scene) => scene.title && scene.directive && scene.focusChunkIds.length > 0);

  if (scenes.length === 0) throw new Error('Teacher produced no valid scenes');
  return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes, usage };
}
