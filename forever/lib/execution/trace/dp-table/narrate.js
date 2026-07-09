// NARRATION STAGE of the dp-table tool. The beats follow the researched DP teaching template
// (define the cell meaning, justify the base row/column, make every interior write its own
// visible moment with its real values, then read the answer OUT of the table): every number
// quoted comes from the recorded run.

export function narrateStart({ entry, rows, cols }) {
  return `We run ${entry} and watch the ${rows}×${cols} table fill cell by cell. One rule before anything moves: know what a cell MEANS — dp[i][j] is the answer to a smaller version of the same question, and every write below only ever combines already-solved smaller answers.`;
}

export function narrateInit({ rows, cols }) {
  return `The table is created: ${rows} row${rows === 1 ? '' : 's'} × ${cols} column${cols === 1 ? '' : 's'}, seeded with its starting values. These are not answers yet — they are the scaffold the real answers will be built on.`;
}

export function narrateWrite({ r, c, value, old, isBase }) {
  if (isBase) {
    return `Base case: dp[${r}][${c}] is set to ${JSON.stringify(value)}. Row 0 and column 0 are the "empty problem" answers — they cost nothing to know, and every harder cell will lean on them.`;
  }
  const was = old !== undefined && old !== null ? ` (it was ${JSON.stringify(old)})` : '';
  return `dp[${r}][${c}] becomes ${JSON.stringify(value)}${was} — computed from already-filled neighbours, never from the future. Watch WHERE the filled region grows: the order is not decoration, it is the guarantee that everything a cell needs exists before the cell does.`;
}

export function narrateBatch({ count }) {
  return `…and ${count} more cell${count === 1 ? '' : 's'} land in this same moment — the table panel shows every one of them.`;
}

export function narrateDone({ result, r, c, value, truncated }) {
  if (truncated) {
    return `The recording stops HERE, on purpose: the fill kept repeating the same pattern past the recording cap, so watching more of it teaches nothing new. The run itself continued to completion and returned ${JSON.stringify(result)} — recorded honestly, cut openly.`;
  }
  const cell = r != null ? ` The answer was read out of dp[${r}][${c}] = ${JSON.stringify(value)} — the bottom-right of the region we just filled, the "full problem" cell.` : '';
  return `The table is complete and the call returns ${JSON.stringify(result)}.${cell} Count what you watched: one write per cell, each in constant time — that is the O(rows × cols) story, and the filled table IS the proof.`;
}
