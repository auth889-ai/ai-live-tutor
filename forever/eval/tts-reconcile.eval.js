// LIVE eval (spends tokens; run intentionally):
//   node --env-file=.env eval/tts-reconcile.eval.js "<teaching text>"
// Full Phase 2 proof: text -> agents -> scene -> REAL TTS per line -> measured
// durations -> reconciled (word-synced) timeline. Writes audio clips to eval/out/.

import { mkdirSync, writeFileSync } from 'node:fs';
import { generateSceneFromText } from '../lib/generation/scene/generate-scene.js';
import { synthesizeLine } from '../lib/tts/synthesize.js';
import { reconcileTimeline } from '../lib/playback/reconcile/reconcile-timeline.js';

const text = process.argv[2];
if (!text || text.trim().length < 40) {
  console.error('Usage: node --env-file=.env eval/tts-reconcile.eval.js "<teaching text, 40+ chars>"');
  process.exit(1);
}

mkdirSync('eval/out', { recursive: true });
const { scene } = await generateSceneFromText(text);
console.log(`Scene: ${scene.objects.length} board objects, ${scene.voiceLines.length} voice lines. Synthesizing...`);

const clips = [];
for (const line of scene.voiceLines) {
  const clip = await synthesizeLine({ text: line.text });
  const file = `eval/out/${scene.sceneId}_${line.id}.audio`;
  writeFileSync(file, clip.bytes);
  clips.push({ voiceLineId: line.id, durationMs: clip.durationMs, url: clip.url });
  console.log(`  ${line.id}: ${(clip.durationMs / 1000).toFixed(2)}s -> ${file}`);
}

const { timeline, durationMs } = reconcileTimeline({
  sceneId: scene.sceneId,
  objects: scene.objects,
  voiceLines: scene.voiceLines,
  clips,
  audioUrl: 'concat-of-clips',
});

console.log(`\nReconciled timeline: ${timeline.actions.length} actions, real total ${(durationMs / 1000).toFixed(1)}s, timingSource=${timeline.timingSource}`);
console.log('Speech durations are now MEASURED from the actual audio, not estimated. Board writing is bound to these real timings.');
