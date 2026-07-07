'use client';

// GridView — the Array2DTracer surface: a DP table / grid / matrix that fills cell-by-cell as
// the algorithm runs (Fibonacci memo, LCS, knapsack, pathfinding grids). Driven by one trace
// step: the CURRENT cell glows orange, FILLED cells stay green, dependency HIGHLIGHT cells turn
// amber, and values accumulate from every step so far (so the table grows as the tutor speaks).

export function GridView({ view, step, history = [] }) {
  const rows = view?.rows ?? 0;
  const cols = view?.cols ?? 0;
  if (!rows || !cols) return null;

  // Accumulate every value written up to and including this step -> the visible table contents.
  const valueAt = new Map();
  for (const h of history) {
    for (const [r, c, v] of h.array2d?.values ?? []) valueAt.set(`${r},${c}`, v);
  }
  const s = step.array2d ?? {};
  const current = s.current ? `${s.current[0]},${s.current[1]}` : null;
  const filled = new Set((s.filled ?? []).map(([r, c]) => `${r},${c}`));
  const highlight = new Set((s.highlight ?? []).map(([r, c]) => `${r},${c}`));

  const colLabels = view.colLabels ?? Array.from({ length: cols }, (_, i) => String(i));
  const rowLabels = view.rowLabels ?? (rows > 1 ? Array.from({ length: rows }, (_, i) => String(i)) : null);

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8', padding: 10 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 4, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>
        <thead>
          <tr>
            {rowLabels ? <th /> : null}
            {colLabels.map((c, i) => (
              <th key={i} style={{ padding: '2px 8px', color: '#a89b7d', fontWeight: 700 }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {rowLabels ? <th style={{ padding: '2px 8px', color: '#a89b7d', fontWeight: 700 }}>{rowLabels[r]}</th> : null}
              {Array.from({ length: cols }).map((__, c) => {
                const key = `${r},${c}`;
                const isCurrent = key === current;
                const isFilled = filled.has(key);
                const isHi = highlight.has(key);
                const border = isCurrent ? '#d35400' : isHi ? '#c9a227' : isFilled ? '#27ae60' : '#e0d6c2';
                const bg = isCurrent ? '#ffd9a8' : isHi ? '#fdeaa7' : isFilled ? '#eafaf0' : '#fffdf8';
                const val = valueAt.has(key) ? String(valueAt.get(key)) : '';
                return (
                  <td
                    key={c}
                    style={{
                      minWidth: 40,
                      height: 38,
                      textAlign: 'center',
                      border: `2px solid ${border}`,
                      borderRadius: 6,
                      background: bg,
                      color: '#3a3327',
                      fontWeight: 700,
                      boxShadow: isCurrent ? '0 0 0 4px rgba(211,84,0,0.22)' : 'none',
                      transition: 'background 0.3s, border-color 0.3s, box-shadow 0.3s',
                    }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
