// Deterministic timeline compiler — NO LLM. Turns board objects + voice lines into a
// provisional, contract-valid action timeline: teacher points, then speaks while
// writing (focus-leads-speech by construction). Phase 2's reconciler replaces these
// provisional durations with measured word timestamps.

import { validateTimeline } from './timeline-actions.js';

const WORD_MS = 380; // provisional speaking pace; replaced by real TTS alignment
const FOCUS_MS = 600;
const FOCUS_LEAD_MS = 200;
const GAP_MS = 300;

export function compileProvisionalTimeline({ sceneId, objects, voiceLines }) {
  const lineByObject = new Map(voiceLines.map((line) => [line.targetObjectId, line]));
  const actions = [];
  let cursor = 0;

  for (const object of objects) {
    const line = lineByObject.get(object.id);
    actions.push({
      id: `act_point_${object.id}`,
      kind: 'point',
      startMs: cursor,
      durationMs: FOCUS_MS,
      targetObjectId: object.id,
    });

    let blockEnd = cursor + FOCUS_MS;
    if (line) {
      const speechMs = Math.max(1500, line.text.split(/\s+/).filter(Boolean).length * WORD_MS);
      const speechStart = cursor + FOCUS_LEAD_MS;
      actions.push({
        id: `act_speak_${object.id}`,
        kind: 'speech',
        startMs: speechStart,
        durationMs: speechMs,
        voiceLineId: line.id,
      });
      const writeKind = object.renderHint === 'code' ? 'reveal_code' : 'write';
      actions.push({
        id: `act_write_${object.id}`,
        kind: writeKind,
        startMs: speechStart + 100,
        durationMs: Math.max(1000, Math.round(speechMs * 0.9)),
        targetObjectId: object.id,
      });
      blockEnd = Math.max(speechStart + speechMs, speechStart + 100 + Math.round(speechMs * 0.9));
    }
    cursor = blockEnd + GAP_MS;
  }

  const timeline = { sceneId, timingSource: 'provisional', actions };
  validateTimeline(timeline, { objects, voiceLines });
  return { timeline, durationMs: cursor };
}
