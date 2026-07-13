// Object production (one job): ONE focused Qwen call produces ONE board object under ITS
// contract only; element repair is the backstop, honest object drop (null) the floor —
// a bad object costs itself, never the scene (the OpenMAIC degradation, with gates).

import { validateBoardObject } from '../../../../board/objects/board-objects.js';
import { coerceBoardObjects } from '../board-coercion.js';
import { resolveImageIds } from '../image-id-mapping.js';
import { repairBoardObject } from '../element-repair.js';
import { stripHandAuthoredAnimation } from './strip-animation.js';
import { HINT_GUIDES } from './hint-guides.js';

export async function produceObject({ stub, sourcePack, layout, brief, imageIndex, call }) {
  const system = `You produce ONE board object of an AI tutor's teaching scene (other agents make the rest).
Output ONLY JSON: {"object":{"id":"${stub.id}","objectType":<short descriptive string>,"renderHint":"${stub.renderHint}","region":"${stub.region}","content":...}}
CONTRACT for renderHint "${stub.renderHint}": ${HINT_GUIDES[stub.renderHint]}
GROUNDING LAW: facts from the source carry "sourceRef":{"chunkId":<a given chunkId>}; a teaching
device YOU invent (hook, analogy, practice question, scenario) carries "grounding":"analogy" instead.
Never raw x/y coordinates. Be concrete: real values, never placeholders.${brief ? `\nSCENE GOAL: ${brief.directive}` : ''}
THIS OBJECT'S JOB: ${stub.purpose}`;
  const user = JSON.stringify({
    chunks: sourcePack.chunks.map((chunk) => ({ chunkId: chunk.id, text: chunk.text })),
    ...(stub.renderHint === 'image' ? { availableImages: imageIndex.available } : {}),
  });

  const finalize = (raw) => {
    const { objects: resolved, dropped } = resolveImageIds([raw], imageIndex);
    if (dropped.length > 0) throw new Error(`image object cites unknown imageId "${raw?.content?.url}"`);
    const [object] = coerceBoardObjects(stripHandAuthoredAnimation(resolved, brief), { layout, brief });
    validateBoardObject(object, layout);
    if (object.decorative !== true && object.grounding !== 'analogy'
      && !sourcePack.chunks.some((chunk) => chunk.id === object.sourceRef?.chunkId)) {
      throw new Error(`object ${object.id} cites unknown chunk ${object.sourceRef?.chunkId}`);
    }
    return object;
  };

  const usages = [];
  try {
    const { json, usage } = await call({ agent: 'board_director', system, user, maxTokens: 6000 });
    usages.push(usage);
    const raw = json.object ?? json;
    try {
      return { object: finalize({ ...raw, id: stub.id, renderHint: raw?.renderHint ?? stub.renderHint, region: raw?.region ?? stub.region }), usages };
    } catch (error) {
      // ELEMENT REPAIR (smallest scope): hand THIS object + THIS error back to Qwen.
      const repaired = await repairBoardObject({ object: raw, error: error.message, brief, hintGuide: HINT_GUIDES[stub.renderHint], call });
      usages.push(repaired.usage);
      return { object: finalize({ ...repaired.object, id: stub.id, renderHint: stub.renderHint, region: stub.region }), usages };
    }
  } catch (error) {
    // Object-level salvage: drop the OBJECT loudly; the scene keeps teaching.
    console.error(`[board] object "${stub.id}" (${stub.renderHint}) dropped after element repair: ${String(error?.message).slice(0, 200)}`);
    return { object: null, usages };
  }
}
