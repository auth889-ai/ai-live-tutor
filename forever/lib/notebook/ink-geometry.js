// INK GEOMETRY — the selection math behind the drawing editor's lasso tool, mirrored from
// Xournal++'s own source (verified 2026-07-19). Pure functions: coordinates are normalized
// (x in 0..1 of W, y in 0..1 of H); rotation happens in pixel space so it never shears.

export const W = 1000;
export const H = 620;

// LassoSelector::contains (src/core/control/tools/Selector.cpp:230): even-odd ray casting.
export function lassoContains(poly, x, y) {
  if (poly.length <= 2) return false;
  let hits = 0;
  let [lastx, lasty] = poly[poly.length - 1];
  for (const [curx, cury] of poly) {
    if ((cury > y) !== (lasty > y)) {
      const t = (y - lasty) / (cury - lasty);
      if (lastx + t * (curx - lastx) > x) hits += 1;
    }
    lastx = curx; lasty = cury;
  }
  return hits % 2 === 1;
}

function itemPoints(it) {
  if (it.kind === 'stroke') { const P = []; for (let j = 0; j < it.points.length; j += 2) P.push([it.points[j], it.points[j + 1]]); return P; }
  if (it.kind === 'shape') return [[it.x1, it.y1], [it.x2, it.y2]];
  return [[it.x, it.y]];
}

// Stroke::isInSelection (src/core/model/Stroke.cpp:235): EVERY point must fall inside.
export function itemInLasso(it, poly) { return itemPoints(it).every(([x, y]) => lassoContains(poly, x, y)); }

export function selectionBounds(items) {
  const pts = items.flatMap(itemPoints);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const mapPts = (it, f) => {
  if (it.kind === 'stroke') { const pts = [...it.points]; for (let j = 0; j < pts.length; j += 2) { const [nx, ny] = f(pts[j], pts[j + 1]); pts[j] = nx; pts[j + 1] = ny; } return { ...it, points: pts }; }
  if (it.kind === 'shape') { const [x1, y1] = f(it.x1, it.y1); const [x2, y2] = f(it.x2, it.y2); return { ...it, x1, y1, x2, y2 }; }
  const [x, y] = f(it.x, it.y); return { ...it, x, y };
};

export function moveItem(it, dx, dy) { return mapPts(it, (x, y) => [x + dx, y + dy]); }

// Element::scale(x0, y0, fx, fy, ...) (src/core/model/Element.h:58): scale about an anchor;
// stroke width follows sqrt(fx*fy) like Stroke::scale's fz.
export function scaleItem(it, x0, y0, fx, fy) {
  const out = mapPts(it, (x, y) => [x0 + (x - x0) * fx, y0 + (y - y0) * fy]);
  const fz = Math.sqrt(Math.abs(fx * fy));
  if (it.kind === 'stroke' || it.kind === 'shape') out.width = Math.max(0.6, it.width * fz);
  if (it.kind === 'text') out.size = Math.max(8, Math.round((it.size ?? 22) * fz));
  return out;
}

// Element::rotate(x0, y0, th) (Element.h:59): rotate about the selection centre — in PIXEL
// space (normalized space would shear: W !== H). rect/ellipse/text carry the angle in `rot`.
export function rotateItem(it, cx, cy, th) {
  const cos = Math.cos(th); const sin = Math.sin(th);
  const rp = (x, y) => {
    const px = (x - cx) * W; const py = (y - cy) * H;
    return [cx + (px * cos - py * sin) / W, cy + (px * sin + py * cos) / H];
  };
  if (it.kind === 'shape' && ['rect', 'ellipse'].includes(it.shape)) {
    const mx = (it.x1 + it.x2) / 2; const my = (it.y1 + it.y2) / 2;
    const [nx, ny] = rp(mx, my); const dx = nx - mx; const dy = ny - my;
    return { ...it, x1: it.x1 + dx, y1: it.y1 + dy, x2: it.x2 + dx, y2: it.y2 + dy, rot: (it.rot ?? 0) + th };
  }
  if (it.kind === 'text') { const [x, y] = rp(it.x, it.y); return { ...it, x, y, rot: (it.rot ?? 0) + th }; }
  return mapPts(it, rp);
}

