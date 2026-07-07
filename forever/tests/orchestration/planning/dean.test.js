import assert from 'node:assert/strict';
import test from 'node:test';

import { designCourseOutline } from '../../../lib/orchestration/agents/planning/dean.js';

const sourcePack = {
  id: 'sp_dean01',
  title: 'BFS Notes',
  chunks: [
    { id: 'chunk_0001', text: 'BFS explores level by level with a queue...' },
    { id: 'chunk_0002', text: 'Common BFS mistakes and complexity...' },
  ],
};

const goodOutline = {
  title: 'Graph Traversal: BFS from Zero to Interview-Ready',
  episodes: [
    {
      id: 'ep_01', title: 'BFS Fundamentals', estimatedMinutes: 45, quizQuestionCount: 4,
      lessons: [
        { id: 'ep_01_l_01', title: 'Why Level-by-Level Wins', lessonType: 'concept', estimatedMinutes: 8, objective: 'Explain when BFS beats DFS', focusChunkIds: ['chunk_0001'] },
        { id: 'ep_01_l_02', title: 'Dry Run: BFS With a Real Queue', lessonType: 'see_it', estimatedMinutes: 10, objective: 'Trace BFS by hand', focusChunkIds: ['chunk_0001', 'chunk_0002'] },
        { id: 'ep_01_l_03', title: 'The Mistakes Everyone Makes', lessonType: 'pitfalls', estimatedMinutes: 6, objective: 'Avoid duplicate enqueues', focusChunkIds: ['chunk_0002'] },
      ],
    },
  ],
};

test('the Dean returns a validated outline (episodes -> lessons with focus chunks)', async () => {
  const { outline } = await designCourseOutline({
    sourcePack,
    deps: { callQwenJson: async () => ({ json: goodOutline, usage: null }) },
  });
  assert.equal(outline.sourcePackId, 'sp_dean01');
  assert.equal(outline.episodes[0].lessons.length, 3);
  assert.equal(outline.episodes[0].lessons[0].lessonType, 'concept'); // opens with concept
});

test('a contract-violating outline is rejected once with the exact problem, then repaired', async () => {
  let calls = 0;
  const badFirst = { ...goodOutline, episodes: [{ ...goodOutline.episodes[0], estimatedMinutes: 10 }] }; // < 30min
  const { outline } = await designCourseOutline({
    sourcePack,
    deps: {
      callQwenJson: async ({ system }) => {
        calls += 1;
        if (calls === 1) return { json: badFirst, usage: null };
        assert.match(system, /REJECTED.*30-90 minutes/s);
        return { json: goodOutline, usage: null };
      },
    },
  });
  assert.equal(calls, 2);
  assert.equal(outline.episodes[0].estimatedMinutes, 45);
});

test('two invalid outlines fail honestly', async () => {
  await assert.rejects(
    designCourseOutline({ sourcePack, deps: { callQwenJson: async () => ({ json: { episodes: [] }, usage: null }) } }),
    /Dean could not produce a valid course outline/,
  );
});
