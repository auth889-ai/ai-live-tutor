// HEAP LENS — detector/compiler pair #11 of the record-once/detect-later engine: the heap AS
// THE LESSON (Kth Largest, top-K, merge-K, running median). The researched standard (VisuAlgo,
// USFCA — both offer exactly these two modes) is the ARRAY-AS-TREE dual reading: the compact
// array IS the complete binary tree, children of i live at 2i+1 and 2i+2. This lens renders
// the array (cells sized to the run's high-water mark, the slot-row pattern from operations)
// and the NARRATION carries the tree reading — where the pushed value settled after sifting,
// which parent it sits under, why the root is always the minimum. The `top` pointer rides
// index 0 on every step: heap[0] is the whole point of a heap.
//
// Detection is two-signal like everything else: the code calls heapq on the variable AND the
// recorded list satisfies the heap property at EVERY sighting (on first elements for tuple
// entries) — a list that merely grows and shrinks near heapq is not necessarily the heap.

import { validateExecutionTrace } from '../../../../board/execution/execution-trace.js';

const keyOf = (x) => (Array.isArray(x) ? x[0] : x);
const isHeapSnapshot = (v) =>
  Array.isArray(v) && v.every((x) => typeof keyOf(x) === 'number') &&
  v.every((_, i) => {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    return (l >= v.length || keyOf(v[i]) <= keyOf(v[l])) && (r >= v.length || keyOf(v[i]) <= keyOf(v[r]));
  });

// Decide the lens from the recording. Returns null or { lens: 'heap', confidence, heapVar }.
export function detectHeap(recording, { code = '' } = {}) {
  if (!/\bheappush\b|\bheappop\b|\bheapify\b/.test(code)) return null;
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  let best = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (!new RegExp(`\\bheap(?:push|pop|ify|pushpop|replace)\\(\\s*${name}\\b`).test(code)) continue;
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 3) continue;
    // The property must hold from its first ordered snapshot ONWARD — `heap = [-s for s in
    // stones]` legitimately exists unordered until heapify; once a heap, always a heap.
    const firstOk = snaps.findIndex(isHeapSnapshot);
    if (firstOk === -1 || !snaps.slice(firstOk).every(isHeapSnapshot)) continue;
    let mutations = 0;
    for (let i = Math.max(1, firstOk); i < snaps.length; i += 1) {
      if (JSON.stringify(snaps[i - 1]) !== JSON.stringify(snaps[i])) mutations += 1;
    }
    if (mutations < 2) continue;
    if (!best || mutations > best.mutations) best = { name, mutations };
  }
  if (!best) return null;
  return { lens: 'heap', confidence: 0.82, heapVar: best.name };
}

