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
