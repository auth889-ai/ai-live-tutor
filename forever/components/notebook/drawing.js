'use client';

// INK ENGINE (Xournal++ #1 + #2, web-sized): pen / highlighter / eraser, colors, widths,
// undo, and paper types (blank / ruled / grid) — strokes stored as NORMALIZED vectors
// (0..1 coordinates, the Xournal law: never a flattened PNG), so drawings re-render crisp
// at any size and stay editable data. Plain SVG + pointer events; no canvas library.

import { useRef, useState } from 'react';

const W = 1000;
const H = 620;
const COLORS = ['#211A14', '#e8604c', '#2f7d4a', '#4477aa', '#c98f2d'];

export function paperDefs(paper, key = 'p') {
  if (paper === 'ruled') {
    return (
      <pattern id={key} width={W} height={34} patternUnits="userSpaceOnUse">
        <line x1="0" y1="33" x2={W} y2="33" stroke="#EBE3D8" strokeWidth="1.4" />
      </pattern>
    );
  }
  if (paper === 'grid') {
    return (
      <pattern id={key} width={34} height={34} patternUnits="userSpaceOnUse">
        <path d={`M 34 0 L 0 0 0 34`} fill="none" stroke="#EDE6DB" strokeWidth="1.2" />
      </pattern>
    );
  }
  return null;
}

export function SvgDrawing({ data, maxHeight = 420 }) {
  let parsed;
  try { parsed = JSON.parse(data); } catch { return null; }
  const strokes = parsed?.strokes ?? [];
  const paper = parsed?.paper ?? 'blank';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight, display: 'block', background: '#FFFEFB', borderRadius: 10, border: '1px solid #EBE3D8' }}>
      {paper !== 'blank' ? <>
        <defs>{paperDefs(paper, `pp-${paper}`)}</defs>
        <rect width={W} height={H} fill={`url(#pp-${paper})`} />
      </> : null}
      {strokes.map((st, i) => (
        <polyline key={i}
          points={st.points.map((v, j) => (j % 2 === 0 ? v * W : v * H).toFixed(1)).join(' ').replace(/(\S+) (\S+) ?/g, '$1,$2 ')}
          fill="none" stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round"
          opacity={st.tool === 'highlighter' ? 0.35 : 1} />
      ))}
    </svg>
  );
}

export function DrawingEditor({ initial = null, onSave, onCancel }) {
  const init = (() => { try { return JSON.parse(initial); } catch { return null; } })();
  const [strokes, setStrokes] = useState(init?.strokes ?? []);
  const [paper, setPaper] = useState(init?.paper ?? 'ruled');
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const svgRef = useRef(null);
  const drawing = useRef(false);

  const pos = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e) => {
    e.preventDefault();
    const [x, y] = pos(e);
    if (tool === 'eraser') {
      // stroke eraser (Xournal's default): remove the nearest stroke under the pointer
      setStrokes((cur) => cur.filter((st) => !st.points.some((v, j) => j % 2 === 0 && Math.hypot(st.points[j] - x, st.points[j + 1] - y) < 0.03)));
      return;
    }
    drawing.current = true;
    setStrokes((cur) => [...cur, { tool, color, width: tool === 'highlighter' ? width * 4 : width, points: [x, y] }]);
  };
  const move = (e) => {
    if (!drawing.current) return;
    const [x, y] = pos(e);
    setStrokes((cur) => {
      const next = [...cur];
      const last = next[next.length - 1];
      if (!last) return cur;
      next[next.length - 1] = { ...last, points: [...last.points, x, y] };
      return next;
    });
  };
  const up = () => { drawing.current = false; };

  const chip = (on) => ({ border: on ? '1.5px solid #e8604c' : '1px solid #EBE3D8', borderRadius: 8, background: on ? '#FDF0EE' : '#fff', color: '#211A14', padding: '4px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
  return (
    <div style={{ border: '1.5px solid #EBD9C4', borderRadius: 14, background: '#FDFAF3', padding: 12, margin: '10px 0' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={() => setTool('pen')} style={chip(tool === 'pen')}>✒️ pen</button>
        <button onClick={() => setTool('highlighter')} style={chip(tool === 'highlighter')}>🖍 highlighter</button>
        <button onClick={() => setTool('eraser')} style={chip(tool === 'eraser')}>⌫ eraser</button>
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #fff' : '2px solid transparent', outline: color === c ? `2px solid ${c}` : 'none', cursor: 'pointer' }} />
        ))}
        <input type="range" min="1" max="8" value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ width: 70, accentColor: '#e8604c' }} />
        <span style={{ display: 'inline-flex', gap: 4, marginLeft: 'auto' }}>
          {['blank', 'ruled', 'grid'].map((pp) => <button key={pp} onClick={() => setPaper(pp)} style={chip(paper === pp)}>{pp}</button>)}
        </span>
        <button onClick={() => setStrokes((cur) => cur.slice(0, -1))} style={chip(false)}>↶ undo</button>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', touchAction: 'none', cursor: 'crosshair', background: '#FFFEFB', borderRadius: 10, border: '1px solid #EBE3D8' }}>
        {paper !== 'blank' ? <>
          <defs>{paperDefs(paper, `pe-${paper}`)}</defs>
          <rect width={W} height={H} fill={`url(#pe-${paper})`} />
        </> : null}
        {strokes.map((st, i) => (
          <polyline key={i}
            points={st.points.map((v, j) => (j % 2 === 0 ? v * W : v * H).toFixed(1)).join(' ').replace(/(\S+) (\S+) ?/g, '$1,$2 ')}
            fill="none" stroke={st.color} strokeWidth={st.width} strokeLinecap="round" strokeLinejoin="round"
            opacity={st.tool === 'highlighter' ? 0.35 : 1} />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => onSave(JSON.stringify({ strokes, paper }))} disabled={strokes.length === 0}
          style={{ border: 'none', borderRadius: 999, background: strokes.length ? '#1E9A61' : '#CFE0D2', color: '#fff', padding: '7px 18px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>✓ save drawing</button>
        <button onClick={onCancel} style={{ border: 'none', background: 'transparent', color: '#77695B', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>cancel</button>
      </div>
    </div>
  );
}
