'use client';

// TERMINAL VIEW (xterm.js) — the interactive "manipulate it" for Operating Systems: a real
// browser terminal that animates a scheduler run. The lesson supplies a script of lines (a
// Gantt trace, ready-queue steps, shell exercise); the student watches the OS "run" and can
// step through it. Not a real shell (no arbitrary execution) — a controlled, honest replay of
// the deterministic scheduler engine's output.
//
// content: { title, lines: [strings], prompt? }  — lines are the scheduler/engine trace.

import { useEffect, useRef, useState } from 'react';

export function TerminalView({ content }) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const [i, setI] = useState(0);
  const lines = content?.lines ?? [];

  useEffect(() => {
    let disposed = false;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
      await import('@xterm/xterm/css/xterm.css').catch(() => {});
      if (disposed || !hostRef.current) return;
      const term = new Terminal({ fontSize: 12, theme: { background: '#0d1117', foreground: '#e8f0ea' }, rows: 14, convertEol: true, disableStdin: true });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try { fit.fit(); } catch { /* pre-layout */ }
      termRef.current = term;
      term.writeln(content?.prompt ?? '$ scheduler --run');
    })();
    return () => { disposed = true; try { termRef.current?.dispose(); } catch { /* gone */ } };
  }, [content?.prompt]);

  const step = () => {
    const term = termRef.current;
    if (!term || i >= lines.length) return;
    term.writeln(lines[i]);
    setI((n) => n + 1);
  };
  const runAll = () => {
    const term = termRef.current;
    if (!term) return;
    for (let k = i; k < lines.length; k += 1) term.writeln(lines[k]);
    setI(lines.length);
  };

  if (!lines.length) return null;

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2320)', marginBottom: 6 }}>{content.title}</div>}
      <div ref={hostRef} style={{ width: '100%', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border, #eadfd8)', padding: 8, background: '#0d1117' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={step} disabled={i >= lines.length} style={{ border: 'none', borderRadius: 999, background: i >= lines.length ? '#c9bda1' : '#2b7a3f', color: '#fff', padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: i >= lines.length ? 'default' : 'pointer', fontFamily: 'inherit' }}>Step</button>
        <button onClick={runAll} style={{ border: '1px solid #b06a2e', borderRadius: 999, background: 'transparent', color: '#b06a2e', padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Run all</button>
        <span style={{ fontSize: 11, color: 'var(--ink-muted, #8a7d76)', alignSelf: 'center' }}>{i}/{lines.length} steps — predict the next line before stepping.</span>
      </div>
    </div>
  );
}
