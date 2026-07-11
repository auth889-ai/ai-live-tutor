// GRAPH-ADJACENCY LENS — detector/compiler pair #8 of the record-once/detect-later engine:
// graph algorithms over an adjacency DICT (BFS/DFS visit order, Kahn's topological sort,
// Course Schedule, bipartite checks, Dijkstra-shaped walks). The proven graph-walk compiler
// animates all of it — take/relax/finalize/indegree-drop moments, the frontier panel, the
// dist table as trace rows — but needs the graph and a role lens DECLARED. This detector
// derives both from the recording:
//
//   graph     = the adjacency local with the most edges, in any of the three idioms the
//               family is written in:
//                 dict-of-lists   {u: [v, ...]}          — keys ∪ members = node ids
//                 weighted dict   {u: [(v, w), ...]}     — the pair position holding node ids
//                                                          is resolved by consistency across
//                                                          ALL members; weights ride the edges
//                 list-of-lists   adj[u] = [v, ...]      — accepted only when it CANNOT be a
//                                                          grid: ragged/short rows, append-only
//                                                          history (a walked grid mutates cells
//                                                          in place), members in [0, n)
//               Symmetric edge sets render undirected. Raw edge lists ([[u,v],...] walked
//               directly) are deliberately NOT claimed here — that shape belongs to the future
//               union-find lens; the floor covers it honestly until then.
//   current   = the scalar local that SUBSCRIPTS the adjacency in code (adj[u]) and only
//               ever holds node ids
//   visited   = a node-member collection that only GROWS
//   frontier  = a breathing list of node ids (or tuples carrying one) — pq if the code says
//               heappush, queue if popleft, else stack
//   dist      = a node-keyed dict of numbers that changes (relaxations)
//   indegree  = an int list with per-index DECREASES (Kahn's countdown)

import { compileGraphWalk } from '../../graph-walk/compiler.js';

const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Decide the lens from the recording. Returns null or:
//   { lens: 'graph-adjacency', confidence, adjName, graph, roles }
export function detectGraphAdjacency(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // THE ADJACENCY: the local holding the most edges in any of the three idioms.
  let adj = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    const snaps = lines.map((e) => e.locals[name]).filter((v) => v !== undefined && v !== null);
    const final = snaps.at(-1);
    if (!final) continue;
    const cand = isPlainObj(final) ? adjFromDict(final) : Array.isArray(final) ? adjFromLists(final, snaps) : null;
    if (!cand || cand.edges.length === 0) continue;
    if (!adj || cand.edges.length > adj.edges.length) adj = { name, ...cand };
  }
  if (!adj) return null;
  const isNodeVal = (v) => (typeof v === 'string' || typeof v === 'number') && adj.ids.has(String(v));

  const roles = {};

  // CURRENT: subscripts the adjacency in code, only ever holds node ids, takes >=2 of them.
  // Several may qualify (adj[b].append during BUILD also subscripts) — the WALKER visits the
  // most distinct nodes, so the widest candidate wins.
  let currentBest = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === adj.name) continue;
    if (!new RegExp(`\\b${adj.name}\\s*\\[[^\\]]*\\b${name}\\b`).test(code)) continue;
    const seen = lines.map((e) => e.locals[name]).filter((v) => v !== undefined && v !== null);
    const scalars = seen.filter((v) => typeof v === 'string' || typeof v === 'number');
    if (scalars.length === 0 || !scalars.every(isNodeVal)) continue;
    const distinct = new Set(scalars.map(String)).size;
    if (distinct < 2) continue;
    if (!currentBest || distinct > currentBest.distinct) currentBest = { name, distinct };
  }
  if (currentBest) roles.current = currentBest.name;

  // FRONTIER: breathes (grows AND shrinks) and every member carries a node id.
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === adj.name || name === roles.current) continue;
    let grew = false;
    let shrank = false;
    let membersOk = true;
    let prevLen = null;
    let sightings = 0;
    for (const e of lines) {
      const v = e.locals[name];
      if (!Array.isArray(v)) continue;
      sightings += 1;
      if (!v.every((m) => isNodeVal(m) || (Array.isArray(m) && m.some(isNodeVal)))) membersOk = false;
      if (prevLen !== null) {
        if (v.length > prevLen) grew = true;
        if (v.length < prevLen) shrank = true;
      }
      prevLen = v.length;
    }
    if (membersOk && grew && shrank && sightings >= 3) {
      const kind = /\bheappush\b|\bheapq\b/.test(code) ? 'pq' : /\bpopleft\b|\.pop\(0\)/.test(code) ? 'queue' : 'stack';
      roles[kind] = name;
      break;
    }
  }

  // VISITED: node members, never shrinks, actually accumulates.
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === adj.name || Object.values(roles).includes(name)) continue;
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 2 || snaps.at(-1).length < 2) continue;
    if (!snaps.every((s) => s.every(isNodeVal))) continue;
    if (!snaps.every((s, i) => i === 0 || s.length >= snaps[i - 1].length)) continue;
    if (snaps.at(-1).length <= snaps[0].length) continue;
    roles.visited = name;
    break;
  }

  // DIST: node-keyed numeric dict that relaxes. INDEGREE: an int list that counts DOWN.
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === adj.name || Object.values(roles).includes(name)) continue;
    const snaps = lines.map((e) => e.locals[name]);
    const dicts = snaps.filter(isPlainObj);
    if (!roles.dist && dicts.length >= 2 && Object.keys(dicts.at(-1)).length > 0
      && Object.entries(dicts.at(-1)).every(([k, v]) => adj.ids.has(String(k)) && typeof v === 'number')
      && JSON.stringify(dicts[0]) !== JSON.stringify(dicts.at(-1))) {
      roles.dist = name;
      continue;
    }
    const ilists = snaps.filter((v) => Array.isArray(v) && v.length >= 2 && v.every((x) => Number.isInteger(x)));
    if (!roles.indegree && ilists.length >= 2) {
      let drops = 0;
      for (let i = 1; i < ilists.length; i += 1) {
        for (let k = 0; k < ilists[i].length; k += 1) if (ilists[i][k] < (ilists[i - 1][k] ?? Infinity)) drops += 1;
      }
      if (drops >= 2) roles.indegree = name;
    }
  }

  if (!roles.current && !roles.pq && !roles.queue && !roles.stack) return null; // a graph nobody walks is data, not a lesson

  const edgeSet = new Set(adj.edges.map(([a, b]) => `${a}>${b}`));
  const directed = !adj.edges.every(([a, b]) => edgeSet.has(`${b}>${a}`));
  return {
    lens: 'graph-adjacency',
    confidence: 0.88,
    adjName: adj.name,
    graph: {
      nodes: [...adj.ids].map((id) => ({ id, label: id })),
      edges: adj.edges.map(([from, to, weight]) => ({ from, to, ...(weight !== undefined ? { weight } : {}) })),
      directed,
    },
    roles,
  };
}

