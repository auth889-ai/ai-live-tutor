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

// Python names an entry expression may use without the code defining them.
const PY_BUILTINS = new Set(['True', 'False', 'None', 'len', 'range', 'list', 'dict', 'set', 'tuple', 'str', 'int', 'float', 'bool', 'max', 'min', 'sum', 'abs', 'sorted', 'reversed', 'enumerate', 'zip', 'map', 'filter', 'print', 'ord', 'chr', 'round']);

// Battery-measured failure mode: the agent writes entry "maxPathSum(root)" but never defines
// root in the code — Python then dies with a NameError so cryptic that FOUR retries repeat the
// same mistake. Checking BEFORE the run, with the fix spelled out, turns that into a one-retry
// self-correction (the actionable-error pattern that made other modes recover).
export function assertEntryNamesDefined(entry, code) {
  const noStrings = entry.replace(/'[^']*'|"[^"]*"/g, '');
  const names = noStrings.match(/(?<![\w.])[A-Za-z_]\w*(?!\s*=[^=])/g) ?? [];
  for (const name of new Set(names)) {
    if (PY_BUILTINS.has(name)) continue;
    const defined = new RegExp(`^(?:${name}\\s*=[^=]|def\\s+${name}\\s*\\(|class\\s+${name}\\b)`, 'm').test(code);
    if (!defined) {
      throw new Error(`entry references "${name}" but the code never defines it at module top level — add the concrete build lines to the code (e.g. ${name} = ...) so the entry can run on a real instance.`);
    }
  }
}

export function buildTracedProgram({ constants = {}, trackerPy, code, entry, marker, resultLine, entryExample }) {
  const call = String(entry ?? '').trim();
  if (!call || /[;\n]/.test(call)) {
    throw new Error(`entry must be a single expression like ${entryExample ?? '"solve(...)"'}`);
  }
  if (!String(code ?? '').trim()) throw new Error('the tracker needs the algorithm code');
  assertEntryNamesDefined(call, String(code));
  if (!String(trackerPy ?? '').trim() || !String(marker ?? '').startsWith('@@')) {
    throw new Error('buildTracedProgram needs a tracker source and an @@-prefixed marker');
  }
  return [
    ...Object.entries(constants).map(([k, v]) => `${k} = ${pyLiteral(v)}`),
    trackerPy,
    '',
    // json.dumps happily emits -Infinity/NaN — INVALID JSON that the parser rejects as if the
    // marker never printed (LC124's best = float('-inf') killed whole traces this way). Every
    // recorded payload passes through this finite-izer before printing.
    'def _finite(v):',
    '    if isinstance(v, float) and (v != v or v == float("inf") or v == float("-inf")):',
    '        return repr(v)',
    '    if isinstance(v, (list, tuple)):',
    '        return [_finite(x) for x in v]',
    '    if isinstance(v, dict):',
    '        return {k: _finite(x) for k, x in v.items()}',
    '    return v',
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
    `print('${marker} ' + json.dumps(_finite({'events': _events, 'result': _out})))`,
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
