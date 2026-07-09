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
//   ANY other graph algorithm (Dijkstra, Bellman-Ford,     -> graph-walk-compiler (settrace
//     Kahn's topo sort, Prim, union-find, cycle detection:    run of the STUDENT'S real code +
//     extract-min, relax old->new, finalize, union,           declared variable lens; the dist
//     indegree drops — all from the real run)                 table IS the trace table)
//   recursion & divide-and-conquer (fib, subsets, merge     -> recursion-compiler (call-tree
//     sort splits, top-down DP with memo hits)                 recording + Euler-tour playback)
//   array pointer algorithms (binary search, two pointers,  -> pointer-walk-compiler (settrace
//     sliding window, in-place sorting: arrows, eliminated     run + array lens; declared
//     half, window span, swap flashes, live values)            examine/arrayVar semantics)
//   DP tables (LCS, knapsack: one frame per cell write,     -> tracer @@STEP array2d contract
//     dependency reads highlighted, running best)              (real execution, grid view)
//   structure-LESS algorithms ONLY (pure math like gcd,     -> line-simulator (sys.settrace:
//     string building, greedy counting — nothing to draw)      every line + variable change of
//                                                              a real run, truncation cut openly)
//
// NO DOWNGRADE RULE (user's standing order): line-sim is a CLASSIFICATION, never a fallback.
// A failed engine attempt fixes its error in the same mode or moves to a RICHER mode; every
// engine's output passes the same dryRunQualityIssue() gate (pointers riding the structure,
// collections shown, tutor-voice explanations) — see execution-tracer.js.

//   data structures THEMSELVES (stack push/pop, queue      -> operations/compiler (one frame
//     enqueue/dequeue, hash map put/get: collisions,           per op, real hashes/chains,
//     updates, misses, underflow taught as lessons)            underflow narrated)
//   linked list (traverse, reverse, insert, delete,        -> linked-list compiler (dedicated
//     slow/fast, cycle detection: fixed boxes, arrows         identity-preserving tracker +
//     flip, orphans fade — real node objects)                 LinkedListView chain renderer)

export { compileTraversalTrace, TRAVERSAL_KINDS } from './traversal/compiler.js';
export { compileGraphWalk, GRAPH_LENS_ROLES } from './graph-walk/compiler.js';
export { compileLinkedListTrace } from './linked-list/compiler.js';
export { assembleListProgram, parseListEvents, LIST_TRACKER_PY } from './linked-list/tracker.js';
export { compileOperationsTrace, OPERATION_STRUCTURES } from './operations/compiler.js';
export { compileRecursionTrace, assembleRecursionProgram, parseCallTree, RECURSION_TRACKER_PY } from './recursion/compiler.js';
export { compilePointerWalk } from './pointer-walk/compiler.js';
export { compileLineTrace, assembleLineProgram, parseLineEvents, LINE_TRACKER_PY } from './line-sim/compiler.js';
export { parseStepEvents, STEP_MARKER } from './parse-steps.js';
