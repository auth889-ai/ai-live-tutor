'use client';

// ML LOSS EXPLORER — the interactive "manipulate it" for Machine Learning: the student moves
// the learning-rate and epochs sliders and watches REAL gradient descent redraw the loss curve
// live. The descent runs in pure JS here (same semantics as the server train-evidence engine:
// linear model, MSE, deterministic) so the student sees convergence, and DIVERGENCE when the
// learning rate is too high — the lesson's warning made touchable, not narrated.
//
// content: { dataset: {columns, rows}, title }  — rows are [x, y] pairs.

import { useEffect, useMemo, useRef, useState } from 'react';

function trainLoss(rows, lr, epochs) {
  const xs = rows.map((r) => Number(r[0]));
  const ys = rows.map((r) => Number(r[1]));
  const n = rows.length;
  let w = 0, b = 0;
  const losses = [];
  for (let e = 1; e <= epochs; e += 1) {
    let gw = 0, gb = 0;
    for (let i = 0; i < n; i += 1) { const err = w * xs[i] + b - ys[i]; gw += 2 * err * xs[i]; gb += 2 * err; }
    w -= lr * (gw / n); b -= lr * (gb / n);
    let mse = 0; for (let i = 0; i < n; i += 1) { const err = w * xs[i] + b - ys[i]; mse += err * err; }
    mse /= n;
    losses.push(Number.isFinite(mse) ? Math.min(mse, 1e12) : 1e12); // cap so divergence still plots
  }
  return { losses, w, b, diverged: !Number.isFinite(w) || losses.at(-1) > losses[0] };
}

export function MLLossExplorer({ content }) {
  const rows = content?.dataset?.rows ?? [];
  const [lr, setLr] = useState(0.01);
  const [epochs, setEpochs] = useState(80);
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const run = useMemo(() => (rows.length ? trainLoss(rows, lr, epochs) : null), [rows, lr, epochs]);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const echarts = await import('echarts');
      if (disposed || !hostRef.current || !run) return;
      const chart = chartRef.current ?? echarts.init(hostRef.current);
      chartRef.current = chart;
      chart.setOption({
        title: { text: run.diverged ? 'Loss (DIVERGING — learning rate too high)' : 'Loss per epoch (live gradient descent)', textStyle: { fontSize: 13, fontWeight: 700, color: run.diverged ? '#c0522d' : '#2b2320' } },
        tooltip: { trigger: 'axis' },
        grid: { left: 56, right: 20, bottom: 30, top: 40 },
        xAxis: { type: 'category', data: run.losses.map((_, i) => i + 1), name: 'epoch' },
        yAxis: { type: 'value', name: 'MSE', scale: true },
        series: [{ type: 'line', data: run.losses.map((v) => Math.round(v * 100) / 100), smooth: true, showSymbol: false, lineStyle: { color: run.diverged ? '#c0522d' : '#2b7a3f' } }],
      });
    })();
    return () => { disposed = true; };
  }, [run]);

  useEffect(() => () => { try { chartRef.current?.dispose(); } catch { /* gone */ } }, []);

  if (!rows.length) return null;

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2320)', marginBottom: 8 }}>{content.title}</div>}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 10 }}>
        <label style={{ fontSize: 12.5, color: 'var(--ink, #2b2320)' }}>
          learning rate: <b>{lr}</b>
          <input type="range" min={0.001} max={0.5} step={0.001} value={lr} onChange={(e) => setLr(Number(e.target.value))} style={{ display: 'block', width: 200 }} />
        </label>
        <label style={{ fontSize: 12.5, color: 'var(--ink, #2b2320)' }}>
          epochs: <b>{epochs}</b>
          <input type="range" min={10} max={300} step={10} value={epochs} onChange={(e) => setEpochs(Number(e.target.value))} style={{ display: 'block', width: 200 }} />
        </label>
      </div>
      <div ref={hostRef} style={{ width: '100%', height: 320 }} />
      <div style={{ fontSize: 11.5, color: run?.diverged ? '#c0522d' : 'var(--ink-muted, #8a7d76)', marginTop: 6 }}>
        {run?.diverged ? 'Push the learning rate up and the loss EXPLODES — this is why the rate matters.' : `Converged toward w=${Math.round(run.w * 100) / 100}. Move the sliders and predict what happens.`}
      </div>
    </div>
  );
}
