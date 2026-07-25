// EDGE-LIST GRAPH LENS — the RELAXING EDGE-WALK family (Bellman-Ford class): the single
// most common LC graph idiom the adjacency detector deliberately refuses (a raw [[u,v,w]]
// list walked directly, no adjacency dict ever built). Before this lens those runs fell to
// dp-table — verified-but-tabular; the network drawing IS the lesson (edges lighting as
// they relax, dist riding under the nodes), so the graph is SYNTHESIZED from the recorded
// edge list and the run is handed to the proven graph-walk compiler.
//
// Evidence set (the strictest in the registry — confidence 0.91 must be EARNED, a wrong
// graph claim is the exact misread class the provenance work exists to kill):
//   1. the code unpack-iterates an edge list:  for u, v[, w] in [sorted(]E[)]
//   2. E is a recorded local: a STABLE list (never mutated — accumulators grow) of >=3
//      rows, each len 2 or 3; positions 0/1 build one small consistent id set (2..64 ids),
//      position 2 (when present) is numeric weight
//   3. the unpacked u/v locals only ever hold ids from that set
//   4. a dist structure (list indexed by int ids, or id-keyed dict) whose tracked entries
//      ONLY ever decrease (relaxation) — never increase. This one rule structurally
//      excludes degree counters (Town Judge does score[b] += 1) and result accumulators.

import { compileGraphWalk } from '../../graph-walk/compiler.js';
import { buildFrameTimeline } from '../frames.js';

const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'number' || typeof v === 'string';

export function detectEdgeListGraph(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length < 3) return null;

  // 1. The unpack loop in code names the players.
  const loop = code.match(/for\s+(\w+)\s*,\s*(\w+)(?:\s*,\s*(\w+))?\s+in\s+(?:sorted\(\s*)?(\w+)/);
  if (!loop) return null;
  const [, aName, bName, cName, edgesName] = loop;

  // 2. E: stable, well-shaped, id-consistent.
  const snaps = lines.map((e) => e.locals[edgesName]).filter((v) => v !== undefined);
  const first = snaps.find(Array.isArray);
  if (!first || first.length < 3) return null;
  const firstJson = JSON.stringify(first);
  if (!snaps.every((v) => !Array.isArray(v) || JSON.stringify(v) === firstJson
    || JSON.stringify([...v].sort()) === JSON.stringify([...first].sort()))) return null; // sorted(E) view ok, mutation not
  const rowLen = first[0]?.length;
  if (rowLen !== 2 && rowLen !== 3) return null;
  if (!first.every((row) => Array.isArray(row) && row.length === rowLen)) return null;
  // sorted(E) iteration reorders columns only in OUR reading if weight leads (Kruskal sorts
  // by weight-first tuples); resolve endpoint columns by consistency, like adjFromDict does.
  const cols = [0, 1, 2].slice(0, rowLen);
  const idPair = pickEndpointColumns(first, cols);
  if (!idPair) return null;
  const [uCol, vCol] = idPair.pair;
  const ids = idPair.ids;
  if (ids.size < 2 || ids.size > 64) return null;
  const weightCol = cols.find((c) => c !== uCol && c !== vCol);
  if (weightCol !== undefined && !first.every((row) => typeof row[weightCol] === 'number')) return null;

  // 3. The unpacked endpoint locals stay inside the id set. (Which unpack name maps to which
  // column follows the loop's own order: sorted-by-weight tuples put w first.)
  const unpackNames = [aName, bName, cName].filter(Boolean);
  const uName = unpackNames[uCol] ?? aName;
  const vName = unpackNames[vCol] ?? bName;
  for (const name of [uName, vName]) {
    const vals = lines.map((e) => e.locals[name]).filter((v) => v !== undefined && v !== null);
    if (vals.length === 0) return null;
    if (!vals.every((v) => isId(v) && ids.has(String(v)))) return null;
  }

  // 4. dist: decrease-only numeric structure over the ids, subscripted in code.
  let dist = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === edgesName) continue;
    if (!new RegExp(`\\b${name}\\s*\\[`).test(code)) continue;
    const seen = lines.map((e) => e.locals[name]).filter((v) => v !== undefined);
    if (seen.length < 2) continue;
    let shape = null; // 'list' | 'dict'
    if (seen.every(Array.isArray) && seen.at(-1).length >= ids.size) shape = 'list';
    else if (seen.every(isPlainObj) && Object.keys(seen.at(-1)).every((k) => ids.has(String(k)))) shape = 'dict';
    if (!shape) continue;
    const entryAt = (snap, key) => (shape === 'list' ? snap[Number(key)] : snap[key]);
    // The recorder serializes float('inf') as the string "inf" — an inf -> number write IS
    // a relaxation (the canonical first one), measured live on Bellman-Ford where skipping
    // it left a single countable decrease and the whole lens silently declined.
    const isInf = (v) => v === 'inf' || v === 'Infinity' || v === null;
    let decreases = 0;
    let increases = 0;
    for (let i = 1; i < seen.length; i += 1) {
      for (const id of ids) {
        const prev = entryAt(seen[i - 1], id);
        const cur = entryAt(seen[i], id);
        if (typeof cur !== 'number') continue;
        if (isInf(prev)) { decreases += 1; continue; }
        if (typeof prev !== 'number') continue;
        if (cur < prev) decreases += 1;
        if (cur > prev) increases += 1;
      }
    }
    if (decreases >= 2 && increases === 0) { dist = { name, shape }; break; }
  }
  if (!dist) return null; // no relaxation story -> not this family (Kruskal stays with union-find)

  const edges = first.map((row) => [String(row[uCol]), String(row[vCol]), ...(weightCol !== undefined ? [row[weightCol]] : [])]);
  const edgeSet = new Set(edges.map(([a, b]) => `${a}>${b}`));
  const directed = !edges.every(([a, b]) => edgeSet.has(`${b}>${a}`));
  return {
    lens: 'edge-list-graph',
    confidence: 0.91,
    edgesName,
    dist,
    ids,
    roles: { current: uName, dist: dist.name },
    graph: {
      nodes: [...ids].map((id) => ({ id, label: id })),
      edges: edges.map(([from, to, weight]) => ({ from, to, ...(weight !== undefined ? { weight } : {}) })),
      directed,
    },
  };
}

