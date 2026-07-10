// OBJECT-STRUCTURE LENS — detector/compiler pair #5 of the record-once/detect-later engine:
// trees and object graphs (TreeNode with left/right, graph Node with neighbors/children).
// The universal recorder's heap snapshots already carry the whole structure with stable ids;
// this lens recognizes SIDEWAYS links — left/right/children/neighbors — and delegates to the
// proven structure compiler (growth revealed node by node, the cursor riding whichever local
// stands on a node, visited accumulating, left/right rendered as sides).
//
// Family boundaries are explicit: a pure `next` chain belongs to the linked-list lens (it
// never triggers here); anything that branches belongs here, not there. Both lenses outrank
// recursion-tree in the registry — on a recursive traversal the STRUCTURE is the lesson,
// the call tree is how it happens.

import { compileStructureTrace } from '../../structure/compiler.js';

const BRANCH_LINKS = ['left', 'right', 'children', 'neighbors'];
const ref = (v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v['@ref'] === 'string' ? v['@ref'] : null);
const valueOf = (rec) => rec.val ?? rec.value ?? rec.data ?? rec.key ?? rec.name ?? null;

// Decide the lens from the recording. Returns null or:
//   { lens: 'object-structure', confidence, nodeType, nodeCount }
export function detectObjectStructure(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const idsByType = new Map();
  const branching = new Set();
  for (const e of lines) {
    for (const [id, rec] of Object.entries(e.heap ?? {})) {
      (idsByType.get(rec.type) ?? idsByType.set(rec.type, new Set()).get(rec.type)).add(id);
      if (BRANCH_LINKS.some((a) => rec[a] !== undefined)) branching.add(rec.type);
    }
  }
  let best = null;
  for (const type of branching) {
    const count = idsByType.get(type)?.size ?? 0;
    if (count >= 2 && (!best || count > best.nodeCount)) best = { nodeType: type, nodeCount: count };
  }
  if (!best) return null;
  return { lens: 'object-structure', confidence: 0.85, ...best };
}

// Rebuild per-line {nodes, pointers} snapshots from the change-only heap, then delegate.
export function compileObjectStructure({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'object-structure') throw new Error('compileObjectStructure needs a plan from detectObjectStructure');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');

  let heap = {};
  const events = [];
  for (const e of lines) {
    if (e.heap) heap = e.heap;
    const nodes = {};
    for (const [id, rec] of Object.entries(heap)) {
      if (rec.type !== plan.nodeType) continue;
      const refs = [];
      for (const field of ['left', 'right', 'next', 'children', 'neighbors']) {
        const link = rec[field];
        if (typeof link === 'string') refs.push([field, link]);
        else if (Array.isArray(link)) for (const cid of link) refs.push([field, cid]);
      }
      nodes[id] = { label: valueOf(rec) ?? '?', refs };
    }
    if (Object.keys(nodes).length === 0) continue;
    const pointers = {};
    for (const [k, v] of Object.entries(e.locals)) {
      const id = ref(v);
      if (id && nodes[id]) pointers[k] = id;
    }
    const variables = {};
    for (const [k, v] of Object.entries(e.locals)) {
      if (['number', 'string', 'boolean'].includes(typeof v)) variables[k] = v;
    }
    events.push({ line: e.line, state: { kind: 'obj', nodes, pointers }, variables });
  }
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });

  // A node-object result reads as TreeNode(5), never a memory address (repo-wide rule).
  let result = recording.result;
  const rid = ref(result);
  if (rid) result = `${plan.nodeType}(${JSON.stringify(valueOf(heap[rid] ?? {}))})`;

  return compileStructureTrace({ events, result, code, entry, language });
}
