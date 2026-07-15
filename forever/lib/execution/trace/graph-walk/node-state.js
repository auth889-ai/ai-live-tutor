// PER-NODE STATE CHANNEL (root-cause fix, mockup parity): the reference dry runs (Tarjan
// disc/low under every node, tree LH/RH, Dijkstra dist) are rich because ALGORITHM STATE KEYED
// BY NODE rides on the drawing itself. Our recorder always captured those locals (disc, low,
// rank, level — any node-keyed dict or node-indexed array), but the compile stage projected
// only the fixed role vocabulary (current/visited/frontier/dist/indegree) and DISCARDED the
// rest — so the renderer never received the data that makes the mockups elite. This module is
// the generic projector: it detects node-keyed locals from the recording alone (no per-problem
// code, works for any of the 4000) and tracks them into step.nodeState = {nodeId: {var: value}}.
//
// Honesty rules:
//   - a var qualifies only if it actually CHANGES per-node during the run (state, not config)
//   - a full-width uniform initialization ([-1]*n, [inf]*n) is a SENTINEL: a node's value is
//     shown only after the algorithm actually WRITES it (matching the mockups, which label
//     disc/low only on reached nodes) — sticky once written
//   - values are recorded scalars, never derived; null/None is never displayed

const isScalar = (v) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Normalize one recorded value into {nodeId: scalar|null} — a dict whose keys are all node
// ids, or an array covering exactly the int-id space 0..n-1. Anything else is null.
export function readNodeKeyed(value, ids) {
  if (isPlainObj(value)) {
    const entries = Object.entries(value);
    // An empty dict is "no knowledge YET" (color/level maps start as {}), not "not node-keyed"
    // — returning null here disqualified every grows-from-empty labeling (measured: bipartite's
    // color map never reached the drawing).
    if (entries.length === 0) return {};
    if (!entries.every(([k, v]) => ids.has(String(k)) && (isScalar(v) || v === null))) return null;
    return Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
  }
  if (Array.isArray(value)) {
    if (value.length !== ids.size || value.length === 0) return null;
    if (!value.every((v) => isScalar(v) || v === null)) return null;
    if (!value.every((_, i) => ids.has(String(i)))) return null;
    return Object.fromEntries(value.map((v, i) => [String(i), v]));
  }
  return null;
}

// Detect which locals are per-node algorithm state: node-keyed on every sighting, seen at
// least twice, final coverage >= 2 nodes, and >= 2 per-node value changes across the run.
// Ranked by change count (the most alive state teaches the most), capped at 3 so the drawing
// stays readable. `exclude` = the role vars already rendered through their own channels.
// Returns [{name, sentinel}] — sentinel is the JSON of the var's INITIALIZATION MARKER
// ([-1]*n, all-inf), decided from the whole run: a value >= 2 nodes START on and NO node
// ever transitions TO (algorithms leave their init value, they never write it back). Nodes
// still holding the sentinel are unreached and stay unlabeled, exactly like the mockups.
export function detectNodeStateVars(events, { ids, exclude = new Set() } = {}) {
  const lines = (events ?? []).filter((e) => e.ev === 'line' || e.locals);
  const names = new Set(lines.flatMap((e) => Object.keys(e.locals ?? {})));
  const ranked = [];
  for (const name of names) {
    if (exclude.has(name)) continue;
    const raws = lines.map((e) => e.locals?.[name]).filter((v) => v !== undefined && v !== null);
    if (raws.length < 2) continue;
    const parsed = raws.map((v) => readNodeKeyed(v, ids));
    if (parsed.some((p) => p === null)) continue; // node-keyed on EVERY sighting or not state
    const final = parsed.at(-1);
    if (Object.values(final).filter((v) => v !== null).length < 2) continue;
    let changes = 0;
    for (let i = 1; i < parsed.length; i += 1) {
      for (const [k, v] of Object.entries(parsed[i])) {
        if (JSON.stringify(parsed[i - 1][k]) !== JSON.stringify(v)) changes += 1;
      }
    }
    if (changes < 2) continue;
    ranked.push({ name, changes, sentinel: inferSentinel(parsed) });
  }
  ranked.sort((a, b) => b.changes - a.changes);
  return ranked.slice(0, 3).map(({ name, sentinel }) => ({ name, sentinel }));
}

// The init marker of one var's snapshot history: a value held by >= 2 nodes in the FIRST
// sighting that no node ever changes INTO later. undefined when no such value exists.
function inferSentinel(parsed) {
  const first = parsed[0];
  const counts = new Map();
  for (const v of Object.values(first)) {
    const key = JSON.stringify(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const candidates = [...counts.entries()].filter(([, n]) => n >= 2).map(([key]) => key);
  if (candidates.length === 0) return undefined;
  const enteredLater = new Set();
  for (let i = 1; i < parsed.length; i += 1) {
    for (const [k, v] of Object.entries(parsed[i])) {
      const key = JSON.stringify(v);
      if (JSON.stringify(parsed[i - 1][k]) !== key) enteredLater.add(key);
    }
  }
  const alive = candidates.filter((key) => !enteredLater.has(key));
  if (alive.length === 0) return undefined;
  alive.sort((a, b) => counts.get(b) - counts.get(a));
  return alive[0];
}

// Stateful tracker the compiler feeds every recorded event. `vars` = the detector's
// [{name, sentinel}]. update(locals) returns the per-node WRITES of that moment (for
// narration); snapshot() returns the cumulative {nodeId: {var: value}} written so far.
export function createNodeStateTracker(vars, ids) {
  const trackers = vars.map((v) => (typeof v === 'string' ? { name: v, sentinel: undefined } : v)).map(({ name, sentinel }) => ({
    name,
    sentinel,
    written: new Map(), // nodeId -> value (only after a real write)
  }));

  return {
    update(locals) {
      const writes = [];
      for (const t of trackers) {
        const parsed = readNodeKeyed(locals?.[t.name], ids);
        if (!parsed) continue;
        for (const [node, value] of Object.entries(parsed)) {
          if (value === null) continue;
          const already = t.written.has(node);
          if (!already && t.sentinel !== undefined && JSON.stringify(value) === t.sentinel) continue;
          const oldValue = t.written.get(node);
          if (already && JSON.stringify(oldValue) === JSON.stringify(value)) continue;
          t.written.set(node, value);
          writes.push({ varName: t.name, node, oldValue: already ? oldValue : undefined, newValue: value });
        }
      }
      return writes;
    },
    snapshot() {
      const out = {};
      for (const t of trackers) {
        for (const [node, value] of t.written) {
          if (!out[node]) out[node] = {};
          out[node][t.name] = value;
        }
      }
      return out;
    },
  };
}
