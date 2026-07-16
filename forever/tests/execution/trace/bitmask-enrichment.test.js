import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { traceUniversal } from '../../../lib/execution/trace/universal/trace.js';

const exec = async ({ source }) => ({ stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 20000 }), stderr: '', timedOut: false });

const LC847 = `from collections import deque
def shortest_path_length(graph):
    n = len(graph)
    target = (1 << n) - 1
    q = deque((i, 1 << i) for i in range(n))
    seen = [(i, 1 << i) for i in range(n)]
    dist = 0
    while q:
        for _ in range(len(q)):
            node, mask = q.popleft()
            if mask == target:
                return dist
            for nei in graph[node]:
                nmask = mask | (1 << nei)
                if (nei, nmask) not in seen:
                    seen.append((nei, nmask))
                    q.append((nei, nmask))
        dist += 1
    return 0`;

test('LC847: the graph lens gains the mask channel — binary meaning per step, target detected', async () => {
  const r = await traceUniversal({ code: LC847, entry: 'shortest_path_length([[1,2,3],[0],[0],[0]])', language: 'python', exec });
  assert.equal(r.lens, 'graph-adjacency', 'composition: bitmask rides ON the graph walk');
  assert.ok(r.trace.views.bitmask, 'views.bitmask declared');
  assert.equal(r.trace.views.bitmask.bits, 4);
  const withMask = r.trace.steps.filter((s) => s.maskState);
  assert.ok(withMask.length >= 3, 'mask states ride the steps');
  const multi = withMask.find((s) => s.maskState.visited.length > 1);
  assert.ok(multi, 'multi-bit masks appear as the walk covers nodes');
  assert.equal(multi.maskState.binary.length, 4);
  assert.ok(r.trace.steps.some((s) => /state mask is now/.test(s.explanation)), 'mask meaning narrated');
  assert.ok(r.trace.steps.some((s) => (s.events ?? []).some((e) => e.semanticRole === 'mask_update')), 'typed mask_update events');
});
