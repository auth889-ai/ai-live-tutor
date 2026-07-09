// Tracer mode: LINKED-LIST — one file, one job. Engine: lib/execution/trace/linked-list/.

import { assembleListProgram, parseListEvents, compileLinkedListTrace } from '../../../../../execution/trace/engines.js';

export const linkedListMode = {
  key: 'linkedlist',
  label: 'Linked-list trace',
  prompt: `LINKED-LIST MODE (python only) — for algorithms over node chains (traverse, reverse, insert,
delete, middle via slow/fast, cycle detection): INSTEAD of "program", output
  "linkedlist": {"entry": "<ONE call expression, e.g. reverse(lst)>",
                 "roots": ["head","prev","curr","nxt"] (EVERY pointer variable the code uses),
                 "nextAttr": "next", "valAttr": "val"}
with "code" = the clean Node class + algorithm. BUILD THE INPUT LIST AT MODULE LEVEL (a plain
statement like "lst = build([1,2,3,4])" after the defs) and make "entry" the operation on it
(e.g. "reverse(lst)") — NOT "reverse(build([...]))". This keeps the dry run focused on the
ACTUAL operation (the build runs untraced as setup) and lays the boxes out head→tail, left to
right. Our identity-preserving tracker runs it for real: boxes are real node objects, arrows are
live next-references, rewires flash, unreachable nodes fade (the garbage moment). Declare every
pointer variable the OPERATION uses in "roots" — undeclared pointers are invisible. Do not write
tracking code.`,
  canHandle: ({ json, lang, code }) => Boolean(json.linkedlist && typeof json.linkedlist === 'object' && lang === 'python' && code),
  async run({ json, code, exec }) {
    const source = assembleListProgram({
      code,
      entry: json.linkedlist.entry,
      roots: json.linkedlist.roots,
      nextAttr: json.linkedlist.nextAttr ?? 'next',
      valAttr: json.linkedlist.valAttr ?? 'val',
    });
    const run = await exec({ language: 'python', source });
    if (run.timedOut) throw new Error('linked-list run timed out (likely an infinite loop — a cycle without Floyd?)');
    const payload = parseListEvents(run.stdout);
    if (!payload) throw new Error(run.stderr ? `run errored: ${run.stderr.slice(0, 300)}` : 'run printed no @@LISTWALK line');
    const trace = compileLinkedListTrace({ ...payload, code, entry: json.linkedlist.entry, language: 'python' });
    trace.meta = {
      tool: 'linkedlist',
      params: {
        code,
        entry: json.linkedlist.entry,
        roots: json.linkedlist.roots,
        nextAttr: json.linkedlist.nextAttr ?? 'next',
        valAttr: json.linkedlist.valAttr ?? 'val',
      },
    };
    return trace;
  },
};
