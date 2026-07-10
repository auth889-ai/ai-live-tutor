// Interval-merge trace compiler — the NUMBER-LINE lens (researched: hellointerview/AlgoMaster/
// NeetCode all teach intervals by drawing sorted bars on a number line and watching overlaps
// fuse into islands). Built on the proven line-simulator recording: the model only DECLARES
// which variable holds the input intervals and which accumulates the merged result; every
// change to the merged list becomes one narrated island beat with the REAL boundaries.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import { narrateSorted, narrateFirstIsland, narrateFuse, narrateNewIsland, narrateClose } from './narrate.js';

const isInterval = (v) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number');
const isIntervalList = (v) => Array.isArray(v) && v.length > 0 && v.every(isInterval);

// compileIntervals({ events, result, code, intervalsVar, mergedVar, language })
export function compileIntervals({ events, result, code, intervalsVar, mergedVar, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('intervals run recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  if (!intervalsVar || !mergedVar) throw new Error('intervals lens needs intervalsVar (the input list) and mergedVar (the merged result list)');
  const lineCount = String(code ?? '').split('\n').length;

  // The sorted input = the intervalsVar's last stable snapshot before merging starts.
  let input = null;
  for (const ev of events) {
    const v = ev.locals?.[intervalsVar];
    if (isIntervalList(v)) input = v;
    if (isIntervalList(ev.locals?.[mergedVar]) && input) break;
  }
  if (!input) throw new Error(`intervals lens: "${intervalsVar}" never held a list of [start,end] pairs in the recording`);

  const steps = [];
  let prevMerged = [];
  const push = (line, explanation, merged, currentIdx) => steps.push({
    line,
    explanation,
    intervals: { merged: merged.map((iv) => [...iv]), ...(currentIdx != null ? { current: currentIdx } : {}) },
    variables: { merged: merged.length },
  });

  const findIdx = (iv) => input.findIndex(([s, e]) => s === iv[0] || (s <= iv[0] && e >= iv[1]));

  push(Number(events[0]?.line) >= 1 && Number(events[0]?.line) <= lineCount ? Number(events[0].line) : 1, narrateSorted(input), [], null);

  for (const ev of events) {
    const line = Number(ev.line);
    if (!Number.isInteger(line) || line < 1 || line > lineCount) continue;
    const merged = ev.locals?.[mergedVar];
    if (!Array.isArray(merged) || !merged.every(isInterval)) continue;
    if (JSON.stringify(merged) === JSON.stringify(prevMerged)) continue;

    if (merged.length > prevMerged.length) {
      const incoming = merged[merged.length - 1];
      const explanation = prevMerged.length === 0
        ? narrateFirstIsland(incoming)
        : narrateNewIsland({ incoming, lastIsland: prevMerged[prevMerged.length - 1] });
      push(line, explanation, merged, findIdx(incoming));
    } else if (merged.length === prevMerged.length && merged.length > 0) {
      const islandBefore = prevMerged[prevMerged.length - 1];
      const islandAfter = merged[merged.length - 1];
      // The incoming interval is the sorted-input entry whose end BECAME the island's new end
      // (or is contained); name it honestly from the recording.
      const incoming = input.find(([s, e]) => s > islandBefore[0] && e === islandAfter[1]) ?? [islandBefore[1], islandAfter[1]];
      push(line, narrateFuse({ incoming, islandBefore, islandAfter }), merged, findIdx(incoming));
    }
    prevMerged = merged.map((iv) => [...iv]);
  }
  if (steps.length < 2) throw new Error(`intervals lens: "${mergedVar}" never grew — check the declared variable names`);

  push(steps[steps.length - 1].line, narrateClose(prevMerged, result), prevMerged, null);

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { intervals: { intervals: input } },
    steps,
  }, 'intervals trace');
}
