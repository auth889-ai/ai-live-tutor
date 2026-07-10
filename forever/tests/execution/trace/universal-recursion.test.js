import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectRecursionTree, compileRecursionTree } from '../../../lib/execution/trace/universal/lenses/recursion-tree.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const FIB = 'def fib(n):\n    if n <= 1:\n        return n\n    return fib(n - 1) + fib(n - 2)';

test('detectRecursionTree: self-recursion recognized from call nesting alone', () => {
  const rec = record({ code: FIB, entry: 'fib(4)' });
  const plan = detectRecursionTree(rec);
  assert.ok(plan, 'fib is recognized');
  assert.equal(plan.fnName, 'fib');
  assert.equal(plan.calls, 9, 'fib(4) really makes 9 calls');

  const once = record({ code: 'def total(arr):\n    s = 0\n    for x in arr:\n        s += x\n    return s', entry: 'total([1, 2, 3])' });
  assert.equal(detectRecursionTree(once), null, 'a plain loop is not recursion');
});

test('the rebuilt call tree animates through the EXISTING recursion compiler', () => {
  const rec = record({ code: FIB, entry: 'fib(4)' });
  const plan = detectRecursionTree(rec);
  const trace = compileRecursionTree({ recording: rec, plan, code: FIB });

  assert.equal(trace.views.graph.nodes.length, 9, 'one node per real call');
  assert.ok(trace.views.graph.directed, 'the call tree is directed parent -> child');
  assert.ok(trace.views.graph.nodes.some((n) => n.label === 'fib(4)'), 'root labeled with its real argument');

  const returns = trace.steps.filter((s) => s.variables?.returns !== undefined);
  assert.ok(returns.length >= 9, 'every return lands as a step');
  assert.match(trace.steps.at(-1).explanation, /3/, 'the final answer 3 reaches the closing narration');

  // Teaching lines derived from the REAL frames: base returns happened on line 3, combines on line 4.
  const baseStep = trace.steps.find((s) => /base case/i.test(s.explanation));
  assert.ok(baseStep, 'base cases are narrated');
  assert.equal(baseStep.line, 3, 'the base-case step highlights the recorded base-return line');
  const callStep = trace.steps.find((s) => /calls/i.test(s.explanation) && s.activeEdge);
  assert.equal(callStep.line, 4, 'recursive calls highlight the recorded call-site line');
});

test('memo hits are detected from BEHAVIOR: a repeated subproblem answered without work', () => {
  const code = [
    'memo = {}',
    'def fib(n):',
    '    if n in memo:',
    '        return memo[n]',
    '    if n <= 1:',
    '        return n',
    '    memo[n] = fib(n - 1) + fib(n - 2)',
    '    return memo[n]',
  ].join('\n');
  const rec = record({ code, entry: 'fib(5)' });
  const plan = detectRecursionTree(rec);
  const trace = compileRecursionTree({ recording: rec, plan, code });

  const memoSteps = trace.steps.filter((s) => s.graph?.memo?.length > 0);
  assert.ok(memoSteps.length > 0, 'memo hits reach the animation (purple nodes)');
  assert.ok(trace.views.graph.nodes.length < 15, `memoization visibly prunes the tree (got ${trace.views.graph.nodes.length} calls, naive fib(5) makes 15)`);
});

test('registry: recursion detected for fib; grid-walk still wins the grid problems', () => {
  const plans = detectLenses(record({ code: FIB, entry: 'fib(4)' }), { code: FIB });
  assert.equal(plans[0]?.lens, 'recursion-tree');

  const oranges = [
    'from collections import deque',
    'def orangesRotting(grid):',
    '    rows, cols = len(grid), len(grid[0])',
    '    q = deque([(r, c) for r in range(rows) for c in range(cols) if grid[r][c] == 2])',
    '    minutes = 0',
    '    while q:',
    '        nxt = deque()',
    '        for r, c in q:',
    '            for dr, dc in ((1,0),(-1,0),(0,1),(0,-1)):',
    '                nr, nc = r + dr, c + dc',
    '                if 0 <= nr < rows and 0 <= nc < cols and grid[nr][nc] == 1:',
    '                    grid[nr][nc] = 2',
    '                    nxt.append((nr, nc))',
    '        q = nxt',
    '        if q:',
    '            minutes += 1',
    '    return minutes',
  ].join('\n');
  const plans2 = detectLenses(record({ code: oranges, entry: 'orangesRotting([[2,1],[1,1]])' }), { code: oranges });
  assert.equal(plans2[0]?.lens, 'grid-walk', 'the board outranks other lenses on grid problems');
});