// Endpoint columns = the pair of columns whose values jointly form ONE small id set that
// every row stays inside (weights fail this: they roam). Prefer (0,1); try weight-first
// tuples (1,2) for sorted-by-weight Kruskal-style rows.
function pickEndpointColumns(rows, cols) {
  const candidates = cols.length === 2 ? [[0, 1]] : [[0, 1], [1, 2], [0, 2]];
  for (const pair of candidates) {
    const vals = rows.flatMap((row) => [row[pair[0]], row[pair[1]]]);
    if (!vals.every(isId)) continue;
    const ids = new Set(vals.map(String));
    if (ids.size >= 2 && ids.size <= Math.max(4, vals.length)) return { pair, ids };
  }
  return null;
}

// Adapt to the proven graph-walk compiler (same shape as compileGraphAdjacency); a list-
// shaped dist is presented as an id-keyed dict so the compiler's relax/table machinery
// sees the exact structure it was built for.
export function compileEdgeListGraph({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'edge-list-graph') throw new Error('compileEdgeListGraph needs a plan from detectEdgeListGraph');
  const all = recording?.events ?? [];
  const timeline = buildFrameTimeline(all);
  const recursive = timeline.frames.length > 1;
  const asDict = (locals) => {
    if (plan.dist.shape !== 'list' || !Array.isArray(locals[plan.dist.name])) return locals;
    const table = {};
    for (const id of plan.ids) table[id] = locals[plan.dist.name][Number(id)];
    return { ...locals, [plan.dist.name]: table };
  };
  const events = all
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.ev === 'line')
    .map(({ e, i }) => ({
      line: e.line,
      locals: asDict(e.locals),
      ...(recursive ? { frames: timeline.stackAt(i), lastReturn: timeline.finishedBefore(i) } : {}),
    }));
  if (all.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileGraphWalk({
    events,
    result: recording.result,
    code,
    entry,
    language,
    graph: plan.graph,
    lens: plan.roles,
  });
}
