'use client';

// ▶ RUN IN YOUR BROWSER — the Pyodide integration (reference repo: ../important = CPython on
// WebAssembly). The EXACT code on screen executes in the student's own browser — real CPython,
// no server round-trip — and the output prints beside the dry run. This is the product's truth
// law made touchable: the lesson's code is not an illustration, it runs. Loads Pyodide from CDN
// on first click only (~7 MB, cached by the browser afterwards).

import { useRef, useState } from 'react';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
let pyodidePromise = null; // one runtime per tab, shared across scenes

function loadPyodideOnce() {
  if (pyodidePromise) return pyodidePromise;
  pyodidePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PYODIDE_URL;
    s.onload = () => {
      window.loadPyodide({ indexURL: PYODIDE_URL.replace(/pyodide\.js$/, '') })
        .then(resolve)
        .catch(reject);
    };
    s.onerror = () => reject(new Error('could not load the Python runtime (offline?)'));
    document.head.appendChild(s);
  }).catch((e) => { pyodidePromise = null; throw e; });
  return pyodidePromise;
}

export function RunInBrowser({ code, language }) {
  const [state, setState] = useState('idle'); // idle | loading | running | done | error
  const [output, setOutput] = useState('');
  const [ms, setMs] = useState(null);
  const ran = useRef(false);
  if (language !== 'python' || !String(code ?? '').trim()) return null;

  const run = async () => {
    setState('loading');
    setOutput('');
    setMs(null);
    try {
      const py = await loadPyodideOnce();
      setState('running');
      const lines = [];
      py.setStdout({ batched: (t) => lines.push(t) });
      py.setStderr({ batched: (t) => lines.push(t) });
      const t0 = performance.now();
      try {
        // runPython returns the value of the last expression, like a REPL — show it when the
        // script itself printed nothing (many solutions end with a bare call).
        const last = await py.runPythonAsync(code);
        if (lines.length === 0 && last !== undefined && last !== null) lines.push(String(last));
      } finally {
        py.setStdout({});
        py.setStderr({});
      }
      setMs(Math.round(performance.now() - t0));
      setOutput(lines.join('\n').trim() || '(no output — the code defines functions without calling them)');
      setState('done');
      ran.current = true;
    } catch (e) {
      setOutput(String(e?.message ?? e).split('\n').slice(-12).join('\n'));
      setState('error');
    }
  };

  return (
    <div style={{ border: '1px solid #f0dcd5', borderRadius: 10, background: '#fffcfa', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', flexWrap: 'wrap' }}>
        <button
          onClick={run}
          disabled={state === 'loading' || state === 'running'}
          style={{
            border: 'none', borderRadius: 999, background: state === 'loading' || state === 'running' ? '#c9bda1' : '#2b7a3f',
            color: '#fff', padding: '5px 14px', fontSize: 12.5, fontWeight: 800, cursor: state === 'loading' || state === 'running' ? 'default' : 'pointer',
          }}
        >
          {state === 'loading' ? 'loading Python…' : state === 'running' ? 'running…' : ran.current ? '▶ run again' : '▶ run in YOUR browser'}
        </button>
        <span style={{ fontSize: 11.5, color: '#8a6d3b' }}>
          real CPython (WebAssembly) — this exact code executes on your machine, nothing is sent anywhere
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
