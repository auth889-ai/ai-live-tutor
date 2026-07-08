'use client';

// "Try your own input" — the panel that turns a dry run into a LIVE INSTRUMENT (the studied
// tools' defining capability). Traversal: pick any start node, switch BFS <-> DFS. Recursion:
// change the arguments, toggle memoization and watch the exponential tree collapse. The same
// deterministic engine that built the lesson re-traces on the server (no LLM) and the whole
// stage re-animates the student's OWN scenario.

import { useState } from 'react';

export function RetracePanel({ meta, onTrace }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [args, setArgs] = useState(() => JSON.stringify(meta?.params?.args ?? []));
  const [memoize, setMemoize] = useState(meta?.params?.memoize === true);
  if (!meta?.tool) return null;

  const request = async (params) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: meta.tool, params }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'retrace failed');
      onTrace(body.trace);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  };

  const chip = {
    border: '1px solid #e8ddc9', borderRadius: 8, background: '#fff', color: '#2b211a',
    padding: '4px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
  };

  return (
    <div style={{ border: '1px dashed #e8b7a4', borderRadius: 10, background: '#fdf6f0', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: '#c0522d', whiteSpace: 'nowrap' }}>🧪 Try your own input</span>

      {meta.tool === 'traversal' && (
        <>
          <label style={{ fontSize: 12, color: '#8a6d3b' }}>
            start{' '}
            <select
              defaultValue={String(meta.params.start)}
              disabled={busy}
              onChange={(e) => request({ ...meta.params, start: e.target.value })}
              style={{ ...chip, cursor: 'pointer' }}
            >
              {(meta.params.graph?.nodes ?? []).map((n) => (
                <option key={n.id} value={String(n.id)}>{String(n.label ?? n.id)}</option>
              ))}
            </select>
          </label>
          {['bfs', 'dfs'].map((kind) => (
            <button
              key={kind}
              disabled={busy || meta.params.kind === kind}
              onClick={() => request({ ...meta.params, kind })}
              style={{ ...chip, background: meta.params.kind === kind ? '#fdeaa7' : '#fff' }}
            >
              {kind.toUpperCase()}
            </button>
          ))}
        </>
      )}

      {meta.tool === 'recursion' && (
        <>
          <label style={{ fontSize: 12, color: '#8a6d3b' }}>
            {meta.params.fnName}(
            <input
              value={args}
              disabled={busy}
              onChange={(e) => setArgs(e.target.value)}
              style={{ ...chip, width: 70, cursor: 'text', fontFamily: 'ui-monospace, monospace' }}
              aria-label="arguments (JSON array)"
            />
            )
          </label>
          <label style={{ fontSize: 12, color: '#8a6d3b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={memoize} disabled={busy} onChange={(e) => setMemoize(e.target.checked)} />
            memoization
          </label>
          <button
            disabled={busy}
            style={{ ...chip, background: '#e8604c', color: '#fff', border: 'none' }}
            onClick={() => {
              let parsed;
              try {
                parsed = JSON.parse(args);
              } catch {
                setError('arguments must be a JSON array, e.g. [7]');
                return;
              }
              request({ ...meta.params, args: parsed, memoize });
            }}
          >
            {busy ? 'running…' : 'run it'}
          </button>
        </>
      )}

      {meta.tool === 'pointerwalk' && (
        <PointerWalkControls meta={meta} busy={busy} request={request} setError={setError} />
      )}

      {busy && meta.tool === 'traversal' ? <span style={{ fontSize: 12, color: '#8a6d3b' }}>re-tracing…</span> : null}
      {error ? <span style={{ fontSize: 12, color: '#c0392b' }}>{error}</span> : null}
    </div>
  );
}

// Pointer-walk: the student edits the CALL itself — their own array, their own target — and
// the same settrace engine re-walks it (the array shown is derived from the real run).
function PointerWalkControls({ meta, busy, request, setError }) {
  const [entry, setEntry] = useState(String(meta?.params?.entry ?? ''));
  const chip = {
    border: '1px solid #e8ddc9', borderRadius: 8, background: '#fff', color: '#2b211a',
    padding: '4px 10px', fontSize: 12.5, fontWeight: 700,
  };
  return (
    <>
      <input
        value={entry}
        disabled={busy}
        onChange={(e) => setEntry(e.target.value)}
        style={{ ...chip, flex: '1 1 220px', cursor: 'text', fontFamily: 'ui-monospace, monospace', fontWeight: 500 }}
        aria-label="call to run (edit the array and target)"
      />
      <button
        disabled={busy}
        style={{ ...chip, background: '#e8604c', color: '#fff', border: 'none', cursor: 'pointer' }}
        onClick={() => {
          const call = entry.trim();
          if (!call || /[;\n]/.test(call)) {
            setError('the call must be one expression, e.g. binary_search([2,5,8], 5)');
            return;
          }
          request({ ...meta.params, entry: call });
        }}
      >
        {busy ? 'running…' : 'run it'}
      </button>
    </>
  );
}
