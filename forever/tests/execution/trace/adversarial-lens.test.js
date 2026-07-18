import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

import { traceUniversal } from '../../../lib/execution/trace/universal/trace.js';

// Adversarial shapes reported by external review 2026-07-19 — reproduced, then guarded.
// These lock the guards in place: a regression here means fake DP visuals came back.

const exec = async ({ source }) => {
  try { return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 }), stderr: '', timedOut: false }; }
  catch (e) { return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message), timedOut: false }; }
};

test('a bitmask-BFS seen-set of pairs is never classified as a DP table (sets have no order)', async () => {
  const code = ['from collections import deque', 'def shortest(n, edges, start):', '    adj = {i: [] for i in range(n)}', '    for a, b in edges:', '        adj[a].append(b)', '        adj[b].append(a)', '    q = deque([(start, 1 << start, 0)])', '    seen = set()', '    while q:', '        node, mask, dist = q.popleft()', '        if mask == (1 << n) - 1:', '            return dist', '        for nxt in adj[node]:', '            state = (nxt, mask | (1 << nxt))', '            if state not in seen:', '                seen.add(state)', '                q.append((nxt, mask | (1 << nxt), dist + 1))', '    return -1'].join('\n');
  const { lens } = await traceUniversal({ code, entry: 'shortest(4, [[0,1],[1,2],[2,3],[0,3]], 0)', exec });
  assert.notEqual(lens?.key ?? lens, 'dp-table');
});

test('a ragged backtracking result accumulator is never a DP table', async () => {
  const code = ['def subsets(nums):', '    result = []', '    path = []', '', '    def search(index):', '        result.append(path[:])', '        for i in range(index, len(nums)):', '            path.append(nums[i])', '            search(i + 1)', '            path.pop()', '', '    search(0)', '    return result'].join('\n');
  const { lens } = await traceUniversal({ code, entry: 'subsets([1, 2, 3])', exec });
  assert.notEqual(lens?.key ?? lens, 'dp-table');
});

test('a constant fill claims ZERO dependency arrows — coincidence rules are suppressed', async () => {
  const code = ['def fill(rows, cols):', '    table = [[0] * cols for _ in range(rows)]', '    for i in range(1, rows):', '        for j in range(1, cols):', '            table[i][j] = 1', '    return table'].join('\n');
  const { trace } = await traceUniversal({ code, entry: 'fill(4, 5)', exec });
  const arrowSteps = (trace?.steps ?? []).filter((st) => st.array2d?.highlight?.length).length;
  assert.equal(arrowSteps, 0);
});
