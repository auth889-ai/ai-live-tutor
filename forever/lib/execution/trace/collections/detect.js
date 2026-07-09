// OPERATION-PATTERN COLLECTION DETECTOR — our genuine edge over shape-only tools (Python Tutor /
// debug-visualizer / jGRASP classify by static SHAPE; we run a real trace, so we can watch the
// OPERATIONS a collection undergoes and auto-upgrade an in-code list/deque/dict to the elite
// stack/queue/hash-map view WITHOUT the model declaring it). Pure & unit-tested: it diffs a
// list/dict variable's recorded snapshots across the line-sim events and infers the ops.
//
//   list grows by 1 at the TAIL  -> push / enqueue
//   list shrinks by 1 at the TAIL -> pop            => the variable is a STACK (LIFO)
//   list shrinks by 1 at the FRONT -> dequeue        => the variable is a QUEUE (FIFO)
//   dict gains a key               -> put            => the variable is a HASH MAP
//
// A variable is only upgraded when its ops are CLEAN and CONSISTENT (all removals from one end)
// and there are enough of them — otherwise we leave it on the floor (never a wrong bespoke view).

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// detectCollectionOps(events) -> { varName, structure, ops, lines } | null
// events: [{ line, locals }] from the line-sim run. Picks the single best collection variable.
export function detectCollectionOps(events) {
  if (!Array.isArray(events) || events.length < 2) return null;
  const lineEvents = events.filter((e) => e && typeof e === 'object' && e.locals && typeof e.locals === 'object' && !e.truncated);
  if (lineEvents.length < 2) return null;

  // Every variable that is EVER a list or a plain dict is a candidate.
  const candidates = new Set();
  for (const ev of lineEvents) {
    for (const [k, v] of Object.entries(ev.locals)) {
      if (Array.isArray(v) || (v && typeof v === 'object' && !Array.isArray(v))) candidates.add(k);
    }
  }

  let best = null;
  for (const varName of candidates) {
    const found = analyzeVariable(varName, lineEvents);
    if (found && (!best || found.ops.length > best.ops.length)) best = found;
  }
  return best;
}

function analyzeVariable(varName, lineEvents) {
  // Reduce to the states where the variable exists, keeping the line each state was seen on.
  const states = [];
  for (const ev of lineEvents) {
    const v = ev.locals[varName];
    if (v === undefined) continue;
    states.push({ value: v, line: ev.line });
  }
  if (states.length < 2) return null;

  const firstArray = states.find((s) => Array.isArray(s.value));
  const isList = !!firstArray;
  const isDict = !isList && states.some((s) => s.value && typeof s.value === 'object' && !Array.isArray(s.value));
  if (isList) return analyzeList(varName, states);
  if (isDict) return analyzeDict(varName, states);
  return null;
}

function analyzeList(varName, states) {
  const ops = [];
  const opLines = {};
  let tailRemovals = 0;
  let frontRemovals = 0;
  let dirty = false; // a change that is NOT a single clean end-operation -> not a pure stack/queue

  for (let i = 1; i < states.length; i += 1) {
    const prev = states[i - 1].value;
    const cur = states[i].value;
    if (!Array.isArray(prev) || !Array.isArray(cur)) continue;
    if (eq(prev, cur)) continue;

    if (cur.length === prev.length + 1 && eq(cur.slice(0, -1), prev)) {
      ops.push({ op: 'add', value: cur[cur.length - 1] });
      opLines.add = states[i].line;
    } else if (cur.length === prev.length - 1 && eq(cur, prev.slice(0, -1))) {
      ops.push({ op: 'popTail', value: prev[prev.length - 1] });
      opLines.popTail = states[i].line;
      tailRemovals += 1;
    } else if (cur.length === prev.length - 1 && eq(cur, prev.slice(1))) {
      ops.push({ op: 'popFront', value: prev[0] });
      opLines.popFront = states[i].line;
      frontRemovals += 1;
    } else {
      dirty = true; // in-place index writes, sorts, multi-element changes -> not a clean collection
    }
  }

  // Require a clean, consistent LIFO or FIFO discipline with enough operations to be worth it.
  const removals = tailRemovals + frontRemovals;
  if (dirty || ops.length < 3 || removals === 0) return null;
  if (tailRemovals > 0 && frontRemovals > 0) return null; // mixed ends -> ambiguous, stay on the floor

  const structure = frontRemovals > 0 ? 'queue' : 'stack';
  const isStack = structure === 'stack';
  const mapped = ops.map((o) => (o.op === 'add' ? { op: isStack ? 'push' : 'enqueue', value: o.value } : { op: isStack ? 'pop' : 'dequeue' }));
  const lines = isStack
    ? { push: opLines.add ?? 1, pop: opLines.popTail ?? 1 }
    : { enqueue: opLines.add ?? 1, dequeue: opLines.popFront ?? 1 };
  return { varName, structure, ops: mapped, lines };
}

function analyzeDict(varName, states) {
  const ops = [];
  const opLines = {};
  const keyType = new Set();
  for (let i = 1; i < states.length; i += 1) {
    const prev = states[i - 1].value;
    const cur = states[i].value;
    if (!isPlainObject(prev) || !isPlainObject(cur)) continue;
    for (const k of Object.keys(cur)) {
      if (!(k in prev)) {
        ops.push({ op: 'put', key: k, value: cur[k] });
        opLines.put = states[i].line;
        keyType.add(typeof k);
      } else if (JSON.stringify(prev[k]) !== JSON.stringify(cur[k])) {
        ops.push({ op: 'put', key: k, value: cur[k] });
        opLines.put = states[i].line;
      }
    }
  }
  // Only upgrade a dict to the hash-map view when the keys are STRINGS (the collision/chain
  // lesson is about hashing string keys) and there are enough puts to be a lesson.
  if (ops.length < 3 || ![...keyType].every((t) => t === 'string')) return null;
  return { varName, structure: 'hash_map', ops, lines: { put: opLines.put ?? 1, get: opLines.put ?? 1, remove: opLines.put ?? 1 } };
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}
