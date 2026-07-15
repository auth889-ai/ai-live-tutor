// Validated chart content -> Apache ECharts option (pure, tested). User-ordered upgrade
// (live report: the hand-rolled SVG overlapped labels and cut text at the edges — layout
// collision is exactly what a mature chart engine solves). The DESIGN LAW is unchanged:
// the AI still emits the same validated contract; this mapper is a deterministic transform
// the engine owns; ECharts only draws. containLabel kills the cut-off problem; the legend
// and label layout engine kill the overlaps.

import { seriesColors } from './chart-math.js';

const WARM = { ink: '#45302A', muted: '#84685E', grid: '#F0DFD6', axis: '#5A4238', amber: '#B87F24', red: '#BC3F34' };

export function toEChartsOption(content) {
  const { xAxis, yAxis, series, annotations = [] } = content;
  const colors = seriesColors(series);

  const echSeries = series.map((s) => {
    const color = colors.get(s.id);
    if (s.style === 'scatter') {
      return {
        id: s.id,
        name: s.label,
        type: 'scatter',
        data: s.points.map((p) => ({ value: [p[0], p[1]], name: typeof p[2] === 'string' ? p[2] : undefined })),
        symbolSize: 13,
        itemStyle: { color, borderColor: '#FFFDFB', borderWidth: 1.5 },
        label: {
          show: s.points.some((p) => typeof p[2] === 'string'),
          formatter: (d) => d.name || '',
          position: 'right', fontSize: 11, color: WARM.muted,
        },
      };
    }
    const ghost = s.style === 'ghost';
    return {
      id: s.id,
      name: s.label,
      type: 'line',
      data: s.points.map((p) => [p[0], p[1]]),
      showSymbol: false,
      smooth: 0.25,
      lineStyle: {
        color,
        width: ghost ? 2.2 : 3.2,
        type: s.style === 'dashed' || ghost ? 'dashed' : 'solid',
        opacity: ghost ? 0.42 : 1,
      },
      itemStyle: { color },
      emphasis: { disabled: true },
      z: ghost ? 1 : 2,
    };
  });

  // Annotations ride on the first series (ECharts marks belong to a series).
  const markPoint = { symbol: 'circle', symbolSize: 13, data: [], label: { fontSize: 12.5, fontWeight: 700, color: '#8F2F27', position: 'top' }, itemStyle: { color: '#FFFDFB', borderColor: WARM.red, borderWidth: 3 } };
  const markLine = { symbol: 'none', animation: false, data: [], lineStyle: { color: WARM.muted, type: 'dashed', width: 1.4 }, label: { fontSize: 12, color: WARM.axis } };
  const markArea = { silent: true, data: [], itemStyle: { color: WARM.amber, opacity: 0.10 }, label: { fontSize: 12.5, fontWeight: 650, color: '#8A6021', position: 'top' } };
  const arrows = [];

  for (const a of annotations) {
    if (a.type === 'point') markPoint.data.push({ coord: [a.x, a.y], name: a.label, value: a.label });
    if (a.type === 'vline') markLine.data.push({ xAxis: a.x, name: a.label ?? '', label: { formatter: a.label ?? '' } });
    if (a.type === 'hline') markLine.data.push({ yAxis: a.y, name: a.label ?? '', label: { formatter: a.label ?? '' } });
    if (a.type === 'region') markArea.data.push([{ xAxis: a.x1, name: a.label ?? '' }, { xAxis: a.x2 }]);
    if (a.type === 'arrow') {
      arrows.push([
        { coord: [a.from[0], a.from[1]] },
        { coord: [a.to[0], a.to[1]], name: a.label ?? '', label: { formatter: a.label ?? '', fontSize: 13, fontWeight: 700, color: '#8A6021', position: 'middle' } },
      ]);
    }
  }
  if (echSeries[0]) {
    if (markPoint.data.length) echSeries[0].markPoint = markPoint;
    if (markLine.data.length || arrows.length) {
      echSeries[0].markLine = {
        ...markLine,
        data: [...markLine.data, ...arrows],
      };
      if (arrows.length) {
        // arrows want a visible head; ECharts uses symbol per data item — set on the pairs
        for (const pair of echSeries[0].markLine.data) {
          if (Array.isArray(pair)) {
            pair[1].symbol = 'arrow';
            pair[1].symbolSize = 11;
            pair[1].lineStyle = { color: WARM.amber, width: 2.6, type: 'solid' };
          }
        }
      }
    }
    if (markArea.data.length) echSeries[0].markArea = markArea;
  }

  return {
    animationDuration: 400,
    legend: {
      show: series.length > 1,
      top: 4,
      textStyle: { color: WARM.ink, fontSize: 13 },
      icon: 'roundRect', itemWidth: 18, itemHeight: 4,
    },
    // containLabel is THE fix for cut-off axis labels (the live-reported bug).
    grid: { left: 14, right: 22, top: series.length > 1 ? 40 : 22, bottom: 12, containLabel: true },
    xAxis: {
      type: 'value', name: xAxis.label, nameLocation: 'middle', nameGap: 28,
      min: xAxis.min, max: xAxis.max,
      nameTextStyle: { color: WARM.ink, fontSize: 14, fontWeight: 650 },
      axisLine: { lineStyle: { color: WARM.axis } },
      axisLabel: { color: WARM.muted, fontSize: 12.5, hideOverlap: true },
      splitLine: { lineStyle: { color: WARM.grid } },
    },
    yAxis: {
      type: 'value', name: yAxis.label, nameLocation: 'middle', nameGap: 40,
      min: yAxis.min, max: yAxis.max,
      nameTextStyle: { color: WARM.ink, fontSize: 14, fontWeight: 650 },
      axisLine: { lineStyle: { color: WARM.axis } },
      axisLabel: { color: WARM.muted, fontSize: 12.5, hideOverlap: true },
      splitLine: { lineStyle: { color: WARM.grid } },
    },
    series: echSeries,
  };
}
