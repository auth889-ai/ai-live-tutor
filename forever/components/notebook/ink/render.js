'use client';

// INK RENDER — shared drawing model + SVG rendering (viewer side of the ink engine).
// The full Xournal++ source map lives in the barrel: components/notebook/drawing.js

import { W, H } from '../../../lib/notebook/ink-geometry.js';

export const COLORS = ['#211A14', '#e8604c', '#2f7d4a', '#4477aa', '#c98f2d', '#8e44ad'];
export const DASH = { solid: null, dashed: '14 10', dotted: '2 8' };
export const GRID = 34;

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
export const PAPER_BG = { blank: '#FFFEFB', ruled: '#FFFEFB', grid: '#FFFEFB', scratch: '#FBF4E4', whiteboard: '#FFFFFF' };

export function parseData(data) {
  try {
    const d = JSON.parse(data);
    if (d?.version === 2) return d;
    // v1 upgrade: flat strokes -> one layer
    return { version: 2, paper: d?.paper ?? 'blank', layers: [{ name: 'Layer 1', visible: true, items: (d?.strokes ?? []).map((s) => ({ kind: 'stroke', ...s })) }] };
  } catch { return null; }
}

// ---- rendering (shared by viewer + editor) ----
export function ItemSvg({ it, bg }) {
  const px = (v) => (v * W).toFixed(1);
  const py = (v) => (v * H).toFixed(1);
  const color = it.tool === 'whiteout' ? bg : it.color;
  const dash = DASH[it.style ?? 'solid'];
  const rotT = (cx, cy) => (it.rot ? `rotate(${(it.rot * 180 / Math.PI).toFixed(2)} ${cx} ${cy})` : undefined);
  if (it.kind === 'text') {
    const FONTS = { hand: 'var(--caveat), "Segoe Script", cursive', mono: 'ui-monospace, SFMono-Regular, monospace', plain: 'inherit' };
    return <text x={px(it.x)} y={py(it.y)} fontSize={it.size ?? 22} fill={it.color} fontFamily={FONTS[it.font ?? 'plain']} fontWeight={it.font === 'hand' ? 600 : 400} transform={rotT(px(it.x), py(it.y))}>{it.text}</text>;
  }
  if (it.kind === 'shape') {
    const common = { fill: it.fill ? `${it.color}22` : 'none', stroke: color, strokeWidth: it.width, strokeDasharray: dash ?? undefined, strokeLinecap: 'round' };
    const x1 = +px(it.x1); const y1 = +py(it.y1); const x2 = +px(it.x2); const y2 = +py(it.y2);
    if (it.shape === 'rect') return <rect x={Math.min(x1, x2)} y={Math.min(y1, y2)} width={Math.abs(x2 - x1)} height={Math.abs(y2 - y1)} {...common} transform={rotT((x1 + x2) / 2, (y1 + y2) / 2)} />;
    if (it.shape === 'ellipse') return <ellipse cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} rx={Math.abs(x2 - x1) / 2} ry={Math.abs(y2 - y1) / 2} {...common} transform={rotT((x1 + x2) / 2, (y1 + y2) / 2)} />;
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
  // a pen TAP is a one-point stroke — Xournal renders it as a dot (round cap on a
  // zero-length stroke); a one-point polyline has no segment and would be invisible
  if (pts.length === 2) {
    const r = Math.max(1.4, (it.width * (0.5 + (it.pressures?.[0] ?? 0.5))) / 1.6);
    return <circle cx={px(pts[0])} cy={py(pts[1])} r={r} fill={color} opacity={opacity} />;
  }
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

