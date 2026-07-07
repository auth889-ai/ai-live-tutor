import { buildTextSourcePack } from './lib/source-pack/build/source-pack.js';
import { generateSceneFromSourcePack } from './lib/generation/scene/generate-scene.js';

const text = 'Binary search finds a target in a sorted array by repeatedly halving the search range. ' +
  'Set low=0 and high=n-1. Compute mid=(low+high)/2. If arr[mid]==target return mid. ' +
  'If arr[mid]<target set low=mid+1 else high=mid-1. Repeat until found or low>high.';
const sp = buildTextSourcePack(text);
const brief = { title: 'Dry Run', pedagogicalRole: 'dry_run', directive: 'Dry-run binary search for 11 in [1,3,5,7,9,11,13], step by step.' };
console.log('generating dry-run scene (board director + execution tracer + real run)...');
const r = await generateSceneFromSourcePack(sp, { sceneId: 'sc_test', brief });
const algo = r.scene.objects.find(o => o.renderHint === 'algorithm');
console.log('\n=== RESULT ===');
console.log('objects:', r.scene.objects.map(o => o.renderHint).join(', '));
if (algo) {
  console.log('ALGORITHM object present. language=', algo.content.language, '| steps=', algo.content.steps.length, '| views=', Object.keys(algo.content.views||{}).join(','));
  const algoLines = r.scene.voiceLines.filter(v => v.targetObjectId === algo.id);
  console.log('per-step voice lines:', algoLines.length, '| all have traceStep:', algoLines.every(v => Number.isInteger(v.traceStep)));
  console.log('SYNC CHECK (voice text == step explanation, same source):', algoLines.every((v,i) => v.text === algo.content.steps[v.traceStep].explanation));
  console.log('\nfirst 2 steps:');
  algo.content.steps.slice(0,2).forEach((s,i)=>console.log(`  step ${i}: L${s.line} | ${s.explanation} | array=${JSON.stringify(s.array||s.graph||{})}`));
} else {
  console.log('NO algorithm object (tracer returned null) — fell back to code demo.');
}
process.exit(0);
