// TRAIN EVIDENCE ENGINE — the ML register's law made runnable: "loss curves and confusion
// matrices COMPUTED, never narrated." calc-evidence handles static arithmetic; this engine
// EXECUTES the iterative part — real gradient descent on the lesson's own dataset — so an
// ML lesson's epoch table is a genuine training run, not an authored story.
//
// Deterministic by construction: fixed zero init, fixed learning rate, no randomness —
// the same spec always produces the same losses (resume-safe, gate-verifiable).
//
// Contract (AI-declared, engine-executed):
//   dataset: { columns: ["distance", "fare"], rows: [[1, 55], [2, 70], ...] }  x = col 0, y = col 1
//   train:   { lr: 0.01, epochs: 80, record: [1, 5, 10, 20, 40, 80] }          which epochs to report
// Returns { losses: [{epoch, mse}], final: { w, b, mse } } — every value a real computation.

import { spawnSync } from 'node:child_process';

const MARKER = '@@TRAINEV';

export function buildTrainEvidenceProgram({ dataset, train }) {
  const payload = JSON.stringify({ dataset, train });
  return [
    'import json',
    `_spec = json.loads(${JSON.stringify(payload)})`,
    '_rows = _spec["dataset"]["rows"]',
    '_xs = [float(r[0]) for r in _rows]',
    '_ys = [float(r[1]) for r in _rows]',
    '_n = len(_rows)',
    '_lr = float(_spec["train"].get("lr", 0.01))',
    '_epochs = int(_spec["train"].get("epochs", 50))',
    '_record = set(int(e) for e in _spec["train"].get("record", []) if int(e) >= 1) or {1, _epochs}',
    '_w, _b = 0.0, 0.0',
    '_mse = lambda w, b: sum((w * x + b - y) ** 2 for x, y in zip(_xs, _ys)) / _n',
    '_losses = []',
    'for _e in range(1, _epochs + 1):',
    '    _gw = sum(2 * (_w * x + _b - y) * x for x, y in zip(_xs, _ys)) / _n',
    '    _gb = sum(2 * (_w * x + _b - y) for x, y in zip(_xs, _ys)) / _n',
    '    _w -= _lr * _gw',
    '    _b -= _lr * _gb',
    '    if _e in _record:',
    '        _losses.append({"epoch": _e, "mse": round(_mse(_w, _b), 4)})',
    'print(' + JSON.stringify(MARKER) + ' + json.dumps({',
    '    "losses": _losses,',
    '    "final": {"w": round(_w, 4), "b": round(_b, 4), "mse": round(_mse(_w, _b), 4)},',
    '}))',
  ].join('\n');
}

export function parseTrainEvidence(stdout) {
  const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(MARKER));
  if (!line) throw new Error('train evidence produced no result marker');
  return JSON.parse(line.slice(MARKER.length));
}

export function runTrainEvidence({ dataset, train }) {
  if (!dataset?.rows?.length || (dataset.columns ?? []).length < 2) {
    throw new Error('train evidence needs a dataset with 2 columns (x, y) and rows');
  }
  const epochs = Number(train?.epochs ?? 0);
  if (!(epochs >= 1 && epochs <= 10000)) throw new Error('train.epochs must be 1..10000');
  const program = buildTrainEvidenceProgram({ dataset, train });
  const r = spawnSync('python3', ['-c', program], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`train evidence failed: ${String(r.stderr).slice(0, 500)}`);
  return parseTrainEvidence(r.stdout);
}
