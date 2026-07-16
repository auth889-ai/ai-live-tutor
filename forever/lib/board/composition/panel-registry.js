// PANEL REGISTRY + LAYOUT POLICY (C3, pure half). The registry is the contract between a
// CompositionSpec and the React cockpit: which panel types exist, what each requires, and
// the spec-level limits (reviewer: max panels, max text, no coordinates, no CSS). The layout
// policy is DETERMINISTIC: the AI writes only layoutIntent; the ENGINE picks the actual
// layout from the structure — an AI naming engines is how visualizations break.

export const PANEL_TYPES = Object.freeze(['graph', 'grid', 'state-table', 'call-stack', 'queue', 'concept-card', 'legend']);
export const LAYOUT_INTENTS = Object.freeze(['auto', 'hierarchical', 'force', 'grid', 'linear']);

const MAX_PANELS = 6;
const MAX_TEXT = 400;
const MAX_TITLE = 80;

// normalizeSpec(spec) -> { ok: true, spec } | { ok: false, reason }
// A rejected spec NEVER renders — the caller falls back to the deterministic default cockpit.
export function normalizeSpec(spec) {
  if (!spec || typeof spec !== 'object') return { ok: false, reason: 'spec must be an object' };
  const panels = spec.panels;
  if (!Array.isArray(panels) || panels.length === 0) return { ok: false, reason: 'spec needs panels[]' };
  if (panels.length > MAX_PANELS) return { ok: false, reason: `${panels.length} panels exceeds the max of ${MAX_PANELS} — a cockpit is not a dashboard dump` };
  const intent = spec.layoutIntent ?? 'auto';
  if (!LAYOUT_INTENTS.includes(intent)) return { ok: false, reason: `unknown layoutIntent "${intent}" (${LAYOUT_INTENTS.join(', ')})` };
  for (const [i, p] of panels.entries()) {
    const at = `panel ${i}`;
    if (!p || typeof p !== 'object') return { ok: false, reason: `${at} must be an object` };
    if (!PANEL_TYPES.includes(p.type)) return { ok: false, reason: `${at}: unknown type "${p.type}" (${PANEL_TYPES.join(', ')})` };
    if (p.title !== undefined && (typeof p.title !== 'string' || p.title.length > MAX_TITLE)) return { ok: false, reason: `${at}: title must be a string ≤ ${MAX_TITLE} chars` };
    if (p.content !== undefined && (typeof p.content !== 'string' || p.content.length > MAX_TEXT)) return { ok: false, reason: `${at}: content must be a string ≤ ${MAX_TEXT} chars` };
    if (p.x !== undefined || p.y !== undefined || p.style !== undefined || p.css !== undefined) {
      return { ok: false, reason: `${at}: coordinates/CSS are not spec territory — layout is the engine's` };
    }
    if (p.type === 'state-table' && !Array.isArray(p.columns)) return { ok: false, reason: `${at}: state-table needs columns[]` };
    if (p.type === 'concept-card' && typeof p.content !== 'string') return { ok: false, reason: `${at}: concept-card needs content text` };
    for (const badge of p.nodeBadges ?? []) {
      if (typeof badge.label !== 'string' || !badge.binding) return { ok: false, reason: `${at}: nodeBadges need {label, binding}` };
    }
  }
  return { ok: true, spec: { ...spec, layoutIntent: intent } };
}

// chooseLayout(structureSpec, intent) -> the engine the renderer actually uses.
// Policy (reviewer's, mapped to what is installed): grids never go to a graph engine; big or
// long-labeled graphs need the strongest layered engine available; single-root hierarchies
// get the tree layout; everything else gets the organic force layout the references use.
export function chooseLayout(structure, intent = 'auto') {
  const kind = structure?.kind ?? null;
  if (kind === 'grid') return 'css-grid';
  if (kind === 'array' || kind === 'list' || kind === 'intervals') return 'linear';
  if (kind !== 'graph') return 'linear';
  const g = structure.views?.find((v) => v.kind === 'graph')?.meta ?? {};
  if ((g.nodeCount ?? 0) > 15 || (g.avgLabelLength ?? 0) > 30) return 'elk'; // renderer falls back to force until elk is wired
  if (intent === 'hierarchical') return 'tree';
  if (intent === 'grid') return 'css-grid';
  return 'force';
}
