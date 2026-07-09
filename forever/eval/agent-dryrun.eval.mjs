// AGENT→TRACER HANDOFF BATTERY — the missing test layer that let 4 different bugs each cost a
// 20-minute lesson regeneration. Engine unit tests exercise the code BELOW the agent; lesson
// runs exercise everything at 20min/attempt. This runs the REAL tracer agent (one Qwen call +
// local python per problem) on hard LeetCode problems and prints every failure at once —
// seconds per problem, all bugs in one sitting.
//
//   node --env-file=.env eval/agent-dryrun.eval.mjs            (all problems)
//   node --env-file=.env eval/agent-dryrun.eval.mjs "path sum" (name filter)

import { traceExecution } from '../lib/orchestration/agents/coding/execution-tracer.js';

const PROBLEMS = [
  ['LC124 Binary Tree Maximum Path Sum (HARD tree recursion)',
    'Show a visual dry run of the optimal solution: for each node compute gains from children clamped at 0, track the global best path sum through the node. Example tree: [-10,9,20,null,null,15,7] -> 42.'],
  ['LC269 Alien Dictionary (HARD graph topo sort)',
    'Show a visual dry run of Kahn\'s topological sort for the alien dictionary problem on words ["wrt","wrf","er","ett","rftt"] (answer "wertf"): build the precedence graph, then indegree+queue.'],
  ['LC297 Serialize/Deserialize Binary Tree (HARD tree)',
    'Show a visual dry run of preorder serialization of the tree [1,2,3,null,null,4,5] into a string with null markers.'],
  ['LC42 Trapping Rain Water (HARD two pointers)',
    'Show a visual dry run of the two-pointer solution on height=[0,1,0,2,1,0,1,3,2,1,2,1] (answer 6): left/right pointers, leftMax/rightMax.'],
  ['LC72 Edit Distance (HARD DP table)',
    'Show a visual dry run of the DP table for edit distance between "horse" and "ros" (answer 3), filling cell by cell.'],
  ['LC23 Merge K Sorted Lists (HARD heap + lists)',
    'Show a visual dry run of merging [[1,4,5],[1,3,4],[2,6]] with a min-heap: pop the smallest, append to result, push its successor.'],
  ['LC212 Word Search II (HARD trie)',
    'Show a visual dry run of building a trie from words ["oath","pea","eat","rain"] — insert them letter by letter.'],
  ['LC84 Largest Rectangle in Histogram (HARD stack)',
    'Show a visual dry run of the monotonic stack solution on heights=[2,1,5,6,2,3] (answer 10): push indices, pop when a smaller bar arrives, compute areas.'],
  ['LC206 Reverse Linked List (list rewiring)',
    'Show a visual dry run of reversing the linked list 1->2->3->4: prev/curr/nxt pointers, arrows flipping one by one.'],
  ['LC53 Maximum Subarray (floor: Kadane)',
    'Show a visual dry run of Kadane\'s algorithm on [-2,1,-3,4,-1,2,1,-5,4] (answer 6).'],
];

const filter = (process.argv[2] ?? '').toLowerCase();
const picked = PROBLEMS.filter(([name]) => name.toLowerCase().includes(filter));
let pass = 0;
const failures = [];

for (const [name, directive] of picked) {
  const t0 = Date.now();
  try {
    const result = await traceExecution({ directive, language: 'python' });
    const trace = result?.trace ?? null;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!trace) {
      failures.push([name, 'traceExecution returned null (all modes/retries exhausted)']);
      console.log(`✖ ${name} — NULL after ${secs}s`);
      continue;
    }
    const views = Object.keys(trace.views ?? {});
    console.log(`✔ ${name} — ${trace.steps.length} steps, tool=${trace.meta?.tool}, views=[${views}], fixes=${result.fixes} (${secs}s)`);
    pass += 1;
  } catch (error) {
    failures.push([name, String(error?.message ?? error).slice(0, 300)]);
    console.log(`✖ ${name} — THREW: ${String(error?.message ?? error).slice(0, 160)}`);
  }
}

console.log(`\n${pass}/${picked.length} produced real traces`);
for (const [name, why] of failures) console.log(`  FAIL ${name}\n    ${why}`);
process.exit(failures.length === 0 ? 0 : 1);
