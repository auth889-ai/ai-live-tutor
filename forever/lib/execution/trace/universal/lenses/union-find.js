// UNION-FIND LENS — detector/compiler pair #9 of the record-once/detect-later engine:
// connected components, redundant connection, accounts merge — the parent-forest family, and
// the home of the RAW EDGE LIST that graph-adjacency deliberately refuses (a bare list of
// pairs is only provably a graph when a forest is consuming it).
//
// The birthmark is behavioral and unmistakable: a structure BORN as the identity map
// (parent[i] == i for every i — list(range(n)) or {x: x}) whose entries are then rewritten to
// OTHER nodes as unions happen. Nothing else in LeetCode starts as the identity map and
// mutates in place. The proven graph-walk compiler already owns the animation (its `parent`
// role narrates unions; path compression is just more recorded parent moves); the static
// edge-list local, validated against the forest's node universe, becomes the drawn edges.

import { compileGraphWalk } from '../../graph-walk/compiler.js';

const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Normalize a forest sighting (int list or dict) to [key, value] pairs, or null.
function forestEntries(v) {
  if (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number' || typeof x === 'string')) {
    return v.map((x, i) => [String(i), String(x)]);
  }
  if (isPlainObj(v) && Object.keys(v).length >= 2 && Object.values(v).every((x) => typeof x === 'number' || typeof x === 'string')) {
    return Object.entries(v).map(([k, x]) => [String(k), String(x)]);
  }
  return null;
}

// Decide the lens from the recording. Returns null or:
//   { lens: 'union-find', confidence, forestVar, graph, roles }
export function detectUnionFind(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // THE FOREST: first sighting is the identity map; a later sighting differs (unions really
  // happened); every value stays inside the node universe (a parent points AT a node).
  let forest = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    const snaps = lines.map((e) => forestEntries(e.locals[name])).filter(Boolean);
    if (snaps.length < 2) continue;
    const first = snaps[0];
    if (!first.every(([k, v]) => k === v)) continue;
    const ids = new Set(first.map(([k]) => k));
    if (!snaps.every((s) => s.every(([k, v]) => ids.has(k) && ids.has(v)))) continue;
    const mutated = snaps.some((s) => s.some(([k, v]) => k !== v));
    if (!mutated) continue;
    forest = { name, ids };
    break;
  }
  if (!forest) return null;

  // THE EDGES: a STATIC list of 2-element pairs whose members all live in the forest's
  // universe — the input the unions consume. Optional: scattered union calls still animate.
  let edges = [];
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === forest.name) continue;
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 2) continue;
    const final = snaps.at(-1);
    const pair = (m) => Array.isArray(m) && m.length === 2 && m.every((x) => forest.ids.has(String(x)));
    if (final.length === 0 || !final.every(pair)) continue;
    if (!snaps.every((s) => JSON.stringify(s) === JSON.stringify(final))) continue; // input, not a worklist
    edges = final.map(([a, b]) => ({ from: String(a), to: String(b) }));
    break;
  }

  // CURRENT: the widest forest-subscripter holding node ids (find's walker).
  const roles = { parent: forest.name };
  let best = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === forest.name) continue;
    if (!new RegExp(`\\b${forest.name}\\s*\\[[^\\]]*\\b${name}\\b`).test(code)) continue;
    const seen = lines.map((e) => e.locals[name]).filter((v) => typeof v === 'number' || typeof v === 'string');
    if (seen.length === 0 || !seen.every((v) => forest.ids.has(String(v)))) continue;
    const distinct = new Set(seen.map(String)).size;
    if (distinct >= 2 && (!best || distinct > best.distinct)) best = { name, distinct };
  }
  if (best) roles.current = best.name;

  return {
    lens: 'union-find',
    confidence: 0.86,
    forestVar: forest.name,
    graph: {
      nodes: [...forest.ids].map((id) => ({ id, label: id })),
      edges,
      directed: false, // union consumes connections, not arrows
    },
    roles,
  };
}

// Adapt the recording to the proven graph-walk compiler (its `parent` role owns the unions).
export function compileUnionFind({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'union-find') throw new Error('compileUnionFind needs a plan from detectUnionFind');
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
