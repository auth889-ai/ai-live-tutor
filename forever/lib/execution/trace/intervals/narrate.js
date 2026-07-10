// Interval narration — the instructor formula over REAL recorded boundaries: pose the overlap
// check with live numbers, give the verdict, then what the island does about it.

export function narrateSorted(intervals) {
  return `We sort the ${intervals.length} intervals by start: ${fmt(intervals)}. Sorting is the whole trick — once sorted, any interval that overlaps something can only overlap the island RIGHT BEFORE it, so one left-to-right pass decides everything.`;
}

export function narrateFirstIsland(interval) {
  return `${fmtOne(interval)} opens the first island — nothing exists yet to overlap with, so it goes straight into the answer.`;
}

export function narrateFuse({ incoming, islandBefore, islandAfter }) {
  return `Does ${fmtOne(incoming)} overlap the current island ${fmtOne(islandBefore)}? Its start ${incoming[0]} is ≤ the island's end ${islandBefore[1]} — YES, they touch. The island absorbs it and now reaches ${fmtOne(islandAfter)} (end = max(${islandBefore[1]}, ${incoming[1]}) = ${islandAfter[1]}).`;
}

export function narrateNewIsland({ incoming, lastIsland }) {
  return `Does ${fmtOne(incoming)} overlap the current island ${fmtOne(lastIsland)}? Its start ${incoming[0]} is > the island's end ${lastIsland[1]} — NO, there is a gap. The island is sealed and ${fmtOne(incoming)} opens a NEW one.`;
}

export function narrateClose(merged, result) {
  return `Every interval has been consumed: ${merged.length} island${merged.length === 1 ? '' : 's'} remain — ${fmt(merged)}. That is the answer the real run returned: ${JSON.stringify(result)}.`;
}

const fmtOne = (iv) => `[${iv[0]},${iv[1]}]`;
const fmt = (list) => list.map(fmtOne).join(' ');
