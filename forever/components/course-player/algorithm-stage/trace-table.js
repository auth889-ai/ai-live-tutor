'use client';

// TraceTable — the LogTracer surface: the step-by-step dry-run table (like "Step · low · high ·
// mid · arr[mid] · Decision"). One row per step revealed SO FAR, columns are the union of the
// steps' traceRow keys (falling back to variables), current row highlighted. Rows appear as the
// clock advances — never all at once.

export function TraceTable({ history = [] }) {
  const rows = history.map((h) => h.traceRow ?? h.variables ?? {});
  const columns = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
  if (columns.length === 0) return null;

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 10, background: '#fffdf8' }}>
      <div style={{ padding: '6px 12px', fontSize: 12, color: '#8a6d3b', background: '#fdeaa7' }}>Dry run — step by step</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, fontFamily: 'ui-monospace, monospace' }}>
        <thead>
          <tr>{columns.map((c) => <th key={c} style={cell(true)}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const current = i === rows.length - 1;
            return (
              <tr key={i} style={current ? { background: '#fff3d6' } : undefined}>
                {columns.map((c) => <td key={c} style={cell(false)}>{c in row ? String(row[c]) : ''}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function cell(header) {
  return {
    border: '1px solid #e8ddc9',
    padding: '5px 10px',
    textAlign: 'left',
    background: header ? '#fdeaa7' : 'transparent',
    fontWeight: header ? 700 : 400,
  };
}
