// SOLUTION ORACLE (reviewer requirement, mandatory before the Director composes over runs):
// real execution faithfully traces a WRONG solution — a beautiful dry run of code that fails
// the problem's own example teaches a lie end to end. When the tracer declares "expect" (the
// expected output for its entry, copied from the problem's stated example), the recorded
// result must match or the trace is rejected with a repair message naming actual vs expected.
// Tolerant equality: JSON-normalized, numeric strings match numbers, list order preserved
// (order matters in most LC answers; sets should be declared sorted by the solution itself).

export function resultMatchesExpect(actual, expect) {
  if (expect === undefined) return true;
  const norm = (v) => {
    if (typeof v === 'string') {
      const t = v.trim();
      try { return JSON.stringify(JSON.parse(t)); } catch { return JSON.stringify(t); }
    }
    return JSON.stringify(v);
  };
  return norm(actual) === norm(expect);
}

export function oracleIssue(actual, expect) {
  if (resultMatchesExpect(actual, expect)) return null;
  return `SOLUTION ORACLE: the code returned ${JSON.stringify(actual)} but the problem's own example expects ${JSON.stringify(expect)} — the SOLUTION is wrong, not the trace. Fix the code (or the entry's input) and output the full JSON again; never adjust "expect" to match a wrong run.`;
}
