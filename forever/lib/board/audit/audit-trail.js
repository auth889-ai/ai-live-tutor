// Pure logic for the Society Audit Trail (the AuditTrailView renders this; kept pure + tested
// here because the repo unit-tests logic, not JSX). The transcript is an array of society
// messages the LangGraph review loop produced for a scene: proposal -> objection(+evidence) ->
// verdict -> revision. These helpers turn it into what the panel shows, and let a test lock the
// shape without a browser.

export const AUDIT_ROLES = Object.freeze({
  board_director: { icon: '🎨', label: 'Board Director' },
  grounding_auditor: { icon: '🔎', label: 'Grounding Auditor' },
  pedagogy_critic: { icon: '📚', label: 'Pedagogy Critic' },
  sync_inspector: { icon: '⏱️', label: 'Sync Inspector' },
  clutter_critic: { icon: '🧹', label: 'Clutter Critic' },
  arbiter: { icon: '⚖️', label: 'Arbiter' },
  teacher: { icon: '👩‍🏫', label: 'Teacher' },
});

export function roleOf(role) {
  return AUDIT_ROLES[role] ?? { icon: '•', label: role || 'Agent' };
}

const EVIDENCE_KEYS = ['objectId', 'chunkId', 'actionId', 'voiceLineId'];

// One evidence pointer -> a human label ("obj: o3"), or null if it points at nothing.
export function refLabel(ref) {
  const key = EVIDENCE_KEYS.find((k) => ref?.[k]);
  return key ? `${key}: ${ref[key]}` : null;
}

// A one-glance summary of the debate for the collapsed header. `verified` reflects that the
// scene shipped at all — a scene the society could not ground never reaches the player.
export function summarizeTranscript(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return null;
  return {
    steps: transcript.length,
    objections: transcript.filter((m) => m.kind === 'objection').length,
    revisions: transcript.filter((m) => m.kind === 'revision').length,
    hasVerdict: transcript.some((m) => m.kind === 'verdict'),
    verified: true,
  };
}
