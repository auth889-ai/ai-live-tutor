// The faculty roster (ARCHITECTURE.md §3.1). Roles are the closed set; what each
// role produces per subject stays fully dynamic.
export const FOREVER_AGENT_ROLES = Object.freeze({
  librarian: 'librarian',
  researcher: 'researcher',
  archivist: 'archivist',
  dean: 'dean',
  domainRouter: 'domain_router',
  teacher: 'teacher',
  boardDirector: 'board_director',
  voiceWriter: 'voice_writer',
  codeRunner: 'code_runner',
  quizMaster: 'quiz_master',
  notebookScribe: 'notebook_scribe',
  groundingAuditor: 'grounding_auditor',
  pedagogyCritic: 'pedagogy_critic',
  syncInspector: 'sync_inspector',
  clutterCritic: 'clutter_critic',
  arbiter: 'arbiter',
  timelineCompiler: 'timeline_compiler',
  reconciler: 'reconciler',
});

export const REVIEW_BOARD_ROLES = Object.freeze([
  FOREVER_AGENT_ROLES.groundingAuditor,
  FOREVER_AGENT_ROLES.pedagogyCritic,
  FOREVER_AGENT_ROLES.syncInspector,
  FOREVER_AGENT_ROLES.clutterCritic,
]);

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
