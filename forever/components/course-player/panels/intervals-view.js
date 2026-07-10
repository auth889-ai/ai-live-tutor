'use client';

// NUMBER-LINE intervals view (researched: hellointerview/AlgoMaster/NeetCode all teach interval
// problems by drawing sorted bars on a shared number line and watching overlaps fuse into
// islands). Top lanes: the sorted input bars — processed green, current coral, future hollow.
// Bottom lane: the merged islands growing, the last one flashing when it just changed.

import { memo } from 'react';

const W = 760;
const BAR_H = 22;
const LANE_GAP = 8;

function assignLanes(intervals) {
  const laneEnds = [];
  return intervals.map(([s, e]) => {
    let lane = laneEnds.findIndex((end) => end < s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    return lane;
  });
}

export const IntervalsView = memo(function IntervalsView({ content, activeStep = 0 }) {
  const input = content?.intervals ?? [];
  const trace = content?.trace ?? [];
  if (!input.length) return <div style={{ color: '#c0392b', fontSize: 13 }}>intervals unavailable</div>;
  const step = trace[Math.max(0, Math.min(trace.length - 1, activeStep))] ?? {};
  const merged = step.merged ?? [];
  const currentIdx = step.current;

  const all = [...input, ...merged];
  const min = Math.min(...all.map((iv) => iv[0]));
  const max = Math.max(...all.map((iv) => iv[1]));
  const span = Math.max(1, max - min);
  const x = (v) => 40 + ((v - min) / span) * (W - 80);

  const lanes = assignLanes(input);
  const laneCount = Math.max(...lanes) + 1;
  const inputTop = 26;
  const mergedTop = inputTop + laneCount * (BAR_H + LANE_GAP) + 34;
  const height = mergedTop + BAR_H + 40;

  const ticks = [];
  const stepSize = span <= 24 ? 1 : Math.ceil(span / 12);
  for (let t = min; t <= max; t += stepSize) ticks.push(t);

  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 12, background: '#fffcfa', padding: '10px 6px', overflowX: 'auto' }}>
      <style>{'@keyframes ivFuse { from { transform: scaleY(0.5); opacity: 0.4; } to { transform: scaleY(1); opacity: 1; } }'}</style>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', minWidth: 560, display: 'block' }}>
        <text x={40} y={14} fontSize={11} fontWeight={800} fill="#8a6d3b" fontFamily="ui-monospace, monospace">input (sorted)</text>
        {input.map(([s, e], i) => {
          const processed = currentIdx != null ? i < currentIdx : merged.length > 0 && trace.indexOf(step) === trace.length - 1;
          const isCur = i === currentIdx;
          const y = inputTop + lanes[i] * (BAR_H + LANE_GAP);
          const fill = isCur ? '#e8604c' : processed ? '#2f9e5f' : '#fffdf9';
          const stroke = isCur ? '#b93c2b' : processed ? '#20794a' : '#c9beac';
          const fg = isCur || processed ? '#fff' : '#8a8172';
          return (
            <g key={`in-${i}`}>
              <rect x={x(s)} y={y} width={Math.max(10, x(e) - x(s))} height={BAR_H} rx={7} fill={fill} stroke={stroke} strokeWidth={2.5} />
              <text x={(x(s) + x(e)) / 2} y={y + BAR_H / 2 + 4} fontSize={11.5} fontWeight={800} fill={fg} textAnchor="middle" fontFamily="ui-monospace, monospace">
                [{s},{e}]
              </text>
            </g>
          );
        })}
        <text x={40} y={mergedTop - 10} fontSize={11} fontWeight={800} fill="#8a6d3b" fontFamily="ui-monospace, monospace">merged islands</text>
        {merged.map(([s, e], i) => (
          <g key={`m-${i}`} style={i === merged.length - 1 ? { animation: 'ivFuse 0.35s ease-out', transformOrigin: 'center' } : undefined}>
            <rect x={x(s)} y={mergedTop} width={Math.max(10, x(e) - x(s))} height={BAR_H} rx={7} fill="#3f7fbf" stroke="#2b5c8f" strokeWidth={2.5} />
            <text x={(x(s) + x(e)) / 2} y={mergedTop + BAR_H / 2 + 4} fontSize={11.5} fontWeight={800} fill="#fff" textAnchor="middle" fontFamily="ui-monospace, monospace">
              [{s},{e}]
            </text>
          </g>
        ))}
        <line x1={40} y1={height - 22} x2={W - 40} y2={height - 22} stroke="#c9beac" strokeWidth={2} />
        {ticks.map((t) => (
          <g key={`t-${t}`}>
            <line x1={x(t)} y1={height - 26} x2={x(t)} y2={height - 18} stroke="#c9beac" strokeWidth={2} />
            <text x={x(t)} y={height - 6} fontSize={10} fill="#8a6d3b" textAnchor="middle" fontFamily="ui-monospace, monospace">{t}</text>
          </g>
        ))}
      </svg>
    </div>
  );
});
