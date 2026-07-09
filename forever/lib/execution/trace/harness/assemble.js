// SHARED HARNESS ASSEMBLY — the one place that turns (tracker python + student code + entry
// call) into a runnable traced program. Every dedicated tracker (line-sim, linked-list,
// divide-conquer, trie, dp-table) used to copy this exact tail; now they declare only what is
// theirs — constants, the tracker source, the stdout marker, and how to serialize the result.
//
// The contract every harness gets for free:
//   - constants injected as python assignments (via pyLiteral — JSON's null/true/false are
//     NOT python; LeetCode-style inputs carry null constantly)
//   - the student's code compiled under the '<student>' filename, so trackers can filter
//     events to ONLY the student's lines (harness lines never leak into the animation)
//   - a single-expression entry evaluated under sys.settrace, tracer always detached in finally
//   - one '<MARKER> {"events": [...], "result": ...}' line printed at the end

import { pyLiteral } from './py-literal.js';

export function buildTracedProgram({ constants = {}, trackerPy, code, entry, marker, resultLine, entryExample }) {
  const call = String(entry ?? '').trim();
  if (!call || /[;\n]/.test(call)) {
    throw new Error(`entry must be a single expression like ${entryExample ?? '"solve(...)"'}`);
  }
  if (!String(code ?? '').trim()) throw new Error('the tracker needs the algorithm code');
  if (!String(trackerPy ?? '').trim() || !String(marker ?? '').startsWith('@@')) {
    throw new Error('buildTracedProgram needs a tracker source and an @@-prefixed marker');
  }
  return [
    ...Object.entries(constants).map(([k, v]) => `${k} = ${pyLiteral(v)}`),
    trackerPy,
    '',
    `_src = ${JSON.stringify(String(code))}`,
    `_compiled = compile(_src, '<student>', 'exec')`,
    '_ns = {}',
    'exec(_compiled, _ns)',
    'sys.settrace(_tracer)',
    'try:',
    `    _result = eval(${JSON.stringify(call)}, _ns)`,
    'finally:',
    '    sys.settrace(None)',
    resultLine,
    `print('${marker} ' + json.dumps({'events': _events, 'result': _out}))`,
  ].join('\n');
}

// One parser for every marker: find the marker line, JSON-parse its payload, null on junk.
export function parseTracedEvents(stdout, marker) {
  const tag = `${marker} `;
  for (const line of String(stdout ?? '').split('\n')) {
    const at = line.indexOf(tag);
    if (at === -1) continue;
    try {
      return JSON.parse(line.slice(at + tag.length));
    } catch {
      return null;
    }
  }
  return null;
}
