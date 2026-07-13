// Grounding Auditor: an INDEPENDENT critic (separate model call from the Board Director).
// One job — check every board object's content is actually supported by its cited chunk.
// Emits objections as evidence-carrying society messages. Never grades its own writing.

import { callQwenJson } from '../../../qwen/client.js';
import { createSocietyMessage } from '../../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../../roles/agent-roles.js';

// Formal fields whose textbook knowledge is verifiable by derivation or execution — a lesson
// on a pasted LeetCode problem legitimately teaches Hierholzer's algorithm even though the
// paste never mentions it (the dry run PROVES the algorithm by running it). Humanities/law
// stay strict: there, interpretation must trace to the source (the 14-course spec's
// source-proof rule is about exactly those fields).
const KNOWLEDGE_DOMAINS = new Set(['dsa', 'programming', 'ml_ai', 'math', 'science', 'systems_swe', 'business_finance']);

export async function auditGrounding({ sceneId, objects, sourcePack, domain = 'general', deps = {} }) {
  const chunkText = new Map(sourcePack.chunks.map((chunk) => [chunk.id, chunk.text]));

  // Measured 2026-07-11: 35% of all dropped scenes were the auditor refusing STANDARD domain
  // knowledge (named algorithms, complexity facts, textbook formulas) because the pasted
  // source is just a problem statement. In formal domains that knowledge is the teacher's
  // own; what must stay grounded is every claim ABOUT the source material itself.
  const knowledgeClause = KNOWLEDGE_DOMAINS.has(domain)
    ? `\nSTANDARD ${domain.toUpperCase()} KNOWLEDGE IS THE TEACHER'S OWN: textbook definitions, named
algorithms/theorems/protocols and their well-known properties, complexity facts, and standard formulas
are NOT source claims — never object that they "are not in the chunk". Object to them ONLY when stated
INCORRECTLY or when they CONTRADICT the chunk. What MUST stay grounded in the cited chunk: every claim
about the source material itself — its specific problem, numbers, examples, constraints, figures, and
anything phrased as "the problem/source/text says".`
    : '';

  const system = `You are the Grounding Auditor of an AI tutor. You are an INDEPENDENT fact-checker.
For each board object, decide if its content is DIRECTLY supported by the exact source chunk it cites.
Reject: invented facts, numbers/claims not in the chunk, or content citing the wrong chunk.
Accept: faithful summaries, reorganizations, and formatting of what the chunk actually says.
TEACHING DEVICES ARE NOT OBJECTIONS: analogies, hooks, motivation, recap summaries, practice
questions with worked answers, and concrete illustrative examples (a specific array, a tiny graph)
are the TEACHER'S craft — by nature they are not sentences from the source. Audit only the
FACTUAL/technical claims inside them: object when a device CONTRADICTS the chunk or asserts a
specific technical fact/number the chunk does not support — never because the device itself
"is not in the source".${knowledgeClause}
Output ONLY JSON: {"objections":[{"objectId","reason","citedChunkId"}]}. Empty array means everything is grounded.
Be strict but fair — do not object to correct teaching just because it is concise.
VERDICTS ONLY: each reason is ONE short sentence naming the unsupported claim. Never restate
the scene, never quote long passages — output tokens are latency.`;

  const user = JSON.stringify({
    task: 'Audit each board object against its cited source chunk.',
    objects: objects.map((object) => {
      // A declared teaching device cites nothing BY DESIGN — the payload must say so,
      // not dangle "(cited chunk does not exist)" as an invitation to object (live-caught:
      // motivate/practice scenes, all devices, died in consensus exactly this way).
      if (object.grounding === 'analogy' || object.decorative === true) {
        return {
          objectId: object.id,
          content: object.content,
          citedChunkId: '(none — declared teaching device)',
          citedChunkText: '(teaching device: no citation required — object ONLY if it CONTRADICTS the source material)',
        };
      }
      return {
        objectId: object.id,
        content: object.content,
        citedChunkId: object.sourceRef?.chunkId,
        citedChunkText: chunkText.get(object.sourceRef?.chunkId) ?? '(cited chunk does not exist)',
      };
    }),
  });

  const { json, usage } = await (deps.callQwenJson ?? callQwenJson)({
    agent: 'grounding_auditor',
    system,
    user,
    model: process.env.MODEL_FAST || 'qwen3.6-flash',
    temperature: 0.1,
    maxTokens: 700, // verdicts, not essays — decode time dominates wall time
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
