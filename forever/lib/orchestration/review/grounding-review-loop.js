// The society's conflict-resolution cycle (Track 3 core), expressed as a REAL LangGraph
// StateGraph (user decision 2026-07-13): design -> audit -> [accept | revise -> re-audit],
// bounded, honest. Same contract as ever — the graph is the orchestration, the agents and
// deterministic validators stay the quality layer. Returns the grounded board PLUS the
// full blackboard transcript (the Studio debate feed). No fallback: if grounding cannot
// be reached, it raises SceneQualityError.

import { StateGraph, Annotation, START, END } from '@langchain/langgraph';

import { designBoard, reviseBoard } from '../agents/authoring/board-director.js';
import { auditGrounding } from '../agents/critics/grounding-auditor.js';
import { auditPedagogy } from '../agents/critics/pedagogy-critic.js';
import { createSocietyMessage } from '../messages/society-messages.js';
import { FOREVER_AGENT_ROLES } from '../roles/agent-roles.js';

export class SceneQualityError extends Error {}

const concat = (a, b) => a.concat(b);

const ReviewState = Annotation.Root({
  board: Annotation(),
  round: Annotation(),
  transcript: Annotation({ reducer: concat, default: () => [] }),
  usages: Annotation({ reducer: concat, default: () => [] }),
  lastObjections: Annotation(),
  groundingCount: Annotation(),
  mustRevise: Annotation(),
  failed: Annotation(),
  acceptedRound: Annotation(),
});

export async function runGroundingReview({
  sceneId,
  sourcePack,
  layout = 'teacher_notebook_code',
  brief = null,
  domain = 'general',
  maxRounds,
  // Agents are injectable so the state machine is unit-testable without spending tokens.
  agents = { designBoard, reviseBoard, auditGrounding, auditPedagogy },
  // THINKING ALOUD: each society step as a human sentence, streamed to the student's
  // progress UI (the wait becomes a window into the agents at work, not a spinner).
  onStep = () => {},
}) {
  const rounds = maxRounds ?? Number(process.env.MAX_DEBATE_ROUNDS || 3);

  const design = async () => {
    onStep('The Board Director is designing the board');
    const board = await agents.designBoard({ sourcePack, layout, brief });
    return {
      board,
      round: 0,
      usages: [board.usage],
      transcript: [createSocietyMessage({
        id: `msg_propose_${sceneId}`,
        kind: 'proposal',
        fromRole: FOREVER_AGENT_ROLES.boardDirector,
        sceneId,
        body: `Proposed a board of ${board.objects.length} objects.`,
      })],
    };
  };

  const audit = async (state) => {
    onStep(state.round === 0 ? 'The Grounding Auditor and Pedagogy Critic are reviewing' : `The critics are re-reviewing (round ${state.round + 1})`);
    // Two independent critics. GROUNDING is the HARD gate (facts must be right, else the
    // scene cannot ship). PEDAGOGY is ADVISORY — it drives revision to improve teaching, but
    // a well-grounded scene is never dropped just because the critic wants it richer.
    const [grounding, pedagogy] = await Promise.all([
      agents.auditGrounding({ sceneId, objects: state.board.objects, sourcePack, domain }),
      agents.auditPedagogy
        ? agents.auditPedagogy({ sceneId, objects: state.board.objects, brief })
        : Promise.resolve({ objections: [], usage: null }),
    ]);
    const allObjections = [...grounding.objections, ...pedagogy.objections];
    return {
      usages: [grounding.usage, pedagogy.usage],
      transcript: allObjections,
      lastObjections: allObjections,
      groundingCount: grounding.objections.length,
      // Pass when grounded. Only on the FIRST round do we also revise for pedagogy (to lift
      // quality); after that, grounded-and-shippable beats endless pedagogy nitpicks.
      mustRevise: grounding.objections.length > 0 || (state.round === 0 && pedagogy.objections.length > 0),
    };
  };

  const decide = (state) => {
    if (!state.mustRevise) return 'accept';
    if (state.round === rounds) return state.groundingCount === 0 ? 'accept' : 'fail';
    return 'revise';
  };

  const accept = (state) => {
    if (state.mustRevise) return { acceptedRound: state.round }; // budget exhausted but grounded — ship quietly
    onStep(state.round === 0 ? 'Approved by both critics on the first review' : `Approved after ${state.round} repair round(s)`);
    return {
      acceptedRound: state.round,
      transcript: [createSocietyMessage({
        id: `msg_verdict_${sceneId}_${state.round}`,
        kind: 'verdict',
        fromRole: FOREVER_AGENT_ROLES.arbiter,
        sceneId,
        body: `Accepted after ${state.round} revision round(s) (grounded${state.lastObjections.some((m) => m.fromRole === FOREVER_AGENT_ROLES.pedagogyCritic) ? '; pedagogy notes remain' : ''}).`,
        verdict: { decision: 'accept', binding: true },
      })],
    };
  };

  const revise = async (state) => {
    onStep(`The Board Director is repairing ${state.lastObjections.length} objection(s) from the critics`);
    const board = await agents.reviseBoard({ sourcePack, layout, previousObjects: state.board.objects, objections: state.lastObjections, brief });
    return {
      board,
      round: state.round + 1,
      usages: [board.usage],
      transcript: [createSocietyMessage({
        id: `msg_revise_${sceneId}_${state.round}`,
        kind: 'revision',
        fromRole: FOREVER_AGENT_ROLES.boardDirector,
        sceneId,
        body: `Revised the board to address ${state.lastObjections.length} objection(s).`,
      })],
    };
  };

  const graph = new StateGraph(ReviewState)
    .addNode('design', design)
    .addNode('audit', audit)
    .addNode('accept', accept)
    .addNode('revise', revise)
    .addNode('fail', () => ({ failed: true }))
    .addEdge(START, 'design')
    .addEdge('design', 'audit')
    .addConditionalEdges('audit', decide, { accept: 'accept', revise: 'revise', fail: 'fail' })
    .addEdge('revise', 'audit')
    .addEdge('accept', END)
    .addEdge('fail', END)
    .compile();

  const state = await graph.invoke({}, { recursionLimit: 4 * (rounds + 2) });
  if (state.failed) {
    throw new SceneQualityError(
      `Scene ${sceneId} could not reach grounded consensus in ${rounds} rounds — refusing to ship ungrounded content.`,
    );
  }
  return { objects: state.board.objects, transcript: state.transcript, usages: state.usages, rounds: state.acceptedRound };
}
