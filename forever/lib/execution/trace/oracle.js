// SOLUTION ORACLE v2 (external review #2): rich visuals require the solution to pass the
// problem's OWN stated examples — parsed from the SOURCE TEXT independently of the AI, every
// example run for real. Levels: verified_examples (all stated examples pass) | unverified
// (source states none we can parse) | failed (any mismatch -> the trace is rejected with a
// CODE-fix demand). The AI can still supply "expect" as a fallback when parsing finds nothing.

export function resultMatchesExpect(actual, expect) {
  if (expect === undefined) return true;
  const norm = (v) => {
    if (typeof v === 'string') {
      const t = v.trim().replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null');
      try { return JSON.stringify(JSON.parse(t)); } catch { return JSON.stringify(t); }
    }
    return JSON.stringify(v);
  };
  return norm(actual) === norm(expect);
}

// Parse LeetCode-style stated examples from the problem text:
//   Input: nums = [1,2,3,4,5,6,7], k = 3
//   Output: [5,6,7,1,2,3,4]
// Returns [{argsRaw: "…the raw python-literal arg list…", expected: "raw output text"}].
// Raw literals are passed to Python verbatim — no JS re-parsing, no value invention.
export function parseStatedExamples(sourceText) {
  const src = String(sourceText ?? '');
  const out = [];
  // Multiline inputs supported (external probe: matrix examples across lines parsed nothing):
  // capture everything between Input: and Output: lazily, then flatten whitespace.
  const re = /Input:\s*([\s\S]*?)\n\s*Output:\s*([^\n]+)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const inputLine = m[1].replace(/\s+/g, ' ').trim();
    // "n = 4, edges = [[3,1,2],...]" -> strip the names, keep ordered raw values.
    const args = [];
    let depth = 0; let cur = '';
    for (const ch of inputLine) {
      if ('[({'.includes(ch)) depth += 1;
      if ('])}'.includes(ch)) depth -= 1;
      if (ch === ',' && depth === 0) { args.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) args.push(cur);
    const values = args.map((a) => (a.includes('=') ? a.slice(a.indexOf('=') + 1) : a).trim()).filter(Boolean);
    if (values.length) out.push({ argsRaw: values.join(', '), expected: m[2].trim() });
  }
  return out;
}

// verifySolution({ code, entry, sourceText, exec }) -> { level, failures: [...] }
// Runs the solution's entry FUNCTION on every stated example (args substituted verbatim).
export async function verifySolution({ code, entry, sourceText, exec }) {
  const examples = parseStatedExamples(sourceText);
  const fnName = String(entry ?? '').split('(')[0].trim();
  if (!examples.length || !fnName) return { level: 'unverified', failures: [] };
  const harness = examples
    .map((ex, i) => `\ntry:\n    import json as _j\n    print("@@EX" + _j.dumps({"i": ${i}, "out": repr(${fnName}(${ex.argsRaw}))}))\nexcept Exception as _e:\n    print("@@EX" + _j.dumps({"i": ${i}, "out": "ERROR: " + str(_e)[:80]}))`)
    .join('\n');
  const run = await exec({ language: 'python', source: `${code}\n${harness}` });
  const results = new Map();
  for (const line of String(run.stdout ?? '').split('\n')) {
    if (line.startsWith('@@EX')) {
      try { const r = JSON.parse(line.slice(4)); results.set(r.i, r.out); } catch { /* skip */ }
    }
  }
  const failures = [];
  examples.forEach((ex, i) => {
    const actual = results.get(i);
    if (actual === undefined || String(actual).startsWith('ERROR:') || !resultMatchesExpect(actual, ex.expected)) {
      failures.push({ example: i + 1, expected: ex.expected, actual: actual ?? 'no output' });
    }
  });
  return { level: failures.length ? 'failed' : 'verified_examples', failures };
}

export function oracleIssue(actual, expect) {
  if (resultMatchesExpect(actual, expect)) return null;
  return `SOLUTION ORACLE: the code returned ${JSON.stringify(actual)} but the problem's own example expects ${JSON.stringify(expect)} — the SOLUTION is wrong, not the trace. Fix the code (or the entry's input) and output the full JSON again; never adjust "expect" to match a wrong run.`;
}

export function verificationIssue(verdict) {
  if (verdict.level !== 'failed') return null;
  const f = verdict.failures[0];
  return `SOLUTION ORACLE: the solution FAILS the problem's own stated example ${f.example}: expected ${f.expected} but got ${f.actual} (${verdict.failures.length} failing example(s)). The SOLUTION is wrong — fix the code and output the full JSON again; never weaken the examples.`;
}
