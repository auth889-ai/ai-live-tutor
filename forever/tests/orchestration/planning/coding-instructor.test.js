import assert from 'node:assert/strict';
import test from 'node:test';

import { designCodingLesson, isCodingDomain, CODING_DOMAINS } from '../../../lib/orchestration/agents/planning/coding-instructor.js';

const sourcePack = {
  title: 'Binary Search Notes',
  chunks: [
    { id: 'chunk_0001', text: 'Binary search halves a sorted array...' },
    { id: 'chunk_0002', text: 'A common mistake is (low+high)/2 overflow...' },
  ],
};

const goodPlan = {
  lessonTitle: 'Binary Search: From Brute Force to O(log n)',
  scenes: [
    { title: 'The Interview Question', pedagogicalRole: 'motivate', directive: 'Open with arr=[2,5,8,12,16,23,38,56], target=23 as asked at a FAANG screen. Python. Board: the exact question.', focusChunkIds: ['chunk_0001'] },
    { title: 'Dry Run: Eliminating Half the Array', pedagogicalRole: 'dry_run', directive: 'Trace binary search on arr=[2,5,8,12,16,23,38,56], target=23 in python; narration states each comparison decision.', focusChunkIds: ['chunk_0001'] },
    { title: 'The Overflow Bug', pedagogicalRole: 'edge_cases', directive: 'Show mid=(low+high)/2 failing on large indexes; the fix low+(high-low)/2; board: mistake list with failing input.', focusChunkIds: ['chunk_0002'] },
  ],
};

test('designCodingLesson returns the validated arc when the model plans well', async () => {
  const systems = [];
  const result = await designCodingLesson({
    sourcePack,
    deps: { callQwenJson: async ({ system }) => { systems.push(system); return { json: goodPlan, usage: { total: 1 } }; } },
  });
  assert.equal(result.scenes.length, 3);
  assert.equal(result.scenes[1].pedagogicalRole, 'dry_run');
  assert.match(systems[0], /brute→better→optimal|brute->better->optimal/i);
  assert.match(systems[0], /dry_run/);
});

test('a plan without a dry_run scene is rejected once and repaired', async () => {
  let calls = 0;
  const noTrace = { ...goodPlan, scenes: goodPlan.scenes.filter((s) => s.pedagogicalRole !== 'dry_run') };
  const result = await designCodingLesson({
    sourcePack,
    deps: {
      callQwenJson: async ({ system }) => {
        calls += 1;
        if (calls === 1) return { json: noTrace, usage: null };
        assert.match(system, /REJECTED.*no dry_run/s);
        return { json: goodPlan, usage: null };
      },
    },
  });
  assert.equal(calls, 2);
  assert.ok(result.scenes.some((s) => s.pedagogicalRole === 'dry_run'));
});

test('two invalid plans in a row fail honestly (never a fake lesson plan)', async () => {
  await assert.rejects(
    designCodingLesson({ sourcePack, deps: { callQwenJson: async () => ({ json: { scenes: [] }, usage: null }) } }),
    /could not produce a valid lesson plan/,
  );
});

test('scenes citing unknown chunks are dropped; only coding domains route here', async () => {
  const sloppy = {
    lessonTitle: 'X',
    scenes: [
      ...goodPlan.scenes,
      { title: 'Ghost', pedagogicalRole: 'recap', directive: 'cites a chunk that does not exist', focusChunkIds: ['chunk_9999'] },
    ],
  };
  const result = await designCodingLesson({ sourcePack, deps: { callQwenJson: async () => ({ json: sloppy, usage: null }) } });
  assert.equal(result.scenes.length, 3); // ghost dropped
  assert.deepEqual([...CODING_DOMAINS], ['dsa', 'programming']);
  assert.ok(isCodingDomain('dsa') && isCodingDomain('programming') && !isCodingDomain('ml_ai'));
});
