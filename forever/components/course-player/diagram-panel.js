'use client';

// Real diagram rendering (the fix for cramped/overlapping SVG diagrams): flowchart/cycle/
// tree render via Mermaid (auto-layout, readable); comparison renders as a proper HTML
// table (auto cell-sizing + wrapping). Content is static, so we render once — the clock
// only controls WHEN the panel appears (via the parent gating on the write action).

import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

import { toMermaid } from '../../lib/board/diagrams/to-mermaid.js';

mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict', flowchart: { htmlLabels: true, curve: 'basis' } });

export function DiagramPanel({ content }) {
  if (content.diagramType === 'comparison') return <ComparisonTable content={content} />;
  return <MermaidDiagram content={content} />;
}

function MermaidDiagram({ content }) {
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

  if (error) return <div style={{ color: '#c0392b', fontSize: 13 }}>diagram unavailable</div>;
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
