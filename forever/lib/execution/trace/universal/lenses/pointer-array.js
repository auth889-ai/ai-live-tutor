// POINTER-ON-ARRAY LENS — detector/compiler pair #3 of the record-once/detect-later engine,
// covering the single biggest LeetCode family: binary search, two pointers, sliding window,
// in-place sorting/partitioning. The proven pointer-walk compiler already animates all of it
// (arrows riding the array, eliminated halves dimming, swaps flashing) — but it needs the
// semantics DECLARED: which variables are pointers, which pair eliminates, which pair is a
// window. This detector derives every declaration from the recording's behavior instead:
//
//   hero array   = the stable-length 1D scalar list seen in the most line events
//   pointer      = an int local that SUBSCRIPTS the hero in code (arr[p]) and stays in range —
//                  plus "bracket" ints (low/high) that never subscript but are monotonic and
//                  bound a subscripting pointer from one side at every common sighting
//   eliminated   = a pointer pair (p,q): p never decreases, q never increases, p<=q always
//                  (binary search, converging two-pointers — cells outside are ruled out)
//   window       = a pointer pair BOTH non-decreasing with p<=q always (sliding window)
//   arrayVar     = the hero itself when its cells change in place (sorting, partitioning)
//   stack/queue  = a second list whose length both grew and shrank (monotonic stack, BFS queue)

import { compilePointerWalk } from '../../pointer-walk/compiler.js';

const isScalar = (v) => v === null || ['number', 'string', 'boolean'].includes(typeof v);
const is1d = (v) => Array.isArray(v) && v.length >= 2 && v.every(isScalar);

