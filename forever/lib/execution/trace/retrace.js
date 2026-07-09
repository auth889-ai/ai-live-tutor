// RETRACE — what makes every dry run a LIVE INSTRUMENT instead of a frozen recording (the
// capability the studied tools have: change the input, watch the structure change). A trace
// carries its recipe in trace.meta {tool, params}; this dispatcher re-runs the SAME
// deterministic engines on student-modified params — no LLM anywhere, so it is instant,
// exact, and cheap. Bounded hard: sizes capped, recursion re-runs only in the sandbox.

import { compileTraversalTrace } from './traversal/compiler.js';
import { compileRecursionTrace, assembleRecursionProgram, parseCallTree } from './recursion/compiler.js';
import { compilePointerWalk } from './pointer-walk/compiler.js';
import { compileGraphWalk } from './graph-walk/compiler.js';
import { compileLinkedListTrace } from './linked-list/compiler.js';
import { assembleListProgram, parseListEvents } from './linked-list/tracker.js';
import { compileDivideConquer } from './divide-conquer/compiler.js';
import { assembleDivideProgram, parseDivideEvents } from './divide-conquer/tracker.js';
import { compileTrieTrace } from './trie/compiler.js';
import { assembleTrieProgram, parseTrieEvents } from './trie/tracker.js';
import { assembleLineProgram, parseLineEvents } from './line-sim/compiler.js';
import { runCode } from '../run-code.js';

export const RETRACE_TOOLS = Object.freeze(['traversal', 'recursion', 'pointerwalk', 'graphwalk', 'linkedlist', 'divideconquer', 'trie']);

export async function retrace({ tool, params } = {}, deps = {}) {
  const exec = deps.runCode ?? runCode;

  if (tool === 'traversal') {
    const { graph, kind, start, code, lines } = params ?? {};
    if ((graph?.nodes?.length ?? 0) > 40) throw new Error('graph too large to retrace (max 40 nodes)');
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    const trace = compileTraversalTrace({ graph, kind, start, code, lines });
    trace.meta = { tool, params: { graph, kind, start, code, lines } };
    return trace;
  }

  if (tool === 'recursion') {
    const { code, fnName, args, memoize, lines } = params ?? {};
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (JSON.stringify(args ?? []).length > 200) throw new Error('arguments too large to retrace');
    const source = assembleRecursionProgram({ code, fnName, args, memoize: memoize === true });
    const run = await exec({ language: 'python', source, timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the recursion timed out — try smaller arguments');
    const callTree = parseCallTree(run.stdout);
    if (!callTree) {
      throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no call tree was recorded');
    }
    const trace = compileRecursionTrace({ callTree, code, lines });
    trace.meta = { tool, params: { code, fnName, args, memoize: memoize === true, lines } };
    return trace;
  }

  if (tool === 'pointerwalk') {
    const { code, entry, array, pointers, examine, arrayVar, eliminatedOutside, window } = params ?? {};
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (String(entry ?? '').length > 200) throw new Error('entry expression too large to retrace');
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry }), timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the walk timed out — try a smaller input');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no walk was recorded');
    // The student edits the ENTRY (their own array lives inside it) — derive the concrete
    // array from what the run actually saw, so the view always matches the real input.
    const seen = arrayVar
      ? payload.events.map((e) => e?.locals?.[arrayVar]).find((v) => Array.isArray(v) && v.length > 0)
      : null;
    const concrete = seen ?? array;
    if (!Array.isArray(concrete) || concrete.length === 0) throw new Error('could not determine the concrete array of this run');
    if (concrete.length > 40) throw new Error('array too large to retrace (max 40 values)');
    const trace = compilePointerWalk({ ...payload, code, array: concrete, pointers, examine, arrayVar, eliminatedOutside, window });
    trace.meta = { tool, params: { code, entry, array: concrete, pointers, examine, arrayVar, eliminatedOutside, window } };
    return trace;
  }

  if (tool === 'graphwalk') {
    const { code, entry, graph, lens } = params ?? {};
    if ((graph?.nodes?.length ?? 0) > 40) throw new Error('graph too large to retrace (max 40 nodes)');
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (String(entry ?? '').length > 200) throw new Error('entry expression too large to retrace');
    const run = await exec({ language: 'python', source: assembleLineProgram({ code, entry }), timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the walk timed out — try a smaller input');
    const payload = parseLineEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no walk was recorded');
    const trace = compileGraphWalk({ ...payload, code, entry, graph, lens });
    trace.meta = { tool, params: { code, entry, graph, lens } };
    return trace;
  }

  if (tool === 'linkedlist') {
    const { code, entry, roots, nextAttr, valAttr } = params ?? {};
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (String(entry ?? '').length > 200) throw new Error('entry expression too large to retrace');
    const source = assembleListProgram({ code, entry, roots, nextAttr, valAttr });
    const run = await exec({ language: 'python', source, timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the run timed out — try a smaller list');
    const payload = parseListEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no chain activity was recorded');
    const trace = compileLinkedListTrace({ ...payload, code, entry });
    trace.meta = { tool, params: { code, entry, roots, nextAttr, valAttr } };
    return trace;
  }

  if (tool === 'divideconquer') {
    const { code, entry, fn, arrayVar, lo, hi, pointers } = params ?? {};
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (String(entry ?? '').length > 200) throw new Error('entry expression too large to retrace');
    const source = assembleDivideProgram({ code, entry, fn, arrayVar, loVar: lo, hiVar: hi });
    const run = await exec({ language: 'python', source, timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the run timed out — try a smaller array');
    const payload = parseDivideEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no run was recorded');
    const trace = compileDivideConquer({ ...payload, code, entry, fn, pointers: Array.isArray(pointers) ? pointers : [] });
    trace.meta = { tool, params: { code, entry, fn, arrayVar, lo, hi, pointers } };
    return trace;
  }

  if (tool === 'trie') {
    const { code, entry, root, childrenAttr, endAttr, cursors } = params ?? {};
    if (String(code ?? '').length > 4000) throw new Error('code too large to retrace');
    if (String(entry ?? '').length > 200) throw new Error('entry expression too large to retrace');
    const source = assembleTrieProgram({
      code, entry, root, childrenAttr, endAttr, cursors: Array.isArray(cursors) && cursors.length ? cursors : undefined,
    });
    const run = await exec({ language: 'python', source, timeoutMs: 8000 });
    if (run.timedOut) throw new Error('the run timed out — try fewer/shorter words');
    const payload = parseTrieEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `the run errored: ${run.stderr.slice(0, 200)}` : 'no trie activity was recorded');
    const trace = compileTrieTrace({ ...payload, code, entry });
    trace.meta = { tool, params: { code, entry, root, childrenAttr, endAttr, cursors } };
    return trace;
  }

  throw new Error(`retrace tool must be one of ${RETRACE_TOOLS.join(', ')} (got "${tool}")`);
}
