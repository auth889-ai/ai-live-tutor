'use client';

// GridView — the Array2DTracer surface: a DP table / grid / matrix that fills cell-by-cell as
// the algorithm runs (Fibonacci memo, LCS, knapsack, pathfinding grids). Driven by one trace
// step: the CURRENT cell glows orange, FILLED cells stay green, dependency HIGHLIGHT cells turn
// amber, and values accumulate from every step so far (so the table grows as the tutor speaks).
// DEPENDENCY ARROWS (the AlgoTutor-mockup signature): every proved read-cell fires an arrow
// into the cell being written — drawn from MEASURED cell positions on an SVG overlay, so they
// stay glued to the table at any size. Reads come from the compiler's value-proof, never a guess.

import { useLayoutEffect, useRef, useState } from 'react';

export function GridView({ view, step, history = [] }) {
  const wrapRef = useRef(null);
  const [arrows, setArrows] = useState([]);
  const rows = view?.rows ?? 0;
  const cols = view?.cols ?? 0;

  const s = step.array2d ?? {};
  const current = s.current ? `${s.current[0]},${s.current[1]}` : null;
  const highlightList = (s.highlight ?? []).map(([r, c]) => `${r},${c}`);

  // Measure the read->write arrows after paint; re-measure when the step moves the cells.
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !current || highlightList.length === 0) { setArrows([]); return; }
    const box = wrap.getBoundingClientRect();
    const center = (key) => {
      const el = wrap.querySelector(`[data-cell="${key}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
    };
    const to = center(current);
    if (!to) { setArrows([]); return; }
    const next = [];
    for (const key of highlightList) {
      const from = center(key);
      if (!from) continue;
      // stop the arrowhead at the target cell's edge, not its center
      const dx = to.x - from.x; const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const trim = Math.min(22, len * 0.35);
      next.push({ x1: from.x + (dx / len) * 10, y1: from.y + (dy / len) * 10, x2: to.x - (dx / len) * trim, y2: to.y - (dy / len) * trim });
    }
    setArrows(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, highlightList.join('|'), rows, cols]);

  if (!rows || !cols) return null;

  // Accumulate every value written up to and including this step -> the visible table contents.
  const valueAt = new Map();
  for (const h of history) {
    for (const [r, c, v] of h.array2d?.values ?? []) valueAt.set(`${r},${c}`, v);
  }
  const filled = new Set((s.filled ?? []).map(([r, c]) => `${r},${c}`));
  const highlight = new Set(highlightList);
  const maxCell = s.max ? `${s.max[0]},${s.max[1]}` : null; // running max/min: persistent outline (dpvis)

  const colLabels = view.colLabels ?? Array.from({ length: cols }, (_, i) => String(i));
  const rowLabels = view.rowLabels ?? (rows > 1 ? Array.from({ length: rows }, (_, i) => String(i)) : null);

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: 10 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6, fontSize: 11, fontFamily: 'ui-monospace, monospace', color: '#5a4a2a' }}>
        <span>🟧 write (now)</span>
        <span>🟨 reads (deps) → arrows</span>
        <span>🟩 filled</span>
        <span style={{ color: '#8e44ad', fontWeight: 700 }}>◎ running max</span>
        {s.rule ? (
          <span style={{ marginLeft: 'auto', padding: '1px 10px', borderRadius: 999, background: '#fdeaa7', border: '1.5px solid #c9a227', color: '#7a5d0e', fontWeight: 800 }}>
            rule: {s.rule}
          </span>
        ) : null}
      </div>
      <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
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
                const isMax = key === maxCell;
                const border = isCurrent ? '#d35400' : isHi ? '#c9a227' : isFilled ? '#27ae60' : '#e0d6c2';
                const bg = isCurrent ? '#ffd9a8' : isHi ? '#fdeaa7' : isFilled ? '#eafaf0' : '#fffcfa';
                const val = valueAt.has(key) ? String(valueAt.get(key)) : '';
                return (
                  <td
                    key={c}
                    data-cell={key}
                    style={{
                      minWidth: 40,
                      height: 38,
                      textAlign: 'center',
                      border: `2px solid ${border}`,
                      borderRadius: 6,
                      background: bg,
                      color: '#3a3327',
                      fontWeight: 700,
                      boxShadow: isCurrent
                        ? '0 0 0 4px rgba(211,84,0,0.22)'
                        : isMax
                          ? '0 0 0 3px rgba(142,68,173,0.45)' // the answer-so-far never loses its ring
                          : 'none',
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
      {arrows.length ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
          <defs>
            <marker id="depArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2980b9" />
            </marker>
          </defs>
          {arrows.map((a, i) => (
            <line key={i} x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2}
              stroke="#2980b9" strokeWidth="2.5" strokeLinecap="round" markerEnd="url(#depArrow)" opacity="0.9" />
          ))}
        </svg>
      ) : null}
      </div>
    </div>
  );
}
