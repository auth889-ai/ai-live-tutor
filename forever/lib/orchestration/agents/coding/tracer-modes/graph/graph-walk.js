// Tracer mode: GRAPH-WALK — one file, one job. Engine: lib/execution/trace/graph-walk/.

import { assembleLineProgram, parseLineEvents, compileGraphWalk } from '../../../../../execution/trace/engines.js';

export const graphWalkMode = {
  key: 'graphwalk',
  label: 'Graph walk',
  prompt: `GRAPH-WALK MODE (python only) — for ANY graph algorithm BEYOND plain BFS/DFS (Dijkstra,
Bellman-Ford, topological sort/Kahn, Prim, union-find, cycle detection): INSTEAD of "program", output
  "graphwalk": {"entry": "<ONE call expression invoking 'code' on the concrete graph>",
                "lens": {"current": "u" (variable holding the node being processed),
                         "dist": "dist" (tentative-distance dict, if any),
                         "visited": "visited" (finalized set/list, if any),
                         "pq": "pq" (heapq list) OR "queue": "q" OR "stack": "st" (the frontier, if any),
                         "parent": "parent" (union-find parent map, if any),
                         "indegree": "indeg" (Kahn's counts, if any)}}
plus "views.graph" and "code" = the clean function. CRITICAL: node ids in views.graph MUST equal
the node keys the code uses (dist/parent/indegree keys, visited elements, current values). When
the graph is WEIGHTED, put each weight on its edge as "label" (e.g. {"from":"A","to":"B","label":"4"})
so the drawing shows the numbers the algorithm is comparing. Our
engine runs the code for real under the tracer and derives every teaching moment (extract-min,
relax old->new, finalize, union, indegree drop) from the actual variables — do not write
tracking code. Declare every lens role that exists in the code; skip roles it doesn't have.`,
  canHandle: ({ json, lang, views, code }) => Boolean(json.graphwalk && typeof json.graphwalk === 'object' && lang === 'python' && views.graph && code),
  async run({ json, code, views, exec }) {
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry: json.graphwalk.entry }) });
    if (run.timedOut) throw new Error('graph walk timed out (likely an infinite loop)');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@LINESIM line');
    const trace = compileGraphWalk({
      ...payload,
      code,
      entry: json.graphwalk.entry,
      graph: views.graph,
      lens: json.graphwalk.lens ?? {},
      language: 'python',
    });
    trace.meta = {
      tool: 'graphwalk',
      params: { code, entry: json.graphwalk.entry, graph: views.graph, lens: json.graphwalk.lens ?? {} },
    };
    return trace;
  },
};
