// NARRATION STAGE of the divide-&-conquer tool — the call/return/terminal beats. The array
// beats (moves, swaps, writes) are REUSED from the pointer-walk narrate stage: same words,
// one owner, no duplication. These sentences own what is unique to D&C: the focus band
// ("only this slice exists right now"), the base case, and the conquered segment coming back.

export function narrateStart({ entry }) {
  return `We run ${entry} and watch two pictures at once: the array with the ACTIVE BAND lit (everything dimmed is another call's job), and the recursion tree growing as the problem splits. Divide and conquer means never thinking about more than one band at a time.`;
}

export function narrateCall({ label, parentLabel, lo, hi, size }) {
  if (size <= 1) {
    return `${label} is the BASE CASE: a band of ${size === 1 ? 'one cell' : 'no cells'} is already sorted by definition — the splitting stops here, and this tiny certainty is what every bigger answer will be built from.`;
  }
  const from = parentLabel ? ` ${parentLabel} hands down the band ${lo}..${hi} and` : '';
  return `We enter ${label}:${from} the problem is now JUST these ${size} cells — watch the focus band shrink onto them. Nothing outside the band can be touched by this call; that discipline is the whole design.`;
}

export function narrateReturn({ label, segmentText, parentLabel }) {
  const upTo = parentLabel ? ` ${parentLabel} now holds one more solved half` : ' The whole array is now conquered';
  return `${label} RETURNS: its band comes back as ${segmentText} — sorted within itself, guaranteed.${upTo}, and combining solved halves is all the work that remains at this level.`;
}

export function narrateDone({ result, values, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the run kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  return `Every call has returned and the array reads [${values.map((v) => JSON.stringify(v)).join(', ')}]. Walk the tree bottom-up in your head: one-cell bands were trivially sorted, and every merge/partition above them only ever combined already-solved halves — that is the entire proof, performed in front of you.`;
}
