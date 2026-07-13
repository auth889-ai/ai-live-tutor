// Element-scoped repair (one job): ask Qwen to fix ONE failing board object, given the
// exact contract error — never the whole board. Research-backed (ScopeRefine-style
// smallest-scope repair: cheaper AND converges better than whole-output regeneration;
// measured live: whole-board repair rolled the dice on every GOOD object each round,
// which is why scene survival oscillated 25-60% across builds v3-v7).

import { callQwenJson } from '../../../qwen/client.js';

export async function repairBoardObject({ object, error, brief = null, call = callQwenJson }) {
  const system = `You repair ONE board object of an AI tutor's teaching scene. It failed its contract.
Output ONLY the corrected object as JSON: {"object": {...}}
Rules:
- Fix EXACTLY the reported problem; keep the object's id, intent and teaching content.
- Keep every field that was already valid. Do not add unrelated fields.
- If the object cites source material, keep its "sourceRef"; an invented teaching device
  carries "grounding":"analogy" instead.${brief?.directive ? `\n- The scene's teaching goal: ${brief.directive}` : ''}`;
  const user = JSON.stringify({ failedObject: object, contractError: error });
  const { json, usage } = await call({ agent: 'board_director', system, user, maxTokens: 4000 });
  const fixed = json.object ?? json; // some models return the object bare
  if (!fixed || typeof fixed !== 'object' || Array.isArray(fixed)) {
    throw new Error('element repair returned no object');
  }
  // The id is identity — a repair that renames the object breaks voice/timeline bindings.
  return { object: { ...fixed, id: object.id }, usage };
}
