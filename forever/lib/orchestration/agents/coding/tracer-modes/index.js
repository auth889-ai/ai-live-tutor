// THE TRACER-MODE REGISTRY — one folder per visual family, one file per mode, one ordered list
// here. Each mode owns its prompt section and how to run its engine; the Execution Tracer agent
// only classifies and dispatches (no god-file). Order = specificity: the most specific teaching
// tool first, the raw model-written @@STEP program last.

import { recursionMode } from './tree/recursion.js';
import { trieMode } from './tree/trie.js';
import { traversalMode } from './graph/traversal.js';
import { graphWalkMode } from './graph/graph-walk.js';
import { structureMode } from './graph/structure.js';
import { dpTableMode } from './array/dp-table.js';
import { divideConquerMode } from './array/divide-conquer.js';
import { pointerWalkMode } from './array/pointer-walk.js';
import { intervalsMode } from './array/intervals.js';
import { linkedListMode } from './list/linked-list.js';
import { operationsMode } from './collection/operations.js';
import { lineSimMode } from './floor/line-sim.js';
import { programMode } from './floor/program.js';

export const TRACER_MODES = Object.freeze([
  recursionMode,
  traversalMode,
  graphWalkMode,
  dpTableMode,
  trieMode,
  divideConquerMode,
  structureMode,
  linkedListMode,
  operationsMode,
  pointerWalkMode,
  intervalsMode,
  lineSimMode,
  programMode,
]);