// {u: [v, ...]} or {u: [(v, w), ...]} -> {ids, edges: [[from, to, weight?]]} | null.
// The pair position holding node ids is resolved by CONSISTENCY across all members — a lone
// coincidence (a weight that equals some node id) cannot flip the reading.
function adjFromDict(final) {
  const entries = Object.entries(final);
  if (entries.length < 2 || !entries.every(([, v]) => Array.isArray(v))) return null;
  const ids = new Set(entries.map(([k]) => String(k)));
  const members = entries.flatMap(([, v]) => v);
  const scalarId = (m) => (typeof m === 'string' || typeof m === 'number') && ids.has(String(m));
  const isPair = (m) => Array.isArray(m) && m.length === 2 && m.every((x) => typeof x === 'string' || typeof x === 'number');
  if (members.every(scalarId)) {
    return { ids, edges: entries.flatMap(([k, v]) => v.map((m) => [String(k), String(m)])) };
  }
  if (members.length > 0 && members.every(isPair)) {
    const nodePos = members.every((m) => ids.has(String(m[0]))) ? 0 : members.every((m) => ids.has(String(m[1]))) ? 1 : null;
    if (nodePos === null) return null;
    return { ids, edges: entries.flatMap(([k, v]) => v.map((m) => [String(k), String(m[nodePos]), m[1 - nodePos]])) };
  }
  return null;
}

// adj[u] = [v, ...] -> {ids, edges} | null — accepted only when it CANNOT be a walked grid:
// members are ints in [0, n), the shape is un-grid-like (ragged or thin rows), and the history
// is append-only (a walked grid REWRITES cells in place; adjacency only ever gains members).
function adjFromLists(final, snaps) {
  const n = final.length;
  if (n < 2 || !final.every((row) => Array.isArray(row))) return null;
  if (!final.every((row) => row.every((m) => Number.isInteger(m) && m >= 0 && m < n))) return null;
  const lens = final.map((row) => row.length);
  const gridShaped = new Set(lens).size === 1 && lens[0] >= 2;
  if (gridShaped) return null; // a rectangle of ints >=2 wide belongs to the grid family
  for (let i = 1; i < snaps.length; i += 1) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    if (!Array.isArray(prev) || !Array.isArray(cur)) continue;
    for (let r = 0; r < Math.min(prev.length, cur.length); r += 1) {
      if (!Array.isArray(prev[r]) || !Array.isArray(cur[r])) return null;
      if (cur[r].length < prev[r].length) return null;
      for (let k = 0; k < prev[r].length; k += 1) {
        if (JSON.stringify(prev[r][k]) !== JSON.stringify(cur[r][k])) return null; // in-place rewrite -> a grid
      }
    }
  }
  const ids = new Set(final.map((_, i) => String(i)));
  return { ids, edges: final.flatMap((row, u) => row.map((v) => [String(u), String(v)])) };
}

// Adapt the recording to the proven graph-walk compiler: its events ARE our line events.
export function compileGraphAdjacency({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'graph-adjacency') throw new Error('compileGraphAdjacency needs a plan from detectGraphAdjacency');
  const events = (recording?.events ?? []).filter((e) => e.ev === 'line').map((e) => ({ line: e.line, locals: e.locals }));
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  const trace = compileGraphWalk({
    events,
    result: recording.result,
    code,
    entry,
    language,
    graph: plan.graph,
    lens: plan.roles,
  });
  if (!plan.roles.visited) synthesizeVisitedFromTakes(trace);
  return trace;
}

// Kahn's and friends have no visited variable — the algorithm's own progress marker is the
// TAKE order. When no visited role exists, processed nodes accumulate as visited so the
// drawing shows progress (the elite gate demands the picture come alive, and it is right).
export function synthesizeVisitedFromTakes(trace) {
  const seen = [];
  let last = null;
  for (const s of trace.steps) {
    const cur = s.graph?.current;
    if (cur != null && cur !== last) {
      if (last != null && !seen.includes(last)) seen.push(last);
      last = cur;
    }
    if (s.graph && (s.graph.visited ?? []).length === 0) s.graph.visited = [...seen];
  }
  const final = trace.steps.at(-1)?.graph;
  if (final && last != null && !final.visited.includes(last)) final.visited = [...final.visited, last];
  return trace;
}
