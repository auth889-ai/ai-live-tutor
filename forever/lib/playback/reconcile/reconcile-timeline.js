// The Reconciler (pure). Replaces provisional timing with REAL measured audio durations,
// then concatenates the per-line clips into one scene audio track. Built through the same
// validated compiler, so the result is a contract-valid reconciled timeline — no patching.

import { compileTimeline } from '../../generation/timeline/timeline-compiler.js';

// clips: [{ voiceLineId, durationMs, url }] in speaking order (one per voice line).
export function reconcileTimeline({ sceneId, objects, voiceLines, clips, audioUrl }) {
  const durationById = new Map();
  for (const clip of clips) {
    if (!clip.voiceLineId || !(clip.durationMs > 0)) {
      throw new Error(`reconcileTimeline: each clip needs voiceLineId and positive durationMs`);
    }
    durationById.set(clip.voiceLineId, clip.durationMs);
  }
  for (const line of voiceLines) {
    if (!durationById.has(line.id)) throw new Error(`reconcileTimeline: no measured clip for voice line ${line.id}`);
  }

  const totalMs = clips.reduce((sum, clip) => sum + clip.durationMs, 0);
  return compileTimeline({
    sceneId,
    objects,
    voiceLines,
    speechDurationFor: (line) => durationById.get(line.id),
    timingSource: 'reconciled',
    audio: { url: audioUrl, durationMs: totalMs },
  });
}
