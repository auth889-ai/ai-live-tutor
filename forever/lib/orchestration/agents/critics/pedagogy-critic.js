// Pedagogy Critic — a second, INDEPENDENT Review Board member. Scores the board on TEACHING
// quality against the scene's role (concrete-before-abstract, depth, clarity, one clear
// idea, right device for the concept). Files evidence-carrying objections when a scene is
// shallow/unclear so the Board Director revises — this is what makes quality CONSISTENT
// (Coursera's edge), not lucky, and adds a real second critic to the Track-3 debate.

import { runAgentChain } from '../../../qwen/client.js';
import { createSocietyMessage } from '../../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../../roles/agent-roles.js';

export async function auditPedagogy({ sceneId, objects, brief = null }) {
  const system = `You are the Pedagogy Critic of an AI tutor — an INDEPENDENT reviewer of TEACHING QUALITY.
Judge this scene's board against the RUBRIC below (distilled from what makes Abdul Bari, Striver,
Andrew Ng and the multimedia-learning literature effective). Object with the objectId and the
SPECIFIC rubric item violated:
1. CONCRETE BEFORE ABSTRACT — a specific worked instance (real values) before any definition/formula.
2. DEPTH FOR ITS ROLE${brief ? ` (role: ${brief.pedagogicalRole}; directive: ${brief.directive})` : ''} — the directive's substance is actually ON the board, not summarized away.
3. VISIBLE REFERENT — every claim the board makes must be SHOWN, not just asserted: a complexity
   claim needs the comparison visible; "this fails" needs the failing input visible; a process
   needs its diagram/trace, not a paragraph about one.
4. WRONG PATH SHOWN — when the role covers mistakes/optimization, the naive/broken version and
   WHY it hurts must appear before the fix (never only the happy path).
5. ONE IDEA, RIGHT DEVICE — one clear idea, taught with the right device (diagram for structure,
   code for mechanics, table for comparison, trace for behaviour) — a wall of prose is a violation.
6. STRUCTURED, SCREENSHOT-ABLE NOTES — numbered/short lines a student would photograph, not essay text.
Output ONLY JSON: {"objections":[{"objectId","reason"}]}. Empty array means the teaching is strong.
Be a fair but demanding reviewer — do NOT object to good, concise teaching.
VERDICTS ONLY: each reason is ONE short sentence naming the rubric item + what to change.
Never restate the scene — output tokens are latency.`;

  const user = JSON.stringify({
    task: 'Review the teaching quality of these board objects.',
    objects: objects.map((o) => ({ objectId: o.id, objectType: o.objectType, renderHint: o.renderHint, content: o.content })),
  });

  const { json, usage } = await runAgentChain({
    agent: 'pedagogy_critic',
    system,
    user,
    model: process.env.MODEL_FAST || 'qwen3.6-flash',
    temperature: 0.2,
    maxTokens: 700, // verdicts, not essays
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
