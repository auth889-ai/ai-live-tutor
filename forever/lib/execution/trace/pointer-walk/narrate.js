// NARRATION STAGE of the pointer-walk tool (the recursion tool's narrate.js pattern — words
// are their own tested stage, never inlined into the lens). Every sentence is composed from
// REAL recorded values and follows the tutor beats: announce the move → show the value under
// it → make each mutation its own visible moment → reconnect to the invariant (why the
// shrinking/sliding matters) → read the answer out of the walk at the end.

// Pointer movements: which arrow moved, to which index, what value sits there.
export function narrateMoves(moved, locals, prev, shown) {
  const moves = moved.map((p) => {
    const at = locals[p];
    const verb = p in prev ? 'moves to' : 'starts at';
    return `${p} ${verb} index ${at}, where the value is ${JSON.stringify(shown[at])}`;
  }).join('; ');
  return `${moves.charAt(0).toUpperCase()}${moves.slice(1)}. These positions are from the real run — the arrows you see are exactly where the pointers stood at this moment.`;
}

// An in-place exchange of exactly two cells — the sorting beat.
export function narrateSwap([i, j], shown) {
  return `Cells ${i} and ${j} trade contents: ${JSON.stringify(shown[i])} now sits at index ${i} and ${JSON.stringify(shown[j])} at index ${j}. Watch the swap flash — in-place rearrangement is the whole trick: no second array, just disciplined exchanges.`;
}

// Any other in-place write (partition, overwrite, fill).
export function narrateWrite(written, shown) {
  return `The array itself changes at ${written.length === 1 ? `index ${written[0]}, which now holds ${JSON.stringify(shown[written[0]])}` : `indices ${written.join(', ')}`} — a real in-place write recorded from the run, not an animation guess.`;
}

// New scalars appearing — the tutor's setup beat: declare what to track BEFORE it moves.
export function narrateIntroduced(introduced) {
  const what = introduced.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ');
  return `New state appears: ${what} — keep your eye on ${introduced.length === 1 ? 'this value' : 'these values'}; every pointer move below is decided by ${introduced.length === 1 ? 'it' : 'them'}.`;
}

// Scalars changing — the decision the comparison just produced.
export function narrateUpdated(updated) {
  const what = updated.map(([k, v]) => `${k} becomes ${JSON.stringify(v)}`).join(', ');
  return `The bookkeeping updates: ${what}. This is the decision the comparison just produced — the pointers only move BECAUSE values like these said so.`;
}

// The binary-search invariant beat: dramatize the shrinking search space.
export function narrateEliminated({ lo, hi, eliminatedCount, total }) {
  return ` Everything outside ${lo}..${hi} is now ELIMINATED — ${eliminatedCount} of ${total} cells dimmed, the search space keeps shrinking, and that shrinking is the whole reason this runs in logarithmic time.`;
}

// The sliding-window invariant beat: reuse of the overlap is the complexity win.
export function narrateWindow({ left, right }) {
  return ` The window now spans indices ${left}..${right} — watch it slide rather than restart; reusing the overlap is what makes this linear instead of quadratic.`;
}

// Terminal beat: the result read out of the walk (or the open, honest recording cut).
export function narrateClose({ truncated, result, liveValues }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the walk kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  const finalValues = liveValues
    ? ` The array ends as [${liveValues.map((v) => JSON.stringify(v)).join(', ')}] — compare it with where it started and every difference is a step you just watched.`
    : '';
  return `The walk is over and the call returns ${JSON.stringify(result)}.${finalValues} Replay the arrows in your head: every move you watched was a decision the code made on real data — that decision pattern IS the algorithm.`;
}
