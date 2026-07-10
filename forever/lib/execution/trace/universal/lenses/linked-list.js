// LINKED-LIST LENS — detector/compiler pair #4 of the record-once/detect-later engine. The
// universal recorder already snapshots the heap object graph with STABLE identities whenever
// it changes; this lens recognizes a chain (a node type that links onward through `next` and
// never sideways through left/right/neighbors), rebuilds the per-line {nodes, pointers} states
// the dedicated linked-list compiler animates (boxes fixed at first appearance, arrows flip,
// orphans fade, named fingers walk), and delegates the whole animation to it.

import { compileLinkedListTrace } from '../../linked-list/compiler.js';

const TREE_LINKS = ['left', 'right', 'neighbors', 'children'];
const ref = (v) => (v && typeof v === 'object' && !Array.isArray(v) && typeof v['@ref'] === 'string' ? v['@ref'] : null);
const valueOf = (rec) => rec.val ?? rec.value ?? rec.data ?? rec.key ?? rec.name ?? null;

// Decide the lens from the recording. Returns null or:
//   { lens: 'linked-list', confidence, nodeType, nodeCount }
export function detectLinkedList(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const idsByType = new Map(); // type -> Set of ids
  const chained = new Set(); // types seen actually LINKING via next
  for (const e of lines) {
    for (const [id, rec] of Object.entries(e.heap ?? {})) {
      if (TREE_LINKS.some((a) => rec[a] !== undefined)) return null; // a tree/graph is not a chain
      (idsByType.get(rec.type) ?? idsByType.set(rec.type, new Set()).get(rec.type)).add(id);
      if (typeof rec.next === 'string') chained.add(rec.type);
    }
  }
  let best = null;
  for (const type of chained) {
    const count = idsByType.get(type)?.size ?? 0;
    if (count >= 2 && (!best || count > best.nodeCount)) best = { nodeType: type, nodeCount: count };
  }
  if (!best) return null;
  return { lens: 'linked-list', confidence: 0.85, ...best };
}

// Rebuild per-line {nodes, pointers} states from the change-only heap snapshots, then delegate.
export function compileLinkedListLens({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'linked-list') throw new Error('compileLinkedListLens needs a plan from detectLinkedList');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const isChain = (rec) => rec?.type === plan.nodeType;

  // Pass 1 — every local name that EVER held a chain node is a named finger; once known, it
  // stays in the pointer panel even while it reads None (prev starts at None — that IS a lesson).
  const pointerNames = new Set();
  let heap = {};
  for (const e of lines) {
    if (e.heap) heap = e.heap;
    for (const [k, v] of Object.entries(e.locals)) {
      if (ref(v) && isChain(heap[ref(v)])) pointerNames.add(k);
    }
  }
  if (pointerNames.size === 0) throw new Error('no local ever pointed at a chain node — not a linked-list walk');

  // Pass 2 — the heap is recorded only when it CHANGES; carry it forward so every line event
  // becomes a full {nodes, pointers} snapshot (reachability = what the real heap walk saw).
  heap = {};
  const events = [];
  for (const e of lines) {
    if (e.heap) heap = e.heap;
    const nodes = {};
    for (const [id, rec] of Object.entries(heap)) {
      if (isChain(rec)) nodes[id] = { value: valueOf(rec), next: rec.next ?? null };
    }
    if (Object.keys(nodes).length === 0) continue;
    const pointers = {};
    for (const name of pointerNames) {
      if (name in e.locals) pointers[name] = ref(e.locals[name]);
    }
    const variables = {};
    for (const [k, v] of Object.entries(e.locals)) {
      if (['number', 'string', 'boolean'].includes(typeof v)) variables[k] = v;
    }
    events.push({ line: e.line, state: { nodes, pointers }, variables });
  }
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });

  // A node-object result reads as ListNode(3), never a memory address (repo-wide rule).
  let result = recording.result;
  const rid = ref(result);
  if (rid) result = `${plan.nodeType}(${JSON.stringify(valueOf(heap[rid] ?? {}))})`;

  return compileLinkedListTrace({ events, result, code, entry, language });
}
