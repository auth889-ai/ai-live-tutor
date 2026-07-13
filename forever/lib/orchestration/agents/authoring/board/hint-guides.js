// Per-renderHint contract guides (one job: the rules each focused object call sees —
// ONLY its own). Narrow contract per call is the whole point of decomposed generation.

export const HINT_GUIDES = Object.freeze({
  text: 'content is a short STRING (a title or a compact note). A pure title/heading may add "decorative": true.',
  list: 'content is {"items": ["...", "..."]} — 2-5 short, concrete points.',
  callout: 'content is {"variant": one of mistake/checkpoint/recap/tip/analogy/insight, "title"?: "...", "body": "..." } — body is the teaching text.',
  quiz: 'content is {"question": "...", "choices": ["...", "..."] (2-4), "answerIndex": <0-based>, "explanation": "why the answer is right"} — the quiz must test THIS scene\'s idea with concrete values.',
  math: 'content is {"latex": "E = mc^2"} for one formula, or {"steps": [{"latex": "...", "note": "why this step"}]} for a derivation — real LaTeX, no prose inside latex.',
  table: 'content is {"columns": ["..."], "rows": [{"label": "...", "values": ["one per column"]}]} — the label column is implicit (never repeat the label as a column); EVERY cell filled with real text.',
  chart: `content is {"xAxis":{"label","min","max"},"yAxis":{"label","min","max"},"series":[{"id","label","points":[[x,y],...],"style"?:"solid|dashed|ghost"}],"annotations"?:[{"type":"point","x","y","label"}|{"type":"vline","x"}|{"type":"hline","y"}|{"type":"arrow","from":[x,y],"to":[x,y],"label"?}|{"type":"region","x1","x2","label"?}]}.
Every point INSIDE the axis ranges; every series labeled; a SHIFT keeps the old curve as style "ghost" with the same id stem ("demand_old"/"demand") plus an arrow annotation; name equilibria with "point" annotations; 2-6 series; never an empty template.`,
  diagram: `content is ONE of: {"diagramType":"flowchart","steps":[...]} | {"diagramType":"cycle","steps":[...]} | {"diagramType":"tree","root":{...}} | {"diagramType":"comparison","columns":[...],"rows":[{"label","values"}]} | {"diagramType":"array","values":[...]} | {"diagramType":"graph","nodes":[{"id","label"}],"edges":[{"from","to"}],"directed"?} | {"diagramType":"mermaid","code":"<first line declares the type: sequenceDiagram/stateDiagram-v2/classDiagram/erDiagram/architecture-beta/timeline/quadrantChart>"}.
If the concept IS a linked structure (tree/graph/list), draw diagramType "graph" with its REAL nodes/edges. Curves of quantities are NOT diagrams — they belong to renderHint "chart".`,
  image: 'content is {"url": <the imageId EXACTLY as given in availableImages, e.g. "fig_003" — unknown ids are DELETED>, "alt": "...", "caption"?: "...", "page"?: <number>, "annotations"?: ordered teaching marks [{"verb":"encircle|arrow|underline|highlight|pointer|label","bbox":{"x","y","w","h" all 0-1},"text"?}]}.',
});
