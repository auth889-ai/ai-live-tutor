// ORGANIC graph layout — deterministic Fruchterman–Reingold force placement (pure, no DOM,
// unit-tested). The reference visualizers draw general graphs the way a textbook sketches
// them: nodes spread naturally in 2D with edges crossing space — not stacked in dagre rows.
// FR is the standard algorithm for that look. Deterministic by construction: nodes seed on a
// fixed ring (by index), a fixed number of cooling iterations, no randomness — the same graph
// always lays out identically (positions are computed once per structure and never per step).
//
// Returns the exact same shape as layoutGraph (dagre) so GraphView can switch freely.

const NODE_H = 44;

export function layoutForce({ nodes = [], edges = [] } = {}, { iterations = 320 } = {}) {
  if (nodes.length === 0) throw new Error('graph needs at least one node');
  const n = nodes.length;
  const ids = nodes.map((node) => String(node.id));
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges
    .map((e) => [index.get(String(e.from)), index.get(String(e.to))])
    .filter(([a, b]) => a !== undefined && b !== undefined && a !== b);

  // Working area scales gently with node count; k = the ideal pairwise distance.
  const area = Math.max(360 * 260, n * 26000);
  const W = Math.sqrt(area * 1.5);
  const H = Math.sqrt(area / 1.5);
  const k = Math.sqrt((W * H) / Math.max(1, n)) * 0.85;

  // Deterministic seeding: a ring, ordered by node index (stable across runs).
  const px = new Array(n);
  const py = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const a = (2 * Math.PI * i) / n;
    px[i] = W / 2 + (Math.min(W, H) / 3) * Math.cos(a);
    py[i] = H / 2 + (Math.min(W, H) / 3) * Math.sin(a);
  }
  if (n === 1) { px[0] = W / 2; py[0] = H / 2; }

  const dx = new Array(n);
  const dy = new Array(n);
  for (let iter = 0; iter < iterations; iter += 1) {
    const temp = (Math.max(W, H) / 10) * (1 - iter / iterations); // linear cooling
    dx.fill(0); dy.fill(0);
    // Repulsion between every pair: k^2 / d.
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let vx = px[i] - px[j];
        let vy = py[i] - py[j];
        let d = Math.hypot(vx, vy);
        if (d < 0.01) { d = 0.01; vx = 0.01 * ((i + j) % 2 ? 1 : -1); vy = 0.01; } // deterministic nudge
        const f = (k * k) / d;
        dx[i] += (vx / d) * f; dy[i] += (vy / d) * f;
        dx[j] -= (vx / d) * f; dy[j] -= (vy / d) * f;
      }
    }
    // Attraction along edges: d^2 / k.
    for (const [a, b] of links) {
      const vx = px[a] - px[b];
      const vy = py[a] - py[b];
      const d = Math.max(0.01, Math.hypot(vx, vy));
      const f = (d * d) / k;
      dx[a] -= (vx / d) * f; dy[a] -= (vy / d) * f;
      dx[b] += (vx / d) * f; dy[b] += (vy / d) * f;
    }
    // Gentle centering keeps disconnected components from drifting apart forever.
    for (let i = 0; i < n; i += 1) {
      dx[i] += (W / 2 - px[i]) * 0.02;
      dy[i] += (H / 2 - py[i]) * 0.02;
      const disp = Math.max(0.01, Math.hypot(dx[i], dy[i]));
      px[i] += (dx[i] / disp) * Math.min(disp, temp);
      py[i] += (dy[i] / disp) * Math.min(disp, temp);
    }
  }

  // BOX-AWARE separation: FR treats nodes as points, but our pills are WIDE — a 25-char label
  // is ~270px, so two centers an "ideal" k apart can still overlap badly (the two-node De
  // Bruijn sketch stacked its pills). Resolve residual box overlaps deterministically: push
  // apart along the axis of least penetration until clean (or the pass budget ends).
  const widths = nodes.map((node) => Math.max(48, String(node.label ?? node.id).length * 10 + 24));
  const HGAP = 28;
  const VGAP = 18;
  for (let pass = 0; pass < 80; pass += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const ox = (widths[i] + widths[j]) / 2 + HGAP - Math.abs(px[i] - px[j]);
        const oy = NODE_H + VGAP - Math.abs(py[i] - py[j]);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox <= oy) {
          const s = px[i] === px[j] ? (i % 2 ? 1 : -1) : Math.sign(px[i] - px[j]);
          px[i] += (s * ox) / 2;
          px[j] -= (s * ox) / 2;
        } else {
          const s = py[i] === py[j] ? (i % 2 ? 1 : -1) : Math.sign(py[i] - py[j]);
          py[i] += (s * oy) / 2;
          py[j] -= (s * oy) / 2;
        }
      }
    }
    if (!moved) break;
  }

  // Normalize into a padded box and emit dagre-shaped output.
  const minX = Math.min(...px);
  const minY = Math.min(...py);
  const PAD = 30;
  return {
    nodes: nodes.map((node, i) => ({
      id: ids[i],
      label: String(node.label ?? node.id),
      x: Math.round(px[i] - minX + PAD - widths[i] / 2),
      y: Math.round(py[i] - minY + PAD - NODE_H / 2),
      width: Math.round(widths[i]),
      height: NODE_H,
    })),
    edges: edges.map((edge, i) => ({ id: `e${i}`, from: String(edge.from), to: String(edge.to), label: edge.label ? String(edge.label) : '' })),
    width: Math.round(Math.max(...px) - minX + PAD * 2),
    height: Math.round(Math.max(...py) - minY + PAD * 2),
  };
}

// A rooted structure with no cycles and single parents reads best as a tidy tree; anything
// with cross-edges, multiple parents, cycles or undirectedness reads best organically.
// Connected-components check: FR force repulsion FLINGS disconnected fragments apart (live
// screenshot: three two-node islands scattered across an empty canvas, auto-zoomed to
// confetti). A disconnected graph always goes to dagre, which stacks components compactly.
function isConnected({ nodes = [], edges = [] }) {
  if (nodes.length <= 1) return true;
  const adjacency = new Map(nodes.map((n) => [String(n.id), []]));
  for (const e of edges) {
    const a = String(e.from);
    const b = String(e.to);
    if (adjacency.has(a) && adjacency.has(b)) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  }
  const stack = [String(nodes[0].id)];
  const seen = new Set(stack);
  while (stack.length) {
    for (const next of adjacency.get(stack.pop()) ?? []) {
      if (!seen.has(next)) { seen.add(next); stack.push(next); }
    }
  }
  return seen.size === nodes.length;
}

export function wantsForceLayout({ nodes = [], edges = [] } = {}, directed = true) {
  if (!isConnected({ nodes, edges })) return false;
  if (directed === false) return true;
  const parents = new Map();
  const seen = new Set(nodes.map((n) => String(n.id)));
  for (const e of edges) {
    const to = String(e.to);
    if (!seen.has(to)) continue;
    parents.set(to, (parents.get(to) ?? 0) + 1);
    if (parents.get(to) > 1) return true; // shared child / cross edge
  }
  return edges.length > Math.max(0, nodes.length - 1); // extra edges => cycle
}
