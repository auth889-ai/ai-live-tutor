'use client';

// INK ENGINE v2 — Xournal++'s tool set, mirrored from its OWN source (verified 2026-07-19):
//   tools:    TOOL_PEN, TOOL_HIGHLIGHTER, TOOL_DRAW_LINE/RECT/ELLIPSE/ARROW/DOUBLE_ARROW,
//             text, select+move                       (src/core/control/ToolEnums.h:71-90)
//   erasers:  DELETE_STROKE (default) + WHITEOUT      (ToolEnums.h:157)
//   styles:   solid / dashed / dotted                 (src/core/model/LineStyle.h)
//   pressure: per-point widths                        (src/core/model/Stroke.h setPressure)
//   layers:   show/hide, active layer, add            (src/core/model/Layer.h)
//   papers:   blank / ruled / grid / scratch / whiteboard, grid snapping
//   stabilization: moving-average smoothing toggle
// Storage law (Xournal's): vectors, never flattened pixels. Data v2:
//   { version: 2, paper, layers: [{ name, visible, items: [stroke|shape|text] }] }

import { useRef, useState } from 'react';

const W = 1000;
const H = 620;
const COLORS = ['#211A14', '#e8604c', '#2f7d4a', '#4477aa', '#c98f2d', '#8e44ad'];
const DASH = { solid: null, dashed: '14 10', dotted: '2 8' };
const GRID = 34;

export function paperDefs(paper, key = 'p') {
  if (paper === 'ruled') {
    return (
      <pattern id={key} width={W} height={GRID} patternUnits="userSpaceOnUse">
        <line x1="0" y1={GRID - 1} x2={W} y2={GRID - 1} stroke="#EBE3D8" strokeWidth="1.4" />
      </pattern>
    );
  }
  if (paper === 'grid') {
    return (
      <pattern id={key} width={GRID} height={GRID} patternUnits="userSpaceOnUse">
        <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#EDE6DB" strokeWidth="1.2" />
      </pattern>
    );
  }
  return null;
}
const PAPER_BG = { blank: '#FFFEFB', ruled: '#FFFEFB', grid: '#FFFEFB', scratch: '#FBF4E4', whiteboard: '#FFFFFF' };

function parseData(data) {
  try {
    const d = JSON.parse(data);
    if (d?.version === 2) return d;
    // v1 upgrade: flat strokes -> one layer
    return { version: 2, paper: d?.paper ?? 'blank', layers: [{ name: 'Layer 1', visible: true, items: (d?.strokes ?? []).map((s) => ({ kind: 'stroke', ...s })) }] };
  } catch { return null; }
}

// ---- rendering (shared by viewer + editor) ----
function ItemSvg({ it, bg }) {
  const px = (v) => (v * W).toFixed(1);
  const py = (v) => (v * H).toFixed(1);
  const color = it.tool === 'whiteout' ? bg : it.color;
  const dash = DASH[it.style ?? 'solid'];
  if (it.kind === 'text') {
    return <text x={px(it.x)} y={py(it.y)} fontSize={it.size ?? 22} fill={it.color} fontFamily="inherit">{it.text}</text>;
  }
  if (it.kind === 'shape') {
    const common = { fill: it.fill ? `${it.color}22` : 'none', stroke: color, strokeWidth: it.width, strokeDasharray: dash ?? undefined, strokeLinecap: 'round' };
    const x1 = +px(it.x1); const y1 = +py(it.y1); const x2 = +px(it.x2); const y2 = +py(it.y2);
    if (it.shape === 'rect') return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} {...common} />;
    if (it.shape === 'ellipse') return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...common} />;
    // line / arrow / double-arrow
    const head = (fx, fy, tx, ty) => {
      const a = Math.atan2(ty - fy, tx - fx);
      const L = 12 + it.width * 2;
      return `M ${tx} ${ty} L ${tx - L * Math.cos(a - 0.42)} ${ty - L * Math.sin(a - 0.42)} M ${tx} ${ty} L ${tx - L * Math.cos(a + 0.42)} ${ty - L * Math.sin(a + 0.42)}`;
    };
    return (
      <g>
        <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} fill="none" />
        {it.shape === 'arrow' || it.shape === 'darrow' ? <path d={head(x1, y1, x2, y2)} stroke={color} strokeWidth={it.width} fill="none" strokeLinecap="round" /> : null}
        {it.shape === 'darrow' ? <path d={head(x2, y2, x1, y1)} stroke={color} strokeWidth={it.width} fill="none" strokeLinecap="round" /> : null}
      </g>
    );
  }
  // stroke — pressure-aware: per-point widths render as segments (Stroke::setPressure analog)
  const pts = it.points;
  const opacity = it.tool === 'highlighter' ? 0.35 : 1;
  if (Array.isArray(it.pressures) && it.pressures.length * 2 === pts.length && it.tool === 'pen') {
    const segs = [];
    for (let i = 2; i < pts.length; i += 2) {
      const p = (it.pressures[i / 2 - 1] + it.pressures[i / 2]) / 2 || 0.5;
      segs.push(<line key={i} x1={px(pts[i - 2])} y1={py(pts[i - 1])} x2={px(pts[i])} y2={py(pts[i + 1])}
        stroke={color} strokeWidth={Math.max(0.6, it.width * (0.5 + p))} strokeLinecap="round" strokeDasharray={dash ?? undefined} opacity={opacity} />);
    }
    return <g>{segs}</g>;
  }
  return <polyline
    points={pts.map((v, j) => (j % 2 === 0 ? v * W : v * H).toFixed(1)).join(' ').replace(/(\S+) (\S+) ?/g, '$1,$2 ')}
    fill="none" stroke={color} strokeWidth={it.width} strokeLinecap="round" strokeLinejoin="round"
    strokeDasharray={dash ?? undefined} opacity={opacity} />;
}

