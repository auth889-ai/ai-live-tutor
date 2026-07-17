// These tests exercise the AI-authored program mode machinery itself — the research escape
// hatch is set explicitly; production never sets it, so Python always uses the real recorder.
process.env.ALLOW_AI_TRACES = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStepEvents, STEP_MARKER } from '../../lib/execution/trace/parse-steps.js';
import { traceExecution, dryRunQualityIssue } from '../../lib/orchestration/agents/coding/execution-tracer.js';

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
  `${STEP_MARKER}{"line":4,"explanation":"We probe the middle: mid=2 holds the value 5, and 5 is less than our target 7. The target must live in the right half, so low jumps to mid+1 and the left half is eliminated.","array":{"current":2,"pointers":{"lo":0,"mid":2,"hi":4}},"variables":{"lo":0,"hi":4,"mid":2}}`,
  `${STEP_MARKER}{"line":4,"explanation":"The new middle: mid=3 holds exactly 7 — that is our target, so the search ends here and we return index 3. Notice how the pointers collapsed around the answer in just two probes.","array":{"current":3,"eliminated":[0,1,2],"pointers":{"lo":3,"mid":3,"hi":4}},"variables":{"lo":3,"hi":4,"mid":3}}`,
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
  const RICH = 'We dequeue node 1 from the front — it is the first node of this level, so we visit it and record it in the traversal order before looking at its children.';
  const noQueue = `${STEP_MARKER}{"line":5,"explanation":"${RICH}","graph":{"current":"1","visited":["1"],"pointers":{"curr":"1"}}}`;
  const withQueue = `${STEP_MARKER}{"line":5,"explanation":"${RICH}","graph":{"current":"1","visited":["1"],"pointers":{"curr":"1"}},"queue":["2"]}`;
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

