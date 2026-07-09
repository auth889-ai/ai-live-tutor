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

  // Normalize into a padded box and emit dagre-shaped output.
  const widths = nodes.map((node) => Math.max(48, String(node.label ?? node.id).length * 10 + 24));
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
export function wantsForceLayout({ nodes = [], edges = [] } = {}, directed = true) {
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
