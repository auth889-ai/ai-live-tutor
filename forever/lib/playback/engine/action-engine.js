// The playback core: derive the full board state at clock time tMs from a validated
// timeline. PURE — no state accumulates between frames, so seeking to any time renders
// exactly the state that continuous playback would have reached (ENGINEERING_PLAYBOOK
// Phase 1 findings). The renderer calls this once per animation frame with
// <audio>.currentTime; tests call it with plain numbers.

export function boardStateAt(timeline, tMs) {
  if (!Number.isFinite(tMs) || tMs < 0) throw new Error(`boardStateAt requires a non-negative time, got ${tMs}`);

  const state = {
    // objectId -> { progress: 0..1 } for stroke-reveal; present = visible on board
    writing: new Map(),
    pointer: null, // targetObjectId the teacher's pointer rests on
    highlights: new Set(), // objectIds actively emphasized
    zoom: null, // targetObjectId being zoomed, or null
    activeSpeech: null, // voiceLineId currently spoken (drives subtitle)
    codeReveal: new Map(), // objectId -> { progress } for code typing reveal
    outputShown: new Set(), // objectIds whose captured output is on screen
    activeQuiz: null, // targetObjectId of a quiz prompt (player pauses the clock)
  };

  for (const action of timeline.actions) {
    if (action.startMs > tMs) break; // actions are contract-sorted by startMs
    applyAction(state, action, tMs);
  }
  return state;
}

function applyAction(state, action, tMs) {
  const endMs = action.startMs + action.durationMs;
  const withinWindow = tMs < endMs;
  const progress = clamp01((tMs - action.startMs) / action.durationMs);

  switch (action.kind) {
    case 'write':
      state.writing.set(action.targetObjectId, { progress });
      break;
    case 'wipe':
      // The board is cleared of everything written before the wipe began.
      state.writing.clear();
      state.codeReveal.clear();
      state.outputShown.clear();
      state.highlights.clear();
      state.pointer = null;
      state.zoom = null;
      break;
    case 'point':
      // Fire-and-forget: the pointer moves and RESTS there until the next point/wipe.
      state.pointer = action.targetObjectId;
      break;
    case 'highlight':
      if (withinWindow) state.highlights.add(action.targetObjectId);
      else state.highlights.delete(action.targetObjectId);
      break;
    case 'zoom':
      state.zoom = withinWindow ? action.targetObjectId : null;
      break;
    case 'speech':
      state.activeSpeech = withinWindow ? action.voiceLineId : null;
      break;
    case 'reveal_code':
      state.codeReveal.set(action.targetObjectId, { progress });
      break;
    case 'show_output':
      // Output appears when the run "lands" and stays: real output does not un-print.
      state.outputShown.add(action.targetObjectId);
      break;
    case 'quiz':
      state.activeQuiz = withinWindow ? action.targetObjectId : null;
      break;
    default:
      throw new Error(`action-engine cannot apply unknown action kind: ${action.kind}`);
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
