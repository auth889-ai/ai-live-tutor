'use client';

// INK EDITOR — the interactive DrawingEditor (tools, layers, lasso selection).
// Feature-to-Xournal++-source map: see components/notebook/drawing.js

import { useEffect, useRef, useState } from 'react';

import { W, H, itemInLasso, selectionBounds, moveItem, scaleItem, rotateItem } from '../../../lib/notebook/ink-geometry.js';
import { COLORS, DASH, GRID, PAPER_BG, paperDefs, parseData, ItemSvg } from './render.js';

// ---------------- editor ----------------
const TOOLS = [
  ['pen', '✒️ pen'], ['highlighter', '🖍 high'], ['eraser', '⌫ erase'], ['whiteout', '⬜ whiteout'],
  ['line', '─ line'], ['arrow', '→ arrow'], ['darrow', '↔ d-arrow'], ['rect', '▭ rect'], ['ellipse', '◯ ellipse'],
  ['text', 'T text'], ['select', '⬚ move'], ['lasso', '⭕ lasso'],
];

export function DrawingEditor({ initial = null, onSave, onCancel }) {
  const init = parseData(initial) ?? { version: 2, paper: 'ruled', layers: [{ name: 'Layer 1', visible: true, items: [] }] };
  const [layers, setLayers] = useState(init.layers);
  const [activeLayer, setActiveLayer] = useState(0);
  const [paper, setPaper] = useState(init.paper);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [style, setStyle] = useState('solid');
  const [fill, setFill] = useState(false);
  const [stabilize, setStabilize] = useState(true);
  const [snap, setSnap] = useState(true);
  const [more, setMore] = useState(false);
  const [textFont, setTextFont] = useState('hand');  // hand | plain | mono — 'convert to many format'
  const [textSize, setTextSize] = useState(24);      // S/M/L/XL font size chips
  const [typing, setTyping] = useState(null);        // inline text entry {x, y, left, top} — never a popup // advanced rows (styles/papers/layers) live behind ⋯
  const svgRef = useRef(null);
  const drawing = useRef(false);
  const raw = useRef([]);
  const dragStart = useRef(null);
  const moveSel = useRef(null); // {layer, index, lastX, lastY}
  // LASSO selection (EditSelection analog): picks across visible layers, bbox with handles
  const [lassoPath, setLassoPath] = useState(null);   // in-progress polygon [[x,y],...]
  const [sel, setSel] = useState(null);               // { picks: [{layer,index}], bbox }
  const dragSel = useRef(null);                       // { mode: move|scale|rotate, ... , items0 }
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const bg = PAPER_BG[paper] ?? '#FFFEFB';
  const items = layers[activeLayer]?.items ?? [];
  const setItems = (fn) => setLayers((cur) => cur.map((l, i) => (i === activeLayer ? { ...l, items: fn(l.items) } : l)));

  const pos = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    let x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    let y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    if (snap && paper === 'grid' && ['line', 'arrow', 'darrow', 'rect', 'ellipse'].includes(tool)) {
      x = Math.round((x * W) / GRID) * GRID / W;
      y = Math.round((y * H) / GRID) * GRID / H;
    }
    return [x, y, e.pressure && e.pressure > 0 ? e.pressure : 0.5];
  };
  const hitIndex = (x, y) => {
    for (let li = layers.length - 1; li >= 0; li -= 1) {
      if (layers[li].visible === false) continue;
      const idx = layers[li].items.findIndex((it) => {
        if (it.kind === 'stroke') return it.points.some((v, j) => j % 2 === 0 && Math.hypot(it.points[j] - x, it.points[j + 1] - y) < 0.03);
        if (it.kind === 'shape') return Math.min(it.x1, it.x2) - 0.02 < x && x < Math.max(it.x1, it.x2) + 0.02 && Math.min(it.y1, it.y2) - 0.02 < y && y < Math.max(it.y1, it.y2) + 0.02;
        if (it.kind === 'text') return Math.abs(it.x - x) < 0.12 && Math.abs(it.y - y) < 0.05;
        return false;
      });
      if (idx >= 0) return { layer: li, index: idx };
    }
    return null;
  };

  const down = (e) => {
    e.preventDefault();
    const [x, y, p] = pos(e);
    if (tool === 'eraser') {
      // ERASER_TYPE_DELETE_STROKE (Xournal's default here): remove the hit object
      const hit = hitIndex(x, y);
      if (hit) setLayers((cur) => cur.map((l, i) => (i === hit.layer ? { ...l, items: l.items.filter((_, j) => j !== hit.index) } : l)));
      return;
    }
    if (tool === 'text') {
      // inline, on-canvas typing (Xournal's TextEditor behaves this way — no dialogs)
      const r = svgRef.current.getBoundingClientRect();
      setTyping({ x, y, left: e.clientX - r.left, top: e.clientY - r.top });
      return;
    }
    if (tool === 'select') {
      const hit = hitIndex(x, y);
      moveSel.current = hit ? { ...hit, lastX: x, lastY: y } : null;
      return;
    }
    if (tool === 'lasso') {
      if (sel) {
        const b = sel.bbox;
        // handle layout mirrors CursorSelectionType: 4 corners, 4 edges, rotate, delete
        const hnd = {
          tl: [b.x, b.y], tr: [b.x + b.w, b.y], bl: [b.x, b.y + b.h], br: [b.x + b.w, b.y + b.h],
          l: [b.x, b.y + b.h / 2], r: [b.x + b.w, b.y + b.h / 2], t: [b.x + b.w / 2, b.y], bm: [b.x + b.w / 2, b.y + b.h],
          rot: [b.x + b.w / 2, b.y - 0.05], del: [b.x + b.w + 0.03, b.y - 0.05],
        };
        const near = (p) => Math.hypot((p[0] - x) * W, (p[1] - y) * H) < 18;
        const snapshot = () => sel.picks.map(({ layer, index }) => layersRef.current[layer].items[index]);
        if (near(hnd.del)) {
          setLayers((cur) => cur.map((l, li) => ({ ...l, items: l.items.filter((_, j) => !sel.picks.some((p) => p.layer === li && p.index === j)) })));
          setSel(null);
          return;
        }
        if (near(hnd.rot)) {
          const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
          dragSel.current = { mode: 'rotate', cx, cy, start: Math.atan2((y - cy) * H, (x - cx) * W), items0: snapshot() };
          return;
        }
        const grip = ['tl', 'tr', 'bl', 'br', 'l', 'r', 't', 'bm'].find((k) => near(hnd[k]));
        if (grip) {
          const anchor = { tl: hnd.br, tr: hnd.bl, bl: hnd.tr, br: hnd.tl, l: hnd.r, r: hnd.l, t: hnd.bm, bm: hnd.t }[grip];
          dragSel.current = { mode: 'scale', grip, ax: anchor[0], ay: anchor[1], sx: x, sy: y, items0: snapshot() };
          return;
        }
        if (x > b.x - 0.01 && x < b.x + b.w + 0.01 && y > b.y - 0.01 && y < b.y + b.h + 0.01) {
          dragSel.current = { mode: 'move', sx: x, sy: y, items0: snapshot() };
          return;
        }
      }
      setSel(null);
      dragSel.current = null;
      setLassoPath([[x, y]]);
      return;
    }
    if (['line', 'arrow', 'darrow', 'rect', 'ellipse'].includes(tool)) {
      dragStart.current = [x, y];
      setItems((cur) => [...cur, { kind: 'shape', shape: tool, x1: x, y1: y, x2: x, y2: y, color, width, style, fill }]);
      return;
    }
    drawing.current = true;
    raw.current = [[x, y, p]];
    setItems((cur) => [...cur, { kind: 'stroke', tool: tool === 'whiteout' ? 'whiteout' : tool, color, width: tool === 'highlighter' ? width * 4 : width, style, points: [x, y], pressures: [p] }]);
  };
  const move = (e) => {
    const [x, y, p] = pos(e);
    if (tool === 'lasso') {
      if (lassoPath) { setLassoPath((cur) => (cur ? [...cur, [x, y]] : cur)); return; }
      const d = dragSel.current;
      if (d && sel) {
        let f;
        if (d.mode === 'move') f = (it) => moveItem(it, x - d.sx, y - d.sy);
        else if (d.mode === 'scale') {
          let fx = (x - d.ax) / ((d.sx - d.ax) || 1e-6);
          let fy = (y - d.ay) / ((d.sy - d.ay) || 1e-6);
          if (['l', 'r'].includes(d.grip)) fy = 1;
          if (['t', 'bm'].includes(d.grip)) fx = 1;
          fx = Math.max(0.05, fx); fy = Math.max(0.05, fy);
          f = (it) => scaleItem(it, d.ax, d.ay, fx, fy);
        } else {
          const now = Math.atan2((y - d.cy) * H, (x - d.cx) * W);
          f = (it) => rotateItem(it, d.cx, d.cy, now - d.start);
        }
        setLayers((cur) => cur.map((l, li) => ({ ...l, items: l.items.map((it, j) => {
          const k = sel.picks.findIndex((p2) => p2.layer === li && p2.index === j);
          return k >= 0 ? f(d.items0[k]) : it;
        }) })));
      }
      return;
    }
    if (moveSel.current && tool === 'select') {
      const { layer, index, lastX, lastY } = moveSel.current;
      const dx = x - lastX; const dy = y - lastY;
      moveSel.current = { ...moveSel.current, lastX: x, lastY: y };
      setLayers((cur) => cur.map((l, li) => li !== layer ? l : { ...l, items: l.items.map((it, j) => {
        if (j !== index) return it;
        if (it.kind === 'stroke') return { ...it, points: it.points.map((v, k) => (k % 2 === 0 ? v + dx : v + dy)) };
        if (it.kind === 'shape') return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy };
        return { ...it, x: it.x + dx, y: it.y + dy };
      }) }));
      return;
    }
    if (dragStart.current) {
      setItems((cur) => { const next = [...cur]; const last = next[next.length - 1]; if (last?.kind === 'shape') next[next.length - 1] = { ...last, x2: x, y2: y }; return next; });
      return;
    }
    if (!drawing.current) return;
    // INPUT STABILIZATION (Xournal feature): moving average over the raw tail
    raw.current.push([x, y, p]);
    const tail = raw.current.slice(-3);
    const sx = stabilize ? tail.reduce((a, q) => a + q[0], 0) / tail.length : x;
    const sy = stabilize ? tail.reduce((a, q) => a + q[1], 0) / tail.length : y;
    setItems((cur) => {
      const next = [...cur];
      const last = next[next.length - 1];
      if (last?.kind !== 'stroke') return cur;
      next[next.length - 1] = { ...last, points: [...last.points, sx, sy], pressures: [...(last.pressures ?? []), p] };
      return next;
    });
  };
  const up = () => {
    drawing.current = false; dragStart.current = null; moveSel.current = null;
    if (lassoPath) {
      const poly = lassoPath;
      setLassoPath(null);
      if (poly.length > 2) {
        const picks = [];
        layersRef.current.forEach((l, li) => {
          if (l.visible === false) return;
          l.items.forEach((it, j) => { if (itemInLasso(it, poly)) picks.push({ layer: li, index: j }); });
        });
        if (picks.length) setSel({ picks, bbox: selectionBounds(picks.map((p) => layersRef.current[p.layer].items[p.index])) });
      }
      return;
    }
    if (dragSel.current && sel) {
      dragSel.current = null;
      setSel((cur) => cur && { ...cur, bbox: selectionBounds(cur.picks.map((p) => layersRef.current[p.layer].items[p.index])) });
    }
  };

  const commitText = (raw) => {
    const t = String(raw ?? '').trim();
    if (t && typing) setItems((cur) => [...cur, { kind: 'text', x: typing.x, y: typing.y, text: t.slice(0, 160), size: textSize, color, font: textFont }]);
    setTyping(null);
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !typing) onCancel?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, typing]);

  const chip = (on) => ({ border: on ? '1.5px solid #e8604c' : '1px solid #EBE3D8', borderRadius: 8, background: on ? '#FDF0EE' : '#fff', color: '#211A14', padding: '3px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });
  return (
    <div style={{ position: 'relative', border: '1.5px solid #EBD9C4', borderRadius: 14, background: '#FDFAF3', padding: 12, margin: '10px 0' }}>
      <button onClick={onCancel} title="close (Esc)"
        style={{ position: 'absolute', top: 8, right: 10, zIndex: 2, border: '1px solid #EBD9C4', borderRadius: 999, background: '#fff', color: '#77695B', width: 26, height: 26, fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>✕</button>
      {more ? (
        <>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, paddingRight: 30 }}>
            {['solid', 'dashed', 'dotted'].map((st) => <button key={st} onClick={() => setStyle(st)} style={chip(style === st)}>{st}</button>)}
            <button onClick={() => setFill((v) => !v)} style={chip(fill)}>fill</button>
            <button onClick={() => setStabilize((v) => !v)} style={chip(stabilize)} title="input stabilization — smoother handwriting">smooth</button>
            <button onClick={() => setSnap((v) => !v)} style={chip(snap)} title="snap shapes to the grid">snap</button>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
              {['blank', 'ruled', 'grid', 'scratch', 'whiteboard'].map((pp) => <button key={pp} onClick={() => setPaper(pp)} style={chip(paper === pp)}>{pp}</button>)}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: '#77695B' }}>LAYERS</span>
            {layers.map((l, i) => (
              <span key={i} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                <button onClick={() => setActiveLayer(i)} style={chip(activeLayer === i)}>{l.name}</button>
                <button onClick={() => setLayers((cur) => cur.map((x, j) => (j === i ? { ...x, visible: x.visible === false } : x)))}
                  title="show/hide" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, opacity: l.visible === false ? 0.35 : 1 }}>👁</button>
                <button disabled={i === 0} onClick={() => { setLayers((cur) => { const n = [...cur]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; }); setActiveLayer((a) => (a === i ? i - 1 : a === i - 1 ? i : a)); }}
                  title="move layer up (drawn earlier = beneath)" style={{ border: 'none', background: 'transparent', cursor: i === 0 ? 'default' : 'pointer', fontSize: 11, opacity: i === 0 ? 0.25 : 0.8, padding: 0 }}>↑</button>
                <button disabled={i === layers.length - 1} onClick={() => { setLayers((cur) => { const n = [...cur]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; }); setActiveLayer((a) => (a === i ? i + 1 : a === i + 1 ? i : a)); }}
                  title="move layer down" style={{ border: 'none', background: 'transparent', cursor: i === layers.length - 1 ? 'default' : 'pointer', fontSize: 11, opacity: i === layers.length - 1 ? 0.25 : 0.8, padding: 0 }}>↓</button>
              </span>
            ))}
            <button onClick={() => { setLayers((cur) => [...cur, { name: `Layer ${cur.length + 1}`, visible: true, items: [] }]); setActiveLayer(layers.length); }} style={chip(false)}>+ layer</button>
          </div>
        </>
      ) : null}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', touchAction: 'none', cursor: tool === 'select' || tool === 'lasso' ? 'grab' : 'crosshair', background: bg, borderRadius: 10, border: '1px solid #EBE3D8' }}>
        {paperDefs(paper, 'pe') ? <><defs>{paperDefs(paper, 'pe')}</defs><rect width={W} height={H} fill="url(#pe)" /></> : null}
        {layers.filter((l) => l.visible !== false).map((l, li) => <g key={li}>{l.items.map((it, i) => <ItemSvg key={i} it={it} bg={bg} />)}</g>)}
        {lassoPath && lassoPath.length > 1 ? (
          <polygon points={lassoPath.map(([qx, qy]) => `${(qx * W).toFixed(1)},${(qy * H).toFixed(1)}`).join(' ')}
            fill="#e8604c14" stroke="#e8604c" strokeWidth="1.5" strokeDasharray="7 6" />
        ) : null}
        {sel ? (() => {
          const b = sel.bbox; const X = b.x * W; const Y = b.y * H; const BW = b.w * W; const BH = b.h * H;
          const grips = [[X, Y], [X + BW, Y], [X, Y + BH], [X + BW, Y + BH], [X, Y + BH / 2], [X + BW, Y + BH / 2], [X + BW / 2, Y], [X + BW / 2, Y + BH]];
          return (
            <g data-selection="1" style={{ pointerEvents: 'none' }}>
              <rect x={X - 4} y={Y - 4} width={BW + 8} height={BH + 8} fill="none" stroke="#4477aa" strokeWidth="1.5" strokeDasharray="6 5" />
              {grips.map(([hx, hy], i) => <rect key={i} x={hx - 4.5} y={hy - 4.5} width="9" height="9" fill="#fff" stroke="#4477aa" strokeWidth="1.5" />)}
              <line x1={X + BW / 2} y1={Y - 4} x2={X + BW / 2} y2={Y - 0.05 * H + 8} stroke="#4477aa" strokeWidth="1" />
              <circle cx={X + BW / 2} cy={Y - 0.05 * H} r="8" fill="#fff" stroke="#4477aa" strokeWidth="1.5" />
              <text x={X + BW / 2} y={Y - 0.05 * H + 3.5} textAnchor="middle" fontSize="10" fill="#4477aa">⟳</text>
              <circle cx={X + BW + 0.03 * W} cy={Y - 0.05 * H} r="8" fill="#fff" stroke="#c0392b" strokeWidth="1.5" />
              <text x={X + BW + 0.03 * W} y={Y - 0.05 * H + 3.5} textAnchor="middle" fontSize="10" fill="#c0392b">✕</text>
            </g>
          );
        })() : null}
      </svg>
      {typing ? (
        <input autoFocus placeholder="type — Enter puts it on the paper"
          onPointerDown={(e2) => e2.stopPropagation()}
          onKeyDown={(e2) => { if (e2.key === 'Enter') commitText(e2.currentTarget.value); if (e2.key === 'Escape') setTyping(null); }}
          onBlur={(e2) => commitText(e2.currentTarget.value)}
          style={{ position: 'absolute', left: typing.left, top: typing.top - 14, width: 280, border: 'none', borderBottom: `2px dashed ${color}`, outline: 'none', background: 'transparent', color, zIndex: 3,
            fontFamily: textFont === 'hand' ? 'var(--caveat), cursive' : textFont === 'mono' ? 'ui-monospace, monospace' : 'inherit', fontSize: Math.max(13, textSize * 0.9), fontWeight: 600 }} />
      ) : null}
      {/* one floating toolbar under the paper — the Image-#36 layout */}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', margin: '10px auto 0', padding: '8px 14px', borderRadius: 999, border: '1px solid #EBE3D8', background: '#fff', boxShadow: '0 6px 18px rgba(33,26,20,0.08)', width: 'fit-content', maxWidth: '100%' }}>
        {TOOLS.map(([t, label]) => (
          <button key={t} onClick={() => { setTool(t); setSel(null); setLassoPath(null); dragSel.current = null; }} title={label}
            style={{ border: 'none', borderRadius: 8, background: tool === t ? '#FDF0EE' : 'transparent', outline: tool === t ? '1.5px solid #e8604c' : 'none', padding: '3px 7px', fontSize: 13, cursor: 'pointer' }}>{label.split(' ')[0]}</button>
        ))}
        <span style={{ width: 1, height: 20, background: '#EBE3D8' }} />
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #fff' : '2px solid transparent', outline: color === c ? `2px solid ${c}` : 'none', cursor: 'pointer', padding: 0 }} />
        ))}
        <input type="range" min="1" max="8" value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ width: 54, accentColor: '#e8604c' }} />
        <span style={{ width: 1, height: 20, background: '#EBE3D8' }} />
        {tool === 'text' ? (
          <>
            {['hand', 'plain', 'mono'].map((f) => (
              <button key={f} onClick={() => setTextFont(f)} title={`text format: ${f}`}
                style={{ border: 'none', borderRadius: 8, background: textFont === f ? '#FDF0EE' : 'transparent', outline: textFont === f ? '1.5px solid #e8604c' : 'none', padding: '2px 7px', fontSize: 12, cursor: 'pointer', fontFamily: f === 'hand' ? 'var(--caveat), cursive' : f === 'mono' ? 'ui-monospace, monospace' : 'inherit', fontWeight: 700 }}>Aa</button>
            ))}
            {[['S', 16], ['M', 24], ['L', 34], ['XL', 48]].map(([lb, sz]) => (
              <button key={lb} onClick={() => setTextSize(sz)} title={`font size ${sz}`}
                style={{ border: 'none', borderRadius: 8, background: textSize === sz ? '#FDF0EE' : 'transparent', outline: textSize === sz ? '1.5px solid #e8604c' : 'none', padding: '2px 6px', fontSize: 10 + [16, 24, 34, 48].indexOf(sz) * 1.6, cursor: 'pointer', fontWeight: 800, color: '#211A14' }}>{lb}</button>
            ))}
            <span style={{ width: 1, height: 20, background: '#EBE3D8' }} />
          </>
        ) : null}
        <button onClick={() => setItems((cur) => cur.slice(0, -1))} title="undo" style={{ border: 'none', background: 'transparent', fontSize: 14, cursor: 'pointer', padding: '2px 4px' }}>↶</button>
        <button onClick={() => setMore((v) => !v)} title="styles · papers · layers" style={{ border: 'none', borderRadius: 8, background: more ? '#FDF0EE' : 'transparent', outline: more ? '1.5px solid #e8604c' : 'none', fontSize: 15, cursor: 'pointer', padding: '0 6px' }}>⋯</button>
        <button onClick={() => onSave(JSON.stringify({ version: 2, paper, layers }))} disabled={layers.every((l) => l.items.length === 0)}
          style={{ border: 'none', borderRadius: 999, background: layers.some((l) => l.items.length) ? '#1E9A61' : '#CFE0D2', color: '#fff', padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>✓ save</button>
      </div>
    </div>
  );
}
