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
  const lineByObject = new Map(voiceLines.map((line) => [line.targetObjectId, line]));
  const actions = [];
  let cursor = 0;

  for (const object of objects) {
    const line = lineByObject.get(object.id);
    actions.push({
      id: `act_point_${object.id}`,
      kind: 'point',
      startMs: Math.round(cursor),
      durationMs: FOCUS_MS,
      targetObjectId: object.id,
    });

    let blockEnd = cursor + FOCUS_MS;
    if (line) {
      const speechMs = Math.max(1000, Math.round(speechDurationFor(line)));
      const speechStart = cursor + FOCUS_LEAD_MS;
      actions.push({
        id: `act_speak_${object.id}`,
        kind: 'speech',
        startMs: Math.round(speechStart),
        durationMs: speechMs,
        voiceLineId: line.id,
      });
      const writeKind = object.renderHint === 'code' ? 'reveal_code' : 'write';
      const writeMs = Math.max(1000, Math.round(speechMs * 0.9));
      actions.push({
        id: `act_write_${object.id}`,
        kind: writeKind,
        startMs: Math.round(speechStart + 100),
        durationMs: writeMs,
        targetObjectId: object.id,
      });
      blockEnd = Math.max(speechStart + speechMs, speechStart + 100 + writeMs);

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
