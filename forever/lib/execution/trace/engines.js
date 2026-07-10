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
//   recursion (fib, subsets, top-down DP with memo hits)   -> recursion-compiler (call-tree
//                                                              recording + Euler-tour playback)
//   divide & conquer on ARRAYS (merge sort, quicksort:     -> divide-conquer compiler (call/
//     focus band dims everything outside the active call's    return/line tracker; array band
//     segment, swaps flash, the recursion tree of segments    view + segment recursion tree
//     grows and each call returns its sorted band)            from ONE real run, in lock-step)
//   array pointer algorithms (binary search, two pointers,  -> pointer-walk-compiler (settrace
//     sliding window, in-place sorting: arrows, eliminated     run + array lens; declared
//     half, window span, swap flashes, live values)            examine/arrayVar semantics)
//   DP tables (LCS, knapsack, edit distance: one visible   -> dp-table compiler (declared dp
//     write per cell with real old->new values, base row       variable snapshotted faithfully
//     taught, answer read out of the final cell)               per line; GridView fills; a
//                                                              >24x24 table fails LOUD)
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
//   trie (insert/search/startsWith/delete: tree grows       -> trie compiler (root chased thru
//     char by char, end-of-word nodes green, cursor           declared children attr; create vs
//     rides under the student's variable name, prune          reuse fork, app-vs-apple end-flag
//     fades — VisuAlgo has NO trie module at all)             lesson, bottom-up prune)
//   ANY OTHER tree/graph problem (TreeNode/ListNode/Node    -> structure compiler (universal
//     objects or adjacency dict/list: invert tree, LCA,        AUTO-EXTRACTION: BFS-follows the
//     clone graph, serialize, path sum — the structure         real objects' reference fields /
//     draws ITSELF from memory, zero declaration)              domain-closed adjacency; cursor =
//                                                              whichever local's id() is a node)

export { compileTraversalTrace, TRAVERSAL_KINDS } from './traversal/compiler.js';
export { compileGraphWalk, GRAPH_LENS_ROLES } from './graph-walk/compiler.js';
export { compileLinkedListTrace } from './linked-list/compiler.js';
export { assembleListProgram, parseListEvents, LIST_TRACKER_PY } from './linked-list/tracker.js';
export { compileDivideConquer } from './divide-conquer/compiler.js';
export { assembleDivideProgram, parseDivideEvents, DIVIDE_TRACKER_PY } from './divide-conquer/tracker.js';
export { compileTrieTrace } from './trie/compiler.js';
export { assembleTrieProgram, parseTrieEvents, TRIE_TRACKER_PY } from './trie/tracker.js';
export { compileDpTable } from './dp-table/compiler.js';
export { assembleDpProgram, parseDpEvents, DP_TRACKER_PY } from './dp-table/tracker.js';
export { compileStructureTrace } from './structure/compiler.js';
export { assembleStructureProgram, parseStructureEvents, STRUCTURE_TRACKER_PY } from './structure/tracker.js';
export { compileOperationsTrace, OPERATION_STRUCTURES } from './operations/compiler.js';
export { compileRecursionTrace, assembleRecursionProgram, parseCallTree, RECURSION_TRACKER_PY } from './recursion/compiler.js';
export { compilePointerWalk } from './pointer-walk/compiler.js';
export { compileLineTrace, assembleLineProgram, parseLineEvents, LINE_TRACKER_PY } from './line-sim/compiler.js';
export { assembleUniversalProgram, parseUniversalEvents, validateUniversalRecording, UNIVERSAL_TRACKER_PY } from './universal/recorder.js';
export { detectLenses, LENS_DETECTORS } from './universal/detect.js';
export { detectGridWalk, compileGridWalk } from './universal/lenses/grid-walk.js';
export { detectRecursionTree, compileRecursionTree } from './universal/lenses/recursion-tree.js';
export { parseStepEvents, STEP_MARKER } from './parse-steps.js';
