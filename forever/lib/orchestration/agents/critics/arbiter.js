// Arbiter (one job): the meta-judge that reviews the Grounding Auditor's SURVIVING
// objections before a scene may be killed. Research-grounded (JudgeBench: single-judge
// precision ~62%; meta-judge arbitration lifts precision 68.9 -> 77.3; every verified
// production pipeline makes critics advisory — a critic alone revises, only corroborated
// judgment kills). The deterministic gates are untouched: this only governs LLM-vs-LLM
// disagreements at the round cap.

import { z } from 'zod';
import { runAgentChain } from '../../../qwen/client.js';

const RULINGS = z.object({
  rulings: z.array(z.object({
    objectId: z.string(),
    ruling: z.enum(['sustain', 'overrule']),
    reason: z.string(),
  })),
});

export async function ruleOnObjections({ sceneId, objections, objects, sourcePack, call = runAgentChain }) {
  const chunkText = new Map(sourcePack.chunks.map((chunk) => [chunk.id, chunk.text]));
  const byId = new Map(objects.map((object) => [object.id, object]));

  const system = `You are the Arbiter of an AI tutor's review board — the final, independent judge.
The Grounding Auditor has objected to board objects for ${String(sceneId)} across several repair rounds.
For EACH objection decide:
- "sustain": the objection is factually CORRECT — the object really asserts something its cited
  source does not support (or contradicts it). The object will be removed.
- "overrule": the objection is mistaken, pedantic, already addressed by the current object text,
  or targets a legitimate teaching device (analogy/hook/practice) that contradicts nothing.
Judge ONLY factual grounding — style, richness and preferences are NOT kill reasons.
One short sentence of reason each. Output: {"rulings":[{"objectId","ruling","reason"}]}`;

  const user = JSON.stringify({
    objections: objections.map((message) => {
      const objectId = message.evidenceRefs?.find((ref) => ref.objectId)?.objectId ?? null;
      const object = objectId ? byId.get(objectId) : null;
      return {
        objectId,
        objection: message.body,
        objectContent: object?.content ?? '(object not found)',
        objectGrounding: object?.grounding === 'analogy' || object?.decorative === true
          ? 'declared teaching device (no citation required)'
          : `cites: ${chunkText.get(object?.sourceRef?.chunkId) ?? '(cited chunk does not exist)'}`,
      };
    }),
  });

  const { json, usage } = await call({
    agent: 'arbiter',
    system,
    user,
    schema: RULINGS,
    model: process.env.MODEL_PLANNER || process.env.MODEL_SCENE, // judgment quality over speed (user: never save tokens at quality's expense)
    temperature: 0.1,
    maxTokens: 1500,
  });

  const valid = new Set(objects.map((object) => object.id));
  const sustained = new Set();
  for (const ruling of json.rulings ?? []) {
    if (ruling.ruling === 'sustain' && valid.has(ruling.objectId)) sustained.add(ruling.objectId);
  }
  return { sustained, rulings: json.rulings ?? [], usage };
}
