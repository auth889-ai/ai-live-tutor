// PLAYBACK STAGE of the universal structure tool: compile the tracker's auto-extracted
// snapshots into a validated ExecutionTrace on the existing GraphView. Ids are stable across
// snapshots (the tracker's registry), so:
//   views.graph  = the FINAL snapshot's structure (nodes + edges, left/right as sides) — a
//                  static frame the layout runs on once (mid-run mutations settle to the end
//                  state; growth is animated via `revealed`)
//   steps        = growth (new nodes appearing) + the cursor walking (whitelisted local whose
//                  id() equals a node — the research's cursor rule), visited accumulating,
//                  activeEdge when the cursor moves along a real link.

import { validateExecutionTrace } from '../../../board/execution/execution-trace.js';

import { narrateStart, narrateGrow, narrateCursor, narrateDone } from './narrate.js';

const CURSOR_PRIORITY = ['node', 'cur', 'curr', 'current', 'u', 'v', 'p', 'x', 'root', 'head'];

export function compileStructureTrace({ events, result, code, entry = null, language = 'python' } = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new Error('structure tracker recorded no events');
  const truncated = events[events.length - 1]?.truncated === true;
  if (truncated) events = events.slice(0, -1);
  const lineCount = String(code ?? '').split('\n').length;
  const snaps = events.filter((e) => e?.state && Number.isInteger(Number(e.line)) && Number(e.line) >= 1 && Number(e.line) <= lineCount);
  if (snaps.length === 0) throw new Error('no tree/graph structure was detected in the run — this problem may not be structure-related');

  // The FINAL snapshot defines the rendered structure; labels remember the latest seen value.
  const labelOf = {};
  for (const ev of snaps) {
    const st = ev.state;
    if (st.kind === 'adj') for (const id of st.nodes) labelOf[id] = id;
    else for (const [id, n] of Object.entries(st.nodes)) labelOf[id] = String(n.label);
  }
  const last = snaps[snaps.length - 1].state;
  const finalIds = last.kind === 'adj' ? [...last.nodes] : Object.keys(last.nodes);
  const idSet = new Set(finalIds);
  const edges = [];
  const edgeKey = new Set();
  const addEdge = (from, to, side) => {
    const k = `${from}>${to}`;
    if (!idSet.has(from) || !idSet.has(to) || edgeKey.has(k)) return;
    edgeKey.add(k);
    edges.push({ from, to, ...(side ? { side } : {}) });
  };
  if (last.kind === 'adj') for (const [f, t] of last.edges) addEdge(f, t);
  else for (const [id, n] of Object.entries(last.nodes)) for (const [field, cid] of n.refs) addEdge(id, cid, field === 'left' || field === 'right' ? field : undefined);
  const hasEdgeBetween = (a, b) => edgeKey.has(`${a}>${b}`) || edgeKey.has(`${b}>${a}`);

  // Steps: growth + cursor. Everything filtered to the FINAL id set (validator contract).
  const steps = [];
  const revealed = [];
  const visited = [];
  let prevCur = null;
  for (const ev of snaps) {
    const st = ev.state;
    const present = (st.kind === 'adj' ? st.nodes : Object.keys(st.nodes)).filter((id) => idSet.has(id));
    const fresh = present.filter((id) => !revealed.includes(id));
    revealed.push(...fresh);

    let cur = null;
    let curName = null;
    for (const nm of CURSOR_PRIORITY) {
      const v = st.pointers?.[nm];
      if (v && idSet.has(v)) { cur = v; curName = nm; break; }
    }

    const parts = [];
    if (fresh.length > 0 && revealed.length > fresh.length) {
      parts.push(narrateGrow({ labels: fresh.map((id) => labelOf[id]), total: revealed.length }));
    }
    if (cur && cur !== prevCur) {
      if (prevCur && !visited.includes(prevCur)) visited.push(prevCur);
      parts.push(narrateCursor({ name: curName, label: labelOf[cur], fromLabel: prevCur ? labelOf[prevCur] : null }));
    }
    if (parts.length === 0) { prevCur = cur ?? prevCur; continue; }

    steps.push({
      line: Number(ev.line),
      explanation: parts.join(' '),
      graph: {
        current: cur,
        visited: visited.filter((id) => idSet.has(id)),
        revealed: [...revealed],
        pointers: cur ? { [curName]: cur } : {},
      },
      ...(cur && prevCur && cur !== prevCur && hasEdgeBetween(prevCur, cur) ? { activeEdge: [prevCur, cur] } : {}),
      variables: ev.variables && typeof ev.variables === 'object' ? ev.variables : {},
    });
    prevCur = cur ?? prevCur;
  }
  if (steps.length === 0) throw new Error('the structure never changed and no cursor walked it — nothing to animate');

  if (entry) {
    steps.unshift({
      line: steps[0].line,
      explanation: narrateStart({ entry }),
      graph: { current: null, visited: [], revealed: [], pointers: {} },
      variables: {},
    });
  }
  steps.push({
    line: steps[steps.length - 1].line,
    explanation: narrateDone({ result, nodeCount: finalIds.length, edgeCount: edges.length, truncated }),
    graph: { current: null, visited: visited.filter((id) => idSet.has(id)), revealed: [...finalIds], pointers: {} },
    variables: {},
  });

  return validateExecutionTrace({
    language,
    code: String(code ?? ''),
    views: { graph: { nodes: finalIds.map((id) => ({ id, label: labelOf[id] ?? id })), edges, directed: true } },
    steps,
  }, 'structure trace');
}
