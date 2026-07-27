// Depth floor + keyterm coverage: BLOCKING validators (external audit: were prompt-only).

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateVoiceDepth, keytermCoverage, perChunkKeytermCoverage } from '../../lib/generation/voice/voice-lines.js';

const objs = [
  { id: 'a', renderHint: 'text' }, { id: 'b', renderHint: 'callout' },
];
const line = (id, text) => ({ id, text, targetObjectId: 'a' });
const rich = [
  line('v1', 'Imagine a small shop with three shelves, each holding twelve boxes of crayons for the winter sale, and a manager deciding where every single box should go.'),
  line('v2', 'The first shelf holds the fast movers because customers grab them without thinking twice, which is exactly why that shelf earns the most money per square meter.'),
  line('v3', 'Now watch what happens when we move a slow item onto that prime shelf position and leave everything else in the store exactly the way it was before.'),
  line('v4', 'Sales barely change at all, which tells us that position alone does not create demand for weak products no matter how visible we make them to shoppers.'),
  line('v5', 'The common mistake is assuming placement fixes everything, and it is tempting because placement is the easiest thing a manager can control on any given morning.'),
  line('v6', 'So the rule becomes simple: measure the product first, then spend your best positions on proven winners, and check the numbers again every single week.'),
  line('v7', 'Notice also what the manager did not do: nothing about the price changed, nothing about the packaging changed, only the physical position moved between the shelves.'),
  line('v8', 'That isolation is the whole trick of honest measurement — when you change exactly one thing at a time you can finally trust what the weekly numbers tell you about cause and effect inside your own store.'),
];

test('depth floor: 6+ substantial lines pass; 5 short lines throw with a repairable reason', () => {
  validateVoiceDepth(rich, objs, { role: 'intuition' });
  assert.throws(() => validateVoiceDepth(rich.slice(0, 7), objs, { role: 'intuition' }), /at least 8/);
  const thin = Array.from({ length: 9 }, (_, i) => line(`t${i}`, 'Short line here.'));
  assert.throws(() => validateVoiceDepth(thin, objs, { role: 'intuition' }), /spoken words/);
  // structurally short scenes are exempt
  validateVoiceDepth(rich.slice(0, 2), objs, { role: 'recap' });
});

test('mark coverage: narration must name at least half the figure marks', () => {
  const withImg = [...objs, { id: 'img', renderHint: 'image', content: { url: '/x.png', annotations: [
    { verb: 'encircle', text: 'fact table' }, { verb: 'arrow', text: 'dimension join' },
  ] } }];
  const naming = [...rich, line('v9', 'The fact table sits in the center, reached through the dimension join on the left.'),
    line('v10', 'That join is the whole story here.'), line('v11', 'And the fact table earns its place by holding every measure.'), line('v12', 'Notice how the dimension join carries the keys across.')].map((l, i) => (i >= 8 ? { ...l, targetObjectId: 'img' } : l));
  validateVoiceDepth(naming, withImg, { role: 'intuition' }); // names 2 of 2 (75% floor)
  assert.throws(() => validateVoiceDepth(rich, withImg, { role: 'intuition' }), /narration lines bound|teaching marks/);
});

test('keytermCoverage: measures whether the source vocabulary is actually spoken', () => {
  const source = 'Normalization removes redundancy. Normalization splits tables. Redundancy wastes storage and normalization protects consistency across tables and storage layers.';
  const good = keytermCoverage([line('v', 'Normalization removes redundancy by splitting tables so storage stays consistent.')], source);
  assert.ok(good.ratio >= 0.5);
  const bad = keytermCoverage([line('v', 'Cooking pasta requires salted boiling liquid and patience.')], source);
  assert.ok(bad.ratio < 0.25);
  assert.ok(bad.missing.includes('normalization'));
});

