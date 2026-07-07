// The SINGLE-AGENT BASELINE for the Track-3 benchmark: one big Qwen call that tries to
// produce a whole lesson in one shot (the "mega-prompt" approach the society replaces).
// We then measure how much of its output is actually contract-valid vs the society's 100%.
// This is the apples-to-apples comparison that proves the multi-agent gain with numbers.

import { buildTextSourcePack } from '../../source-pack/build/source-pack.js';
import { callQwenJson } from '../../qwen/client.js';
import { validateBoardObjects } from '../../board/objects/board-objects.js';
import { validateVoiceLines } from '../voice/voice-lines.js';

export async function generateLessonSingleAgent(text) {
  const sourcePack = buildTextSourcePack(text);
  const system = `You are an AI tutor. In ONE response, produce a COMPLETE multi-scene lesson from the source.
Output ONLY JSON: {"lessonTitle": string, "scenes": [{"title": string,
  "objects": [{"id","objectType","renderHint" (text|list|code),"region":"notebook_area","lineNumber":int,"content","sourceRef":{"chunkId"}}],
  "voiceLines": [{"id","text","targetObjectId"}]}]}
Every object must cite a real chunkId. Aim for 5-8 scenes.`;
  const user = JSON.stringify({ chunks: sourcePack.chunks.map((c) => ({ chunkId: c.id, text: c.text })) });

  const started = Date.now();
  const { json, usage } = await callQwenJson({ agent: 'single_agent_baseline', system, user, model: process.env.MODEL_PLANNER || 'qwen3.7-max', maxTokens: 8000 });
  const scenes = Array.isArray(json.scenes) ? json.scenes : [];

  // Measure contract validity: how many scenes the one-shot output actually gets right.
  let validScenes = 0;
  let groundedObjects = 0;
  let totalObjects = 0;
  const chunkIds = new Set(sourcePack.chunks.map((c) => c.id));
  for (const scene of scenes) {
    totalObjects += scene.objects?.length ?? 0;
    for (const o of scene.objects ?? []) if (chunkIds.has(o.sourceRef?.chunkId)) groundedObjects += 1;
    try {
      validateBoardObjects(scene.objects, 'teacher_notebook_code');
      validateVoiceLines(scene.voiceLines, scene.objects);
      validScenes += 1;
    } catch {
      // invalid scene — the cost of one mega-prompt with no per-agent validation/repair
    }
  }

  return {
    approach: 'single-agent',
    lessonTitle: String(json.lessonTitle || sourcePack.title),
    scenes, // raw output — the benchmark judge must see the REAL baseline lesson, not a summary
    totalScenes: scenes.length,
    validScenes,
    groundingRate: totalObjects ? groundedObjects / totalObjects : 0,
    tokens: usage?.total_tokens ?? 0,
    wallMs: Date.now() - started,
  };
}
