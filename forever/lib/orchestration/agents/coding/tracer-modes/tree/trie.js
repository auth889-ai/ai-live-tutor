// Tracer mode: TRIE — one file, one job. Engine: lib/execution/trace/trie/.

import { assembleTrieProgram, parseTrieEvents, compileTrieTrace } from '../../../../../execution/trace/engines.js';

export const trieMode = {
  key: 'trie',
  label: 'Trie trace',
  prompt: `TRIE MODE (python only) — for prefix-tree lessons (implement trie, insert/search/startsWith,
autocomplete, word dictionary): INSTEAD of "program", output
  "trie": {"entry": "<ONE call expression, e.g. demo()>",
           "root": "trie" (the variable holding the Trie instance or root node),
           "childrenAttr": "children" (dict char->node, or a 26-slot list),
           "endAttr": "is_end" (the end-of-word flag attribute),
           "cursors": ["node","cur"] (EVERY node variable the code walks with)}
with "code" = the clean TrieNode/Trie classes + operations + a demo function the entry calls
(insert several words sharing prefixes, then search for a stored word AND for a prefix-only
word like 'app' when 'apple' is stored — that contrast is the lesson). Our tracker runs it for
real: the tree grows character by character, end-of-word nodes turn green, the cursor rides
under the student's own variable name. Do not write tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.trie && typeof json.trie === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const t = json.trie;
    const source = assembleTrieProgram({
      code,
      entry: t.entry,
      root: t.root,
      childrenAttr: t.childrenAttr ?? 'children',
      endAttr: t.endAttr ?? 'is_end',
      cursors: Array.isArray(t.cursors) && t.cursors.length ? t.cursors : undefined,
    });
    const run = await exec({ language: 'python', source });
    if (run.timedOut) throw new Error('trie run timed out (likely an infinite loop)');
    const payload = parseTrieEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@TRIE line');
    const trace = compileTrieTrace({ ...payload, code, entry: t.entry, language: 'python' });
    trace.meta = {
      tool: 'trie',
      params: { code, entry: t.entry, root: t.root, childrenAttr: t.childrenAttr ?? 'children', endAttr: t.endAttr ?? 'is_end', cursors: Array.isArray(t.cursors) ? t.cursors : null },
    };
    return trace;
  },
};
