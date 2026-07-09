'use client';

// TraceTable — the Dry Run Trace, rebuilt as the elite CENTREPIECE (target tree2.png): ONE
// integrated table where every step's row carries its structured state AND its action, lined up
// so the table and the explanation always match. Columns are assembled from what the steps
// actually contain, in the reading order a tutor writes them:
//   Step · Node (colored circle) · Queue/Stack (live collection) · Visited · <vars> · Action
// The current row (the step the tutor is on right now) is highlighted; rows appear as the clock
// advances, never all at once. Columns come from the WHOLE trace so headers are stable from
// step 1 (the old "misplaced headers" bug).

export function TraceTable({ history = [], allSteps = null, nodeLabels = null }) {
  const source = allSteps ?? history;
  if (source.length === 0) return null;
  const labelOf = (id) => (nodeLabels && nodeLabels[String(id)] != null ? String(nodeLabels[String(id)]) : String(id));

  // Which structured columns exist anywhere in the trace (stable across playback).
  const has = {
    node: source.some((s) => s.graph?.current != null),
    queue: source.some((s) => Array.isArray(s.queue)),
    stack: source.some((s) => Array.isArray(s.stack)),
    visited: source.some((s) => Array.isArray(s.graph?.visited) && s.graph.visited.length > 0),
  };

  // Scalar variable columns — one key-space for the whole table (traceRow if any step has one,
  // else variables), first-seen order. Mixing them per-row spanned disjoint key sets and read
  // as misaligned; deciding once keeps every row in the same columns.
  const useTraceRow = source.some((s) => s.traceRow && typeof s.traceRow === 'object');
  const varsOf = (s) => (useTraceRow ? s.traceRow ?? {} : s.variables ?? {});
  // A variable key is dropped when a dedicated column already tells its story, so the table
  // never shows both "Node" and "node" or "Queue" and "queue": the Step column covers
  // step/index; the structured columns cover the current node, the collections and the visited
  // set. Everything else (low/mid/high, i/j, sum…) stays as its own column.
  const covered = (k) => {
    if (/^(step|idx|index)$/i.test(k)) return true;
    if (has.node && /^(node|cur|curr|current|u|v)$/i.test(k)) return true;
    if (has.queue && /^queue$/i.test(k)) return true;
    if (has.stack && /^stack$/i.test(k)) return true;
    if (has.visited && /^visited$/i.test(k)) return true;
    return false;
  };
  const varCols = [];
  for (const s of source) for (const k of Object.keys(varsOf(s))) if (!covered(k) && !varCols.includes(k)) varCols.push(k);
  // A step-by-step table shows EVOLVING state. A column whose value never changes across the
  // whole trace is an input constant (the string "abcde", the array, the target) — it belongs
  // in the Variables panel, not repeated on every row. Drop constant columns.
  const evolving = varCols.filter((c) => {
    const vals = new Set();
    for (const s of source) { const r = varsOf(s); if (c in r) vals.add(JSON.stringify(r[c])); }
    return vals.size > 1;
  });

  const hasAction = source.some((s) => String(s.explanation ?? '').trim().length > 0);
  const nCols = 1 + (has.node ? 1 : 0) + (has.queue ? 1 : 0) + (has.stack ? 1 : 0) + (has.visited ? 1 : 0) + evolving.length + (hasAction ? 1 : 0);
  if (nCols <= 1) return null;

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8' }}>
      <div style={{ padding: '6px 12px', fontSize: 12, color: '#8a6d3b', background: '#fdeaa7', fontWeight: 700 }}>Dry Run Trace — step by step</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
        <thead>
          <tr>
            <th style={cell(true)}>Step</th>
            {has.node ? <th style={cell(true)}>Node</th> : null}
            {has.queue ? <th style={cell(true)}>Queue (front → back)</th> : null}
            {has.stack ? <th style={cell(true)}>Stack (top →)</th> : null}
            {has.visited ? <th style={cell(true)}>Visited</th> : null}
            {evolving.map((c) => <th key={c} style={cell(true)}>{c}</th>)}
            {hasAction ? <th style={{ ...cell(true), minWidth: 220 }}>Action / Explanation</th> : null}
          </tr>
        </thead>
        <tbody>
          {history.map((s, i) => {
            const current = i === history.length - 1;
            const vars = varsOf(s);
            return (
              <tr key={i} style={current ? { background: '#eafaf0' } : undefined}>
                <td style={{ ...cell(false), color: '#d35400', fontWeight: 700, textAlign: 'center' }}>{s.step ?? i + 1}</td>
                {has.node ? (
                  <td style={{ ...cell(false), textAlign: 'center' }}>
                    {s.graph?.current != null ? <NodeChip label={labelOf(s.graph.current)} current={current} /> : ''}
                  </td>
                ) : null}
                {has.queue ? <td style={cell(false)}>{fmtList(s.queue)}</td> : null}
                {has.stack ? <td style={cell(false)}>{fmtList(s.stack)}</td> : null}
                {has.visited ? <td style={cell(false)}>{(s.graph?.visited ?? []).map(labelOf).join(', ')}</td> : null}
                {evolving.map((c) => <td key={c} style={{ ...cell(false), textAlign: 'center' }}>{c in vars ? String(vars[c]) : ''}</td>)}
                {hasAction ? <td style={{ ...cell(false), fontFamily: 'inherit', color: '#5a4a2a' }}>{firstSentence(s.explanation)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A node rendered as a small circle inside the cell (target: the Current Node column shows the
// actual node, not a bare id) — the current row's node glows orange, earlier rows read green.
function NodeChip({ label, current }) {
  const c = current
    ? { border: '#d35400', bg: '#ffd9a8', fg: '#8a3a12' }
    : { border: '#27ae60', bg: '#eafaf0', fg: '#1c6b3a' };
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        padding: '0 6px',
        borderRadius: 999,
        border: `2px solid ${c.border}`,
        background: c.bg,
        color: c.fg,
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      {label}
    </span>
  );
}

// The Action column is a TERSE action (first sentence) — the full 2-3 sentence narration lives
// in the caption panel; the table stays scannable while still matching the step word for word.
function firstSentence(text) {
  const t = String(text ?? '').trim();
  if (!t) return '';
  const end = t.search(/\.\s|\.$/);
  const first = end === -1 ? t : t.slice(0, end + 1);
  return first.length > 120 ? `${first.slice(0, 117)}…` : first;
}

function fmtList(arr) {
  if (!Array.isArray(arr)) return '';
  if (arr.length === 0) return '∅';
  return `[${arr.map(String).join(', ')}]`;
}

function cell(header) {
  return {
    border: '1px solid #e8ddc9',
    padding: '5px 10px',
    textAlign: 'left',
    verticalAlign: 'top',
    background: header ? '#fdeaa7' : 'transparent',
    fontWeight: header ? 700 : 400,
  };
}
