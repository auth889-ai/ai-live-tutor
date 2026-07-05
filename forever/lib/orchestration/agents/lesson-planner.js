// Lesson Planner: a minimal Dean. ONE job — divide a SourcePack into an ordered list of
// scene briefs (title + which chunks each scene teaches). This is task decomposition:
// the whole topic is split into teachable steps before any scene is generated.
// (Deepened later into full episode/duration planning; kept lean for the visible lesson.)

import { callQwenJson } from '../../qwen/client.js';

export async function planLesson({ sourcePack, minScenes = 2, maxScenes = 4 }) {
  const chunkIds = new Set(sourcePack.chunks.map((chunk) => chunk.id));

  const system = `You are the Lesson Planner of an AI tutor. Divide the source into an ordered
sequence of ${minScenes}-${maxScenes} teaching scenes, each covering ONE coherent idea, in a
logical teaching order (intuition first, details after). Output ONLY JSON:
{"lessonTitle": string, "scenes":[{"title": string, "focusChunkIds": [chunkId, ...]}]}
Every focusChunkId MUST be one of the provided chunk ids. Each scene needs at least one chunk.`;

  const user = JSON.stringify({
    task: 'Plan the scene sequence for this lesson.',
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
  });

  const { json, usage } = await callQwenJson({
    agent: 'lesson_planner',
    system,
    user,
    model: process.env.MODEL_PLANNER || 'qwen3.7-max',
    temperature: 0.3,
  });

  const scenes = Array.isArray(json.scenes) ? json.scenes : [];
  const plan = scenes
    .map((scene) => ({
      title: String(scene.title || '').trim(),
      focusChunkIds: (scene.focusChunkIds || []).filter((id) => chunkIds.has(id)),
    }))
    .filter((scene) => scene.title && scene.focusChunkIds.length > 0);

  if (plan.length === 0) throw new Error('Lesson Planner produced no valid scenes');
  return { lessonTitle: String(json.lessonTitle || sourcePack.title).trim(), scenes: plan, usage };
}
