'use client';

// "Try it yourself" — the student-facing code editor. Seeds with the scene's code, runs
// the STUDENT'S edit in the same isolated sandbox the tutor uses (POST /api/run), and
// shows the real stdout/stderr. Collapsed by default so it never fights the lesson;
// honest states: run -> output | error | timeout.

import { useState } from 'react';

import { AlgorithmStage } from '../algorithm-stage/algorithm-stage.js';

const UI = { border: '#f5e6d9', muted: '#8a6d3b', accent: '#f47368', accentDark: '#e8604c', ink: '#2b211a' };

// Seed the entry-call box from the code itself: the LAST def's signature becomes a template
// ("linear_search(arr, target)") — the student swaps parameter names for real values.
function guessEntry(src) {
  const defs = [...String(src ?? '').matchAll(/^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/gm)];
  const last = defs[defs.length - 1];
  if (!last) return '';
  const params = last[2].split(',').map((x) => x.trim().split('=')[0].trim()).filter((x) => x && x !== 'self');
  return `${last[1]}(${params.join(', ')})`;
}

export function TryItPanel({ seedCode = '', language = 'python' }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(seedCode);
  const [lang, setLang] = useState(language === 'javascript' ? 'javascript' : 'python');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { stdout, stderr, timedOut } | { error }
  // THE PYODIDE VISUAL DRY RUN: the student's OWN code + entry call run under the universal
  // recorder INSIDE the browser (real CPython/WASM), then the same detectors and compilers
  // build an ExecutionTrace and the full AlgorithmStage animates it — array, pointers, ledger,
  // code line, variables. Any edit, any input, no server. Correctness is architectural: every
  // frame comes from the recording of the run that just happened on this machine.
  const [entry, setEntry] = useState('');
  const [vizState, setVizState] = useState('idle'); // idle | working | done | error
  const [vizError, setVizError] = useState('');
  const [vizTrace, setVizTrace] = useState(null);
  const [vizLens, setVizLens] = useState('');

  async function visualize() {
    setVizState('working');
    setVizError('');
    setVizTrace(null);
    try {
      const call = (entry || guessEntry(code)).trim();
      if (!call) throw new Error('write the entry call, e.g. linear_search([2,5,8], 8)');
      const [{ traceUniversal }, { pyodideExec }] = await Promise.all([
        import('../../../lib/execution/trace/universal/trace.js'),
        import('./run-in-browser.js'),
      ]);
      const { trace, lens } = await traceUniversal({ code, entry: call, exec: pyodideExec });
      setVizTrace(trace);
      setVizLens(lens);
      setVizState('done');
    } catch (e) {
      setVizError(String(e?.message ?? e));
      setVizState('error');
    }
  }

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, source: code }),
      });
      const data = await res.json();
      setResult(res.ok ? data : { error: data.error || 'Run failed' });
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  }

  if (!open) {
    return (
      <div style={{ padding: '10px 24px', borderTop: `1px solid #efe6d3`, background: '#fffcfa', textAlign: 'center' }}>
        <button onClick={() => { setOpen(true); if (!code) setCode(seedCode); }}
          style={{ border: `1.5px solid ${UI.accent}`, color: UI.accentDark, background: '#fff', borderRadius: 999, padding: '8px 22px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>
          💻 Try it yourself — edit &amp; run this code
        </button>
      </div>
    );
  }

  return (
    <div style={{ borderTop: `1px solid #efe6d3`, background: '#fffcfa', padding: '14px 24px 18px', textAlign: 'left' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: UI.ink }}>💻 Try it yourself</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}
          style={{ border: `1px solid ${UI.border}`, borderRadius: 8, padding: '4px 8px', fontSize: 12.5, background: '#fff' }}>
          <option value="python">Python</option>
          <option value="javascript">JavaScript</option>
        </select>
        <span style={{ fontSize: 11.5, color: UI.muted }}>runs in an isolated sandbox · no network</span>
        <button onClick={() => setOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: UI.muted, cursor: 'pointer', fontSize: 13 }}>✕ close</button>
      </div>

      <textarea value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false}
        style={{
          width: '100%', minHeight: 180, boxSizing: 'border-box', resize: 'vertical',
          background: '#1e1712', color: '#f3e9dc', border: '1px solid #3a2c20', borderRadius: 12,
          padding: 14, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13.5, lineHeight: 1.55,
        }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <button onClick={run} disabled={running || !code.trim()}
          style={{ background: running ? '#f5b8ae' : UI.accent, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 26px', fontSize: 14, fontWeight: 800, cursor: running ? 'default' : 'pointer' }}>
          {running ? 'Running…' : '▶ Run'}
        </button>
        {result?.timedOut && <span style={{ fontSize: 12.5, color: '#a33d2e', fontWeight: 700 }}>⏱ Timed out — infinite loop?</span>}
      </div>

      {lang === 'python' ? (
        <div style={{ marginTop: 12, border: '1.5px dashed #e8b7a4', borderRadius: 12, background: '#fdf6f0', padding: '10px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#8a3a12', whiteSpace: 'nowrap' }}>🔬 Visual dry run of YOUR code</span>
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              placeholder={guessEntry(code) ? `entry call — e.g. ${guessEntry(code)}` : 'entry call — e.g. solve([1,2,3])'}
              spellCheck={false}
              style={{ flex: '1 1 220px', border: `1px solid ${UI.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5, fontFamily: 'ui-monospace, monospace', background: '#fff' }}
            />
            <button onClick={visualize} disabled={vizState === 'working' || !code.trim()}
              style={{ background: vizState === 'working' ? '#c9bda1' : '#2b7a3f', color: '#fff', border: 'none', borderRadius: 999, padding: '7px 18px', fontSize: 12.5, fontWeight: 800, cursor: vizState === 'working' ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
              {vizState === 'working' ? 'recording your run…' : '🔬 visualize in this browser'}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: UI.muted, marginTop: 5 }}>
            your edit runs under the real recorder (CPython in WebAssembly, this tab) — then the full animated dry run below is built from that recording, nothing invented
          </div>
          {vizState === 'error' ? (
            <pre style={{ margin: '8px 0 0', background: '#fdf0ee', color: '#a33d2e', borderRadius: 8, padding: '8px 12px', fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{vizError}</pre>
          ) : null}
        </div>
      ) : null}

      {vizState === 'done' && vizTrace ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#2b7a3f', marginBottom: 8 }}>
            ✓ recorded in your browser · teaching lens: {vizLens} · every frame below is from that run
          </div>
          <AlgorithmStage trace={vizTrace} progress={1} stepIndex={0} />
        </div>
      ) : null}

      {result?.error && (
        <pre style={outputBox('#fdf0ee', '#a33d2e')}>{result.error}</pre>
      )}
      {result && !result.error && (
        <>
          {result.stdout && <pre style={outputBox('#14100d', '#b9f0c0')}>{result.stdout}</pre>}
          {result.stderr && <pre style={outputBox('#2a1512', '#f0b9b0')}>{result.stderr}</pre>}
          {!result.stdout && !result.stderr && !result.timedOut && (
            <pre style={outputBox('#faf3e8', UI.muted)}>(no output — add a print statement)</pre>
          )}
        </>
      )}
    </div>
  );
}

function outputBox(bg, color) {
  return {
    marginTop: 10, marginBottom: 0, background: bg, color, borderRadius: 10, padding: '10px 14px',
    fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflowY: 'auto',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  };
}
