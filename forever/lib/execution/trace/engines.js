// THE TRACE ENGINE REGISTRY — one folder (lib/execution/trace/), one tool per file, one
// wiring point. Every dry run in Forever is produced by one of these engines; the Execution
// Tracer agent only CLASSIFIES the algorithm's shape and supplies the problem — all recording,
// stepping and narration is deterministic code in this folder. The shared output contract is
// ExecutionTrace (lib/board/execution/execution-trace.js), rendered by ONE AlgorithmStage:
// code line + structure + pointers + stack/queue + variables + trace table + voice, all from
// one step object per moment — matching is structural, not hoped-for.
//
// Coverage map (algorithm family -> engine):
//   trees & graphs (BFS/DFS/level-order, any nodes/edges)  -> traversal-compiler (native walk)
//   recursion & divide-and-conquer (fib, subsets, merge     -> recursion-compiler (call-tree
//     sort splits, top-down DP with memo hits)                 recording + Euler-tour playback)
//   array pointer algorithms (binary search, two pointers,  -> pointer-walk-compiler (settrace
//     sliding window: arrows, eliminated half, window span)    run + array lens)
//   DP tables (LCS, knapsack: one frame per cell write,     -> tracer @@STEP array2d contract
//     dependency reads highlighted, running best)              (real execution, grid view)
//   EVERYTHING ELSE (greedy, math, string, OOP, any custom  -> line-simulator (sys.settrace
//     LeetCode/Codeforces code)                                floor: every line + variable
//                                                              change of a real run — a dry run
//                                                              can never be trace-less)

//   data structures THEMSELVES (stack push/pop, queue      -> operations/compiler (one frame
//     enqueue/dequeue, hash map put/get: collisions,           per op, real hashes/chains,
//     updates, misses, underflow taught as lessons)            underflow narrated)
//   linked list (chain view with node insert/delete)       -> PLANNED: needs a dedicated
//                                                              chain renderer first — not
//                                                              shipped weak on the graph view

export { compileTraversalTrace, TRAVERSAL_KINDS } from './traversal/compiler.js';
export { compileOperationsTrace, OPERATION_STRUCTURES } from './operations/compiler.js';
export { compileRecursionTrace, assembleRecursionProgram, parseCallTree, RECURSION_TRACKER_PY } from './recursion/compiler.js';
export { compilePointerWalk } from './pointer-walk/compiler.js';
export { compileLineTrace, assembleLineProgram, parseLineEvents, LINE_TRACKER_PY } from './line-sim/compiler.js';
export { parseStepEvents, STEP_MARKER } from './parse-steps.js';
