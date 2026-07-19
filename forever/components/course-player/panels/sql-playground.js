'use client';

// SQL PLAYGROUND — the interactive "manipulate it" for Database: the student writes SQL and
// RUNS it in-browser (sql.js — real SQLite compiled to WASM, no server, no key). The lesson
// seeds a schema+data; the student queries it, edits, re-runs, and sees the actual result
// table — the engine=truth law made touchable, the same way run-in-browser does for Python.
//
// content: { schema: <CREATE TABLE + INSERT SQL>, seedQuery: <starter SELECT>, title, challenge }

import { useEffect, useRef, useState } from 'react';

let sqlPromise = null;
async function getSQL() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      // sql.js needs its wasm; load it from the CDN matching the installed version.
      return initSqlJs({ locateFile: (f) => `https://sql.js.org/dist/${f}` });
    })();
  }
  return sqlPromise;
}

export function SqlPlayground({ content }) {
  const [query, setQuery] = useState(content?.seedQuery ?? 'SELECT * FROM sqlite_master;');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const dbRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const SQL = await getSQL();
        if (cancelled) return;
        const db = new SQL.Database();
        if (content?.schema) db.run(content.schema); // seed schema + data
        dbRef.current = db;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError('could not load the in-browser SQL engine');
      }
    })();
    return () => { cancelled = true; try { dbRef.current?.close(); } catch { /* gone */ } };
  }, [content?.schema]);

  const run = () => {
    setError(null);
    setResult(null);
    try {
      const res = dbRef.current.exec(query);
      if (!res.length) { setResult({ columns: [], values: [], empty: true }); return; }
      setResult({ columns: res[0].columns, values: res[0].values });
    } catch (e) {
      setError(String(e.message ?? e));
    }
  };

  if (!content?.schema) return null;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', width: '100%' }}>
      {content?.title && <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--ink, #2b2320)', marginBottom: 4 }}>{content.title}</div>}
      {content?.challenge && <div style={{ fontSize: 12.5, color: 'var(--ink-muted, #8a7d76)', marginBottom: 8, fontStyle: 'italic' }}>{content.challenge}</div>}
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
        rows={Math.min(8, Math.max(3, query.split('\n').length))}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13, padding: 12, borderRadius: 10,
          border: '1px solid var(--border, #eadfd8)', background: '#0d1117', color: '#e8f0ea', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button onClick={run} disabled={!ready} style={{ border: 'none', borderRadius: 999, background: ready ? '#2b7a3f' : '#c9bda1', color: '#fff', padding: '6px 16px', fontSize: 12.5, fontWeight: 800, cursor: ready ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          {ready ? '▶ run SQL in your browser' : 'loading SQLite…'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--ink-muted, #8a7d76)' }}>real SQLite (WASM) — your query runs on your machine, nothing sent anywhere</span>
      </div>

      {error && <pre style={{ marginTop: 10, padding: 10, borderRadius: 8, background: '#fdf0ee', color: '#8a3a12', fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{error}</pre>}
      {result && !error && (
        <div style={{ marginTop: 10, overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border, #eadfd8)' }}>
          {result.empty ? (
            <div style={{ padding: 10, fontSize: 12.5, color: 'var(--ink-muted, #8a7d76)' }}>Query ran — no rows returned.</div>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
              <thead>
                <tr>{result.columns.map((c) => <th key={c} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '2px solid var(--border, #eadfd8)', background: '#fbf6f2', fontWeight: 700 }}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {result.values.slice(0, 50).map((row, i) => (
                  <tr key={i}>{row.map((v, j) => <td key={j} style={{ padding: '6px 10px', borderBottom: '1px solid var(--border, #f0e8e2)', fontFamily: 'ui-monospace, monospace' }}>{String(v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
