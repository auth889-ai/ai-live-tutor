// Deterministic timeline compiler — NO LLM. Turns board objects + voice lines into a
// contract-valid action timeline: teacher points, then speaks while writing
// (focus-leads-speech by construction).
//
// ONE builder, two timing sources (playbook Phase 2 decision): the caller injects
// speechDurationFor(line). Provisional passes a word-count estimate; the reconciler
// passes REAL measured clip durations from TTS. The reconciled timeline is therefore
// built by the same validated compiler, not patched after the fact.

import { validateTimeline } from './timeline-actions.js';

const WORD_MS = 380; // provisional speaking pace, replaced by measured TTS timing
const FOCUS_MS = 600;
const FOCUS_LEAD_MS = 200;
const GAP_MS = 300;

function estimateSpeechMs(line) {
  return Math.max(1500, line.text.split(/\s+/).filter(Boolean).length * WORD_MS);
}

export function compileTimeline({
  sceneId,
  objects,
  voiceLines,
  speechDurationFor = estimateSpeechMs,
  timingSource = 'provisional',
  audio = null,
}) {
  // Multiple narration lines per object (deep teaching): group in array order.
  const linesByObject = new Map();
  for (const line of voiceLines) {
    if (!linesByObject.has(line.targetObjectId)) linesByObject.set(line.targetObjectId, []);
    linesByObject.get(line.targetObjectId).push(line);
  }
  const actions = [];
  let cursor = 0;

  for (const object of objects) {
    const lines = linesByObject.get(object.id) ?? [];
    actions.push({
      id: `act_point_${object.id}`,
      kind: 'point',
      startMs: Math.round(cursor),
      durationMs: FOCUS_MS,
      targetObjectId: object.id,
    });

    let blockEnd = cursor + FOCUS_MS;
    if (lines.length) {
      // Chain the object's narration lines back-to-back; the write spans them all.
      const speechStart = cursor + FOCUS_LEAD_MS;
      let speechCursor = speechStart;
      lines.forEach((line, index) => {
        const speechMs = Math.max(1000, Math.round(speechDurationFor(line)));
        actions.push({
          id: `act_speak_${object.id}_${index}`,
          kind: 'speech',
          startMs: Math.round(speechCursor),
          durationMs: speechMs,
          voiceLineId: line.id,
        });
        speechCursor += speechMs;
      });
      const totalSpeechMs = speechCursor - speechStart;

      const writeKind = object.renderHint === 'code' ? 'reveal_code' : 'write';
      const writeMs = Math.max(1000, Math.round(totalSpeechMs * 0.9));
      actions.push({
        id: `act_write_${object.id}`,
        kind: writeKind,
        startMs: Math.round(speechStart + 100),
        durationMs: writeMs,
        targetObjectId: object.id,
      });
      blockEnd = Math.max(speechCursor, speechStart + 100 + writeMs);

      // A code object with real executed output reveals that output right after the code
      // finishes writing — so the board shows the program actually running.
      if (object.renderHint === 'code' && object.output != null) {
        const outputStart = speechStart + 100 + writeMs;
        actions.push({
          id: `act_output_${object.id}`,
          kind: 'show_output',
          startMs: Math.round(outputStart),
          durationMs: 500,
          targetObjectId: object.id,
        });
        blockEnd = Math.max(blockEnd, outputStart + 500);
      }
    }
    cursor = blockEnd + GAP_MS;
  }

  const timeline = { sceneId, timingSource, actions };
  if (audio) timeline.audio = audio;
  validateTimeline(timeline, { objects, voiceLines });
  return { timeline, durationMs: Math.round(cursor) };
}

// Provisional timing (pre-TTS): word-count estimate.
export function compileProvisionalTimeline({ sceneId, objects, voiceLines }) {
  return compileTimeline({ sceneId, objects, voiceLines });
}
