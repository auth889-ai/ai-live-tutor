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
  let found = detectCollectionOps(lines);
  if (!found) return null;
  // THE LRU SIGNATURE: a stack/queue can win the op-count contest while being a hash map's
  // SHADOW — when a dict's keys are exactly the winning list's member values, the MAP is the
  // lesson and the list is its recency order. Flip the primary before composing.
  if (found.structure !== 'hash_map') {
    const memberVals = new Set(found.ops.filter((o) => o.value !== undefined).map((o) => String(o.value)));
    for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
      if (name === found.varName) continue;
      if (!lines.some((e) => e.locals[name] && typeof e.locals[name] === 'object' && !Array.isArray(e.locals[name]))) continue;
      const asMap = detectCollectionOps(lines, { varName: name });
      if (asMap?.structure !== 'hash_map') continue;
      const overlap = asMap.ops.filter((o) => memberVals.has(String(o.key))).length;
      if (overlap >= 2) {
        found = detectCollectionOps(lines, { varName: name, companionVar: found.varName }) ?? asMap;
        break;
      }
    }
  }
  // LRU COMPOSITION: when the lesson is a hash map, look for its RECENCY companion — a list
  // whose members are the map's own keys and which keeps reordering (order.remove/append).
  // Re-run the detection with the companion declared so every op carries its live snapshot.
  if (found.structure === 'hash_map' && !found.ops.some((o) => o.companion)) {
    const keys = new Set(found.ops.map((o) => String(o.key)));
    for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
      if (name === found.varName) continue;
      const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
      if (snaps.length < 2 || snaps.at(-1).length === 0) continue;
      if (!snaps.every((s) => s.every((m) => keys.has(String(m))))) continue;
      let changes = 0;
      for (let i = 1; i < snaps.length; i += 1) if (JSON.stringify(snaps[i - 1]) !== JSON.stringify(snaps[i])) changes += 1;
      if (changes < 2) continue;
      found = detectCollectionOps(lines, { companionVar: name }) ?? found;
      break;
    }
  }
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
