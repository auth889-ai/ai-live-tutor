'use client';

// ChartView — professional chart rendering via Apache ECharts (user-ordered upgrade after the
// hand-rolled SVG shipped overlapping labels and edge-cut text; a mature layout engine solves
// collisions we were solving by hand). The contract is UNCHANGED: this renders the same
// validated chart content the AI has always emitted — the deterministic content->option
// transform lives in lib/board/charts/echarts-option.js (pure, tested); ECharts only draws.
// Same warm palette; ghost/dashed/scatter/annotations all preserved.

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

import { toEChartsOption } from '../../../lib/board/charts/echarts-option.js';

export function ChartView({ content }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const chart = chartRef.current ?? echarts.init(hostRef.current);
    chartRef.current = chart;
    chart.setOption(toEChartsOption(content), { notMerge: true });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [content]);

  useEffect(() => () => {
    chartRef.current?.dispose();
    chartRef.current = null;
  }, []);

  return (
    <div style={{
      maxWidth: 760, margin: '0 auto', background: 'var(--surface, #FFFDFB)',
      border: '1px solid var(--border, #EBD6CB)', borderRadius: 16, padding: '10px 6px 4px',
      boxShadow: 'var(--card-shadow, 0 2px 8px rgba(190,120,100,.12))',
    }}>
      <div
        ref={hostRef}
        role="img"
        aria-label={`Chart: ${content.yAxis.label} vs ${content.xAxis.label}`}
        style={{ width: '100%', height: 430 }}
      />
    </div>
  );
}
