export const FOREVER_AGENT_ROLES = Object.freeze({
  coursePlanner: 'course_planner',
  episodePlanner: 'episode_planner',
  pedagogyPlanner: 'pedagogy_planner',
  voiceDirector: 'voice_director',
  visualDirector: 'visual_director',
  timelineCompiler: 'timeline_compiler',
  groundingReviewer: 'grounding_reviewer',
  syncReviewer: 'sync_reviewer',
  repairAgent: 'repair_agent',
});

export function createAgentTurnSummary({ agentId, agentName, role, contentPreview, actionCount = 0 }) {
  if (!Object.values(FOREVER_AGENT_ROLES).includes(role)) {
    throw new Error(`Unknown Forever agent role: ${role}`);
  }
  return {
    agentId,
    agentName,
    role,
    contentPreview,
    actionCount,
  };
}

