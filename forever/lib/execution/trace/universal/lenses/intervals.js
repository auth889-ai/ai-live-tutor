// INTERVALS LENS — detector/compiler pair #15 of the record-once/detect-later engine: merge
// intervals, meeting rooms, insert interval — the NUMBER-LINE family. The proven intervals
// compiler already animates the islands fusing; this detector derives its two declarations:
//
//   intervalsVar = the input: a list of [start, end] number pairs whose LENGTH never changes
//                  (sorting reorders it, merging never consumes it)
//   mergedVar    = the accumulator: an interval list that grows from nothing — and, the
//                  signature that separates it from any other pair-collector (Kruskal's MST
//                  list collects literal input edges): at least one FUSION, an element whose
//                  bounds were REWRITTEN in place ([1,3] stretching to [1,6]) or that exists
//                  in no input snapshot. No fusion, no claim — the fusing IS the lesson.

import { compileIntervals } from '../../intervals/compiler.js';

const isInterval = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number') && v[0] <= v[1];
const isIntervalList = (v) => Array.isArray(v) && v.every(isInterval);

// Decide the lens from the recording. Returns null or:
//   { lens: 'intervals', confidence, intervalsVar, mergedVar }
export function detectIntervals(recording, _ctx = {}) {
  const lines = (recording?.events ?? []).filter((e) => e.ev === 'line');
  if (lines.length === 0) return null;
  const names = new Set(lines.flatMap((e) => Object.keys(e.locals)));

  // The input: pair-list with a STABLE length (>= 2 — one bar teaches nothing).
  let input = null;
  for (const name of names) {
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 2) continue;
    if (!snaps.every((s) => isIntervalList(s) && s.length === snaps[0].length)) continue;
    if (snaps[0].length < 2) continue;
    if (!input || snaps[0].length > input.len) input = { name, len: snaps[0].length };
  }
  if (!input) return null;
  const inputMembers = new Set(
    lines.flatMap((e) => (Array.isArray(e.locals[input.name]) ? e.locals[input.name].map((iv) => JSON.stringify(iv)) : [])),
  );

  // The accumulator: grows from nothing, and FUSES at least once.
  for (const name of names) {
    if (name === input.name) continue;
    const snaps = lines.map((e) => e.locals[name]).filter(Array.isArray);
    if (snaps.length < 2 || !snaps.every(isIntervalList)) continue;
    if (snaps[0].length > 1 || snaps.at(-1).length < 1) continue;
    if (!snaps.every((s, i) => i === 0 || s.length >= snaps[i - 1].length)) continue;
    let fused = snaps.at(-1).some((iv) => !inputMembers.has(JSON.stringify(iv)));
    for (let i = 1; !fused && i < snaps.length; i += 1) {
      if (snaps[i].length === snaps[i - 1].length && JSON.stringify(snaps[i]) !== JSON.stringify(snaps[i - 1])) fused = true;
    }
    if (!fused) continue;
    // 0.9, tying dp-table: a growing pair-list IS a 2-column table filling in sweep order, so
    // dp-table always co-fires here — but this detector demanded s<=e pairs, a stable input
    // AND a fusion, which no real DP run exhibits. Specificity wins; registry order breaks the tie.
    return { lens: 'intervals', confidence: 0.9, intervalsVar: input.name, mergedVar: name };
  }
  return null;
}

// Adapt the recording to the proven intervals compiler: its events ARE our line events.
export function compileIntervalsLens({ recording, plan, code, language = 'python' }) {
  if (!plan || plan.lens !== 'intervals') throw new Error('compileIntervalsLens needs a plan from detectIntervals');
  const events = (recording?.events ?? []).filter((e) => e.ev === 'line').map((e) => ({ line: e.line, locals: e.locals }));
  if (recording?.events?.at(-1)?.truncated === true) events.push({ truncated: true });
  return compileIntervals({
    events,
    result: recording.result,
    code,
    language,
    intervalsVar: plan.intervalsVar,
    mergedVar: plan.mergedVar,
  });
}
