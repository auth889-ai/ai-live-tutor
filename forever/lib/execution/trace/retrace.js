// RETRACE — what makes every dry run a LIVE INSTRUMENT instead of a frozen recording (the
// capability the studied tools have: change the input, watch the structure change). A trace
// carries its recipe in trace.meta {tool, params}; this dispatcher re-runs the SAME
// deterministic engines on student-modified params — no LLM anywhere, so it is instant,
// exact, and cheap. Bounded hard: sizes capped, recursion re-runs only in the sandbox.

import { compileTraversalTrace } from './traversal/compiler.js';
import { compileRecursionTrace, assembleRecursionProgram, parseCallTree } from './recursion/compiler.js';
import { runCode } from '../run-code.js';

export const RETRACE_TOOLS = Object.freeze(['traversal', 'recursion']);

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

  throw new Error(`retrace tool must be one of ${RETRACE_TOOLS.join(', ')} (got "${tool}")`);
}
