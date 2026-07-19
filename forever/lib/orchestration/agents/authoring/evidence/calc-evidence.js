// CALC EVIDENCE ENGINE — the numeric counterpart of sql-evidence, for every course whose
// truths are arithmetic rather than queries (economics elasticities, physics kinematics,
// ML metrics, chemistry stoichiometry). The AI DECLARES a tiny dataset + named formulas;
// this engine EXECUTES them (python3, restricted namespace) and returns the computed values.
// The lesson may then narrate ONLY numbers that came out of here or the source — the econ
// register's law made runnable: "the ghost curve is arithmetic, not artwork."
//
// Contract (all AI-declared, all engine-verified):
//   dataset:  { columns: ["price", "qty"], rows: [[10, 100], [12, 80]] }
//   formulas: [{ id: "elasticity", label: "% change qty / % change price",
//                expr: "((qty[1]-qty[0])/qty[0]) / ((price[1]-price[0])/price[0])" }]
// Each expr sees the dataset columns as Python lists plus every EARLIER formula's value by
// its id — chained derivations stay honest because each link is executed.
// Same shape as sql-evidence: buildProgram (Pyodide-ready string) + run (python3 subprocess).

import { spawnSync } from 'node:child_process';

const MARKER = '@@CALCEV';

// eval() gets NO builtins; only these — enough for course arithmetic, nothing else.
const SAFE_FUNCS = "{'sum': sum, 'min': min, 'max': max, 'len': len, 'round': round, 'abs': abs, 'sorted': sorted, 'zip': zip, 'range': range, 'enumerate': enumerate, 'float': float, 'int': int, 'pow': pow}";

export function buildCalcEvidenceProgram({ dataset, formulas }) {
  const payload = JSON.stringify({ dataset, formulas });
  return [
    'import json',
    `_spec = json.loads(${JSON.stringify(payload)})`,
    '_cols = _spec.get("dataset", {}).get("columns", [])',
    '_rows = _spec.get("dataset", {}).get("rows", [])',
    '_ns = {c: [r[i] for r in _rows] for i, c in enumerate(_cols)}',
    `_funcs = ${SAFE_FUNCS}`,
    '_results = []',
    'for _f in _spec.get("formulas", []):',
    '    _val = eval(compile(_f["expr"], "<formula>", "eval"), {"__builtins__": {}}, {**_funcs, **_ns, **{r["id"]: r["value"] for r in _results}})',
    '    if isinstance(_val, float): _val = round(_val, 6)',
    '    _results.append({"id": _f["id"], "label": _f.get("label", _f["id"]), "expr": _f["expr"], "value": _val})',
    `print(${JSON.stringify(MARKER)} + json.dumps({"results": _results, "dataset": _spec.get("dataset")}))`,
  ].join('\n');
}

export function parseCalcEvidence(stdout) {
  const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(MARKER));
  if (!line) throw new Error('calc evidence produced no result marker');
  return JSON.parse(line.slice(MARKER.length));
}

export function runCalcEvidence({ dataset, formulas }) {
  const program = buildCalcEvidenceProgram({ dataset, formulas });
  const r = spawnSync('python3', ['-c', program], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`calc evidence failed: ${String(r.stderr).slice(0, 500)}`);
  return parseCalcEvidence(r.stdout);
}
