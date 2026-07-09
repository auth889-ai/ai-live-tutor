// JSON value -> Python literal. JSON.stringify is NOT valid Python: null/true/false crash the
// tracker with "NameError: name 'null' is not defined" — and LeetCode tree inputs like
// [-10,9,20,null,null,15,7] carry null constantly. This walks the value and emits real Python
// (None/True/False, dicts, lists); strings go through JSON.stringify, whose escaping Python
// accepts verbatim.

export function pyLiteral(value) {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return String(value);
    return value !== value ? "float('nan')" : value > 0 ? "float('inf')" : "float('-inf')";
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`).join(', ')}}`;
  }
  throw new Error(`cannot express ${typeof value} as a python literal`);
}
