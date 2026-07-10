// Tracer mode: STRUCTURE (universal tree/graph auto-extraction) — one file, one job.
// Engine: lib/execution/trace/structure/. Applies ONLY when the problem is tree/graph-related:
// the tracker emits nothing unless real node objects or a domain-closed adjacency exist.

import { assembleStructureProgram, parseStructureEvents, compileStructureTrace } from '../../../../../execution/trace/engines.js';

export const structureMode = {
  key: 'structure',
  label: 'Structure trace',
  prompt: `STRUCTURE MODE (python only) — for ANY OTHER tree/graph problem where the code builds or walks
node objects (TreeNode/ListNode/Node) or an adjacency dict/list and no mode above fits better
(invert/serialize a tree, LCA, path sum, clone graph, course schedule): INSTEAD of "program", output
  "structure": {"entry": "<ONE call expression, e.g. invert(tree)>"}
with "code" = the clean classes + algorithm, and BUILD THE INPUT AT MODULE LEVEL (e.g.
"tree = build()" after the defs) so the entry operates on it. NOTHING else is declared — our
tracker AUTO-EXTRACTS the real structure from memory (every node object, every reference,
adjacency keys/neighbors) and tracks the cursor variable automatically. The tree/graph draws
itself and grows/walks exactly as the real run did. Do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.structure && typeof json.structure === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const source = assembleStructureProgram({ code, entry: json.structure.entry });
    const run = await exec({ language: 'python', source });
    if (run.timedOut) throw new Error('structure run timed out (likely an infinite loop or a cycle without a guard)');
    const payload = parseStructureEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(-400).trim()}` : 'run printed no @@STRUCTURE line');
    const trace = compileStructureTrace({ ...payload, code, entry: json.structure.entry, language: 'python' });
    trace.meta = { tool: 'structure', params: { code, entry: json.structure.entry } };
    return trace;
  },
};
