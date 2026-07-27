// RECURSION-TREE LENS — detector/compiler pair #2 of the record-once/detect-later engine.
// The universal recording already contains the whole call tree (every call with args, every
// return with value, in nesting order); this lens recognizes self-recursion and is the THIN
// ADAPTER onto the vendored brpapa/recursion-tree-visualizer machinery (vendor/
// recursion-tree-visualizer/): the reference's tree builder replays the recorded call/return
// events through its parent-stack discipline (callId/parentCallId/args/weight per vertex),
// and its Reingold-Tilford layout supplies the reference's exact node coordinates. On top of
// the copied machinery this file derives the TEACHING LINES — call/base/combine — from which
// lines the real frames actually ran, and detects the choose→recurse→undo (backtracking)
// shape from recorded collection ops so explicit backtrack beats can be emitted.
//
// HARD LAW: an edge/parent-child link is only ever emitted because the recording shows that
// call opening while its parent was the innermost open frame — never inferred from code text.
// Same law for undo: a backtrack step exists only when a recorded mutation before a recursive
// call has a recorded inverse (same collection, same value) after that call returned.
//
// Division of labor stays intact: this file only detects and adapts; the proven
// recursion/compiler.js + narrate.js own the animation and the tutor's words.

import { compileRecursionTrace } from '../../recursion/compiler.js';
import { buildTreeFromEvents } from '../../../../../vendor/recursion-tree-visualizer/tree-builder.js';
import { toIntermediateTree } from '../../../../../vendor/recursion-tree-visualizer/layout.js';

// Decide the lens from the recording. Returns null or:
//   { lens: 'recursion-tree', confidence, fnName, calls }
export function detectRecursionTree(recording, _ctx = {}) {
  const events = recording?.events ?? [];
  const truncated = events.at(-1)?.truncated === true;

  // Self-recursion = a call of fn opens while another call of THE SAME fn is still open.
  const stack = [];
  const callCounts = new Map();
  const returnCounts = new Map();
  const recursive = new Set();
  for (const e of events) {
    if (e.ev === 'call') {
      if (stack.includes(e.fn)) recursive.add(e.fn);
      stack.push(e.fn);
      callCounts.set(e.fn, (callCounts.get(e.fn) ?? 0) + 1);
    } else if (e.ev === 'return') {
      if (stack.at(-1) === e.fn) {
        stack.pop();
        returnCounts.set(e.fn, (returnCounts.get(e.fn) ?? 0) + 1);
      }
    }
  }
  // A truncated recording is a PREFIX, not a lie — the deep problems that need 180-300 steps
  // are exactly the ones that hit the cap, and refusing them dropped the whole family to the
  // floor. Unbalanced WITHOUT a truncation sentinel is a genuinely broken recording: refuse.
  if (stack.length > 0 && !truncated) return null;

  let best = null;
  for (const fn of recursive) {
    const closed = returnCounts.get(fn) ?? 0; // enough COMPLETED calls to teach from
    if (closed >= 3 && (!best || closed > best.closed)) best = { fnName: fn, calls: callCounts.get(fn) ?? closed, closed };
  }
  if (!best) return null;
  return { lens: 'recursion-tree', confidence: 0.85, fnName: best.fnName, calls: best.calls };
}

