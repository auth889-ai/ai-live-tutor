export const TIMELINE_ACTION_KINDS = Object.freeze([
  'speech',
  'write',
  'point',
  'highlight',
  'zoom',
  'reveal_code',
  'show_output',
  'quiz',
  'wipe',
]);

export const TIMELINE_TIMING_SOURCES = Object.freeze(['provisional', 'reconciled']);

const FOCUS_KINDS = new Set(['point', 'highlight', 'zoom']);
const OBJECT_TARGET_KINDS = new Set(['write', 'point', 'highlight', 'zoom', 'reveal_code', 'show_output', 'quiz']);

export function validateTimeline(timeline, { objects = [], voiceLines = [] } = {}) {
  if (!timeline.sceneId?.trim()) throw new Error('timeline.sceneId is required');
  if (!TIMELINE_TIMING_SOURCES.includes(timeline.timingSource)) {
    throw new Error(`timeline.timingSource must be one of ${TIMELINE_TIMING_SOURCES.join(', ')}`);
  }
  if (timeline.timingSource === 'reconciled') {
    if (!timeline.audio?.url?.trim() || !(timeline.audio?.durationMs > 0)) {
      throw new Error('Reconciled timeline requires audio.url and audio.durationMs — measured timing comes from real audio');
    }
  }
  if (!timeline.actions?.length) throw new Error('timeline.actions must be non-empty');

  const objectIds = new Set(objects.map((object) => object.id));
  const voiceLineById = new Map(voiceLines.map((line) => [line.id, line]));
  const ids = new Set();
  let previousStart = -1;

  for (const action of timeline.actions) {
    validateAction(action, { objectIds, voiceLineById });
    if (ids.has(action.id)) throw new Error(`Duplicate timeline action id: ${action.id}`);
    ids.add(action.id);
    if (action.startMs < previousStart) throw new Error('timeline.actions must be sorted by ascending startMs');
    previousStart = action.startMs;
  }

  assertSpeechDoesNotOverlap(timeline.actions);
  assertFocusLeadsSpeech(timeline.actions, voiceLineById);
  return timeline;
}

function validateAction(action, { objectIds, voiceLineById }) {
  if (!action.id?.trim()) throw new Error('timeline action id is required');
  const context = `action ${action.id}`;
  if (!TIMELINE_ACTION_KINDS.includes(action.kind)) {
    throw new Error(`${context} has unknown kind: ${action.kind}`);
  }
  if (!Number.isInteger(action.startMs) || action.startMs < 0) {
    throw new Error(`${context}.startMs must be a non-negative integer`);
  }
  if (!Number.isInteger(action.durationMs) || action.durationMs <= 0) {
    throw new Error(`${context}.durationMs must be a positive integer`);
  }
  if (OBJECT_TARGET_KINDS.has(action.kind)) {
    if (!action.targetObjectId?.trim()) throw new Error(`${context} (${action.kind}) requires targetObjectId`);
    if (objectIds.size && !objectIds.has(action.targetObjectId)) {
      throw new Error(`${context} targets missing board object ${action.targetObjectId}`);
    }
  }
  if (action.kind === 'speech') {
    if (!action.voiceLineId?.trim()) throw new Error(`${context} (speech) requires voiceLineId`);
    if (voiceLineById.size && !voiceLineById.has(action.voiceLineId)) {
      throw new Error(`${context} references missing voice line ${action.voiceLineId}`);
    }
  }
}

// Speech advances the one playback clock, so speech actions may never overlap.
function assertSpeechDoesNotOverlap(actions) {
  let speechEnd = -1;
  for (const action of actions) {
    if (action.kind !== 'speech') continue;
    if (action.startMs < speechEnd) {
      throw new Error(`Speech action ${action.id} overlaps previous speech — speech is synchronous on the clock`);
    }
    speechEnd = action.startMs + action.durationMs;
  }
}

// OpenMAIC rule: the teacher points BEFORE speaking about a thing. For every board
// object, the first focus action on it must not start after the first speech about it.
function assertFocusLeadsSpeech(actions, voiceLineById) {
  const firstFocusByObject = new Map();
  for (const action of actions) {
    if (FOCUS_KINDS.has(action.kind) && !firstFocusByObject.has(action.targetObjectId)) {
      firstFocusByObject.set(action.targetObjectId, action);
    }
  }
  const firstSpeechByObject = new Map();
  for (const action of actions) {
    if (action.kind !== 'speech') continue;
    const targetObjectId = voiceLineById.get(action.voiceLineId)?.targetObjectId;
    if (targetObjectId && !firstSpeechByObject.has(targetObjectId)) {
      firstSpeechByObject.set(targetObjectId, action);
    }
  }
  for (const [objectId, speech] of firstSpeechByObject) {
    const focus = firstFocusByObject.get(objectId);
    if (focus && focus.startMs > speech.startMs) {
      throw new Error(`Focus ${focus.id} on ${objectId} starts after speech ${speech.id} — focus must lead speech`);
    }
  }
}
