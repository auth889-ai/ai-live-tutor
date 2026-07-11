// TRIE-DICT LENS — detector/compiler pair #13 of the record-once/detect-later engine: the
// idiomatic LeetCode trie built INLINE as a dict-of-dicts (root = {}, node[ch] = {}, '$' marks
// a word's end). There are no objects for the heap walker to follow — the identity of a trie
// node is its PATH from the root, and paths are stable across every snapshot. This lens walks
// each recorded snapshot of the nested dict, names every node by its path, and hands the
// growing tree to the proven structure compiler: nodes appear character by character as words
// are inserted, shared prefixes visibly reused (the trie's whole lesson).
//
// The recorder serializes nested values only 4 levels deep — the honest cap for a TEACHING
// trie (short words); deeper branches would arrive as repr strings and are left as leaves.

import { compileStructureTrace } from '../../structure/compiler.js';

const isPlainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const looksLikeTrie = (v) =>
  isPlainObj(v) && Object.entries(v).some(([k, x]) => k.length <= 2 && isPlainObj(x));

// Decide the lens from the recording. Returns null or { lens: 'trie-dict', confidence, rootVar }.
export function detectTrieDict(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  let best = null;
  for (const name of new Set(lines.flatMap((e) => Object.keys(e.locals)))) {
    const snaps = lines.map((e) => e.locals[name]).filter(isPlainObj);
    if (snaps.length < 3) continue;
    if (!snaps.some(looksLikeTrie)) continue; // must NEST — a flat counter dict is not a trie
    if (!snaps.every((s) => Object.keys(s).every((k) => k.length <= 2))) continue; // char keys (+ '$')
    const count = (v) => (isPlainObj(v) ? 1 + Object.values(v).reduce((a, x) => a + count(x), 0) : 0);
    const growth = count(snaps.at(-1)) - count(snaps[0]);
    if (growth < 2) continue; // the tree must visibly GROW — static config objects refuse
    if (!best || growth > best.growth) best = { name, growth };
  }
  if (!best) return null;
  return { lens: 'trie-dict', confidence: 0.84, rootVar: best.name };
}

// Name nodes by path, snapshot per line event, delegate the growth animation.
export function compileTrieDict({ recording, plan, code, entry = null, language = 'python' }) {
  if (!plan || plan.lens !== 'trie-dict') throw new Error('compileTrieDict needs a plan from detectTrieDict');
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');

  const events = [];
  const known = new Set();
  let cursor = null; // the growing TIP: the newest path is where the insertion pen stands
  for (const e of lines) {
    const root = e.locals[plan.rootVar];
    if (!isPlainObj(root)) continue;
    const nodes = {};
    (function walk(dict, path, label) {
      nodes[path] = { label, refs: [] };
      if (!isPlainObj(dict)) return;
      for (const [k, v] of Object.entries(dict)) {
        const childPath = `${path}/${k}`;
        nodes[path].refs.push(['child', childPath]);
        if (isPlainObj(v)) walk(v, childPath, k);
        else nodes[childPath] = { label: k === '$' ? '$ (word ends)' : k, refs: [] };
      }
    })(root, plan.rootVar, plan.rootVar);
    for (const path of Object.keys(nodes)) {
      if (!known.has(path)) { known.add(path); cursor = path; }
    }
    events.push({
      line: e.line,
      state: { kind: 'obj', nodes, pointers: cursor ? { node: cursor } : {} },
      variables: Object.fromEntries(Object.entries(e.locals).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))),
    });
  }
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileStructureTrace({ events, result: recording.result, code, entry, language });
}