// PER-CHUNK coverage (audit: "chunk assigned to a scene ≠ concepts explained") — the
// global keytermCoverage concatenates chunks, so a scene rich on chunk A and silent on
// chunk B passes globally; the per-chunk check judges each chunk's own vocabulary.
const chunkA = { id: 'chunk_0001', text: 'Normalization removes redundancy. Normalization splits tables so redundancy never wastes storage; normalization protects consistency.' };
const chunkB = { id: 'chunk_0002', text: 'Indexes accelerate queries. An index stores sorted pointers so queries touch fewer pages; indexes trade write speed for read speed.' };

test('perChunkKeytermCoverage: a scene speaking BOTH chunks\' vocabulary clears every chunk', () => {
  const both = [line('v', 'Normalization removes redundancy by splitting tables, while indexes keep queries fast through sorted pointers that trade write speed for read speed.')];
  const per = perChunkKeytermCoverage(both, [chunkA, chunkB]);
  assert.equal(per.length, 2);
  assert.ok(per.every((c) => c.ratio >= 0.4), JSON.stringify(per));
});

test('perChunkKeytermCoverage: a scene ignoring one chunk fails THAT chunk by id (global check would pass it)', () => {
  const onlyA = [line('v', 'Normalization removes redundancy by splitting tables so storage stays consistent across the whole schema and redundancy never returns.')];
  const per = perChunkKeytermCoverage(onlyA, [chunkA, chunkB]);
  const skipped = per.find((c) => c.chunkId === 'chunk_0002');
  assert.ok(skipped.ratio < 0.4);
  assert.ok(skipped.missing.includes('indexes')); // the repair message can name exactly what to add
  assert.ok(per.find((c) => c.chunkId === 'chunk_0001').ratio >= 0.4); // the taught chunk still passes
});

test('perChunkKeytermCoverage: a chunk too thin to yield 3 terms is not judged (ratio 1)', () => {
  const tiny = { id: 'chunk_0003', text: 'See also page nine.' };
  const per = perChunkKeytermCoverage([line('v', 'Anything at all.')], [tiny]);
  assert.deepEqual(per, [{ chunkId: 'chunk_0003', ratio: 1, missing: [] }]);
});

test('figure scenes NEVER bypass the floor — even short roles and single-object boards', () => {
  const figOnly = [{ id: 'img', renderHint: 'image', content: { url: '/x.png', annotations: [
    { verb: 'encircle', text: 'fact table' }, { verb: 'arrow', text: 'dimension join' },
  ] } }];
  // single object + figure: floor applies (would have bypassed before the fix)
  assert.throws(() => validateVoiceDepth([line('v1', 'One short line.')], figOnly, { role: 'intuition' }), /at least 8/);
  // short role + figure: still applies
  assert.throws(() => validateVoiceDepth([line('v1', 'One short line.')], figOnly, { role: 'recap' }), /at least 8/);
});

test('teaching-moves floor: move-free filler fails even at length; real teaching passes', () => {
  const filler = Array.from({ length: 9 }, (_, i) => line(`f${i}`,
    'Data things happen in many various systems and structures across different situations generally speaking overall in practice with numerous relevant considerations involved throughout the entire broader landscape today.'));
  assert.throws(() => validateVoiceDepth(filler, objs, { role: 'intuition' }), /teaching moves/);
  // `rich` fixture has example (imagine/numbers), causal (because), misconception (mistake) => passes
  validateVoiceDepth(rich, objs, { role: 'intuition' });
});

test('anti-stuffing: keyword-sprinkled repetition fails on phrase diversity; varied teaching passes', () => {
  const stuffed = Array.from({ length: 10 }, (_, i) => line(`s${i}`,
    'Normalization is a technique because normalization removes redundancy for example normalization splits tables therefore normalization is a technique because normalization removes redundancy.'));
  assert.throws(() => validateVoiceDepth(stuffed, objs, { role: 'intuition' }), /phrase diversity/);
  validateVoiceDepth(rich, objs, { role: 'intuition' }); // varied real teaching untouched
});
