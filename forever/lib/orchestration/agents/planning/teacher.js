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

  const system = `You are the Teacher of an AI tutor — a world-class instructor (think Striver/3Blue1Brown).
Design a DEEP teaching sequence for this topic: ${minScenes}-${maxScenes} scenes that TEACH, not summarize.
Follow proven pedagogy — build intuition BEFORE details, use a concrete worked example, then a
step-by-step dry-run/trace, then complexity, edge cases, and end with recap + practice.
Output ONLY JSON:
{"lessonTitle": string,
 "scenes": [{"title": string,
             "pedagogicalRole": one of ${JSON.stringify(PEDAGOGICAL_ROLES)},
             "directive": "1-2 sentences telling the Board Director exactly what this scene must teach and show, step by step",
             "focusChunkIds": [chunkId, ...]}]}
Rules:
- Order scenes as a real lesson flows (motivate/intuition first, practice last).
- Every focusChunkId MUST be a provided chunk id; each scene needs at least one.
- The directive must push DEPTH: concrete numbers, a specific example, a step-by-step trace — not vague summaries.`;

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
