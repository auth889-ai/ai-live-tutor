// RECURSION-TREE LENS — detector/compiler pair #2 of the record-once/detect-later engine.
// The universal recording already contains the whole call tree (every call with args, every
// return with value, in nesting order); this lens recognizes self-recursion, rebuilds the
// exact vertex structure the dedicated recursion compiler animates (Euler-tour playback,
// return values landing on edges, memo hits purple), and derives the TEACHING LINES —
// call/base/combine — from which lines the real frames actually ran, not from guessing.
//
// Division of labor stays intact: this file only detects and adapts; the proven
// recursion/compiler.js + narrate.js own the animation and the tutor's words.

import { compileRecursionTrace } from '../../recursion/compiler.js';

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

// Rebuild the call tree in the exact shape recursion/compiler.js animates, then delegate.
export function compileRecursionTree({ recording, plan, code, language = 'python' }) {
  if (!plan || plan.lens !== 'recursion-tree') throw new Error('compileRecursionTree needs a plan from detectRecursionTree');
  const { fnName } = plan;
  const events = recording?.events ?? [];

  const vertices = {};
  const open = []; // vertex ids of currently-open fnName frames, outermost -> innermost
  const done = []; // finished calls: {id, argsKey, value, hadChildren}
  let nextId = 0;
  let callLineVotes = new Map();
  const baseLines = new Map();
  const combineLines = new Map();
  const lastLineAt = new Map(); // open vertex id -> last line event seen inside that frame

  for (const [i, e] of events.entries()) {
    if (e.ev === 'call' && e.fn === fnName) {
      const vid = nextId;
      nextId += 1;
      vertices[vid] = { args: Object.values(e.args ?? {}), children: [], memoized: false };
      if (open.length > 0) {
        vertices[open.at(-1)].children.push({ id: vid, value: null });
        // The caller's line right before this call IS the recursive call site — recorded, not guessed.
        const prev = events[i - 1];
        if (prev?.ev === 'line' && prev.fn === fnName) vote(callLineVotes, prev.line);
      }
      open.push(vid);
    } else if (e.ev === 'line' && e.fn === fnName && open.length > 0) {
      lastLineAt.set(open.at(-1), e.line);
    } else if (e.ev === 'return' && e.fn === fnName && open.length > 0) {
      const vid = open.pop();
      const v = vertices[vid];
      const parent = open.length > 0 ? vertices[open.at(-1)] : null;
      if (parent) {
        const slot = parent.children.find((c) => c.id === vid);
        if (slot) slot.value = e.value;
      }
      const argsKey = JSON.stringify(v.args);
      // MEMO HIT, detected from behavior: a childless call whose exact subproblem was already
      // SOLVED WITH REAL WORK earlier (same args, same value, that call had children). The
      // recording proves the shortcut — no declaration, no memo-variable naming convention.
      if (v.children.length === 0 && done.some((d) => d.argsKey === argsKey && JSON.stringify(d.value) === JSON.stringify(e.value) && d.hadChildren)) {
        v.memoized = true;
      }
      done.push({ id: vid, argsKey, value: e.value, hadChildren: v.children.length > 0 });
      const lineMap = v.children.length === 0 ? baseLines : combineLines;
      const ret = lastLineAt.get(vid);
      if (Number.isInteger(ret)) vote(lineMap, ret);
      lastLineAt.delete(vid);
    }
  }
  if (nextId === 0) throw new Error(`the recording holds no calls of "${fnName}"`);

  // A truncated recording leaves the deepest spine unclosed — mark those returns as the CUT,
  // openly, never as a fake result (the same honest-cut convention every engine follows).
  for (const vid of open) {
    for (const v of Object.values(vertices)) {
      const slot = v.children.find((c) => c.id === vid && c.value === null);
      if (slot) slot.value = '⟨recording cut⟩';
    }
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
  });
}

function vote(map, line) {
  map.set(line, (map.get(line) ?? 0) + 1);
}

function winner(map) {
  let best = null;
  for (const [line, count] of map) if (!best || count > best.count) best = { line, count };
  return best?.line ?? null;
}
