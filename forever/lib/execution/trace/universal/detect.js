// THE LENS-DETECTOR REGISTRY — one entry per visual family, one file per family under
// lenses/, one ordered list here (mirror of tracer-modes/index.js). Detectors read a universal
// recording AFTER the real run and return a lens plan with a confidence score, or null; the
// classification happens ONCE over the whole timeline, never per step, so the chosen lens can
// never flicker mid-animation. Order = specificity: when confidences tie, the earlier (more
// specific) family wins.

import { detectGridWalk, compileGridWalk } from './lenses/grid-walk.js';
import { detectRecursionTree, compileRecursionTree } from './lenses/recursion-tree.js';

export const LENS_DETECTORS = Object.freeze([
  // grid-walk before recursion-tree: a recursive flood fill is BOTH, but the board is the
  // teaching view there — the call tree of a 40-cell DFS is noise, the spreading grid is the lesson.
  { key: 'grid-walk', detect: detectGridWalk, compile: compileGridWalk },
  { key: 'recursion-tree', detect: detectRecursionTree, compile: compileRecursionTree },
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
