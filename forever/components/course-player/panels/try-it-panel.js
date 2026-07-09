'use client';

// "Try it yourself" — the student-facing code editor. Seeds with the scene's code, runs
// the STUDENT'S edit in the same isolated sandbox the tutor uses (POST /api/run), and
// shows the real stdout/stderr. Collapsed by default so it never fights the lesson;
// honest states: run -> output | error | timeout.

import { useState } from 'react';

const UI = { border: '#f5e6d9', muted: '#8a6d3b', accent: '#f47368', accentDark: '#e8604c', ink: '#2b211a' };

export function TryItPanel({ seedCode = '', language = 'python' }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(seedCode);
  const [lang, setLang] = useState(language === 'javascript' ? 'javascript' : 'python');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null); // { stdout, stderr, timedOut } | { error }

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
