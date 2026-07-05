// Grounding Auditor: an INDEPENDENT critic (separate model call from the Board Director).
// One job — check every board object's content is actually supported by its cited chunk.
// Emits objections as evidence-carrying society messages. Never grades its own writing.

import { callQwenJson } from '../../qwen/client.js';
import { createSocietyMessage } from '../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../roles/agent-roles.js';

export async function auditGrounding({ sceneId, objects, sourcePack }) {
  const chunkText = new Map(sourcePack.chunks.map((chunk) => [chunk.id, chunk.text]));

  const system = `You are the Grounding Auditor of an AI tutor. You are an INDEPENDENT fact-checker.
For each board object, decide if its content is DIRECTLY supported by the exact source chunk it cites.
Reject: invented facts, numbers/claims not in the chunk, or content citing the wrong chunk.
Accept: faithful summaries, reorganizations, and formatting of what the chunk actually says.
Output ONLY JSON: {"objections":[{"objectId","reason","citedChunkId"}]}. Empty array means everything is grounded.
Be strict but fair — do not object to correct teaching just because it is concise.`;

  const user = JSON.stringify({
    task: 'Audit each board object against its cited source chunk.',
    objects: objects.map((object) => ({
      objectId: object.id,
      content: object.content,
      citedChunkId: object.sourceRef?.chunkId,
      citedChunkText: chunkText.get(object.sourceRef?.chunkId) ?? '(cited chunk does not exist)',
    })),
  });

  const { json, usage } = await callQwenJson({
    agent: 'grounding_auditor',
    system,
    user,
    model: process.env.MODEL_FAST || 'qwen3.6-flash',
    temperature: 0.1,
  });

  const rawObjections = Array.isArray(json.objections) ? json.objections : [];
  const objectIds = new Set(objects.map((object) => object.id));
  const messages = [];
  for (let index = 0; index < rawObjections.length; index += 1) {
    const objection = rawObjections[index];
    if (!objectIds.has(objection.objectId)) continue; // ignore phantom targets
    messages.push(
      createSocietyMessage({
        id: `msg_audit_${sceneId}_${index}`,
        kind: 'objection',
        fromRole: FOREVER_AGENT_ROLES.groundingAuditor,
        sceneId,
        body: objection.reason || 'Content not supported by the cited source.',
        evidenceRefs: [{ objectId: objection.objectId }, { chunkId: objection.citedChunkId || 'unknown' }],
      }),
    );
  }
  return { objections: messages, usage };
}
