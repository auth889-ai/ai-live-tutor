'use client';

// ▶ RUN IN YOUR BROWSER — the Pyodide integration (reference repo: ../important = CPython on
// WebAssembly). The EXACT code on screen executes in the student's own browser — real CPython,
// no server round-trip — and the output prints beside the dry run. This is the product's truth
// law made touchable: the lesson's code is not an illustration, it runs.
//
// PROVENANCE piece 5 (external review, 2026-07-20): Pyodide runs inside a DEDICATED WEB
// WORKER, never on the UI thread. Two reasons, both safety:
//   1. the page stays responsive while Python executes;
//   2. student code can defeat every in-Python guard (sys.settrace(None); while True: pass) —
//      worker.terminate() from the parent is the ONLY enforceable timeout. On timeout the
//      worker is killed and a fresh one is created lazily on the next run.
// Loads Pyodide from CDN on first run only (~7 MB, cached by the browser afterwards).

import { useRef, useState } from 'react';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
const INDEX_URL = PYODIDE_URL.replace(/pyodide\.js$/, '');

const WORKER_SRC = `
importScripts('${PYODIDE_URL}');
const pyReady = loadPyodide({ indexURL: '${INDEX_URL}' });
onmessage = async (e) => {
  const { id, source } = e.data;
  let py;
  try { py = await pyReady; }
  catch (ex) { postMessage({ id, stdout: '', stderr: 'could not load the Python runtime (offline?)', last: null }); return; }
  const out = [];
  const err = [];
  py.setStdout({ batched: (t) => out.push(t) });
  py.setStderr({ batched: (t) => err.push(t) });
  let last = null;
  try {
    const v = await py.runPythonAsync(source);
    if (v !== undefined && v !== null) last = String(v);
  } catch (ex) {
    err.push(String((ex && ex.message) || ex));
  } finally {
    py.setStdout({});
    py.setStderr({});
  }
  postMessage({ id, stdout: out.join('\\n'), stderr: err.join('\\n'), last });
};
`;

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })));
  worker.onmessage = (e) => {
    const p = pending.get(e.data.id);
    if (p) { pending.delete(e.data.id); p(e.data); }
  };
  worker.onerror = () => {
    for (const p of pending.values()) p({ stdout: '', stderr: 'the Python worker crashed — it will restart on the next run', last: null });
    pending.clear();
    try { worker.terminate(); } catch { /* already gone */ }
    worker = null;
  };
  return worker;
}

// exec in the run-code shape ({language, source} -> {stdout, stderr, timedOut}) so the
// UNIVERSAL ORCHESTRATOR (traceUniversal) can run its recorder INSIDE the browser: same
// tracker string, same detectors, same compilers — Pyodide only replaces the subprocess.
// timedOut: true is REAL here — the worker was terminated by the parent thread.
export function pyodideExec({ source, timeoutMs = 60000 }) {
  const w = getWorker();
  seq += 1;
  const id = seq;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      for (const p of pending.values()) p({ stdout: '', stderr: 'a neighboring run timed out and the runtime was restarted — run again', last: null });
      pending.clear();
      try { w.terminate(); } catch { /* already gone */ }
      worker = null; // next run builds a clean runtime
      resolve({ stdout: '', stderr: `execution timed out after ${Math.round(timeoutMs / 1000)}s — the Python runtime was terminated and will restart clean on the next run`, timedOut: true });
    }, timeoutMs);
    pending.set(id, (d) => {
      clearTimeout(timer);
      resolve({ stdout: d.stdout, stderr: d.stderr, timedOut: false, last: d.last });
    });
    w.postMessage({ id, source });
  });
}

export function RunInBrowser({ code, language }) {
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [output, setOutput] = useState('');
  const [ms, setMs] = useState(null);
  const ran = useRef(false);
  if (language !== 'python' || !String(code ?? '').trim()) return null;

  const run = async () => {
    setState('running');
    setOutput('');
    setMs(null);
    const t0 = performance.now();
    const r = await pyodideExec({ source: code, timeoutMs: 30000 });
    setMs(Math.round(performance.now() - t0));
    if (r.timedOut || (r.stderr && !r.stdout)) {
      setOutput((r.stderr || 'unknown error').split('\n').slice(-12).join('\n'));
      setState('error');
      return;
    }
    // runPython returns the value of the last expression, like a REPL — show it when the
    // script itself printed nothing (many solutions end with a bare call).
    const body = [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || (r.last ?? '');
    setOutput(body.trim() || '(no output — the code defines functions without calling them)');
    setState('done');
    ran.current = true;
  };

  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <button
          onClick={run}
          disabled={state === 'running'}
          style={{
            border: 'none', borderRadius: 999, background: state === 'running' ? '#c9bda1' : '#2b7a3f',
            color: '#fff', padding: '5px 14px', fontSize: 12.5, fontWeight: 800, cursor: state === 'running' ? 'default' : 'pointer',
          }}
        >
          {state === 'running' ? 'running…' : ran.current ? '▶ run again' : '▶ run in YOUR browser'}
        </button>
        <span style={{ fontSize: 11.5, color: '#8a6d3b' }}>
          real CPython (WebAssembly) in a sandboxed worker — this exact code executes on your machine, nothing is sent anywhere
        </span>
      </div>
      {state === 'done' || state === 'error' ? (
        <div style={{ borderTop: '1px solid #f0dcd5', background: state === 'error' ? '#fdf0ee' : '#101613', padding: '10px 12px' }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, color: state === 'error' ? '#c0522d' : '#7fd39a', marginBottom: 5, fontFamily: 'ui-monospace, monospace' }}>
            {state === 'error' ? 'PYTHON ERROR' : `OUTPUT · ran in ${ms}ms in this browser tab`}
          </div>
          <pre style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: state === 'error' ? '#8a3a12' : '#e8f5ec', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', maxHeight: 220, overflowY: 'auto' }}>{output}</pre>
        </div>
      ) : null}
    </div>
  );
}
