// The society's conflict-resolution cycle (Track 3 core). A hand-built LangGraph-style
// state machine: generate -> audit -> [pass | revise -> re-audit], bounded, honest.
// Returns the grounded board PLUS the full blackboard transcript (the Studio debate feed).
// No fallback: if grounding cannot be reached, it raises SceneQualityError.

import { designBoard, reviseBoard } from '../agents/board-director.js';
import { auditGrounding } from '../agents/grounding-auditor.js';
import { createSocietyMessage } from '../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../roles/agent-roles.js';

export class SceneQualityError extends Error {}

export async function runGroundingReview({
  sceneId,
  sourcePack,
  layout = 'teacher_notebook_code',
  brief = null,
  maxRounds,
  // Agents are injectable so the state machine is unit-testable without spending tokens.
  agents = { designBoard, reviseBoard, auditGrounding },
}) {
  const rounds = maxRounds ?? Number(process.env.MAX_DEBATE_ROUNDS || 2);
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
    const audit = await agents.auditGrounding({ sceneId, objects: board.objects, sourcePack });
    usages.push(audit.usage);
    transcript.push(...audit.objections);

    if (audit.objections.length === 0) {
      transcript.push(
        createSocietyMessage({
          id: `msg_verdict_${sceneId}_${round}`,
          kind: 'verdict',
          fromRole: FOREVER_AGENT_ROLES.arbiter,
          sceneId,
          body: `Grounding accepted after ${round} revision round(s).`,
          verdict: { decision: 'accept', binding: true },
        }),
      );
      return { objects: board.objects, transcript, usages, rounds: round };
    }

    if (round === rounds) break; // out of revision budget

    board = await agents.reviseBoard({ sourcePack, layout, previousObjects: board.objects, objections: audit.objections, brief });
    usages.push(board.usage);
    transcript.push(
      createSocietyMessage({
        id: `msg_revise_${sceneId}_${round}`,
        kind: 'revision',
        fromRole: FOREVER_AGENT_ROLES.boardDirector,
        sceneId,
        body: `Revised the board to address ${audit.objections.length} grounding objection(s).`,
      }),
    );
  }

  throw new SceneQualityError(
    `Scene ${sceneId} could not reach grounded consensus in ${rounds} rounds — refusing to ship ungrounded content.`,
  );
}
