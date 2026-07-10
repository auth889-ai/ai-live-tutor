// COLLECTION-OPS LENS — detector/compiler pair #6 of the record-once/detect-later engine:
// stacks, queues and hash maps AS THE LESSON (Valid Parentheses, monotonic stacks, frequency
// counters). This is the operation-pattern edge already proven in the line-sim auto-upgrade:
// detectCollectionOps() watches what a list/dict UNDERGOES across the recording (clean tail
// pushes + tail pops = stack, front pops = queue, growing string-keyed dict = hash map) and
// the operations compiler animates it — slot rows filling and draining, collision chains
// walked hop by hop.
//
// Priority is deliberate and tested elsewhere in the registry: every structural lens (grid,
// chain, tree, recursion) outranks this one, so Rotten Oranges keeps its BOARD and Subsets
// keeps its TREE even though both also carry a clean queue/stack — this lens exists for the
// problems where the collection IS the story.

import { compileOperationsTrace } from '../../operations/compiler.js';
import { detectCollectionOps } from '../../collections/detect.js';

// Decide the lens from the recording. Returns null or:
//   { lens: 'collection-ops', confidence, varName, structure, ops, lines }
export function detectCollectionLens(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const found = detectCollectionOps(lines);
  if (!found) return null;
  if (found.ops.length > 40) return null; // a lesson, not a log — the floor cuts openly instead
  return { lens: 'collection-ops', confidence: 0.8, ...found };
}

export function compileCollectionOps({ recording, plan, code, language = 'python' }) {
  if (!plan || plan.lens !== 'collection-ops') throw new Error('compileCollectionOps needs a plan from detectCollectionLens');
  return compileOperationsTrace({
    structure: plan.structure,
    ops: plan.ops,
    code,
    lines: plan.lines,
    language,
  });
}
