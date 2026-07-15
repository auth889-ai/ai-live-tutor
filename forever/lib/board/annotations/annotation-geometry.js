// Annotation mark geometry (pure, tested) — the math behind the Konva draw-on layer.
// Each teaching mark (encircle/underline/arrow/…) becomes a shape spec in PIXEL space from
// its normalized bbox (0-1, the Qwen-VL grounding contract), plus the stroke LENGTH the
// draw-on animation needs (dash = [len, len], dashOffset len -> 0 ≈ a pen drawing the mark).
// The renderer only tweens what this module computes.

// Ramanujan's ellipse-perimeter approximation — exact enough for a dash animation.
export function ellipsePerimeter(rx, ry) {
  const h = ((rx - ry) ** 2) / ((rx + ry) ** 2);
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

export function lineLength(points) {
  let total = 0;
  for (let i = 2; i < points.length; i += 2) {
    total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return total;
}

// bbox {x,y,w,h} in 0-1 fractions + the canvas pixel size -> one drawable mark spec.
// Returns null for malformed input (a mark that cannot be placed teaches nothing — drop it).
export function markSpec(annotation, width, height) {
  const b = annotation?.bbox;
  if (!b || [b.x, b.y, b.w, b.h].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const x = b.x * width;
  const y = b.y * height;
  const w = b.w * width;
  const h = b.h * height;
  const cx = x + w / 2;
  const cy = y + h / 2;

  switch (annotation.verb) {
    case 'encircle': {
      const rx = w / 2 + Math.min(10, width * 0.012);
      const ry = h / 2 + Math.min(10, height * 0.012);
      return { kind: 'ellipse', cx, cy, rx, ry, length: ellipsePerimeter(rx, ry) };
    }
    case 'underline': {
      const points = [x, y + h + 3, x + w, y + h + 3];
      return { kind: 'line', points, length: lineLength(points) };
    }
    case 'cross_out': {
      const points = [x, y, x + w, y + h];
      return { kind: 'cross', points, points2: [x + w, y, x, y + h], length: lineLength(points) * 2 };
    }
    case 'highlight':
      return { kind: 'rect', x, y, w, h }; // fades in, no stroke to draw
    case 'pointer':
      return { kind: 'dot', cx, cy, r: Math.max(5, width * 0.008) }; // pulses in
    case 'arrow': {
      // The arrow flies IN toward the target from the lower-left, ending at the bbox center.
      const fromX = Math.max(8, cx - Math.max(60, w));
      const fromY = Math.min(height - 8, cy + Math.max(46, h));
      const points = [fromX, fromY, cx, cy];
      return { kind: 'arrow', points, length: lineLength(points), text: annotation.text ?? null, textX: fromX, textY: fromY + 6 };
    }
    case 'label':
      return { kind: 'label', cx, cy, text: annotation.text ?? '', textY: Math.max(12, y - 10) };
    default:
      return null;
  }
}
