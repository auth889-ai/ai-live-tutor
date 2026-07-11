// The society's conflict-resolution cycle (Track 3 core). A hand-built LangGraph-style
// state machine: generate -> audit -> [pass | revise -> re-audit], bounded, honest.
// Returns the grounded board PLUS the full blackboard transcript (the Studio debate feed).
// No fallback: if grounding cannot be reached, it raises SceneQualityError.

import { designBoard, reviseBoard } from '../agents/authoring/board-director.js';
import { auditGrounding } from '../agents/critics/grounding-auditor.js';
import { auditPedagogy } from '../agents/critics/pedagogy-critic.js';
import { createSocietyMessage } from '../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../roles/agent-roles.js';

export class SceneQualityError extends Error {}

export async function runGroundingReview({
  sceneId,
  sourcePack,
  layout = 'teacher_notebook_code',
  brief = null,
  domain = 'general',
  maxRounds,
  // Agents are injectable so the state machine is unit-testable without spending tokens.
  agents = { designBoard, reviseBoard, auditGrounding, auditPedagogy },
}) {
  const rounds = maxRounds ?? Number(process.env.MAX_DEBATE_ROUNDS || 3);
  const transcript = [];
  const usages = [];

  let board = await agents.designBoard({ sourcePack, layout, brief });
  usages.push(board.usage);
  transcript.push(
    createSocietyMessage({
      id: `msg_propose_${sceneId}`,
      kind: 'proposal',
      fromRole: FOREVER_AGENT_ROLES.boardDirector,
      sceneId,
      body: `Proposed a board of ${board.objects.length} objects.`,
    }),
  );

  for (let round = 0; round <= rounds; round += 1) {
    // Two independent critics. GROUNDING is the HARD gate (facts must be right, else the
    // scene cannot ship). PEDAGOGY is ADVISORY — it drives revision to improve teaching, but
    // a well-grounded scene is never dropped just because the critic wants it richer.
    const [grounding, pedagogy] = await Promise.all([
      agents.auditGrounding({ sceneId, objects: board.objects, sourcePack, domain }),
      agents.auditPedagogy
        ? agents.auditPedagogy({ sceneId, objects: board.objects, brief })
        : Promise.resolve({ objections: [], usage: null }),
    ]);
    usages.push(grounding.usage, pedagogy.usage);
    transcript.push(...grounding.objections, ...pedagogy.objections);
    const allObjections = [...grounding.objections, ...pedagogy.objections];

    // Pass when grounded. Only on the FIRST round do we also revise for pedagogy (to lift
    // quality); after that, grounded-and-shippable beats endless pedagogy nitpicks.
    const mustRevise = grounding.objections.length > 0 || (round === 0 && pedagogy.objections.length > 0);
    if (!mustRevise) {
      transcript.push(
        createSocietyMessage({
          id: `msg_verdict_${sceneId}_${round}`,
          kind: 'verdict',
          fromRole: FOREVER_AGENT_ROLES.arbiter,
          sceneId,
          body: `Accepted after ${round} revision round(s) (grounded${pedagogy.objections.length ? '; pedagogy notes remain' : ''}).`,
          verdict: { decision: 'accept', binding: true },
        }),
      );
      return { objects: board.objects, transcript, usages, rounds: round };
    }

    if (round === rounds) {
      // Out of budget: ship if grounded (pedagogy is advisory); only fail if still ungrounded.
      if (grounding.objections.length === 0) return { objects: board.objects, transcript, usages, rounds: round };
      break;
    }

    board = await agents.reviseBoard({ sourcePack, layout, previousObjects: board.objects, objections: allObjections, brief });
    usages.push(board.usage);
    transcript.push(
      createSocietyMessage({
        id: `msg_revise_${sceneId}_${round}`,
        kind: 'revision',
        fromRole: FOREVER_AGENT_ROLES.boardDirector,
        sceneId,
        body: `Revised the board to address ${allObjections.length} objection(s).`,
      }),
    );
  }

  throw new SceneQualityError(
    `Scene ${sceneId} could not reach grounded consensus in ${rounds} rounds — refusing to ship ungrounded content.`,
  );
}
