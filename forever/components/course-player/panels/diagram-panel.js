'use client';

// Real diagram rendering (the fix for cramped/overlapping SVG diagrams): flowchart/cycle/
// tree render via Mermaid (auto-layout, readable); comparison renders as a proper HTML
// table (auto cell-sizing + wrapping). Content is static, so we render once — the clock
// only controls WHEN the panel appears (via the parent gating on the write action).

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

import { toMermaid } from '../../../lib/board/diagrams/to-mermaid.js';
import { GraphView } from './graph-view.js';
import { ArrayView } from './array-view.js';

// Hand-drawn look (Mermaid v11, rough.js under the hood): evidence-backed teacherly feel
// (Wood et al. 2012 — sketchy rendering raises engagement + invites annotation). Fixed
// seed keeps re-renders stable so the board never flickers between shapes.
mermaid.initialize({ startOnLoad: false, look: 'handDrawn', handDrawnSeed: 7, theme: 'neutral', securityLevel: 'strict', flowchart: { htmlLabels: true, curve: 'basis' } });

export function DiagramPanel({ content, progress = 1, activeNode = null, activeStep = null }) {
  if (content.diagramType === 'comparison') return <ComparisonTable content={content} />;
  if (content.diagramType === 'trace') return <TraceTable content={content} />;
  if (content.diagramType === 'array') return <ArrayView content={content} progress={progress} activeStep={activeStep} />; // array dry-run (binary search / two-pointer)
  if (content.diagramType === 'graph') return <GraphView content={content} progress={progress} activeNode={activeNode} activeStep={activeStep} />; // React Flow + dagre (+ voice-synced trace)
  return <MermaidDiagram content={content} progress={progress} />;
}

// Step-by-step variable trace (the Striver dry-run) from REAL execution.
function TraceTable({ content }) {
  const columns = content.columns ?? [];
  const rows = content.rows ?? [];
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8' }}>
      <div style={{ padding: '6px 12px', fontSize: 12, color: '#8a6d3b', background: '#fdeaa7', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        Dry run — variables at each step (real execution)
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14, fontFamily: 'ui-monospace, monospace' }}>
        <thead>
          <tr>
            <th style={cell(true)}>Step</th>
            {columns.map((col) => (
              <th key={col} style={cell(true)}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ ...cell(false), color: '#8a6d3b' }}>{row.label}</td>
              {row.values.map((value, i) => (
                <td key={i} style={cell(false)}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MermaidDiagram({ content, progress = 1 }) {
  const ref = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const syntax = toMermaid(content);
      const id = `m${Math.abs(hash(syntax))}`;
      mermaid
        .render(id, syntax)
        .then(({ svg }) => {
          if (!cancelled && ref.current) ref.current.innerHTML = svg;
        })
        .catch((e) => !cancelled && setError(e.message));
    } catch (e) {
      setError(e.message);
    }
    return () => {
      cancelled = true;
    };
  }, [content]);

  // DRAW-ON ENGINE (research: Fiorella & Mayer 2016 — watching drawing beats static, but
  // ONLY with a visible pen). Clock-driven, therefore seekable: each SVG stroke reveals via
  // stroke-dashoffset staggered across the diagram by the object's write progress, text pops
  // as its group finishes, and a pen dot rides the tip of the stroke being drawn NOW.
  useEffect(() => {
    const svg = ref.current?.querySelector('svg');
    if (!svg) return;
    const strokes = Array.from(svg.querySelectorAll('path, line, polyline, polygon, circle, ellipse, rect'))
      .filter((el) => el.getTotalLength ? true : false);
    const texts = Array.from(svg.querySelectorAll('text, foreignObject'));
    const n = strokes.length;
    if (!n) return;

    let pen = svg.querySelector('#forever-pen');
    if (!pen) {
      pen = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pen.setAttribute('id', 'forever-pen');
      pen.setAttribute('r', '5');
      pen.setAttribute('fill', '#e8604c');
      svg.appendChild(pen);
    }

    const span = 1 / n; // each stroke owns an equal slice of the reveal window
    let penPlaced = false;
    strokes.forEach((el, i) => {
      let length = 0;
      try { length = el.getTotalLength(); } catch { /* unmeasurable element */ }
      if (!length) return;
      const local = Math.max(0, Math.min(1, (progress - i * span) / span));
      el.style.strokeDasharray = `${length}`;
      el.style.strokeDashoffset = `${length * (1 - local)}`;
      if (!penPlaced && local > 0 && local < 1) {
        try {
          const tip = el.getPointAtLength(length * local);
          pen.setAttribute('cx', tip.x);
          pen.setAttribute('cy', tip.y);
          pen.setAttribute('opacity', '1');
          penPlaced = true;
        } catch { /* no tip for this element */ }
      }
    });
    if (!penPlaced) pen.setAttribute('opacity', '0'); // finished (or not started): pen down

    // Text appears once the surrounding strokes are underway (clip-wipe is stroke-only).
    texts.forEach((el, i) => {
      const local = (progress - (i / Math.max(texts.length, 1)) * 0.8) * 3;
      el.style.opacity = `${Math.max(0, Math.min(1, local))}`;
    });
  }, [progress, content]);

  if (error) {
    // Never show a raw engine error on the board: fall back to the diagram's own text as
    // structured notes so the teaching content survives a bad render.
    const lines = String(content.code ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|mindmap|timeline)/.test(l)).slice(0, 8);
    return (
      <div style={{ background: '#fffdf8', borderRadius: 12, border: '1px solid #e8ddc9', padding: '14px 18px', fontSize: 14.5, lineHeight: 1.7, color: '#3a2e22' }}>
        {lines.length ? lines.map((l, i) => <div key={i}>• {l.replace(/[-=]{2,}>?|[[\]{}()"]/g, ' ').trim()}</div>) : 'Diagram unavailable for this step.'}
      </div>
    );
  }
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', padding: 12, background: '#fffdf8', borderRadius: 12, border: '1px solid #e8ddc9' }} />;
}

function ComparisonTable({ content }) {
  const columns = content.columns ?? [];
  const rows = content.rows ?? [];
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #e8ddc9', borderRadius: 12, background: '#fffdf8' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 14 }}>
        <thead>
          <tr>
            <th style={cell(true)} />
            {columns.map((col) => (
              <th key={col} style={cell(true)}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={{ ...cell(false), fontWeight: 600 }}>{row.label}</td>
              {(row.values ?? []).map((value, i) => (
                <td key={i} style={cell(false)}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cell(header) {
  return {
    border: '1px solid #e8ddc9',
    padding: '8px 12px',
    textAlign: 'left',
    verticalAlign: 'top',
    background: header ? '#fdeaa7' : 'transparent',
    fontWeight: header ? 700 : 400,
    maxWidth: 260,
  };
}

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return h;
}
