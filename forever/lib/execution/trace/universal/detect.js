// THE LENS-DETECTOR REGISTRY — one entry per visual family, one file per family under
// lenses/, one ordered list here (mirror of tracer-modes/index.js). Detectors read a universal
// recording AFTER the real run and return a lens plan with a confidence score, or null; the
// classification happens ONCE over the whole timeline, never per step, so the chosen lens can
// never flicker mid-animation. Order = specificity: when confidences tie, the earlier (more
// specific) family wins.

import { detectGridWalk, compileGridWalk } from './lenses/grid-walk.js';
import { detectRecursionTree, compileRecursionTree } from './lenses/recursion-tree.js';
import { detectPointerArray, compilePointerArray } from './lenses/pointer-array.js';
import { detectLinkedList, compileLinkedListLens } from './lenses/linked-list.js';
import { detectObjectStructure, compileObjectStructure } from './lenses/object-structure.js';
import { detectCollectionLens, compileCollectionOps } from './lenses/collection-ops.js';
import { detectHeap, compileHeap } from './lenses/heap.js';
import { detectExploredGraph, compileExploredGraph } from './lenses/explored-graph.js';
import { detectTrieDict, compileTrieDict } from './lenses/trie-dict.js';
import { detectDivideConquer, compileDivideConquerLens } from './lenses/divide-conquer.js';
import { detectIntervals, compileIntervalsLens } from './lenses/intervals.js';
import { detectDpTable, compileDpTableLens } from './lenses/dp-table.js';
import { detectGraphAdjacency, compileGraphAdjacency } from './lenses/graph-adjacency.js';
import { detectUnionFind, compileUnionFind } from './lenses/union-find.js';
import { detectAdjacencyMatrix, compileAdjacencyMatrix } from './lenses/adjacency-matrix.js';

export const LENS_DETECTORS = Object.freeze([
  // dp-table above grid-walk: both fire on a mutating 2D list, but the DP detector demands
  // three fingerprints (scaffold/growing start, row-major sweep, no frontier queue) — when all
  // three say "fill", the dedicated DP animation beats the board view.
  // Structure lenses (grid, chain, tree/graph) outrank recursion-tree: a recursive flood fill,
  // reversal or traversal is BOTH families, but the structure is the lesson — the call tree is
  // merely how it happens (equal confidences — registry order breaks the tie).
  // collection-ops (0.8) sits below all of those: Rotten Oranges keeps its board and Subsets
  // keeps its tree even though both also carry a clean queue/stack; it wins only where the
  // collection IS the story (Valid Parentheses, frequency counters).
  // intervals BEFORE dp-table (both 0.9): a growing pair-list is also a 2-column table filling
  // in sweep order, so dp-table co-fires on every merge-intervals run — but the intervals
  // detector demanded s<=e pairs, a stable input AND a fusion; the more specific reading wins.
  { key: 'intervals', detect: detectIntervals, compile: compileIntervalsLens },
  { key: 'dp-table', detect: detectDpTable, compile: compileDpTableLens },
  { key: 'grid-walk', detect: detectGridWalk, compile: compileGridWalk },
  // graph-adjacency (0.88) between the boards and the object lenses: a walked adjacency dict
  // beats its own queue/recursion (Course Schedule shows the GRAPH, not just Kahn's queue).
  { key: 'graph-adjacency', detect: detectGraphAdjacency, compile: compileGraphAdjacency },
  // adjacency-matrix (0.87) and union-find (0.86) right behind it: a SQUARE STATIC
  // double-subscripted matrix with a walker is a graph in disguise; the identity-map birthmark
  // is unmistakable, and only a forest proves a bare pair-list is a graph.
  { key: 'adjacency-matrix', detect: detectAdjacencyMatrix, compile: compileAdjacencyMatrix },
  { key: 'union-find', detect: detectUnionFind, compile: compileUnionFind },
  // divide-conquer (0.86): the splitter's nested-segments fingerprint outranks its own recursion tree.
  { key: 'divide-conquer', detect: detectDivideConquer, compile: compileDivideConquerLens },
  { key: 'linked-list', detect: detectLinkedList, compile: compileLinkedListLens },
  { key: 'object-structure', detect: detectObjectStructure, compile: compileObjectStructure },
  { key: 'recursion-tree', detect: detectRecursionTree, compile: compileRecursionTree },
  // heap (0.82) between recursion and collection-ops: when a heap is merely the FRONTIER of a
  // graph walk the graph lens (0.88) owns the run; when the heap IS the lesson, nothing outranks it.
  { key: 'heap', detect: detectHeap, compile: compileHeap },
  // explored-graph (0.83) above collection-ops: on an implicit graph the discovery TREE is the
  // lesson, not the queue that drives it; real-adjacency walks still route to graph-adjacency.
  { key: 'explored-graph', detect: detectExploredGraph, compile: compileExploredGraph },
  // trie-dict (0.84) above collection-ops: a NESTED growing char-keyed dict is a tree being
  // built, not a flat map being filled — shared prefixes are the lesson.
  { key: 'trie-dict', detect: detectTrieDict, compile: compileTrieDict },
  { key: 'collection-ops', detect: detectCollectionLens, compile: compileCollectionOps },
  { key: 'pointer-array', detect: detectPointerArray, compile: compilePointerArray },
]);

// All lens plans this recording supports, best first. ctx carries { code } so detectors can use
// the source as a secondary signal (never the only one — behavior in the recording leads).
export function detectLenses(recording, ctx = {}) {
  return LENS_DETECTORS
    .map((d) => {
      const plan = d.detect(recording, ctx);
      return plan ? { ...plan, compile: d.compile } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);
}