// Rebuild the call tree via the VENDORED reference builder, then delegate to the proven
// recursion compiler in the exact callTree shape it animates.
export function compileRecursionTree({ recording, plan, code, language = 'python' }) {
  if (!plan || plan.lens !== 'recursion-tree') throw new Error('compileRecursionTree needs a plan from detectRecursionTree');
  const { fnName } = plan;
  const events = recording?.events ?? [];

  const built = buildTreeFromEvents({ events, fnName, result: recording?.result });
  if (Object.keys(built.vertices).length === 0) throw new Error(`the recording holds no calls of "${fnName}"`);

  // TEACHING LINES from the recorded line events. A frame's identity in the event stream is
  // its (fn, depth) pair for its whole lifetime — no other fnName frame can share that depth
  // while it is open — so one forward pass keyed by depth recovers each call's last-run line.
  const hasParent = new Set();
  for (const v of Object.values(built.vertices)) for (const a of v.adjList) hasParent.add(a.childId);
  const retVidAt = new Map([...built.returnEventIndex].map(([vid, i]) => [i, vid]));
  const callVidAt = new Map([...built.callEventIndex].map(([vid, i]) => [i, vid]));
  const callLineVotes = new Map();
  const baseLines = new Map();
  const combineLines = new Map();
  const lastLineByDepth = new Map();
  for (const [i, e] of events.entries()) {
    if (e.ev === 'line' && e.fn === fnName) {
      lastLineByDepth.set(e.depth, e.line);
    } else if (callVidAt.has(i)) {
      lastLineByDepth.delete(e.depth); // a fresh frame at this depth — never inherit a sibling's line
      if (hasParent.has(callVidAt.get(i))) {
        // The caller's line right before this call IS the recursive call site — recorded, not guessed.
        const prev = events[i - 1];
        if (prev?.ev === 'line' && prev.fn === fnName) vote(callLineVotes, prev.line);
      }
    } else if (retVidAt.has(i)) {
      const vid = retVidAt.get(i);
      const ln = lastLineByDepth.get(e.depth);
      if (Number.isInteger(ln)) vote(built.vertices[vid].adjList.length === 0 ? baseLines : combineLines, ln);
    }
  }

  // BACKTRACKING: choose→recurse→undo proved from recorded collection ops.
  const undoByVid = detectUndos({ events, collops: recording?.collops, fnName, built });

  // Adapt the reference node model {argsList, adjList:[{childId, weight}]} to the proven
  // compiler's callTree shape {args, children:[{id, value}], memoized}.
  const vertices = {};
  for (const [id, v] of Object.entries(built.vertices)) {
    vertices[id] = {
      args: v.argsList,
      children: v.adjList.map((a) => ({
        id: a.childId,
        value: a.weight === undefined ? null : a.weight,
        ...(undoByVid.has(a.childId) ? { undo: undoByVid.get(a.childId) } : {}),
      })),
      memoized: v.memoized,
    };
  }

  // A truncated recording leaves the deepest spine unclosed — mark those returns as the CUT,
  // openly, never as a fake result (the same honest-cut convention every engine follows).
  for (const vid of built.openIds) {
    for (const v of Object.values(vertices)) {
      const slot = v.children.find((c) => c.id === vid && c.value === null);
      if (slot) slot.value = '⟨recording cut⟩';
    }
  }

  // Reference layout (Reingold-Tilford) — optional enrichment; a coordinate failure must
  // never cost the trace itself.
  let layout = null;
  try {
    const inter = toIntermediateTree({ vertices: built.vertices, fnResult: built.fnResult });
    if (Object.keys(inter.coords).length > 0) layout = inter.coords;
  } catch {
    layout = null;
  }

  const lines = {
    call: winner(callLineVotes) ?? winner(combineLines) ?? 1,
    base: winner(baseLines) ?? 1,
    combine: winner(combineLines) ?? winner(baseLines) ?? 1,
    memo: winner(baseLines) ?? 1,
  };
  return compileRecursionTrace({
    callTree: { fnName, result: recording.result, vertices },
    code,
    language,
    lines,
    layout,
  });
}

// Inverse-op pairs: the only mutations that can prove a choose, and the only ops that can
// prove its undo. A pair is claimed per child call when the choose is the LAST matching
// mutation in the caller's frame before the call and the undo is the FIRST inverse mutation
// of the SAME collection with the SAME value after the return — all four facts recorded.
const UNDO_OPS = { append: ['pop'], appendleft: ['popleft'], add: ['remove', 'discard'] };

