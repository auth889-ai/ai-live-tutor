// C3 fixture: REAL Tarjan execution + the HANDWRITTEN SemanticVisualSpec -> /dev/cockpit.
// A test fixture (the C2/C3 gate), not a product output — the Director will write specs
// like this one at C4; until then this page proves resolver + panels + layout on real data.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { traceUniversal } from '../lib/execution/trace/universal/trace.js';

const exec = async ({ source }) => ({ stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 20000 }), stderr: '', timedOut: false });

const CODE = `def critical_connections(n, connections):
    adj = {i: [] for i in range(n)}
    for u, v in connections:
        adj[u].append(v)
        adj[v].append(u)
    disc = [-1] * n
    low = [-1] * n
    bridges = []
    time = [0]
    def dfs(u, parent):
        disc[u] = low[u] = time[0]
        time[0] += 1
        for v in adj[u]:
            if disc[v] == -1:
                dfs(v, u)
                low[u] = min(low[u], low[v])
                if low[v] > disc[u]:
                    bridges.append([u, v])
            elif v != parent:
                low[u] = min(low[u], disc[v])
    dfs(0, -1)
    return bridges`;

const SPEC = {
  algorithmFamily: 'tarjan-bridges',
  layoutIntent: 'force',
  panels: [
    { type: 'graph', title: 'Network — Discovery and Low-Link Values' },
    { type: 'call-stack', title: 'DFS Call Stack' },
    {
      type: 'state-table',
      title: 'Discovery / Low Values',
      columns: [
        { label: 'disc', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'disc' } },
        { label: 'low', binding: { op: 'lookup', collection: 'nodeState', key: '$node.id', field: 'low' } },
      ],
    },
    { type: 'concept-card', title: 'Bridge Rule', content: 'An edge u–v is a bridge when low[v] > disc[u]: nothing in v\'s subtree can reach back above u.' },
  ],
};

const r = await traceUniversal({ code: CODE, entry: 'critical_connections(6, [[0,1],[1,2],[2,0],[1,3],[3,4],[4,5],[5,3]])', language: 'python', exec });
writeFileSync('app/dev/cockpit/fixture.json', JSON.stringify({ spec: SPEC, trace: r.trace }, null, 1));
console.log(`fixture written: lens=${r.lens}, steps=${r.trace.steps.length}`);
