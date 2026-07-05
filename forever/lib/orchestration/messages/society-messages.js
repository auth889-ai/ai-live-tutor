import { FOREVER_AGENT_ROLES } from '../roles/agent-roles.js';

export const SOCIETY_MESSAGE_KINDS = Object.freeze([
  'proposal',
  'objection',
  'evidence',
  'revision',
  'verdict',
  'handoff',
]);

export const VERDICT_DECISIONS = Object.freeze(['accept', 'revise', 'reject']);

const EVIDENCE_POINTER_KEYS = ['chunkId', 'objectId', 'actionId', 'voiceLineId'];

export function createSocietyMessage(message) {
  if (!message.id?.trim()) throw new Error('societyMessage.id is required');
  const context = `societyMessage ${message.id}`;
  if (!SOCIETY_MESSAGE_KINDS.includes(message.kind)) {
    throw new Error(`${context}.kind must be one of ${SOCIETY_MESSAGE_KINDS.join(', ')}`);
  }
  if (!Object.values(FOREVER_AGENT_ROLES).includes(message.fromRole)) {
    throw new Error(`${context}.fromRole is not a Forever agent role: ${message.fromRole}`);
  }
  if (!message.sceneId?.trim()) throw new Error(`${context}.sceneId is required — messages live on a scene blackboard`);
  if (!message.body?.trim()) throw new Error(`${context}.body is required`);

  if (message.kind === 'objection' || message.kind === 'evidence') {
    validateEvidenceRefs(message, context);
  }
  if (message.kind === 'verdict') {
    if (message.fromRole !== FOREVER_AGENT_ROLES.arbiter) {
      throw new Error(`${context}: only the arbiter issues verdicts`);
    }
    if (!VERDICT_DECISIONS.includes(message.verdict?.decision)) {
      throw new Error(`${context}.verdict.decision must be one of ${VERDICT_DECISIONS.join(', ')}`);
    }
    if (message.verdict.binding !== true) {
      throw new Error(`${context}: arbiter verdicts are binding — set verdict.binding to true`);
    }
  }
  return Object.freeze({ ...message });
}

// An objection without evidence is rhetoric, not review — the runtime rejects it.
function validateEvidenceRefs(message, context) {
  if (!message.evidenceRefs?.length) {
    throw new Error(`${context} (${message.kind}) requires non-empty evidenceRefs — no evidence, no objection`);
  }
  for (const ref of message.evidenceRefs) {
    if (!EVIDENCE_POINTER_KEYS.some((key) => ref?.[key]?.trim?.())) {
      throw new Error(`${context} evidence ref must point at ${EVIDENCE_POINTER_KEYS.join('/')}`);
    }
  }
}
