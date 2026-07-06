// Parse a REAL execution trace into a trace table. The Code Runner writes code that prints
// one `TRACE {json}` line per step (variable states); we run it for real and parse those
// lines here into {columns, rows}. Columns = variable names (first-seen order); each row =
// one step. Pure + deterministic -> unit-tested. This is the Striver dry-run, from actual
// execution, not invented.

export function parseTrace(stdout) {
  const steps = [];
  for (const line of String(stdout).split('\n')) {
    const match = line.match(/^\s*TRACE\s+(\{.*\})\s*$/);
    if (!match) continue;
    try {
      steps.push(JSON.parse(match[1]));
    } catch {
      // skip a malformed trace line rather than fail the whole table
    }
  }
  if (steps.length === 0) return null;

  const columns = [];
  for (const step of steps) {
    for (const key of Object.keys(step)) if (!columns.includes(key)) columns.push(key);
  }
  const rows = steps.map((step, index) => ({
    label: `Step ${index + 1}`,
    values: columns.map((col) => (col in step ? formatValue(step[col]) : '')),
  }));
  return { diagramType: 'trace', columns, rows };
}

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.join(', ')}]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
