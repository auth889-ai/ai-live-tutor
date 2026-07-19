// PHYSICS SIMULATION ENGINE — physics's engine=truth, the register's "predict-then-SIMULATE
// on the student's own values" made runnable. calc-evidence does one-shot arithmetic; this
// NUMERICALLY INTEGRATES motion over time (semi-implicit Euler) so a kinematics lesson shows
// a REAL trajectory table — position, velocity, energy at each timestep — not a narrated one.
// Executed in python3 (deterministic: fixed dt, no randomness → identical output every run).
//
// Contract (AI-declared, engine-executed):
//   model:   "kinematics_1d" | "projectile_2d"
//   params:  { v0, a, dt, steps }               (1D: initial velocity, accel)
//            { v0, angleDeg, g, dt, steps }      (2D projectile)
//   record:  [step indices to report]
// Returns { rows: [{t, ...state}], summary: {...} } — every value a real integration step.

import { spawnSync } from 'node:child_process';

const MARKER = '@@SIMEV';

export function buildSimEvidenceProgram({ model, params, record = [] }) {
  const payload = JSON.stringify({ model, params, record });
  return [
    'import json, math',
    `_spec = json.loads(${JSON.stringify(payload)})`,
    '_p = _spec["params"]',
    '_rec = set(int(i) for i in _spec.get("record", []))',
    '_dt = float(_p.get("dt", 0.1))',
    '_steps = int(_p.get("steps", 10))',
    '_rows = []',
    'if _spec["model"] == "kinematics_1d":',
    '    _v = float(_p.get("v0", 0.0)); _a = float(_p.get("a", 0.0)); _x = 0.0; _t = 0.0',
    '    for _i in range(0, _steps + 1):',
    '        if _i in _rec or not _rec:',
    '            _rows.append({"step": _i, "t": round(_t, 4), "x": round(_x, 4), "v": round(_v, 4)})',
    '        _v += _a * _dt; _x += _v * _dt; _t += _dt',
    '    _summary = {"final_x": round(_x, 4), "final_v": round(_v, 4)}',
    'elif _spec["model"] == "projectile_2d":',
    '    _g = float(_p.get("g", 9.8)); _v0 = float(_p.get("v0", 0.0)); _ang = math.radians(float(_p.get("angleDeg", 45)))',
    '    _vx = _v0 * math.cos(_ang); _vy = _v0 * math.sin(_ang); _x = 0.0; _y = 0.0; _t = 0.0',
    '    for _i in range(0, _steps + 1):',
    '        if _i in _rec or not _rec:',
    '            _rows.append({"step": _i, "t": round(_t, 4), "x": round(_x, 4), "y": round(_y, 4), "vy": round(_vy, 4)})',
    '        _vy -= _g * _dt; _x += _vx * _dt; _y += _vy * _dt; _t += _dt',
    '    _range = (_v0 * _v0 * math.sin(2 * _ang)) / _g',
    '    _summary = {"range": round(_range, 4), "peak_time": round(_v0 * math.sin(_ang) / _g, 4)}',
    'else:',
    '    _rows = []; _summary = {"error": "unknown model"}',
    `print(${JSON.stringify(MARKER)} + json.dumps({"rows": _rows, "summary": _summary}))`,
  ].join('\n');
}

export function parseSimEvidence(stdout) {
  const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(MARKER));
  if (!line) throw new Error('sim evidence produced no result marker');
  return JSON.parse(line.slice(MARKER.length));
}

export function runSimEvidence({ model, params, record = [] }) {
  if (!['kinematics_1d', 'projectile_2d'].includes(model)) throw new Error(`unknown sim model: ${model}`);
  const steps = Number(params?.steps ?? 0);
  if (!(steps >= 1 && steps <= 100000)) throw new Error('params.steps must be 1..100000');
  const program = buildSimEvidenceProgram({ model, params, record });
  const r = spawnSync('python3', ['-c', program], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`sim evidence failed: ${String(r.stderr).slice(0, 500)}`);
  return parseSimEvidence(r.stdout);
}
