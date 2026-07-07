// Pedagogy Critic — a second, INDEPENDENT Review Board member. Scores the board on TEACHING
// quality against the scene's role (concrete-before-abstract, depth, clarity, one clear
// idea, right device for the concept). Files evidence-carrying objections when a scene is
// shallow/unclear so the Board Director revises — this is what makes quality CONSISTENT
// (Coursera's edge), not lucky, and adds a real second critic to the Track-3 debate.

import { callQwenJson } from '../../../qwen/client.js';
import { createSocietyMessage } from '../../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../../roles/agent-roles.js';

export async function auditPedagogy({ sceneId, objects, brief = null }) {
  const system = `You are the Pedagogy Critic of an AI tutor — an INDEPENDENT reviewer of TEACHING QUALITY.
Judge this scene's board against elite teaching standards:
- Concrete BEFORE abstract (a specific example, not a cold definition).
- Real DEPTH for its role${brief ? ` (role: ${brief.pedagogicalRole}; directive: ${brief.directive})` : ''} — not a vague summary.
- ONE clear idea, taught clearly; the right device (diagram/code/math/example) for the concept.
Output ONLY JSON: {"objections":[{"objectId","reason"}]}. Empty array means the teaching is strong.
Object to a specific object only when it is genuinely shallow, vague, abstract-without-example, or off-role.
Be a fair but demanding reviewer — do NOT object to good, concise teaching.`;

  const user = JSON.stringify({
    task: 'Review the teaching quality of these board objects.',
    objects: objects.map((o) => ({ objectId: o.id, objectType: o.objectType, renderHint: o.renderHint, content: o.content })),
  });

  const { json, usage } = await callQwenJson({
    agent: 'pedagogy_critic',
    system,
    user,
    model: process.env.MODEL_FAST || 'qwen3.6-flash',
    temperature: 0.2,
  });

  const objectIds = new Set(objects.map((o) => o.id));
  const raw = Array.isArray(json.objections) ? json.objections : [];
  const messages = [];
  for (let i = 0; i < raw.length; i += 1) {
    const obj = raw[i];
    if (!objectIds.has(obj.objectId)) continue;
    messages.push(
      createSocietyMessage({
        id: `msg_pedagogy_${sceneId}_${i}`,
        kind: 'objection',
        fromRole: FOREVER_AGENT_ROLES.pedagogyCritic,
        sceneId,
        body: obj.reason || 'Teaching is too shallow or unclear here.',
        evidenceRefs: [{ objectId: obj.objectId }],
      }),
    );
  }
  return { objections: messages, usage };
}
