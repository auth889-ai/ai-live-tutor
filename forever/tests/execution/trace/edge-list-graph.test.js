// EDGE-LIST GRAPH lens: the strictest evidence set in the registry, adversarially locked.
// A wrong graph claim is the exact misread class the provenance work exists to kill, so
// every neighbor shape that LOOKS like an edge list must be proven to fall through.

import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEdgeListGraph } from '../../../lib/execution/trace/universal/lenses/edge-list-graph.js';

const line = (locals) => ({ ev: 'line', line: 1, locals });

const BF_CODE = `def bellman_ford(n, edges, src):
    dist = [float('inf')] * n
    dist[src] = 0
    for _ in range(n - 1):
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
    return dist`;
const EDGES = [[0, 1, 6], [0, 2, 7], [1, 3, 5], [2, 3, -3]];

test('claims Bellman-Ford: unpack loop + stable edges + inf->number relaxations', () => {
  const rec = { events: [
    line({ edges: EDGES, dist: ['inf', 'inf', 'inf', 'inf'] }),
    line({ edges: EDGES, dist: [0, 'inf', 'inf', 'inf'], u: 0, v: 1, w: 6 }),
    line({ edges: EDGES, dist: [0, 6, 'inf', 'inf'], u: 0, v: 2, w: 7 }),
    line({ edges: EDGES, dist: [0, 6, 7, 'inf'], u: 2, v: 3, w: -3 }),
    line({ edges: EDGES, dist: [0, 6, 7, 4], u: 2, v: 3, w: -3 }),
  ] };
  const plan = detectEdgeListGraph(rec, { code: BF_CODE });
  assert.ok(plan, 'must claim the relaxing edge walk');
  assert.equal(plan.confidence, 0.91);
  assert.equal(plan.roles.dist, 'dist');
  assert.equal(plan.graph.edges.length, 4);
  assert.equal(plan.graph.edges[3].weight, -3);
});

test('REFUSES Town Judge: score increments disqualify the decrease-only dist rule', () => {
  const code = `def find_judge(n, trust):
    score = [0] * (n + 1)
    for a, b in trust:
        score[a] -= 1
        score[b] += 1
    return -1`;
  const trust = [[1, 3], [2, 3], [3, 1]];
  const rec = { events: [
    line({ trust, score: [0, 0, 0, 0] }),
    line({ trust, score: [0, -1, 0, 1], a: 1, b: 3 }),
    line({ trust, score: [0, -1, -1, 2], a: 2, b: 3 }),
    line({ trust, score: [0, 0, -1, 1], a: 3, b: 1 }),
  ] };
  assert.equal(detectEdgeListGraph(rec, { code }), null);
});

test('REFUSES merge intervals: no unpacked endpoint loop, pairs are ranges not edges', () => {
  const code = `def merge(intervals):
    intervals.sort()
    merged = []
    for iv in intervals:
        merged.append(list(iv))
    return merged`;
  const rec = { events: [
    line({ intervals: [[1, 3], [2, 6], [8, 10]], merged: [] }),
    line({ intervals: [[1, 3], [2, 6], [8, 10]], merged: [[1, 6]] }),
  ] };
  assert.equal(detectEdgeListGraph(rec, { code }), null);
});

test('REFUSES a growing accumulator wearing edge-list shape (stability rule)', () => {
  const code = `def pairs(n):
    out = []
    for u, v in seed:
        out.append([u, v])
    return out`;
  const rec = { events: [
    line({ seed: [[0, 1], [1, 2], [2, 3]], out: [[0, 1]], distx: [0, 'inf'] }),
    line({ seed: [[0, 1], [1, 2], [2, 3]], out: [[0, 1], [1, 2]] }),
  ] };
  // seed is stable BUT there is no decrease-only dist structure subscripted in code -> null
  assert.equal(detectEdgeListGraph(rec, { code }), null);
});
