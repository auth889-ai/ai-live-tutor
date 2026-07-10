import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectUnionFind, compileUnionFind } from '../../../lib/execution/trace/universal/lenses/union-find.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const COMPONENTS = [
  'def components(n, edges):',
  '    parent = list(range(n))',
  '    def find(x):',
  '        while parent[x] != x:',
  '            parent[x] = parent[parent[x]]',
  '            x = parent[x]',
  '        return x',
  '    count = n',
  '    for a, b in edges:',
  '        ra, rb = find(a), find(b)',
  '        if ra != rb:',
  '            parent[ra] = rb',
  '            count -= 1',
  '    return count',
].join('\n');
const ENTRY = 'components(5, [[0, 1], [1, 2], [3, 4]])';

test('the identity-map birthmark: parent forest found, edge list claimed, unions narrated', () => {
  const rec = record({ code: COMPONENTS, entry: ENTRY });
  const plan = detectUnionFind(rec, { code: COMPONENTS });
  assert.ok(plan, 'the forest is recognized');
  assert.equal(plan.forestVar, 'parent');
  assert.equal(plan.graph.nodes.length, 5);
  assert.equal(plan.graph.edges.length, 3, 'the STATIC pair-list becomes the drawn edges');
  assert.equal(plan.graph.directed, false, 'union consumes connections, not arrows');
  assert.equal(plan.roles.parent, 'parent');
  assert.equal(plan.roles.current, 'x', "find's walker subscripts the forest widest");

  const trace = compileUnionFind({ recording: rec, plan, code: COMPONENTS, entry: ENTRY });
  const birth = trace.steps.find((s) => /starts as its own root/.test(s.explanation));
  assert.ok(birth, "the forest's birth is the designed opening beat: every node its own lone set");
  const unions = trace.steps.filter((s) => /Union:/.test(s.explanation));
  assert.ok(unions.length >= 3, 'each real union is a narrated merge');
  assert.match(trace.steps.at(-1).explanation, /2/, 'the real component count reaches the close');
});

test('registry: union-find claims the forest run outright', () => {
  const rec = record({ code: COMPONENTS, entry: ENTRY });
  const plans = detectLenses(rec, { code: COMPONENTS });
  assert.equal(plans[0]?.lens, 'union-find', 'the forest outranks the pointer-array reading of parent');
});

test('the birthmark is strict: mutating int lists and interval pairs refuse', () => {
  const notIdentity = record({
    code: 'def bump(arr):\n    for i in range(len(arr)):\n        arr[i] = arr[i] * 2\n    return arr',
    entry: 'bump([3, 1, 2])',
  });
  assert.equal(detectUnionFind(notIdentity, { code: '' }), null, 'a mutating list that was never the identity map is not a forest');

  const intervals = record({
    code: 'def total(pairs):\n    s = 0\n    for a, b in pairs:\n        s += b - a\n    return s',
    entry: 'total([[1, 3], [2, 6]])',
  });
  assert.equal(detectUnionFind(intervals, { code: '' }), null, 'pair-lists without a forest stay unclaimed (the graph-adjacency refusal holds here too)');
});
