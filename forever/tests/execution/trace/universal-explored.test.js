import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectExploredGraph, compileExploredGraph } from '../../../lib/execution/trace/universal/lenses/explored-graph.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

test('Word Ladder: the graph never exists in memory, yet the discovery tree gets drawn', () => {
  const code = [
    'from collections import deque',
    'def ladder(begin, end, words):',
    '    seen = [begin]',
    '    q = deque([(begin, 1)])',
    '    while q:',
    '        word, steps = q.popleft()',
    '        if word == end:',
    '            return steps',
    '        for i in range(len(word)):',
    "            for ch in 'cdghiot':",
    '                nxt = word[:i] + ch + word[i+1:]',
    '                if nxt in words and nxt not in seen:',
    '                    seen.append(nxt)',
    '                    q.append((nxt, steps + 1))',
    '    return 0',
  ].join('\n');
  const entry = "ladder('hit', 'cog', ['hot', 'dot', 'dog', 'cog'])";
  const rec = record({ code, entry });
  const plan = detectExploredGraph(rec, { code });
  assert.ok(plan, 'frontier + overlapping growing seen = an exploration');
  assert.equal(plan.frontier.name, 'q');
  assert.equal(plan.frontier.kind, 'queue');
  assert.equal(plan.seenVar, 'seen');

  const trace = compileExploredGraph({ recording: rec, plan, code, entry });
  const labels = trace.views.graph.nodes.map((n) => n.label);
  for (const w of ['hit', 'hot', 'dot', 'dog', 'cog']) assert.ok(labels.includes(w), `${w} was discovered and drawn`);
  const edge = (a, b) => trace.views.graph.edges.some((e) => e.from === a && e.to === b);
  assert.ok(edge('hit', 'hot') && edge('hot', 'dot') && edge('dot', 'dog') && edge('dog', 'cog'), 'parent pointers reconstruct the REAL discovery chain');
  assert.ok(trace.steps.some((s) => s.graph?.current === 'hot'), 'the cursor rides the state being processed');
  assert.match(trace.steps.at(-1).explanation, /5/, 'the real ladder length reaches the close');

  const plans = detectLenses(rec, { code });
  assert.equal(plans[0]?.lens, 'explored-graph', 'the discovery tree outranks the queue view');
});

test('no theft: adjacency walks, backtracking, and paren stacks all stay with their own lenses', () => {
  const bfsAdj = [
    'from collections import deque',
    'def bfs(adj, start):',
    '    visited = [start]',
    '    q = deque([start])',
    '    order = []',
    '    while q:',
    '        u = q.popleft()',
    '        order.append(u)',
    '        for v in adj[u]:',
    '            if v not in visited:',
    '                visited.append(v)',
    '                q.append(v)',
    '    return order',
    "g = {'A': ['B', 'C'], 'B': ['A'], 'C': ['A']}",
  ].join('\n');
  const plans = detectLenses(record({ code: bfsAdj, entry: "bfs(g, 'A')" }), { code: bfsAdj });
  assert.equal(plans[0]?.lens, 'graph-adjacency', 'a REAL adjacency outranks the discovery tree');

  const subsets = record({
    code: 'def subs(i, cur, arr, out):\n    if i == len(arr):\n        out.append(list(cur))\n        return\n    cur.append(arr[i])\n    subs(i + 1, cur, arr, out)\n    cur.pop()\n    subs(i + 1, cur, arr, out)\nout = []',
    entry: 'subs(0, [], [1, 2], out)',
  });
  assert.equal(detectExploredGraph(subsets, { code: '' }), null, 'a backtracking cur breathes but nothing monotonic overlaps it');

  const parens = record({
    code: 'def valid(s):\n    st = []\n    pairs = {")": "(", "]": "[", "}": "{"}\n    for ch in s:\n        if ch in pairs:\n            if not st or st.pop() != pairs[ch]:\n                return False\n        else:\n            st.append(ch)\n    return len(st) == 0',
    entry: 'valid("([])")',
  });
  assert.equal(detectExploredGraph(parens, { code: '' }), null, 'a paren stack has no seen set at all');
});
