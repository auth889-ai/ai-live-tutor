// PYODIDE EQUIVALENCE HARNESS — proves the browser dry run IS the server dry run.
// Takes every 5th problem of the 50-problem battery (all families), runs each through
// REAL Pyodide in a headless browser AND python3 on the server, and diffs lens + step
// count. Run after any recorder/lens change:  node scripts/pyodide-equivalence.mjs
// Measured 2026-07-19: 13/13 exact equivalence (same lens, same steps).

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { chromium } from 'playwright';

import { traceUniversal } from '../lib/execution/trace/universal/trace.js';

const src = readFileSync('scripts/universal-battery.mjs', 'utf8');
const grab = (name) => {
  const i = src.indexOf('const ' + name + ' = `');
  return src.slice(src.indexOf('`', i) + 1, src.indexOf('`', i + name.length + 10));
};
const arrText = src.slice(src.indexOf('const PROBLEMS = [') + 'const PROBLEMS = '.length, src.indexOf('];', src.indexOf('const PROBLEMS = [')) + 1);
const PROBLEMS = new Function('LIST_PRELUDE', 'TREE_PRELUDE', 'return ' + arrText)(grab('LIST_PRELUDE'), grab('TREE_PRELUDE'));
const subset = PROBLEMS.filter((_, i) => i % 5 === 0).map(([cat, name, code, entry]) => ({ cat, name, code, entry }));

const pyExec = async ({ source }) => {
  try { return { stdout: execFileSync('python3', ['-c', source], { encoding: 'utf8', timeout: 15000 }), stderr: '', timedOut: false }; }
  catch (e) { return { stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? e.message), timedOut: false }; }
};
const ref = [];
for (const p of subset) {
  const { trace, lens } = await traceUniversal({ code: p.code, entry: p.entry, exec: pyExec });
  ref.push({ name: p.name, lens: lens?.key ?? String(lens), steps: trace?.steps?.length ?? 0 });
}

const bundlePath = path.join(mkdtempSync(path.join(tmpdir(), 'pyeq-')), 'trace-browser.js');
const entryPath = path.join(path.dirname(bundlePath), 'entry.js');
writeFileSync(entryPath, `import { traceUniversal } from '${path.resolve('lib/execution/trace/universal/trace.js')}';\nwindow.traceUniversal = traceUniversal;\n`);
execFileSync('npx', ['--yes', 'esbuild', entryPath, '--bundle', '--format=iife', `--outfile=${bundlePath}`], { encoding: 'utf8' });

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js' });
await page.addScriptTag({ content: readFileSync(bundlePath, 'utf8') });
const results = await page.evaluate(async (problems) => {
  const pyodide = await window.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/' });
  const exec = async ({ source }) => {
    let out = '';
    pyodide.setStdout({ batched: (s) => { out += s + String.fromCharCode(10); } });
    try { await pyodide.runPythonAsync(source); return { stdout: out, stderr: '', timedOut: false }; }
    catch (e) { return { stdout: out, stderr: String(e), timedOut: false }; }
  };
  const rows = [];
  for (const p of problems) {
    try {
      const { trace, lens } = await window.traceUniversal({ code: p.code, entry: p.entry, exec });
      rows.push({ name: p.name, lens: lens?.key ?? String(lens), steps: trace?.steps?.length ?? 0 });
    } catch (e) { rows.push({ name: p.name, error: String(e.message ?? e).slice(0, 70) }); }
  }
  return rows;
}, subset);
await browser.close();

let same = 0;
for (let i = 0; i < ref.length; i += 1) {
  const a = ref[i]; const b = results[i];
  const ok = a.lens === b.lens && a.steps === b.steps;
  if (ok) same += 1;
  console.log(`${ok ? 'SAME' : 'DIFF'}  ${a.name.slice(0, 32).padEnd(34)} server: ${a.lens}/${a.steps}  pyodide: ${b.lens ?? b.error}/${b.steps ?? ''}`);
}
console.log(`${same}/${ref.length} ${same === ref.length ? 'PYODIDE_EXACT_EQUIVALENCE' : 'DIVERGENCE — fix before shipping'}`);
process.exit(same === ref.length ? 0 : 1);
