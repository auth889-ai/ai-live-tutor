// ADJACENCY-MATRIX LENS — detector/compiler pair #10 of the record-once/detect-later engine:
// the graph handed over as a square matrix (LC547 Number of Provinces' isConnected, distance
// matrices read-only, tournament graphs). A 2D array in LeetCode can be FOUR different things,
// and the fingerprints separate them cleanly:
//   walked grid  -> MUTATES in place            (grid-walk claims it)
//   DP table     -> starts scaffold and FILLS    (dp-table claims it)
//   matrix graph -> SQUARE, STATIC, double-subscripted (m[i][j]), and WALKED by graph roles
//   plain data   -> static but nobody walks it   (no lens; the floor narrates it honestly)
// The matrix is converted to the node-edge picture the student should see: nodes 0..n-1, an
// edge wherever m[i][j] is truthy (self-loops dropped, symmetric matrices render undirected,
// non-0/1 values ride as weights) — then the proven graph-walk compiler owns the animation.

import { compileGraphWalk } from '../../graph-walk/compiler.js';

const isSquareStatic = (snaps) => {
  const final = snaps.at(-1);
  if (!Array.isArray(final)) return null;
  const n = final.length;
  if (n < 2 || !final.every((row) => Array.isArray(row) && row.length === n && row.every((v) => typeof v === 'number'))) return null;
  if (!snaps.every((s) => JSON.stringify(s) === JSON.stringify(final))) return null; // written even once -> a grid or a table
  return final;
};

// Decide the lens from the recording. Returns null or:
//   { lens: 'adjacency-matrix', confidence, matrixVar, graph, roles }
export function detectAdjacencyMatrix(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  let matrix = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    const snaps = lines.map((e) => e.locals[name]).filter((v) => v !== undefined && v !== null);
    if (snaps.length < 2) continue;
    const m = isSquareStatic(snaps.filter(Array.isArray));
    if (!m) continue;
    if (!new RegExp(`\\b${name}\\s*\\[[^\\]]*\\]\\s*\\[`).test(code)) continue; // must be read as m[i][j]
    const edges = [];
    m.forEach((row, i) => row.forEach((v, j) => { if (v && i !== j) edges.push([i, j, v]); }));
    if (edges.length === 0) continue;
    if (!matrix || edges.length > matrix.edges.length) matrix = { name, n: m.length, edges };
  }
  if (!matrix) return null;
  const ids = new Set(Array.from({ length: matrix.n }, (_, i) => String(i)));
  const isNodeVal = (v) => (typeof v === 'number' || typeof v === 'string') && ids.has(String(v));

  // A matrix nobody WALKS is data, not a lesson — demand at least one live graph role.
  const roles = {};
  let best = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === matrix.name) continue;
    if (!new RegExp(`\\b${matrix.name}\\s*\\[[^\\]]*\\b${name}\\b`).test(code)) continue; // first subscript = the walker
    const seen = lines.map((e) => e.locals[name]).filter((v) => v !== undefined && v !== null);
    const scalars = seen.filter((v) => typeof v === 'number' || typeof v === 'string');
    if (scalars.length === 0 || !scalars.every(isNodeVal)) continue;
    const distinct = new Set(scalars.map(String)).size;
    if (distinct >= 2 && (!best || distinct > best.distinct)) best = { name, distinct };
  }
  if (best) roles.current = best.name;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === matrix.name || Object.values(roles).includes(name)) continue;
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 2 || snaps.at(-1).length < 2) continue;
    if (!snaps.every((s) => s.every(isNodeVal))) continue;
    if (!snaps.every((s, i) => i === 0 || s.length >= snaps[i - 1].length)) continue;
    if (snaps.at(-1).length <= snaps[0].length) continue;
    roles.visited = name;
    break;
  }
  // The walker requirement is MEMORY, not a subscript: `for r in range(n): total += m[r][c]`
  // has a perfectly node-shaped counter, but nothing accumulates — a walk that remembers
  // nothing is a scan over data. visited (or a frontier, later) is the proof of a walk.
  if (!roles.visited) return null;

  const weighted = matrix.edges.some(([, , v]) => v !== 1);
  const edgeSet = new Set(matrix.edges.map(([a, b]) => `${a}>${b}`));
  const directed = !matrix.edges.every(([a, b]) => edgeSet.has(`${b}>${a}`));
  return {
    lens: 'adjacency-matrix',
    confidence: 0.87,
    matrixVar: matrix.name,
    graph: {
      nodes: [...ids].map((id) => ({ id, label: id })),
      edges: matrix.edges.map(([from, to, v]) => ({ from: String(from), to: String(to), ...(weighted ? { weight: v } : {}) })),
      directed,
    },
    roles,
  };
}

// Adapt the recording to the proven graph-walk compiler.
export function compileAdjacencyMatrix({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'adjacency-matrix') throw new Error('compileAdjacencyMatrix needs a plan from detectAdjacencyMatrix');
  const events = (recording?.events ?? []).filter((e) => e.ev === 'line').map((e) => ({ line: e.line, locals: e.locals }));
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
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
