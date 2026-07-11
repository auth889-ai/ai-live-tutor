// Data-structure OPERATIONS engine — teaching a stack/queue/hash map ITSELF (push/pop,
// enqueue/dequeue, put/get with collisions) as one animated frame per operation: the standard
// set by VisuAlgo /list and USFCA's visualizations, verified 2026-07-08. Deterministic tool:
// the model declares only the structure and the operation list; THIS code executes every
// operation on a real model of the structure and narrates from the actual state — sizes,
// hashes, collisions, and mistakes (pop on empty) are computed, never imagined.
//
// STRUCTURAL VIEW, not chips-only (the depth audit's gap): stack/queue render as a row of
// capacity slots the student watches fill and drain — live per-step values, a top / front+back
// pointer riding the cells, and the touched cell highlighted at the moment of the op. The
// hash map walks its collision chain one visible hop at a time, because that walk IS the
// lesson about collision cost.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import {
  narrateAdd, narrateUnderflow, narrateRemove, narratePeek,
  narrateChainHop, narratePutUpdate, narratePutInsert, narrateGet, narrateMapRemove,
} from './narrate.js';

export const OPERATION_STRUCTURES = Object.freeze(['stack', 'queue', 'hash_map']);

// Deterministic string hash (djb2-style, shown to the student digit by digit).
function hashOf(key, buckets) {
  let h = 5381;
  for (const ch of String(key)) h = ((h * 33) + ch.charCodeAt(0)) >>> 0;
  return h % buckets;
}

