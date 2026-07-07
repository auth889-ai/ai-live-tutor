// The Reconciler (pure). Rebuilds the timeline to match the REAL synthesized audio: the
// scene's clips are concatenated in voice-line order (gapless), so each speech action sits
// at its true offset in that audio, and the board writing/pointer align to it. This is
// what makes the handwriting land on the spoken words. Produces a contract-valid
// reconciled timeline. Honest failure if any voice line has no measured clip.

import { validateTimeline } from '../../generation/timeline/timeline-actions.js';

const POINT_LEAD_MS = 200;
const POINT_MS = 600;

// clips: [{ voiceLineId, durationMs }] — must cover every voice line. voiceLines are in
// speaking order (the same order the audio was concatenated).
export function reconcileTimeline({ sceneId, objects, voiceLines, clips, audioUrl }) {
  const durationById = new Map();
  for (const clip of clips) {
    if (!clip.voiceLineId || !(clip.durationMs > 0)) throw new Error('reconcileTimeline: each clip needs voiceLineId and positive durationMs');
    durationById.set(clip.voiceLineId, clip.durationMs);
  }

  // Assign each line its true offset in the gapless concatenated audio. When the TTS
  // returned word timings, shift them to ABSOLUTE clock times too — word-level sync
  // (karaoke subtitles, word-anchored highlights) rides on these.
  const wordsById = new Map();
  for (const clip of clips) {
    if (Array.isArray(clip.wordTimings) && clip.wordTimings.length) wordsById.set(clip.voiceLineId, clip.wordTimings);
  }
  const timingByLine = new Map();
  const enrichedLines = [];
  let offset = 0;
  for (const line of voiceLines) {
    const durationMs = durationById.get(line.id);
    if (!(durationMs > 0)) throw new Error(`reconcileTimeline: no measured clip for voice line ${line.id}`);
    timingByLine.set(line.id, { startMs: offset, durationMs });
    const words = wordsById.get(line.id);
    enrichedLines.push(
      words
        ? { ...line, words: words.map((w) => ({ word: w.word, startMs: w.startMs + offset, endMs: w.endMs + offset })) }
        : line,
    );
    offset += durationMs;
  }
  const totalMs = offset;

  const linesByObject = new Map();
  for (const line of voiceLines) {
    if (!linesByObject.has(line.targetObjectId)) linesByObject.set(line.targetObjectId, []);
    linesByObject.get(line.targetObjectId).push(line);
  }

  const actions = [];
  for (const object of objects) {
    const lines = linesByObject.get(object.id) ?? [];
    if (lines.length === 0) continue;
    const first = timingByLine.get(lines[0].id);
    const last = timingByLine.get(lines[lines.length - 1].id);

    actions.push({
      id: `act_point_${object.id}`,
      kind: 'point',
      startMs: Math.max(0, first.startMs - POINT_LEAD_MS),
      durationMs: POINT_MS,
      targetObjectId: object.id,
    });
    lines.forEach((line, index) => {
      const timing = timingByLine.get(line.id);
      actions.push({
        id: `act_speak_${object.id}_${index}`,
        kind: 'speech',
        startMs: timing.startMs,
        durationMs: timing.durationMs,
        voiceLineId: line.id,
      });
    });
    const writeEnd = last.startMs + last.durationMs;
    actions.push({
      id: `act_write_${object.id}`,
      kind: object.renderHint === 'code' ? 'reveal_code' : 'write',
      startMs: first.startMs,
      durationMs: Math.max(1000, writeEnd - first.startMs),
      targetObjectId: object.id,
    });
    if (object.renderHint === 'code' && object.output != null) {
      actions.push({ id: `act_output_${object.id}`, kind: 'show_output', startMs: writeEnd, durationMs: 500, targetObjectId: object.id });
    }
  }

  actions.sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  const timeline = { sceneId, timingSource: 'reconciled', audio: { url: audioUrl, durationMs: totalMs }, actions };
  validateTimeline(timeline, { objects, voiceLines });
  return { timeline, durationMs: totalMs, voiceLines: enrichedLines };
}
