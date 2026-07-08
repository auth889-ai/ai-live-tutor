import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStepEvents, STEP_MARKER } from '../../lib/execution/trace/parse-steps.js';
import { traceExecution } from '../../lib/orchestration/agents/coding/execution-tracer.js';

// --- parser ---

test('parseStepEvents extracts @@STEP json, ignores other output, skips malformed', () => {
  const stdout = [
    'some debug noise',
    `${STEP_MARKER}{"line":1,"explanation":"start","array":{"current":0}}`,
    'more noise',
    `${STEP_MARKER}{"line":2,"explanation":"broken json"`, // malformed -> skipped
    `${STEP_MARKER}{"line":3,"explanation":"done","array":{"current":2}}`,
  ].join('\n');
  const steps = parseStepEvents(stdout);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].line, 1);
  assert.equal(steps[1].explanation, 'done');
});

test('parseStepEvents returns [] for empty/no-marker output', () => {
  assert.deepEqual(parseStepEvents(''), []);
  assert.deepEqual(parseStepEvents('hello\nworld'), []);
});

// --- tracer agent (injected society + executor) ---

const GOOD_JSON = {
  language: 'python',
  code: 'def bsearch(a, t):\n    lo, hi = 0, len(a)-1\n    while lo <= hi:\n        mid = (lo+hi)//2',
  views: { array: { values: [1, 3, 5, 7, 9] } },
  program: 'print("...")',
};
const GOOD_STDOUT = [
  `${STEP_MARKER}{"line":4,"explanation":"mid=2 -> 5 < 7, go right","array":{"current":2,"pointers":{"lo":0,"mid":2,"hi":4}},"variables":{"lo":0,"hi":4,"mid":2}}`,
  `${STEP_MARKER}{"line":4,"explanation":"mid=3 -> 7 found","array":{"current":3,"eliminated":[0,1,2],"pointers":{"lo":3,"mid":3,"hi":4}},"variables":{"lo":3,"hi":4,"mid":3}}`,
].join('\n');

test('traceExecution compiles a validated ExecutionTrace from a real run', async () => {
  const result = await traceExecution({
    directive: 'binary search',
    deps: {
      callQwenJson: async () => ({ json: GOOD_JSON, usage: { total_tokens: 10 } }),
      runCode: async () => ({ stdout: GOOD_STDOUT, stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.ok(result, 'a trace was produced');
  assert.equal(result.trace.steps.length, 2);
  assert.equal(result.trace.views.array.values.length, 5);
  assert.equal(result.fixes, 0);
});

test('traceExecution self-debugs: a failing first run, then a good one', async () => {
  let call = 0;
  const result = await traceExecution({
    directive: 'binary search',
    deps: {
      callQwenJson: async () => ({ json: GOOD_JSON, usage: null }),
      runCode: async () => {
        call += 1;
        return call === 1
          ? { stdout: 'no steps here', stderr: 'IndexError', timedOut: false, exitCode: 1 }
          : { stdout: GOOD_STDOUT, stderr: '', timedOut: false, exitCode: 0 };
      },
    },
  });
  assert.ok(result);
  assert.equal(result.fixes, 1); // succeeded on the second attempt
});

test('traceExecution returns null (honest) when no real valid trace can be produced', async () => {
  const result = await traceExecution({
    directive: 'binary search',
    maxFixes: 1,
    deps: {
      callQwenJson: async () => ({ json: GOOD_JSON, usage: null }),
      runCode: async () => ({ stdout: 'never prints steps', stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.equal(result, null);
});

test('quality gate: a queue-driven algorithm must SHOW the queue at each step (repair demanded)', async () => {
  const BFS_JSON = {
    language: 'python',
    code: 'from collections import deque\ndef bfs(root):\n    queue = deque([root])\n    while queue:\n        node = queue.popleft()',
    views: { graph: { nodes: [{ id: '1' }, { id: '2' }], edges: [{ from: '1', to: '2', side: 'left' }], directed: true } },
    program: 'print("...")',
  };
  const noQueue = `${STEP_MARKER}{"line":5,"explanation":"dequeue 1","graph":{"current":"1","visited":["1"],"pointers":{"curr":"1"}}}`;
  const withQueue = `${STEP_MARKER}{"line":5,"explanation":"dequeue 1","graph":{"current":"1","visited":["1"],"pointers":{"curr":"1"}},"queue":["2"]}`;
  const errors = [];
  let call = 0;
  const result = await traceExecution({
    directive: 'BFS level order traversal',
    deps: {
      callQwenJson: async ({ system }) => {
        if (call > 0) errors.push(system);
        return { json: BFS_JSON, usage: null };
      },
      runCode: async () => ({ stdout: (call += 1) === 1 ? noQueue : withQueue, stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.ok(result, 'repaired trace accepted');
  assert.equal(result.fixes, 1);
  assert.match(errors[0], /NO step carries "queue"/);
  assert.deepEqual(result.trace.steps[0].queue, ['2']);
});

test('traceExecution rejects a trace that references a node/index not in views', async () => {
  const badStdout = `${STEP_MARKER}{"line":4,"explanation":"oops","array":{"current":99}}`;
  const result = await traceExecution({
    directive: 'binary search',
    maxFixes: 0,
    deps: {
      callQwenJson: async () => ({ json: GOOD_JSON, usage: null }),
      runCode: async () => ({ stdout: badStdout, stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.equal(result, null); // validation caught the out-of-bounds index -> no fake trace
});
