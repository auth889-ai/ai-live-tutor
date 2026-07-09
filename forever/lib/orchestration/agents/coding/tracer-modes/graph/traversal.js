// Tracer mode: TRAVERSAL — one file, one job. Engine: lib/execution/trace/traversal/.

import { compileTraversalTrace } from '../../../../../execution/trace/engines.js';

export const traversalMode = {
  key: 'traversal',
  label: 'Traversal trace',
  prompt: `TRAVERSAL MODE — when the algorithm IS breadth-first / depth-first / level-order over a CONCRETE
tree or graph: INSTEAD of "program", output
  "traversal": {"kind": "bfs" | "dfs" | "level_order", "start": "<nodeId from views.graph>",
                "lines": {"init": <line that seeds the queue/stack>, "visit": <line that visits>, "done": <line after the loop>}}
plus "views.graph" (edges carry "side" for binary trees) and "code" = the clean traversal function.
Our engine executes the walk itself, exactly — do not write tracking code.`,
  canHandle: ({ json, views, code }) => Boolean(json.traversal && typeof json.traversal === 'object' && views.graph && code),
  async run({ json, code, views, lang }) {
    const trace = compileTraversalTrace({
      graph: views.graph,
      kind: json.traversal.kind,
      start: json.traversal.start,
      code,
      language: lang,
      lines: json.traversal.lines ?? {},
    });
    trace.meta = {
      tool: 'traversal',
      params: { graph: views.graph, kind: json.traversal.kind, start: json.traversal.start, code, lines: json.traversal.lines ?? {} },
    };
    return trace;
  },
};
