// Data-structure OPERATIONS engine — teaching a stack/queue/hash map ITSELF (push/pop,
// enqueue/dequeue, put/get with collisions) as one animated frame per operation: the standard
// set by VisuAlgo /list and USFCA's visualizations, verified 2026-07-08. Deterministic tool:
// the model declares only the structure and the operation list; THIS code executes every
// operation on a real model of the structure and narrates from the actual state — sizes,
// hashes, collisions, and mistakes (pop on empty) are computed, never imagined.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

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
  if (structure === 'stack' || structure === 'queue') {
    const isStack = structure === 'stack';
    const items = [];
    for (const { op, value } of ops) {
      let explanation;
      if (op === 'push' || op === 'enqueue') {
        items.push(value);
        explanation = isStack
          ? `push(${JSON.stringify(value)}): the new item lands on TOP of the stack — it sits above everything that came before, and it will be the FIRST to leave. That is the whole contract: Last In, First Out. Size is now ${items.length}.`
          : `enqueue(${JSON.stringify(value)}): the new item joins the BACK of the queue and must wait its turn behind ${items.length - 1} other${items.length === 2 ? '' : 's'} — First In, First Out, like any fair line. Size is now ${items.length}.`;
      } else if (op === 'pop' || op === 'dequeue') {
        if (items.length === 0) {
          explanation = isStack
            ? `pop() on an EMPTY stack — this is the classic crash (stack underflow). Real code must guard with "if not stack:" before popping; watch how the state simply has nothing to give.`
            : `dequeue() on an EMPTY queue — the classic underflow bug. Production code checks emptiness first; there is nothing at the front to hand back.`;
        } else {
          const out = isStack ? items.pop() : items.shift();
          explanation = isStack
            ? `pop(): ${JSON.stringify(out)} comes off the TOP — it was the most recent arrival, and it leaves first. Notice nothing below it moved; a stack only ever touches its top. Size is now ${items.length}.`
            : `dequeue(): ${JSON.stringify(out)} leaves from the FRONT — it waited longest, so it is served first. Everyone behind shifts one place closer. Size is now ${items.length}.`;
        }
      } else if (op === 'peek' || op === 'front') {
        explanation = items.length === 0
          ? `${op}() on an empty ${structure}: there is nothing to look at — another case your code must guard.`
          : `${op}(): we look at ${JSON.stringify(isStack ? items[items.length - 1] : items[0])} WITHOUT removing it — reading costs nothing and changes nothing; the size stays ${items.length}.`;
      } else {
        throw new Error(`unknown ${structure} operation "${op}"`);
      }
      steps.push({ line: lineOf(op), explanation, [isStack ? 'stack' : 'queue']: [...items], variables: { size: items.length } });
    }
  } else {
    // hash_map: buckets rendered as a grid (row = bucket, columns = chained slots).
    const table = Array.from({ length: buckets }, () => []);
    const COLS = 4;
    const gridState = (current, highlight = []) => ({
      ...(current ? { current } : {}),
      values: table.flatMap((chain, b) => chain.slice(0, COLS).map((e, c) => [b, c, `${e.key}:${e.value}`])),
      ...(highlight.length ? { highlight } : {}),
    });
    for (const { op, key, value } of ops) {
      const b = hashOf(key, buckets);
      const chain = table[b];
      const at = chain.findIndex((e) => e.key === key);
      let explanation;
      let current = null;
      if (op === 'put') {
        if (at >= 0) {
          chain[at] = { key, value };
          current = [b, at];
          explanation = `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): hash(${JSON.stringify(key)}) = ${b}, and ${JSON.stringify(key)} is ALREADY in bucket ${b} — so this is an update, not an insert. The old value is overwritten in place; a map holds one value per key.`;
        } else {
          chain.push({ key, value });
          current = [b, Math.min(chain.length - 1, COLS - 1)];
          explanation = chain.length > 1
            ? `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): hash(${JSON.stringify(key)}) = ${b}, but bucket ${b} already holds ${chain.length - 1} entr${chain.length === 2 ? 'y' : 'ies'} — a COLLISION. We chain the new entry behind the others; lookups in this bucket now walk the chain, which is exactly why too many collisions degrade a hash map toward a list.`
            : `put(${JSON.stringify(key)}, ${JSON.stringify(value)}): the hash function turns the key into a bucket number — hash(${JSON.stringify(key)}) = ${b} — and the entry drops straight into empty bucket ${b}. No searching: that single jump is the O(1) magic.`;
        }
      } else if (op === 'get') {
        current = at >= 0 ? [b, Math.min(at, COLS - 1)] : null;
        explanation = at >= 0
          ? `get(${JSON.stringify(key)}): hash straight to bucket ${b}, ${at > 0 ? `walk ${at + 1} chained entr${at === 0 ? 'y' : 'ies'} (the collision cost), ` : ''}and find ${JSON.stringify(key)} = ${JSON.stringify(chain[at].value)}. One hash, ${at + 1} look${at === 0 ? '' : 's'} — no scanning the whole table.`
          : `get(${JSON.stringify(key)}): hash says bucket ${b}, but the ${chain.length === 0 ? 'bucket is empty' : 'chain there does not contain it'} — the key does not exist. A hash map answers "not here" just as fast as "found".`;
      } else if (op === 'remove') {
        if (at >= 0) {
          chain.splice(at, 1);
          explanation = `remove(${JSON.stringify(key)}): hash to bucket ${b}, unlink the entry, and the chain closes up behind it. Size bookkeeping is the map's job — no other bucket was touched.`;
        } else {
          explanation = `remove(${JSON.stringify(key)}): bucket ${b} does not contain the key — removing a missing key is a no-op (or an error, depending on the API; know which one YOUR language does).`;
        }
      } else {
        throw new Error(`unknown hash_map operation "${op}"`);
      }
      steps.push({
        line: lineOf(op),
        explanation,
        array2d: gridState(current),
        variables: { bucket: b, size: table.reduce((a, c) => a + c.length, 0) },
      });
    }
  }

  const views = structure === 'hash_map'
    ? { array2d: { rows: buckets, cols: 4, rowLabels: Array.from({ length: buckets }, (_, i) => `b${i}`) } }
    : {};
  return validateExecutionTrace({ language, code: String(code ?? ''), views, steps }, 'operations trace');
}
