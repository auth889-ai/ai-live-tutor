// Tracer mode: OPERATIONS — one file, one job. Engine: lib/execution/trace/operations/.

import { compileOperationsTrace } from '../../../../../execution/trace/engines.js';

export const operationsMode = {
  key: 'operations',
  label: 'Operations trace',
  prompt: `OPERATIONS MODE — when the lesson teaches a DATA STRUCTURE ITSELF (stack, queue, hash map —
push/pop, enqueue/dequeue, put/get/remove with collisions): INSTEAD of "program", output
  "operations": {"structure": "stack" | "queue" | "hash_map",
                 "ops": [{"op":"push","value":7}, {"op":"pop"}, {"op":"put","key":"cat","value":1}, ...],
                 "lines": {"push": <code line of push>, "pop": <...>, "put": <...>, "get": <...>}}
with "code" = the short usage snippet shown to the student. Design the ops to TEACH: include a
collision (hash_map), an update of an existing key, a miss, and one underflow (pop/dequeue on
empty) — our engine executes every operation for real and narrates sizes, hashes and chains.`,
  canHandle: ({ json, code }) => Boolean(json.operations && typeof json.operations === 'object' && code),
  async run({ json, code, lang }) {
    return compileOperationsTrace({
      structure: json.operations.structure,
      ops: json.operations.ops,
      code,
      lines: json.operations.lines ?? {},
      buckets: json.operations.buckets ?? 5,
      language: lang,
    });
  },
};
