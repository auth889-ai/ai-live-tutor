import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { dryRunQualityIssue } from '../../../lib/orchestration/agents/coding/execution-tracer.js';
import { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording } from '../../../lib/execution/trace/universal/recorder.js';
import { detectHeap, compileHeap } from '../../../lib/execution/trace/universal/lenses/heap.js';
import { detectLenses } from '../../../lib/execution/trace/universal/detect.js';

const py = (source) => execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15_000 });
const record = ({ code, entry }) =>
  validateUniversalRecording(parseUniversalEvents(py(assembleUniversalProgram({ code, entry }))));

const KTH = [
  'import heapq',
  'def kth_largest(nums, k):',
  '    heap = []',
  '    for x in nums:',
  '        heapq.heappush(heap, x)',
  '        if len(heap) > k:',
  '            heapq.heappop(heap)',
  '    return heap[0]',
].join('\n');
const ENTRY = 'kth_largest([3, 2, 1, 5, 6, 4], 2)';

test('Kth Largest: the heap IS the lesson — array-as-tree, sift-up settles, root removals', () => {
  const rec = record({ code: KTH, entry: ENTRY });
  const plan = detectHeap(rec, { code: KTH });
  assert.ok(plan, 'heapq calls + the heap property at every sighting = the heap');
  assert.equal(plan.heapVar, 'heap');

  const trace = compileHeap({ recording: rec, plan, code: KTH, entry: ENTRY });
  assert.match(trace.steps[0].explanation, /binary tree in disguise.*2i\+1/s, 'the opening teaches the array-as-tree reading');
  const push = trace.steps.find((s) => /SIFTS UP, settling at slot/.test(s.explanation));
  assert.ok(push, 'a push narrates where the value really settled');
  const pop = trace.steps.find((s) => /root.*REMOVED.*sifts DOWN/s.test(s.explanation));
  assert.ok(pop, 'a pop narrates the root removal and the sift-down');
  assert.ok(trace.steps.every((s) => s.array?.pointers?.top === 0), 'the top pointer rides slot 0 on every step');
  assert.match(trace.steps.at(-1).explanation, /returns 5/, 'the real 2nd-largest reaches the close');

  const issue = dryRunQualityIssue({ steps: trace.steps, directive: 'Kth largest element via a min-heap of size k', code: KTH });
  assert.equal(issue, null, `the elite gate is clean (got: ${issue})`);
});

test('registry: the heap claims its own lesson but stays behind the graph on Dijkstra', () => {
  const rec = record({ code: KTH, entry: ENTRY });
  assert.equal(detectLenses(rec, { code: KTH })[0]?.lens, 'heap');

  const dijkstra = [
    'import heapq',
    'def dijkstra(adj, start):',
    '    dist = {u: 999 for u in adj}',
    '    dist[start] = 0',
    '    pq = [(0, start)]',
    '    while pq:',
    '        d, u = heapq.heappop(pq)',
    '        if d > dist[u]:',
    '            continue',
    '        for v, w in adj[u]:',
    '            if d + w < dist[v]:',
    '                dist[v] = d + w',
    '                heapq.heappush(pq, (dist[v], v))',
    '    return dist',
    "g = {'A': [('B', 4), ('C', 8)], 'B': [('C', 3)], 'C': []}",
  ].join('\n');
  const rec2 = record({ code: dijkstra, entry: "dijkstra(g, 'A')" });
  const plans = detectLenses(rec2, { code: dijkstra });
  assert.equal(plans[0]?.lens, 'graph-adjacency', 'the heap is merely the frontier there — the graph owns the run');
});

test('the heap property is the proof: heapq in the code alone claims nothing', () => {
  const notHeap = record({
    code: 'import heapq\ndef collect(nums):\n    out = []\n    for x in nums:\n        out.append(x)\n    heapq.heapify(nums)\n    return out',
    entry: 'collect([5, 3, 8])',
  });
  assert.equal(detectHeap(notHeap, { code: 'heapq.heapify(nums)\nout.append' }), null, 'out never satisfies the property discipline; nums never breathes under heapq calls we track');
});
