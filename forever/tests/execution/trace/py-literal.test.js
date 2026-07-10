import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { pyLiteral } from '../../../lib/execution/trace/harness/py-literal.js';
import { assembleRecursionProgram } from '../../../lib/execution/trace/recursion/tracker.js';

test('pyLiteral: JSON values become real python (null/true/false do not leak)', () => {
  assert.equal(pyLiteral([-10, 9, 20, null, null, 15, 7]), '[-10, 9, 20, None, None, 15, 7]');
  assert.equal(pyLiteral({ ok: true, miss: null, s: 'null' }), '{"ok": True, "miss": None, "s": "null"}');
  assert.equal(pyLiteral('has "quotes" and null words'), '"has \\"quotes\\" and null words"');
  assert.equal(pyLiteral(Infinity), "float('inf')");
});

test('a student function named "fn" cannot shadow the tracker (the reference demo name)', () => {
  // recursion.vercel.app's own demo names the function fn — a wrapper also named fn recorded
  // ZERO vertices because the student def silently replaced it.
  const code = "a = 'AG'\nb = 'GA'\ndef fn(i, j):\n    if i == len(a) or j == len(b):\n        return 0\n    if a[i] == b[j]:\n        return 1 + fn(i + 1, j + 1)\n    return max(fn(i + 1, j), fn(i, j + 1))";
  const program = assembleRecursionProgram({ code, fnName: 'fn', args: [0, 0], memoize: true });
  const stdout = execFileSync('python3', ['-c', program], { encoding: 'utf8', timeout: 15_000 });
  const line = stdout.split('\n').find((l) => l.includes('@@CALLTREE '));
  const tree = JSON.parse(line.slice(line.indexOf('@@CALLTREE ') + '@@CALLTREE '.length));
  assert.ok(Object.keys(tree.vertices).length >= 5, `expected a real call tree, got ${Object.keys(tree.vertices).length} vertices`);
});

test('recursion tracker survives LeetCode-style null args (the Max Path Sum crash)', () => {
  // The exact shape that killed the generated tree lesson: a level-order array with null holes.
  const code = [
    'def count(vals, i=0):',
    '    if i >= len(vals) or vals[i] is None:',
    '        return 0',
    '    return 1 + count(vals, 2*i+1) + count(vals, 2*i+2)',
  ].join('\n');
  const program = assembleRecursionProgram({ code, fnName: 'count', args: [[-10, 9, 20, null, null, 15, 7]] });
  const stdout = execFileSync('python3', ['-c', program], { encoding: 'utf8', timeout: 15_000 });
  const line = stdout.split('\n').find((l) => l.includes('@@CALLTREE '));
  assert.ok(line, `tracker printed no call tree:\n${stdout.slice(0, 400)}`);
  const tree = JSON.parse(line.slice(line.indexOf('@@CALLTREE ') + '@@CALLTREE '.length));
  assert.equal(tree.result, 5, 'the real run counts the 5 non-null nodes');
  assert.ok(Object.keys(tree.vertices).length >= 5, 'one vertex per real call');
});

test('non-finite floats in recorded state cannot poison the payload (LC124 -inf)', async () => {
  const { assembleStructureProgram, parseStructureEvents } = await import('../../../lib/execution/trace/engines.js');
  const code = 'class N:\n    def __init__(self):\n        self.left = None\nroot = N()\ndef walk(node):\n    best = float("-inf")\n    best = max(best, 42)\n    return best';
  const src = assembleStructureProgram({ code, entry: 'walk(root)' });
  const out = execFileSync('python3', ['-c', src], { encoding: 'utf8', timeout: 15_000 });
  const payload = parseStructureEvents(out);
  assert.ok(payload, 'the @@STRUCTURE payload must survive -inf in locals');
  assert.equal(payload.result, 42);
});

test('nested recursive defs trace natively via settrace (the idiomatic LeetCode shape)', async () => {
  const { assembleNestedRecursionProgram } = await import('../../../lib/execution/trace/recursion/tracker.js');
  const code = 'class T:\n    def __init__(self, v, l=None, r=None):\n        self.v = v; self.l = l; self.r = r\ntree = T(-10, T(9), T(20, T(15), T(7)))\ndef maxPathSum(root):\n    best = float("-inf")\n    def gain(node):\n        nonlocal best\n        if node is None: return 0\n        l = max(0, gain(node.l)); r = max(0, gain(node.r))\n        best = max(best, node.v + l + r)\n        return node.v + max(l, r)\n    gain(root)\n    return best';
  const src = assembleNestedRecursionProgram({ code, entry: 'maxPathSum(tree)', fnName: 'gain' });
  const out = execFileSync('python3', ['-c', src], { encoding: 'utf8', timeout: 15_000 });
  const line = out.split('\n').find((l) => l.includes('@@CALLTREE '));
  const tree = JSON.parse(line.slice(line.indexOf('@@CALLTREE ') + '@@CALLTREE '.length));
  assert.equal(tree.result, 42, 'the classic example answers 42');
  assert.ok(Object.keys(tree.vertices).length >= 5, 'one vertex per real nested call');
  // Undefined entry names still fail fast with the fix spelled out.
  assert.throws(
    () => assembleNestedRecursionProgram({ code: 'def f():\n    def g():\n        return 0\n    return g()', entry: 'f(tree)', fnName: 'g' }),
    /entry references "tree"/,
  );
});
