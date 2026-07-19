'use client';

// LIVE CHART VIEW — ECharts rendering of REAL data (economics FRED series, any measured
// time-series the evidence engines produced). The student sees actual GDP/inflation/
// unemployment curves, not a stylized textbook sketch. content is engine/API data, never
// numbers the model made up.
//
// content: { title, xData: [labels], series: [{ name, data: [numbers], type? }], yName? }

import { useEffect, useRef } from 'react';

export function LiveChartView({ content }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const echarts = await import('echarts');
      if (disposed || !hostRef.current) return;
      const chart = echarts.init(hostRef.current, null, { renderer: 'canvas' });
      chartRef.current = chart;
      const series = (content?.series ?? []).map((s) => ({
        name: s.name, type: s.type ?? 'line', data: s.data ?? [], smooth: true, showSymbol: false,
      }));
      chart.setOption({
        title: content?.title ? { text: content.title, textStyle: { fontSize: 14, fontWeight: 700 } } : undefined,
        tooltip: { trigger: 'axis' },
        legend: series.length > 1 ? { top: content?.title ? 24 : 0 } : undefined,
        grid: { left: 48, right: 20, bottom: 36, top: series.length > 1 ? 56 : 40 },
        xAxis: { type: 'category', data: content?.xData ?? [], boundaryGap: false },
        yAxis: { type: 'value', name: content?.yName ?? '' },
        series,
      });
      const onResize = () => chart.resize();
      window.addEventListener('resize', onResize);
      chart._onResize = onResize;
    })();
    return () => {
      disposed = true;
      const c = chartRef.current;
      if (c) { if (c._onResize) window.removeEventListener('resize', c._onResize); c.dispose(); }
    };
  }, [content]);

  if (!content?.series?.length) return null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>
      <div ref={hostRef} style={{ width: '100%', height: 360 }} />
      {content?.source && (
        <div style={{ fontSize: 11, color: 'var(--ink-muted, #8a7d76)', marginTop: 4, textAlign: 'right' }}>
          Source: {content.source} — real measured data.
        </div>
      )}
    </div>
  );
}