export function SvgDrawing({ data, maxHeight = 420 }) {
  const d = parseData(data);
  if (!d) return null;
  const bg = PAPER_BG[d.paper] ?? '#FFFEFB';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight, display: 'block', background: bg, borderRadius: 10, border: '1px solid #EBE3D8' }}>
      {paperDefs(d.paper, `pp`) ? <><defs>{paperDefs(d.paper, 'pp')}</defs><rect width={W} height={H} fill="url(#pp)" /></> : null}
      {d.layers.filter((l) => l.visible !== false).map((l, li) => <g key={li}>{l.items.map((it, i) => <ItemSvg key={i} it={it} bg={bg} />)}</g>)}
    </svg>
  );
}

// serialize a drawing to a standalone SVG string (Xournal export analog)
export function drawingToSvgString(data) {
  const el = document.createElement('div');
  // cheap approach: render current markup is React-side; instead rebuild minimal svg
  const d = parseData(data);
  if (!d) return '';
  const bg = PAPER_BG[d.paper] ?? '#FFFEFB';
  const items = d.layers.filter((l) => l.visible !== false).flatMap((l) => l.items);
  const seg = (it) => {
    const P = (v, dim) => (v * (dim === 'x' ? W : H)).toFixed(1);
    const color = it.tool === 'whiteout' ? bg : it.color;
    const dash = DASH[it.style ?? 'solid'] ? ` stroke-dasharray="${DASH[it.style ?? 'solid']}"` : '';
    const op = it.tool === 'highlighter' ? ' opacity="0.35"' : '';
    if (it.kind === 'text') return `<text x="${P(it.x, 'x')}" y="${P(it.y, 'y')}" font-size="${it.size ?? 22}" fill="${it.color}">${String(it.text).replace(/</g, '&lt;')}</text>`;
    if (it.kind === 'shape') {
      const x1 = +P(it.x1, 'x'); const y1 = +P(it.y1, 'y'); const x2 = +P(it.x2, 'x'); const y2 = +P(it.y2, 'y');
      const fill = it.fill ? `${it.color}22` : 'none';
      if (it.shape === 'rect') return `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${fill}" stroke="${color}" stroke-width="${it.width}"${dash}/>`;
      if (it.shape === 'ellipse') return `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" fill="${fill}" stroke="${color}" stroke-width="${it.width}"${dash}/>`;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${it.width}"${dash} stroke-linecap="round"/>`;
    }
    const pts = it.points.map((v, j) => (j % 2 === 0 ? v * W : v * H).toFixed(1)).join(' ').replace(/(\S+) (\S+) ?/g, '$1,$2 ');
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${it.width}" stroke-linecap="round" stroke-linejoin="round"${dash}${op}/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${items.map(seg).join('')}</svg>`;
}

export async function downloadDrawing(data, kind = 'svg', name = 'drawing') {
  const svg = drawingToSvgString(data);
  if (kind === 'svg') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    a.download = `${name}.svg`;
    a.click();
    return;
  }
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await new Promise((res) => { img.onload = res; img.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  canvas.getContext('2d').drawImage(img, 0, 0, W * 2, H * 2);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${name}.png`;
  a.click();
}

// ---------------- editor ----------------
const TOOLS = [
  ['pen', '✒️ pen'], ['highlighter', '🖍 high'], ['eraser', '⌫ erase'], ['whiteout', '⬜ whiteout'],
  ['line', '─ line'], ['arrow', '→ arrow'], ['darrow', '↔ d-arrow'], ['rect', '▭ rect'], ['ellipse', '◯ ellipse'],
  ['text', 'T text'], ['select', '⬚ move'],
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
  const svgRef = useRef(null);
  const drawing = useRef(false);
  const raw = useRef([]);
  const dragStart = useRef(null);
  const moveSel = useRef(null); // {layer, index, lastX, lastY}

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
      const t = window.prompt('text:');
      if (t?.trim()) setItems((cur) => [...cur, { kind: 'text', x, y, text: t.trim().slice(0, 120), size: 14 + width * 3, color }]);
      return;
    }
    if (tool === 'select') {
      const hit = hitIndex(x, y);
      moveSel.current = hit ? { ...hit, lastX: x, lastY: y } : null;
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
  const up = () => { drawing.current = false; dragStart.current = null; moveSel.current = null; };

  const chip = (on) => ({ border: on ? '1.5px solid #e8604c' : '1px solid #EBE3D8', borderRadius: 8, background: on ? '#FDF0EE' : '#fff', color: '#211A14', padding: '3px 8px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' });
  return (
    <div style={{ border: '1.5px solid #EBD9C4', borderRadius: 14, background: '#FDFAF3', padding: 12, margin: '10px 0' }}>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        {TOOLS.map(([t, label]) => <button key={t} onClick={() => setTool(t)} style={chip(tool === t)}>{label}</button>)}
      </div>
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: color === c ? '2.5px solid #fff' : '2px solid transparent', outline: color === c ? `2px solid ${c}` : 'none', cursor: 'pointer' }} />
        ))}
        <input type="range" min="1" max="8" value={width} onChange={(e) => setWidth(Number(e.target.value))} style={{ width: 60, accentColor: '#e8604c' }} />
        {['solid', 'dashed', 'dotted'].map((st) => <button key={st} onClick={() => setStyle(st)} style={chip(style === st)}>{st}</button>)}
        <button onClick={() => setFill((v) => !v)} style={chip(fill)}>fill</button>
        <button onClick={() => setStabilize((v) => !v)} style={chip(stabilize)} title="input stabilization — smoother handwriting">smooth</button>
        <button onClick={() => setSnap((v) => !v)} style={chip(snap)} title="snap shapes to the grid">snap</button>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
          {['blank', 'ruled', 'grid', 'scratch', 'whiteboard'].map((pp) => <button key={pp} onClick={() => setPaper(pp)} style={chip(paper === pp)}>{pp}</button>)}
        </span>
      </div>
      {/* LAYERS (Layer.h analog): active layer, visibility, add */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#77695B' }}>LAYERS</span>
        {layers.map((l, i) => (
          <span key={i} style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
            <button onClick={() => setActiveLayer(i)} style={chip(activeLayer === i)}>{l.name}</button>
            <button onClick={() => setLayers((cur) => cur.map((x, j) => (j === i ? { ...x, visible: x.visible === false } : x)))}
              title="show/hide" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12, opacity: l.visible === false ? 0.35 : 1 }}>👁</button>
          </span>
        ))}
        <button onClick={() => { setLayers((cur) => [...cur, { name: `Layer ${cur.length + 1}`, visible: true, items: [] }]); setActiveLayer(layers.length); }} style={chip(false)}>+ layer</button>
        <button onClick={() => setItems((cur) => cur.slice(0, -1))} style={{ ...chip(false), marginLeft: 'auto' }}>↶ undo</button>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: '100%', touchAction: 'none', cursor: tool === 'select' ? 'grab' : 'crosshair', background: bg, borderRadius: 10, border: '1px solid #EBE3D8' }}>
        {paperDefs(paper, 'pe') ? <><defs>{paperDefs(paper, 'pe')}</defs><rect width={W} height={H} fill="url(#pe)" /></> : null}
        {layers.filter((l) => l.visible !== false).map((l, li) => <g key={li}>{l.items.map((it, i) => <ItemSvg key={i} it={it} bg={bg} />)}</g>)}
      </svg>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={() => onSave(JSON.stringify({ version: 2, paper, layers }))} disabled={layers.every((l) => l.items.length === 0)}
          style={{ border: 'none', borderRadius: 999, background: layers.some((l) => l.items.length) ? '#1E9A61' : '#CFE0D2', color: '#fff', padding: '7px 18px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>✓ save drawing</button>
        <button onClick={onCancel} style={{ border: 'none', background: 'transparent', color: '#77695B', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>cancel</button>
      </div>
    </div>
  );
}