// Decide the lens from the recording. Returns null or:
//   { lens: 'pointer-array', confidence, array: {name, values}, pointers, arrayVar,
//     eliminatedOutside, window, stackVar, queueVar }
export function detectPointerArray(recording, { code = '' } = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;

  // THE HERO ARRAY: stable length at every sighting (a growing list is an accumulator or a
  // stack, never the walked structure), scalar cells, seen in enough of the run to be the story.
  const arrays = new Map(); // name -> {len, count, first, mutated, unstable}
  for (const e of lines) {
    for (const [k, v] of Object.entries(e.locals)) {
      if (!is1d(v)) continue;
      const a = arrays.get(k) ?? { len: v.length, count: 0, first: v, mutated: false, unstable: false };
      if (a.len !== v.length) a.unstable = true;
      else if (JSON.stringify(a.first) !== JSON.stringify(v)) a.mutated = true;
      a.count += 1;
      arrays.set(k, a);
    }
  }
  let hero = null;
  for (const [name, a] of arrays) {
    if (a.unstable || a.count < Math.max(2, lines.length / 3)) continue;
    if (!hero || a.count > hero.count) hero = { name, ...a };
  }
  if (!hero) return null;

  // Integer locals with their sighting sequences (only sightings alongside the hero count).
  const heroLines = lines.filter((e) => is1d(e.locals[hero.name]));
  const seqs = new Map();
  for (const e of heroLines) {
    for (const [k, v] of Object.entries(e.locals)) {
      if (k === hero.name || !Number.isInteger(v)) continue;
      (seqs.get(k) ?? seqs.set(k, []).get(k)).push(v);
    }
  }

  const inRange = (seq) => seq.every((v) => v >= 0 && v <= hero.len);
  const changes = (seq) => new Set(seq).size > 1;
  const subscripts = (name) => new RegExp(`\\b${hero.name}\\s*\\[[^\\]]*\\b${name}\\b`).test(code);
  const nonDecr = (seq) => seq.every((v, i) => i === 0 || v >= seq[i - 1]);
  const nonIncr = (seq) => seq.every((v, i) => i === 0 || v <= seq[i - 1]);

  // PRIMARY pointers really touch the array; BRACKETS (binary search's low/high) never
  // subscript, but they are monotonic and bound a primary from one side at every sighting.
  const primary = [...seqs].filter(([k, seq]) => subscripts(k) && inRange(seq) && changes(seq)).map(([k]) => k);
  if (primary.length === 0) return null;
  // Bounding holds by STRONG MAJORITY, not universally: right after `low = mid + 1` the stale
  // mid from the previous iteration briefly violates low <= mid until mid is recomputed.
  const bounds = (name, side) => {
    let ok = 0;
    let total = 0;
    for (const e of heroLines) {
      const v = e.locals[name];
      if (!Number.isInteger(v)) continue;
      for (const p of primary) {
        if (!Number.isInteger(e.locals[p])) continue;
        total += 1;
        if (side === 'lo' ? v <= e.locals[p] : v >= e.locals[p]) ok += 1;
      }
    }
    return total > 0 && ok / total >= 0.8;
  };
  const brackets = [...seqs]
    .filter(([k, seq]) => !primary.includes(k) && inRange(seq) && changes(seq) && (nonDecr(seq) || nonIncr(seq)))
    .filter(([k, seq]) => (nonDecr(seq) ? bounds(k, 'lo') : bounds(k, 'hi')))
    .map(([k]) => k);
  const pointers = [...primary, ...brackets].slice(0, 4);

  // ROLES from monotonicity: converging pair -> eliminated outside; advancing pair -> window.
  const pairRole = () => {
    for (const p of pointers) {
      for (const q of pointers) {
        if (p === q) continue;
        const sp = seqs.get(p);
        const sq = seqs.get(q);
        if (!changes(sp) || !changes(sq)) continue;
        const ordered = heroLines.every((e) => !Number.isInteger(e.locals[p]) || !Number.isInteger(e.locals[q]) || e.locals[p] <= e.locals[q]);
        if (!ordered) continue;
        if (nonDecr(sp) && nonIncr(sq)) return { eliminatedOutside: [p, q] };
        if (nonDecr(sp) && nonDecr(sq)) return { window: [p, q] };
      }
    }
    return {};
  };
  const role = pairRole();

  // A COMPANION collection breathes (a result accumulator only grows — not a collection).
  let stackVar = null;
  let queueVar = null;
  for (const [name, a] of arrays) {
    if (name === hero.name || !a.unstable) continue;
    let grew = false;
    let shrank = false;
    let prevLen = null;
    for (const e of heroLines) {
      const v = e.locals[name];
      if (!Array.isArray(v)) continue;
      if (prevLen !== null) {
        if (v.length > prevLen) grew = true;
        if (v.length < prevLen) shrank = true;
      }
      prevLen = v.length;
    }
    if (grew && shrank) {
      if (/\bpopleft\b|\.pop\(0\)/.test(code)) queueVar = name;
      else stackVar = name;
      break;
    }
  }

  // A COMPANION map is the walk's MEMORY (Two Sum's seen, window counts): a scalar-valued
  // dict that changes as the pointers move. Int keys count — this is a side table, not the
  // bucket-grid lesson, so the collection-ops string-key rule does not apply here.
  let mapVar = null;
  for (const name of new Set(heroLines.flatMap((e) => Object.keys(e.locals)))) {
    if (name === hero.name || name === stackVar || name === queueVar) continue;
    const snaps = heroLines
      .map((e) => e.locals[name])
      .filter((v) => v && typeof v === 'object' && !Array.isArray(v) && !('@ref' in v));
    if (snaps.length < 2) continue;
    if (!snaps.every((s) => Object.values(s).every((v) => v === null || ['number', 'string', 'boolean'].includes(typeof v)))) continue;
    let changesCount = 0;
    for (let i = 1; i < snaps.length; i += 1) if (JSON.stringify(snaps[i - 1]) !== JSON.stringify(snaps[i])) changesCount += 1;
    const gained = Object.keys(snaps.at(-1)).length > Object.keys(snaps[0]).length;
    if (changesCount >= 2 && gained) { mapVar = name; break; }
  }

  return {
    lens: 'pointer-array',
    confidence: role.eliminatedOutside || role.window ? 0.8 : 0.75,
    array: { name: hero.name, values: hero.first },
    pointers,
    arrayVar: hero.mutated ? hero.name : null,
    eliminatedOutside: role.eliminatedOutside ?? null,
    window: role.window ?? null,
    stackVar,
    queueVar,
    mapVar,
  };
}

// Adapt the recording to the proven pointer-walk compiler: its events ARE our line events.
export function compilePointerArray({ recording, plan, code, language = 'python' }) {
  if (!plan || plan.lens !== 'pointer-array') throw new Error('compilePointerArray needs a plan from detectPointerArray');
  const events = (recording?.events ?? []).filter((e) => e.ev === 'line' && is1d(e.locals?.[plan.array.name]));
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compilePointerWalk({
    events,
    result: recording.result,
    code,
    language,
    array: plan.array.values,
    pointers: plan.pointers,
    arrayVar: plan.arrayVar,
    eliminatedOutside: plan.eliminatedOutside,
    window: plan.window,
    stackVar: plan.stackVar,
    queueVar: plan.queueVar,
    mapVar: plan.mapVar,
  });
}
