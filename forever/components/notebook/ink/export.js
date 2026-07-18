'use client';

// INK EXPORT — standalone SVG serialization + SVG/PNG download (Xournal export analog).

import { W, H } from '../../../lib/notebook/ink-geometry.js';
import { DASH, PAPER_BG, parseData } from './render.js';

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
    const rotA = (cx, cy) => (it.rot ? ` transform="rotate(${(it.rot * 180 / Math.PI).toFixed(2)} ${cx} ${cy})"` : '');
    if (it.kind === 'text') return `<text x="${P(it.x, 'x')}" y="${P(it.y, 'y')}" font-size="${it.size ?? 22}" fill="${it.color}"${rotA(P(it.x, 'x'), P(it.y, 'y'))}>${String(it.text).replace(/</g, '&lt;')}</text>`;
    if (it.kind === 'shape') {
      const x1 = +P(it.x1, 'x'); const y1 = +P(it.y1, 'y'); const x2 = +P(it.x2, 'x'); const y2 = +P(it.y2, 'y');
      const fill = it.fill ? `${it.color}22` : 'none';
      if (it.shape === 'rect') return `<rect x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}" width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}" fill="${fill}" stroke="${color}" stroke-width="${it.width}"${dash}${rotA((x1 + x2) / 2, (y1 + y2) / 2)}/>`;
      if (it.shape === 'ellipse') return `<ellipse cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}" rx="${Math.abs(x2 - x1) / 2}" ry="${Math.abs(y2 - y1) / 2}" fill="${fill}" stroke="${color}" stroke-width="${it.width}"${dash}${rotA((x1 + x2) / 2, (y1 + y2) / 2)}/>`;
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

