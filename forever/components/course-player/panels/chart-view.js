'use client';

// ChartView — the hand-rolled curve renderer (one job: draw a validated chart content
// object). Built because Mermaid xychart cannot teach curves: no legend, no point markers,
// no ghost curves, zero-baseline bugs. Pure SVG on the warm palette; geometry from
// chart-math; colors deterministic (ghost/new variants of one curve share a hue, so a
// demand SHIFT reads as one curve moving, not two unrelated lines — the MRU move).

import { makeScale, niceTicks, seriesColors } from '../../../lib/board/charts/chart-math.js';

const W = 720;
const H = 430;
const M = { top: 26, right: 24, bottom: 58, left: 68 };

export function ChartView({ content }) {
  const { xAxis, yAxis, series, annotations = [] } = content;
  const sx = makeScale([xAxis.min, xAxis.max], [M.left, W - M.right]);
  const sy = makeScale([yAxis.min, yAxis.max], [H - M.bottom, M.top]);
  const colors = seriesColors(series);
  const xTicks = niceTicks(xAxis.min, xAxis.max);
  const yTicks = niceTicks(yAxis.min, yAxis.max);

  return (
    <div style={{
      maxWidth: 760, margin: '0 auto', background: 'var(--surface, #FFFDFB)',
      border: '1px solid var(--border, #EBD6CB)', borderRadius: 16, padding: '18px 14px 8px',
      boxShadow: 'var(--card-shadow, 0 2px 8px rgba(190,120,100,.12))',
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Chart: ${yAxis.label} vs ${xAxis.label}`}>
        <defs>
          <marker id="chart-arrowhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#B87F24" />
          </marker>
        </defs>

        {/* gridlines + ticks */}
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} stroke="#F0DFD6" strokeWidth="1" />
            <text x={M.left - 9} y={sy(t) + 4} textAnchor="end" fontSize="12.5" fill="#84685E" fontVariant="tabular-nums">{t}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} x2={sx(t)} y1={H - M.bottom} y2={H - M.bottom + 5} stroke="#C9AC9E" strokeWidth="1" />
            <text x={sx(t)} y={H - M.bottom + 21} textAnchor="middle" fontSize="12.5" fill="#84685E" fontVariant="tabular-nums">{t}</text>
          </g>
        ))}

        {/* regions (shortage/surplus bands) sit under the curves */}
        {annotations.filter((a) => a.type === 'region').map((a, i) => (
          <g key={`region${i}`}>
            <rect x={sx(a.x1)} y={M.top} width={sx(a.x2) - sx(a.x1)} height={H - M.bottom - M.top} fill="#B87F24" opacity="0.10" />
            {a.label && <text x={(sx(a.x1) + sx(a.x2)) / 2} y={M.top + 16} textAnchor="middle" fontSize="12.5" fontWeight="650" fill="#8A6021">{a.label}</text>}
          </g>
        ))}

        {/* axes */}
        <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="#5A4238" strokeWidth="1.5" />
        <line x1={M.left} x2={M.left} y1={M.top} y2={H - M.bottom} stroke="#5A4238" strokeWidth="1.5" />
        <text x={(M.left + W - M.right) / 2} y={H - 14} textAnchor="middle" fontSize="14" fontWeight="650" fill="#45302A">{xAxis.label}</text>
        <text x={17} y={(M.top + H - M.bottom) / 2} textAnchor="middle" fontSize="14" fontWeight="650" fill="#45302A" transform={`rotate(-90 17 ${(M.top + H - M.bottom) / 2})`}>{yAxis.label}</text>

        {/* guide lines */}
        {annotations.filter((a) => a.type === 'vline').map((a, i) => (
          <g key={`v${i}`}>
            <line x1={sx(a.x)} x2={sx(a.x)} y1={M.top} y2={H - M.bottom} stroke="#84685E" strokeWidth="1.2" strokeDasharray="5 4" />
            {a.label && <text x={sx(a.x) + 5} y={M.top + 14} fontSize="12.5" fill="#5A4238">{a.label}</text>}
          </g>
        ))}
        {annotations.filter((a) => a.type === 'hline').map((a, i) => (
          <g key={`h${i}`}>
            <line x1={M.left} x2={W - M.right} y1={sy(a.y)} y2={sy(a.y)} stroke="#84685E" strokeWidth="1.2" strokeDasharray="5 4" />
            {a.label && <text x={M.left + 6} y={sy(a.y) - 6} fontSize="12.5" fill="#5A4238">{a.label}</text>}
          </g>
        ))}

        {/* curves */}
        {series.map((s) => {
          const d = s.points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join(' ');
          const ghost = s.style === 'ghost';
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={colors.get(s.id)}
              strokeWidth={ghost ? 2.2 : 3}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.style === 'dashed' || ghost ? '7 6' : undefined}
              opacity={ghost ? 0.42 : 1}
            />
          );
        })}

        {/* shift arrows ride above the curves */}
        {annotations.filter((a) => a.type === 'arrow').map((a, i) => (
          <g key={`arrow${i}`}>
            <line x1={sx(a.from[0])} y1={sy(a.from[1])} x2={sx(a.to[0])} y2={sy(a.to[1])} stroke="#B87F24" strokeWidth="2.6" markerEnd="url(#chart-arrowhead)" />
            {a.label && <text x={(sx(a.from[0]) + sx(a.to[0])) / 2 + 6} y={(sy(a.from[1]) + sy(a.to[1])) / 2 - 7} fontSize="13" fontWeight="700" fill="#8A6021">{a.label}</text>}
          </g>
        ))}

        {/* marked points (equilibria) */}
        {annotations.filter((a) => a.type === 'point').map((a, i) => (
          <g key={`pt${i}`}>
            <circle cx={sx(a.x)} cy={sy(a.y)} r="6.5" fill="#FFFDFB" stroke="#BC3F34" strokeWidth="3" />
            <text x={sx(a.x) + 11} y={sy(a.y) - 9} fontSize="13" fontWeight="700" fill="#8F2F27">{a.label}</text>
          </g>
        ))}
      </svg>

      {/* legend — the thing xychart could never do */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px 18px', justifyContent: 'center', padding: '10px 8px 8px' }}>
        {series.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-body, #45302A)', opacity: s.style === 'ghost' ? 0.6 : 1 }}>
            <svg width="26" height="8" aria-hidden>
              <line x1="1" x2="25" y1="4" y2="4" stroke={seriesColors(series).get(s.id)} strokeWidth="3"
                strokeDasharray={s.style === 'dashed' || s.style === 'ghost' ? '6 5' : undefined} opacity={s.style === 'ghost' ? 0.5 : 1} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
