'use client';

// CONTEXT PANEL — the right rail: selected block, AI actions (explain, quiz, dry run,
// visual note), backlinks, teach-back entry, ask box.

import { useState } from 'react';

import { C } from '../theme.js';
import { TryItPanel } from '../../course-player/panels/try-it-panel.js';

export function ContextPanel({ nb, sel, backlinks, onNavigate, onChanged, onExplain, onContinue, onAsk, onQuiz, onSummary }) {
  const [dryCode, setDryCode] = useState(null);
  const [tab, setTab] = useState('ai');
  const [q, setQ] = useState('');
  const [teachText, setTeachText] = useState('');
  const [teachBusy, setTeachBusy] = useState(false);
  const [teachResult, setTeachResult] = useState(null);
  const teach = async () => {
    if (!sel) return;
    setTeachBusy(true);
    setTeachResult(null);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${sel._id}/teachback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ explanation: teachText }) });
      const d = await r.json();
      setTeachResult(r.ok ? d : { error: d.error });
      if (r.ok) { setTeachText(''); onChanged(); }
    } finally { setTeachBusy(false); }
  };
  const T2 = (idd, label) => (
    <button key={idd} onClick={() => setTab(idd)} style={{ border: 'none', borderBottom: tab === idd ? `2px solid ${C.accent}` : '2px solid transparent', background: 'transparent', color: tab === idd ? C.ink : C.sub, fontSize: 12, fontWeight: 800, padding: '8px 2px', marginRight: 14, cursor: 'pointer' }}>{label}</button>
  );
  return (
    <div className="nbk-rail-right" style={{ borderLeft: `1px solid ${C.border}`, minWidth: 0 }}>
    <div style={{ position: 'sticky', top: 62, maxHeight: 'calc(100vh - 76px)', overflowY: 'auto', padding: '4px 16px 16px' }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>{T2('ai', 'AI')}{T2('back', 'Backlinks')}{T2('review', 'Explain back')}</div>

      {tab === 'ai' ? (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {sel ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Selected content</div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: '#F4EEE5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{{ image: '🖼', pdf: '📄', link: '🔗', moment: '▶', voice: '🎙' }[sel.type] ?? '📝'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflowe: 'ellipsis' }}>{(sel.title || sel.content || sel.transcript || '').slice(0, 40)}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>{sel.page ?? 'Notes'}</div>
                </div>
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>Select any block in the document to act on it.</div>}

          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>What would you like to do?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ActionRow icon="✨" title="Explain" sub="explain this in simple terms" disabled={!sel} onClick={() => sel && onExplain(sel._id)} />
            <ActionRow icon="🎓" title="Explain it back" sub="help me teach this back" disabled={!sel} onClick={() => sel && setTab('review')} />
            <ActionRow icon="🧠" title="Create quiz" sub="generate practice questions" onClick={() => onQuiz()} />
            <ActionRow icon="📋" title="Summarize" sub="create a short summary" onClick={() => onSummary()} />
            <ActionRow icon="🔬" title="Dry run" sub="run this algorithm live, step by step" disabled={!sel} onClick={async () => {
              if (!sel) return;
              setDryCode({ loading: true });
              const r = await fetch(`/api/notebooks/${nb}/dryrun-code`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: sel._id }) });
              const d = await r.json();
              setDryCode(r.ok ? { code: d.code, entry: d.entry, note: d.note } : { error: d.error });
            }} />
            <ActionRow icon="✍️" title="Visual note" sub="a handwritten board from this block" disabled={!sel} onClick={async () => {
              if (!sel) return;
              const r = await fetch(`/api/notebooks/${nb}/handboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: sel.page ?? 'Notes', blockIds: [sel._id] }) });
              if (r.ok) onChanged();
            }} />
            {sel && sel.trust === 'user' && ['note', 'text'].includes(sel.type) ? <ActionRow icon="✍️" title="Continue writing" sub="the AI extends your draft" onClick={() => onContinue(sel._id)} /> : null}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            {dryCode ? (
        <div style={{ margin: '10px 0' }}>
          {dryCode.loading ? <div style={{ fontSize: 12, color: C.sub }}>writing the algorithm…</div>
            : dryCode.error ? <div style={{ fontSize: 12, color: '#c0392b' }}>{dryCode.error}</div>
            : <>
                {dryCode.note ? <div style={{ fontSize: 11.5, color: C.sub, marginBottom: 6 }}>{dryCode.note}</div> : null}
                <TryItPanel seedCode={dryCode.code} seedEntry={dryCode.entry ?? ''} language="python" />
              </>}
        </div>
      ) : null}
      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Ask anything about this notebook</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { onAsk(q.trim()); setQ(''); } }}
                placeholder="Ask a question…" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px', fontSize: 12.5 }} />
              <button onClick={() => { if (q.trim()) { onAsk(q.trim()); setQ(''); } }} style={{ border: 'none', borderRadius: 12, background: C.accent, color: '#fff', width: 34, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>↑</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.sub, marginTop: 6 }}>AI answers come from your sources and notes.</div>
          </div>
        </div>
      ) : null}

      {tab === 'back' ? (
        backlinks.length === 0 ? <div style={{ fontSize: 12.5, color: C.sub }}>No links point here yet — write [[{'{'}notebook{'}'}]] in any note.</div>
          : backlinks.map((bl, i) => (
            <button key={i} onClick={() => onNavigate?.(bl.notebookId)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '5px 0' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.extracted }}>{bl.title}</div>
              {bl.preview ? <div style={{ fontSize: 11.5, color: C.sub }}>“{bl.preview.slice(0, 80)}…”</div> : null}
            </button>
          ))
      ) : null}

      {tab === 'review' ? (
        <div>
          {sel ? (
            <>
              <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 8 }}>Explain “{(sel.title || sel.content || '').slice(0, 50)}” in your own words — the tutor checks it and schedules what you miss.</div>
              <textarea value={teachText} onChange={(e) => setTeachText(e.target.value)} spellCheck={false}
                style={{ width: '100%', minHeight: 100, boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, lineHeight: 1.6 }} />
              <button onClick={teach} disabled={teachBusy || teachText.trim().length < 20}
                style={{ marginTop: 6, border: 'none', borderRadius: 999, background: teachBusy || teachText.trim().length < 20 ? '#CFE0D2' : '#1E9A61', color: '#fff', padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                {teachBusy ? 'checking…' : '✓ check my explanation'}
              </button>
              {teachResult?.error ? <div style={{ fontSize: 12, color: '#D64545', marginTop: 6, fontWeight: 700 }}>{teachResult.error}</div> : null}
              {teachResult?.verdict ? <div style={{ fontSize: 12.5, color: C.ink, marginTop: 8 }}>Verdict: <b>{teachResult.verdict}</b>{teachResult.missing?.length ? ` — ${teachResult.missing.length} revision item(s) scheduled` : ' — nothing missing 🎉'}<div style={{ color: C.sub, marginTop: 4 }}>the full check landed in your notebook</div></div> : null}
            </>
          ) : <div style={{ fontSize: 12.5, color: C.sub }}>Select a block first, then explain it back.</div>}
        </div>
      ) : null}
    </div>
    </div>
  );
}

export function ActionRow({ icon, title, sub, onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', padding: '9px 12px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FDEFE7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 11, color: C.sub }}>{sub}</div>
      </span>
    </button>
  );
}

export function CtxBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.ink, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{children}</button>;
}