test('quality gate: one-line stub explanations are rejected and repaired to tutor voice', async () => {
  const thin = `${STEP_MARKER}{"line":4,"explanation":"Visit node 1","array":{"current":0,"pointers":{"lo":0}}}`;
  const errors = [];
  let call = 0;
  const result = await traceExecution({
    directive: 'binary search',
    deps: {
      callQwenJson: async ({ system }) => {
        if (call > 0) errors.push(system);
        return { json: GOOD_JSON, usage: null };
      },
      runCode: async () => ({ stdout: (call += 1) === 1 ? thin : GOOD_STDOUT, stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.ok(result);
  assert.equal(result.fixes, 1);
  assert.match(errors[0], /one-line stubs/);
  assert.ok(result.trace.steps.every((s) => s.explanation.length >= 50), 'repaired trace speaks in full sentences');
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

// --- no-downgrade contract (user's standing order: never fall back to a weaker trace) ---

test('retry prompt NEVER advertises line-sim as an escape hatch; it forbids downgrading', async () => {
  const prompts = [];
  const result = await traceExecution({
    directive: 'binary search',
    maxFixes: 3,
    deps: {
      callQwenJson: async ({ system }) => {
        prompts.push(system);
        return { json: GOOD_JSON, usage: null };
      },
      runCode: async () => ({ stdout: prompts.length >= 4 ? GOOD_STDOUT : 'boom', stderr: 'Error', timedOut: false, exitCode: 1 }),
    },
  });
  assert.ok(result, 'eventually succeeds without ever downgrading');
  assert.equal(prompts.length, 4);
  for (const p of prompts) {
    assert.doesNotMatch(p, /SWITCH TO LINE-SIM/i, 'the escape hatch must stay dead');
    assert.doesNotMatch(p, /cannot fail|cannot produce a wrong trace|SAFE fallback/i, 'line-sim is a classification, not a safety net');
  }
  assert.match(prompts[1], /never drop to a weaker representation/i);
});

test('quality gate applies to ENGINE traces too: line-sim of a stack algorithm is rejected, mode moves UP', async () => {
  const LINESIM_JSON = {
    language: 'python',
    code: 'def demo():\n    stack = []\n    stack.append(7)\n    return stack',
    views: {},
    linesim: { entry: 'demo()' },
  };
  const OPS_JSON = {
    language: 'python',
    code: 'stack = []\nstack.append(7)\nstack.pop()',
    views: {},
    operations: { structure: 'stack', ops: [{ op: 'push', value: 7 }, { op: 'pop' }], lines: { push: 2, pop: 3 } },
  };
  const LINESIM_STDOUT = '@@LINESIM {"events":[{"line":2,"fn":"demo","locals":{}},{"line":3,"fn":"demo","locals":{"stack":[]}},{"line":4,"fn":"demo","locals":{"stack":[7]}}],"result":[7]}';
  const prompts = [];
  const result = await traceExecution({
    directive: 'teach how a stack works with push and pop',
    deps: {
      callQwenJson: async ({ system }) => {
        prompts.push(system);
        return { json: prompts.length === 1 ? LINESIM_JSON : OPS_JSON, usage: null };
      },
      runCode: async () => ({ stdout: LINESIM_STDOUT, stderr: '', timedOut: false, exitCode: 0 }),
    },
  });
  assert.ok(result, 'the richer operations trace is accepted');
  assert.equal(result.fixes, 1);
  assert.match(prompts[1], /NO step carries "stack"/, 'the gate names exactly what the weak trace hid');
  assert.ok(result.trace.steps.every((s) => Array.isArray(s.stack)), 'the accepted trace SHOWS the stack at every step');
});

test('malformed @@STEP lines are counted and repaired — a dry run never ships with silent holes', async () => {
  const oneGood = `${STEP_MARKER}{"line":4,"explanation":"We probe the middle of the array: mid lands on index 2 where the value is 5, and 5 is smaller than the target, so the whole left half can be ruled out.","array":{"current":2,"pointers":{"mid":2}}}`;
  const broken = `${STEP_MARKER}{"line":4,"explanation":"half-printed`; // hand-formatted, not serialized
  const prompts = [];
  const result = await traceExecution({
    directive: 'binary search',
    deps: {
      callQwenJson: async ({ system }) => {
        prompts.push(system);
        return { json: GOOD_JSON, usage: null };
      },
      runCode: async () => ({
        stdout: prompts.length === 1 ? `${oneGood}\n${broken}` : GOOD_STDOUT,
        stderr: '', timedOut: false, exitCode: 0,
      }),
    },
  });
  assert.ok(result, 'repaired on the second attempt');
  assert.equal(result.fixes, 1);
  assert.match(prompts[1], /1 @@STEP line\(s\) were malformed JSON.*json\.dumps/s, 'the repair demand names the structural fix');
});

test('LC200 regression: a 2-step call->return junk trace for loopy code is rejected, steering to auto mode', () => {
  // The exact junk shape that shipped: nested-closure flood fill, legacy mode, outer call only.
  const junk = [
    { line: 15, explanation: 'We start by calling numIslands on the grid. Watch the tree grow downward as recursive calls open.', graph: { current: '0', visited: ['0'], revealed: ['0'], pointers: { call: '0' } }, stack: ['numIslands(grid)'] },
    { line: 16, explanation: 'After exploring every cell systematically, the algorithm reports back: exactly 2 islands were found in this grid.', graph: { current: '0', visited: ['0'], revealed: ['0'], returned: { 0: 2 }, pointers: { call: '0' } }, stack: [] },
  ];
  const code = 'def numIslands(grid):\n    for r in range(len(grid)):\n        for c in range(len(grid[0])):\n            pass';
  const issue = dryRunQualityIssue({ steps: junk, directive: 'dry run: watch DFS sink island cell by cell', code });
  assert.match(issue, /auto/, 'the repair message prescribes the universal auto mode');
  // A tight legit 2-step ARRAY trace stays legal (the binary-search contract above).
  const legal = [
    { line: 4, explanation: 'We probe the middle: mid=2 holds 5, less than target 7, so low jumps to mid+1 and the left half is eliminated entirely.', array: { current: 2, pointers: { lo: 0, mid: 2, hi: 4 } } },
    { line: 4, explanation: 'The new middle mid=3 holds exactly 7 — the target. The search ends and we return index 3 after two probes.', array: { current: 3, pointers: { lo: 3, mid: 3, hi: 4 } } },
  ];
  assert.equal(dryRunQualityIssue({ steps: legal, directive: 'binary search dry run', code }), null);
});

test('LC1192 regression: recursion mode on adjacency-walking code is rejected, steering to auto', () => {
  // Live-caught: Tarjan chose recursion mode (dfs IS recursive) and shipped the call tree
  // instead of the network with disc/low labels. The gate reads the CODE, not the steps —
  // any recursive adjacency walk belongs to a graph lens.
  const tarjan = 'def critical_connections(n, connections):\n    def dfs(u, parent):\n        for v in adj[u]:\n            pass';
  const richSteps = Array.from({ length: 8 }, (_, i) => ({
    line: 3,
    explanation: `Call ${i} opens and the tree grows one frame deeper — watch the traversal walk into fresh territory here.`,
    graph: { current: String(i), visited: [String(i)], revealed: [String(i)], pointers: { call: String(i) } },
    stack: [`dfs(${i})`],
  }));
  const issue = dryRunQualityIssue({ steps: richSteps, directive: 'Tarjan bridges dry run', code: tarjan, tool: 'recursion' });
  assert.match(issue, /WALKS A GRAPH.*auto/s, 'prescribes auto with the reason');
  // Plain recursion (fib) in recursion mode stays legal — no adjacency iteration in the code.
  const fib = 'def fib(n):\n    if n < 2: return n\n    return fib(n-1) + fib(n-2)';
  assert.equal(dryRunQualityIssue({ steps: richSteps, directive: 'fib dry run', code: fib, tool: 'recursion' }), null);
  // The same adjacency code through a GRAPH tool is legal — the rule only guards recursion mode.
  assert.equal(dryRunQualityIssue({ steps: richSteps, directive: 'Tarjan bridges dry run', code: tarjan, tool: 'graphwalk' }), null);
});
