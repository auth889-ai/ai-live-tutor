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

// Striver's positional vocabulary (mined from the DP-series transcripts, lecture 9: "there
// are two ways one is up one is left … up plus left and where did you store it in dp of i j";
// lecture 26: "1 plus f of i minus one j minus one … take the best among them").
function relName([a, b], r, c) {
  if (a === r - 1 && b === c) return 'the cell above';
  if (a === r && b === c - 1) return 'the cell to the left';
  if (a === r - 1 && b === c - 1) return 'the diagonal';
  return `dp[${a}][${b}]`;
}

export function narrateWrite({ r, c, value, old, isBase , proved = false , informative = true , readCells = null , chosen = null , tookBest = false , readsInstrumented = false }) {
  const was = old !== undefined && old !== null ? ` (it was ${JSON.stringify(old)})` : '';
  // STRIVER GRAMMAR, recorded facts only: fires ONLY when this write's timestep RECORDED dp
  // reads — every cell named below was actually read by the run, so "we look at" is literal.
  if (informative && Array.isArray(readCells) && readCells.length > 0) {
    const names = readCells.map((x) => `${relName(x.p, r, c)} (dp[${x.p[0]}][${x.p[1]}] = ${JSON.stringify(x.v)})`);
    const look = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const best = chosen && chosen.length > 0
      ? `, and take the best among them — dp[${chosen[0][0]}][${chosen[0][1]}] wins`
      : (tookBest ? ', and take the best among them' : '');
    return `To fill dp[${r}][${c}] we look at ${look}${best}. So dp[${r}][${c}] = ${JSON.stringify(value)}${was}. Every cell named here was RECORDED being read for this exact write — never a formula guess.`;
  }
  if (isBase) {
    return `Base case first: dp[${r}][${c}] = ${JSON.stringify(value)} because the smallest version of the problem is answered directly — no other cell was read to produce it. Row-0/column-0 cells are the "empty problem" answers every harder cell will lean on.`;
  }
  // VERIFIED-TEMPLATES LAW (external review #2, reproduced 2026-07-20): 'computed from
  // neighbours' may only be said when neighbour reads were RECORDED — a constant write
  // (dp[i][j] = 1) uses no neighbours, and saying otherwise is a false explanation.
  // Inference-deletion corollary (2026-07-28): a recording WITHOUT read instrumentation
  // carries no read evidence either way — so it claims neither a dependency NOR "assigned
  // directly"; it narrates the bare write and nothing more.
  if (!proved) {
    return readsInstrumented
      ? `dp[${r}][${c}] becomes ${JSON.stringify(value)}${was}. No reads of other cells were recorded for this write — the value was assigned directly. Watch WHERE the filled region grows: the order tells you how the loop sweeps the table.`
      : `dp[${r}][${c}] becomes ${JSON.stringify(value)}${was}. This recording carries no read instrumentation, so no dependency is claimed for this write. Watch WHERE the filled region grows: the order tells you how the loop sweeps the table.`;
  }
  if (!informative) {
    return `dp[${r}][${c}] becomes ${JSON.stringify(value)}${was}. The write's expression read other cells (recorded — they light up), but the written value is constant across the run, so no value flow is claimed from them.`;
  }
  return `dp[${r}][${c}] becomes ${JSON.stringify(value)}${was} — computed from already-filled neighbours (the recorded reads light up), never from the future. Watch WHERE the filled region grows: the order is not decoration, it is the guarantee that everything a cell needs exists before the cell does.`;
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
