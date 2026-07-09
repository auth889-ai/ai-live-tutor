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
  // ---- family-coverage tier: 2-3 DIVERSE problems per family, so "any problem in the
  // family" is measured, not assumed. Includes grid->graph and CF-style shapes. ----
  ['LC78 Subsets (backtracking recursion)',
    'Show a visual dry run of the recursive subsets/backtracking solution for nums=[1,2,3]: the call tree branching on include/exclude.'],
  ['LC70 Climbing Stairs (top-down memo)',
    'Show a visual dry run of top-down memoized climbing stairs for n=6: the recursion tree with memo hits.'],
  ['LC102 Binary Tree Level Order (BFS traversal)',
    'Show a visual dry run of level-order traversal (BFS with a queue) of the tree [3,9,20,null,null,15,7].'],
  ['LC200 Number of Islands (grid BFS)',
    'Show a visual dry run of counting islands in the grid [["1","1","0"],["1","0","0"],["0","0","1"]] (answer 2): flood-fill from each unvisited land cell.'],
  ['LC207 Course Schedule (cycle detection)',
    'Show a visual dry run of deciding if numCourses=4 with prerequisites [[1,0],[2,1],[3,2]] can finish (yes): Kahn\'s indegree walk.'],
  ['LC743 Network Delay Time (Dijkstra variant)',
    'Show a visual dry run of Dijkstra for times=[[2,1,1],[2,3,1],[3,4,1]], n=4, k=2 (answer 2).'],
  ['LC322 Coin Change (1D DP)',
    'Show a visual dry run of the DP table for coin change with coins=[1,2,5], amount=6 (answer 2): dp[i] filled left to right.'],
  ['LC62 Unique Paths (2D DP)',
    'Show a visual dry run of the 3x3 unique-paths DP grid filling cell by cell (answer 6).'],
  ['LC208 Implement Trie (insert + search)',
    'Show a visual dry run of inserting "apple" and "app" into a trie, then searching "app" (found).'],
  ['LC912 Sort an Array (merge sort divide & conquer)',
    'Show a visual dry run of merge sort on [5,2,3,1]: the split tree and the merges with real values.'],
  ['LC21 Merge Two Sorted Lists (list splicing)',
    'Show a visual dry run of merging the linked lists 1->2->4 and 1->3->4: the two pointers choosing the smaller head each step.'],
  ['LC146 LRU Cache (hash map + ops, HARD)',
    'Show a visual dry run of an LRU cache with capacity 2: put(1,1), put(2,2), get(1), put(3,3) evicts key 2, get(2) misses.'],
  ['LC11 Container With Most Water (two pointers)',
    'Show a visual dry run of the two-pointer solution on height=[1,8,6,2,5,4,8,3,7] (answer 49): pointers closing in from both ends.'],
  ['LC136 Single Number (bit-trick floor)',
    'Show a visual dry run of XOR-ing [4,1,2,1,2] to find the single number (answer 4).'],
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