// compileOperationsTrace({ structure, ops, code, lines, buckets, language })
// ops: [{op, value?, key?}] — stack: push/pop/peek; queue: enqueue/dequeue/front;
// hash_map: put {key, value} / get {key} / remove {key}. lines: {<op>: codeLine}.
export function compileOperationsTrace({ structure, ops, code, lines = {}, buckets = 5, language = 'python' } = {}) {
  if (!OPERATION_STRUCTURES.includes(structure)) throw new Error(`operations structure must be one of ${OPERATION_STRUCTURES.join(', ')}`);
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('operations trace needs a non-empty ops list');
  if (ops.length > 40) throw new Error('operations trace is capped at 40 ops (a lesson, not a log)');
  const lineCount = String(code ?? '').split('\n').length;
  const lineOf = (op) => {
    const l = Number(lines[op]);
    return Number.isInteger(l) && l >= 1 && l <= lineCount ? l : 1;
  };

  const steps = [];
  let views;
  if (structure === 'stack' || structure === 'queue') {
    const isStack = structure === 'stack';
    // Capacity = the high-water mark of a dry simulation, so the slot row never resizes —
    // cells fill and drain inside a fixed frame (the student sees SPACE as well as content).
    let size = 0;
    let cap = 1;
    for (const { op } of ops) {
      if (op === 'push' || op === 'enqueue') cap = Math.max(cap, (size += 1));
      else if ((op === 'pop' || op === 'dequeue') && size > 0) size -= 1;
    }

    const items = [];
    const slotState = (touched) => ({
      values: [...items, ...Array(cap - items.length).fill('')],
      pointers: items.length === 0 ? {} : isStack ? { top: items.length - 1 } : { front: 0, back: items.length - 1 },
      ...(touched != null ? { current: touched } : {}),
    });
    for (const { op, value } of ops) {
      let explanation;
      let touched = null;
      if (op === 'push' || op === 'enqueue') {
        items.push(value);
        touched = items.length - 1;
        explanation = narrateAdd({ isStack, structure, value, size: items.length, neighbor: items[items.length - 2] });
      } else if (op === 'pop' || op === 'dequeue') {
        if (items.length === 0) {
          explanation = narrateUnderflow({ isStack });
        } else {
          const out = isStack ? items.pop() : items.shift();
          touched = isStack ? items.length : 0; // the slot the action just emptied / shifted into
          explanation = narrateRemove({ isStack, out, size: items.length });
        }
      } else if (op === 'peek' || op === 'front') {
        touched = items.length === 0 ? null : isStack ? items.length - 1 : 0;
        explanation = narratePeek({
          op, structure, empty: items.length === 0, value: isStack ? items[items.length - 1] : items[0], size: items.length,
        });
      } else if (op === 'init' || op === 'create' || op === 'new') {
        // Constructor beat (LRU cache, custom classes): a real teaching moment, not an error.
        explanation = `The ${isStack ? 'stack' : 'queue'} is created${value !== undefined ? ` with capacity ${JSON.stringify(value)}` : ''} — empty for now; every slot you see will be earned by an operation, not assumed.`;
      } else {
        throw new Error(`unknown ${structure} operation "${op}"`);
      }
      steps.push({
        line: lineOf(op),
        explanation,
        array: slotState(touched),
        [isStack ? 'stack' : 'queue']: [...items],
        variables: { size: items.length },
      });
    }
    views = { array: { values: Array(cap).fill('') } };
  } else {
    // hash_map: buckets rendered as a grid (row = bucket, columns = chained slots).
    const table = Array.from({ length: buckets }, () => []);
    const COLS = 4;
    const col = (k) => Math.min(k, COLS - 1);
    const gridState = (current, highlight = []) => ({
      ...(current ? { current } : {}),
      values: table.flatMap((chain, b) => chain.slice(0, COLS).map((e, c) => [b, c, `${e.key}:${e.value}`])),
      ...(highlight.length ? { highlight } : {}),
    });
    const mapSize = () => table.reduce((a, c) => a + c.length, 0);
    // The collision walk, one visible hop per chained entry — this walk IS the collision cost.
    const walkChain = (op, key, b, upto, companion) => {
      const chain = table[b];
      for (let k = 0; k < upto; k += 1) {
        steps.push({
          line: lineOf(op),
          explanation: narrateChainHop({ op, key, bucket: b, slot: k, slotKey: chain[k].key }),
          array2d: gridState([b, col(k)], chain.slice(0, k + 1).map((_, i) => [b, col(i)])),
          ...(companion ? { queue: companion.map(String) } : {}),
          variables: { bucket: b, chainSlot: k, size: mapSize() },
        });
      }
    };
    for (const { op, key, value, companion } of ops) {
      const b = hashOf(key, buckets);
      const chain = table[b];
      const at = chain.findIndex((e) => e.key === key);
      let explanation;
      let current = null;
      if (op === 'put') {
        walkChain(op, key, b, at >= 0 ? at : chain.length, companion);
        if (at >= 0) {
          chain[at] = { key, value };
          current = [b, col(at)];
          explanation = narratePutUpdate({ key, value, bucket: b });
        } else {
          chain.push({ key, value });
          current = [b, col(chain.length - 1)];
          explanation = narratePutInsert({ key, value, bucket: b, chainLength: chain.length });
        }
      } else if (op === 'get') {
        walkChain(op, key, b, at >= 0 ? at : chain.length, companion);
        current = at >= 0 ? [b, col(at)] : null;
        explanation = narrateGet({ key, bucket: b, at, value: at >= 0 ? chain[at].value : undefined, chainLength: chain.length });
      } else if (op === 'remove') {
        walkChain(op, key, b, Math.max(at, 0), companion);
        if (at >= 0) chain.splice(at, 1);
        explanation = narrateMapRemove({ key, bucket: b, found: at >= 0 });
      } else if (op === 'init' || op === 'create' || op === 'new') {
        // Constructor beat (LRU cache): the empty table is the honest starting frame.
        explanation = `The map is created${value !== undefined ? ` with capacity ${JSON.stringify(value)}` : ''} — ${buckets} empty buckets; watch each key hash into its home as the operations arrive.`;
      } else {
        throw new Error(`unknown hash_map operation "${op}"`);
      }
      steps.push({
        line: lineOf(op),
        explanation,
        array2d: gridState(current),
        // The companion snapshot (LRU's recency order, least-recent first) rides as the queue
        // panel — the two structures the lesson is ABOUT, moving in sync on every op.
        ...(companion ? { queue: companion.map(String) } : {}),
        variables: { bucket: b, size: mapSize() },
      });
    }
    views = { array2d: { rows: buckets, cols: COLS, rowLabels: Array.from({ length: buckets }, (_, i) => `b${i}`) } };
  }

  return validateExecutionTrace({ language, code: String(code ?? ''), views, steps }, 'operations trace');
}
