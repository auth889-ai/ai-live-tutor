import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { traceUniversal } from '../../../lib/execution/trace/universal/trace.js';
import { autoMode } from '../../../lib/orchestration/agents/coding/tracer-modes/universal/auto.js';
import { TRACER_MODES } from '../../../lib/orchestration/agents/coding/tracer-modes/index.js';

// exec in the run-code shape, backed by real python3 (same tier the dev pipeline uses).
const exec = async ({ source }) => {
  try {
    return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 }), stderr: '', timedOut: false };
  } catch (err) {
    return { stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? err.message), timedOut: false };
  }
};

test('orchestrator: a structural run compiles through its detected lens, one call end to end', async () => {
  const code = [
    'from collections import deque',
    'def rot(grid):',
    '    R, C = len(grid), len(grid[0])',
    '    q = deque()',
    '    for r in range(R):',
    '        for c in range(C):',
    '            if grid[r][c] == 2:',
    '                q.append((r, c))',
    '    while q:',
    '        r, c = q.popleft()',
    '        for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):',
    '            nr, nc = r + dr, c + dc',
    '            if 0 <= nr < R and 0 <= nc < C and grid[nr][nc] == 1:',
    '                grid[nr][nc] = 2',
    '                q.append((nr, nc))',
    '    return grid',
  ].join('\n');
  const { trace, lens, confidence } = await traceUniversal({ code, entry: 'rot([[2,1],[1,1]])', exec });
  assert.equal(lens, 'grid-walk');
  assert.equal(confidence, 0.9);
  assert.ok(trace.steps.length >= 10, 'a full narrated dry run came back from ONE call');
});

test('THE FLOOR: a structureless run still gets the elite line table — a miss is impossible', async () => {
  const gcd = 'def gcd(a, b):\n    while b:\n        a, b = b, a % b\n    return a';
  const { trace, lens, attempts } = await traceUniversal({ code: gcd, entry: 'gcd(48, 18)', exec });
  assert.equal(lens, 'line-floor', 'no lens claims pure math — the floor does');
  assert.ok(Array.isArray(attempts), 'failed lens attempts are reported, not swallowed');
  assert.ok(trace.steps.length >= 4, 'the table has real rows');
  assert.match(trace.steps.at(-1).explanation, /6/, 'gcd(48, 18) = 6 reaches the close');
  const withVars = trace.steps.filter((s) => s.variables && 'a' in s.variables);
  assert.ok(withVars.length >= 3, 'live variables ride every row');
});

test('the floor speaks values, never addresses: @ref locals resolve to Type(value) labels', async () => {
  const code = [
    'class Box:',
    '    def __init__(self, val):',
    '        self.val = val',
    'def bump(box, times):',
    '    for _ in range(times):',
    '        box.val = box.val + 1',
    '    return box.val',
    'b = Box(10)',
  ].join('\n');
  const { trace, lens } = await traceUniversal({ code, entry: 'bump(b, 2)', exec });
  assert.equal(lens, 'line-floor', 'one lone object is not a structure');
  const text = JSON.stringify(trace.steps);
  assert.ok(!text.includes('@ref'), 'no raw reference ever reaches the student');
  assert.ok(text.includes('Box('), 'the object reads as Box(10), a value with a name');
});

test('autoMode: wired above the floor modes, runs the whole engine from one declared entry', async () => {
  const keys = TRACER_MODES.map((m) => m.key);
  assert.ok(keys.indexOf('auto') < keys.indexOf('linesim'), 'auto sits ABOVE the old floor');
  assert.ok(keys.indexOf('auto') > keys.indexOf('recursion'), 'dedicated modes keep first pick');

  const code = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)';
  const ctx = { json: { auto: { entry: 'fib(4)' } }, lang: 'python', code };
  assert.ok(autoMode.canHandle(ctx), 'auto claims a declared entry');
  assert.ok(!autoMode.canHandle({ json: {}, lang: 'python', code }), 'no declaration, no claim');
  const trace = await autoMode.run({ json: ctx.json, code, exec });
  assert.ok(trace.views.graph, 'fib came back as its recursion tree — detected, not declared');
  assert.ok(trace.steps.length >= 10, 'a full dry run through the tracer-mode door');
});