// Compile the recording: one step per push/pop, cells in the slot-row pattern, tree-reading narration.
export function compileHeap({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'heap') throw new Error('compileHeap needs a plan from detectHeap');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  const truncated = recording?.events?.at(-1)?.truncated === true;
  const codeLines = String(code ?? '').split('\n');
  const src = (line) => (codeLines[line - 1] ?? '').trim();
  const show = (x) => (Array.isArray(x) ? x.map((v) => JSON.stringify(v)).join(':') : JSON.stringify(x));

  const snaps = lines.map((e) => ({ e, heap: e.locals[plan.heapVar] })).filter(({ heap }) => Array.isArray(heap));
  if (snaps.length === 0) throw new Error(`the recording never saw "${plan.heapVar}" as a list`);
  const capacity = Math.max(1, ...snaps.map(({ heap }) => heap.length));

  const cells = (heap) => [...heap.map(show), ...Array(capacity - heap.length).fill('')];
  const parentOf = (i) => Math.floor((i - 1) / 2);
  const arrState = (heap, extra = {}) => ({
    values: cells(heap),
    pointers: { top: 0, ...(extra.pointers ?? {}) },
    ...(extra.current !== undefined ? { current: extra.current } : {}),
    ...(extra.swapped ? { swapped: extra.swapped } : {}),
  });
  const scalars = (locals) => {
    const out = {};
    for (const [k, v] of Object.entries(locals)) if (['number', 'string', 'boolean'].includes(typeof v)) out[k] = v;
    return out;
  };

  const steps = [];
  let prev = null;
  let prevEvent = null;
  for (const { e, heap } of snaps) {
    if (prev === null) {
      steps.push({
        line: e.line,
        explanation: `${entry ? `We run \`${entry}\` and record the real execution. ` : ''}The row of ${capacity} slot${capacity === 1 ? '' : 's'} you see IS a binary tree in disguise — the children of slot i live at slots 2i+1 and 2i+2, and the rule of the heap is simply: every parent stays ≤ its children. Watch slot 0: whatever sifts its way there is always the minimum.`,
        array: arrState(heap),
        variables: scalars(e.locals),
      });
      prev = heap;
      prevEvent = e;
      continue;
    }
    if (JSON.stringify(prev) !== JSON.stringify(heap)) {
      const cause = prevEvent?.line ?? e.line;
      const changed = [];
      for (let i = 0; i < Math.max(prev.length, heap.length); i += 1) {
        if (JSON.stringify(prev[i]) !== JSON.stringify(heap[i])) changed.push(i);
      }
      if (heap.length > prev.length) {
        const settled = changed.length > 0 ? Math.min(...changed) : heap.length - 1;
        const v = heap[settled];
        const p = parentOf(settled);
        const underParent = settled > 0 ? ` Its parent, slot ${p} holding ${show(heap[p])}, is ≤ it — so the sift stops here and the heap property holds.` : ' It sifted all the way to slot 0 — a new minimum.';
        steps.push({
          line: cause,
          explanation: `Line ${cause} runs \`${src(cause)}\`. ${show(v)} enters at the end and SIFTS UP, settling at slot ${settled}${changed.length > 1 ? ` (${changed.length} slots shifted on its way)` : ''}.${underParent}`,
          array: arrState(heap, { current: settled, ...(changed.length > 1 ? { swapped: changed.slice(0, 2) } : {}), pointers: settled > 0 ? { parent: p } : {} }),
          variables: scalars(e.locals),
        });
      } else if (heap.length < prev.length) {
        const settledList = changed.filter((i) => i < heap.length);
        const settled = settledList.length > 0 ? Math.max(...settledList) : 0;
        steps.push({
          line: cause,
          explanation: `Line ${cause} runs \`${src(cause)}\`. The root ${show(prev[0])} is REMOVED — the root is always the minimum, that is the heap's whole promise. The last element ${show(prev[prev.length - 1])} takes slot 0 and sifts DOWN${heap.length > 0 ? `, settling at slot ${settled}; the new root is ${show(heap[0])}` : ''}.`,
          array: arrState(heap, { current: heap.length > 0 ? settled : 0 }),
          variables: scalars(e.locals),
        });
      } else {
        steps.push({
          line: cause,
          explanation: `Line ${cause} runs \`${src(cause)}\`. The heap is rewritten in place — ${changed.length} slot${changed.length === 1 ? '' : 's'} changed, and the parent-≤-children rule still holds at every level (verified from the recording).`,
          array: arrState(heap, { current: changed[0] ?? 0 }),
          variables: scalars(e.locals),
        });
      }
      prev = heap;
    }
    prevEvent = e;
  }
  if (steps.length < 2) throw new Error('the heap never changed on any recorded line — nothing to animate');

  steps.push({
    line: steps.at(-1).line,
    explanation: truncated
      ? `The recording stops HERE, on purpose: the push/sift rhythm keeps repeating, so watching more of it teaches nothing new. The run continued to completion and returned ${JSON.stringify(recording.result)} — recorded honestly, cut openly.`
      : `Execution finishes and the call returns ${JSON.stringify(recording.result)}. Read the final row as a tree one last time — slot 0 over slots 1 and 2, and so on down — and notice the promise held at every step: the parent never exceeded its children, so the minimum was always one glance away.`,
    array: arrState(prev ?? []),
    variables: steps.at(-1).variables,
  });

  return validateExecutionTrace(
    { language, code: String(code ?? ''), views: { array: { values: cells(snaps.at(-1).heap).length ? cells(snaps.at(-1).heap) : [''] } }, steps },
    'heap trace',
  );
}
