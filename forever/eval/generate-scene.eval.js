// LIVE eval (spends tokens — run intentionally, never in npm test):
//   node --env-file=.env eval/generate-scene.eval.js "<any teaching text>"
// Proves the dynamic pipeline: arbitrary text -> real Qwen agents -> playable scene.

import { generateSceneFromText } from '../lib/generation/scene/generate-scene.js';

const text = process.argv[2];
if (!text || text.trim().length < 40) {
  console.error('Usage: node --env-file=.env eval/generate-scene.eval.js "<teaching text, 40+ chars>"');
  process.exit(1);
}

const started = Date.now();
const result = await generateSceneFromText(text);

console.log('=== GENERATED SCENE (no human wrote this) ===');
for (const object of result.scene.objects) {
  console.log(`\n[${object.renderHint}] ${object.objectType} @ ${object.region}:${object.lineNumber ?? 0} (cites ${object.sourceRef.chunkId})`);
  console.log(typeof object.content === 'string' ? object.content : object.content.items.map((item) => `  • ${item}`).join('\n'));
}
console.log('\n=== TUTOR VOICE ===');
for (const line of result.scene.voiceLines) console.log(`(${line.targetObjectId}) "${line.text}"`);
console.log(`\n=== SOCIETY DEBATE (${result.reviewRounds} revision round(s)) ===`);
for (const message of result.transcript) {
  const who = message.fromRole.replace(/_/g, ' ');
  console.log(`  [${message.kind}] ${who}: ${message.body}`);
}

console.log(`\n=== TIMELINE === ${result.timeline.actions.length} actions, ${(result.durationMs / 1000).toFixed(1)}s, contract-valid`);
const flat = [...(result.usage.review ?? []), result.usage.voiceWriter].filter(Boolean);
const tokens = flat.reduce((sum, u) => sum + (u.total_tokens ?? 0), 0);
console.log(`Tokens: ${tokens} across ${flat.length} focused agent calls · wall ${(Date.now() - started) / 1000}s`);