function detectUndos({ events, collops, fnName, built }) {
  const undoByVid = new Map();
  if (!Array.isArray(collops) || collops.length === 0) return undoByVid;

  for (const [uStr, v] of Object.entries(built.vertices)) {
    const u = Number(uStr);
    const uCall = built.callEventIndex.get(u);
    const uRet = built.returnEventIndex.get(u);
    for (let k = 0; k < v.adjList.length; k += 1) {
      const childId = v.adjList[k].childId;
      const ci = built.callEventIndex.get(childId);
      const ri = built.returnEventIndex.get(childId);
      if (ci === undefined || ri === undefined || uCall === undefined) continue;
      const callerDepth = (events[ci]?.depth ?? 1) - 1;
      // The caller's frame windows around this child: after the previous sibling closed,
      // before the next sibling opened (or the caller itself returned).
      const lower = k > 0 ? (built.returnEventIndex.get(v.adjList[k - 1].childId) ?? uCall) : uCall;
      const upper = k + 1 < v.adjList.length
        ? (built.callEventIndex.get(v.adjList[k + 1].childId) ?? events.length)
        : (uRet ?? events.length);
      // A collection op recorded at _events length L executed DURING the event at L-1; it
      // belongs to the caller only if that event is a line of the caller's own frame.
      const inCallerFrame = (idx) => idx >= 0 && events[idx]?.ev === 'line' && events[idx].fn === fnName && events[idx].depth === callerDepth;

      let choose = null;
      for (const op of collops) {
        const idx = op.i - 1;
        if (idx <= lower || idx >= ci) continue;
        if (!UNDO_OPS[op.op] || op.arg === undefined) continue;
        if (!inCallerFrame(idx)) continue;
        choose = op; // keep the LAST mutation before the call
      }
      if (!choose) continue;

      let undo = null;
      for (const op of collops) {
        const idx = op.i - 1;
        if (idx <= ri || idx >= upper) continue;
        if (op.n !== choose.n || !UNDO_OPS[choose.op].includes(op.op)) continue;
        if (!inCallerFrame(idx)) continue;
        undo = op; // the FIRST inverse after the return
        break;
      }
      if (!undo) continue;
      const undone = undo.ret !== undefined ? undo.ret : undo.arg;
      if (undone === undefined || JSON.stringify(undone) !== JSON.stringify(choose.arg)) continue;

      // Recorded states around the undo: the line event a mutation executed during fires
      // BEFORE the line runs, so its locals are the state before the undo; the caller's next
      // recorded moment (line or its own return locals) is the state after.
      const undoIdx = undo.i - 1;
      const stateBefore = events[undoIdx]?.locals?.[choose.n];
      let stateAfter;
      for (let j = undoIdx + 1; j <= Math.min(events.length - 1, upper); j += 1) {
        const e = events[j];
        if ((e.ev === 'line' || e.ev === 'return') && e.fn === fnName && e.depth === callerDepth && e.locals?.[choose.n] !== undefined) {
          stateAfter = e.locals[choose.n];
          break;
        }
      }
      // REVERT CHECK: when both the pre-choose state and the post-undo state were recorded,
      // they must match exactly — a mutation that was not restored is no backtrack.
      const preChoose = events[choose.i - 1]?.locals?.[choose.n];
      if (preChoose !== undefined && stateAfter !== undefined && JSON.stringify(preChoose) !== JSON.stringify(stateAfter)) continue;

      undoByVid.set(childId, {
        name: choose.n,
        value: choose.arg,
        ...(stateBefore !== undefined ? { stateBefore } : {}),
        ...(stateAfter !== undefined ? { stateAfter } : {}),
        line: events[undoIdx]?.line,
      });
    }
  }
  return undoByVid;
}

function vote(map, line) {
  map.set(line, (map.get(line) ?? 0) + 1);
}

function winner(map) {
  let best = null;
  for (const [line, count] of map) if (!best || count > best.count) best = { line, count };
  return best?.line ?? null;
}
