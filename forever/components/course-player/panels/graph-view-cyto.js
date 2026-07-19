'use client';

// GRAPH VIEW (Cytoscape) — the interactive relationship map used across Networking (AS paths,
// topology), History (people/places/events), Law (citation networks), and Agents/RAG (chunk/
// tool graphs). The student drags nodes, follows edges, explores structure. content is nodes +
// edges the model/engine produced (real RIPEstat prefixes, real citations) — never invented.
//
// content: { nodes: [{ id, label, group? }], edges: [{ source, target, label? }], title, directed? }

import { useEffect, useRef } from 'react';

const PALETTE = ['#2b7a3f', '#b06a2e', '#3a6ea5', '#8a3a8a', '#c0522d', '#4a7c59'];

export function GraphViewCyto({ content }) {
  const hostRef = useRef(null);
  const cyRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      const cytoscape = (await import('cytoscape')).default;
      if (disposed || !hostRef.current) return;
      const groups = [...new Set((content?.nodes ?? []).map((n) => n.group ?? 'x'))];
      const cy = cytoscape({
        container: hostRef.current,
        elements: [
          ...(content?.nodes ?? []).map((n) => ({ data: { id: String(n.id), label: n.label ?? String(n.id), g: n.group ?? 'x' } })),
          ...(content?.edges ?? []).map((e, i) => ({ data: { id: `e${i}`, source: String(e.source), target: String(e.target), label: e.label ?? '' } })),
        ],
        style: [
          { selector: 'node', style: { 'background-color': (ele) => PALETTE[groups.indexOf(ele.data('g')) % PALETTE.length], label: 'data(label)', color: '#2b2320', 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 90, 'text-valign': 'bottom', 'text-margin-y': 3, width: 26, height: 26 } },
          { selector: 'edge', style: { width: 1.5, 'line-color': '#c9bda1', 'target-arrow-color': '#c9bda1', 'target-arrow-shape': content?.directed ? 'triangle' : 'none', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 9, color: '#8a7d76' } },
        ],
        layout: { name: 'cose', animate: false, padding: 20 },
      });
      cyRef.current = cy;
    })();
    return () => { disposed = true; try { cyRef.current?.destroy(); } catch { /* gone */ } };
  }, [content]);

  if (!content?.nodes?.length) return null;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2320)', marginBottom: 4 }}>{content.title}</div>}
      <div ref={hostRef} style={{ width: '100%', height: 380, borderRadius: 12, border: '1px solid var(--border, #eadfd8)', background: '#fffdfb' }} />
      <div style={{ fontSize: 11, color: 'var(--ink-muted, #8a7d76)', marginTop: 6 }}>Drag nodes to explore the relationships.{content?.source ? ` · ${content.source}` : ''}</div>
    </div>
  );
}
