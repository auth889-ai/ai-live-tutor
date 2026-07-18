'use client';

// 📓 Notebooks — the Sankofa input-first pattern: a notebook is YOUR object. You feed it any
// input — typed notes, pasted text, links (auto-extracted), PDFs/images, your voice — as typed
// blocks with provenance badges, then one button turns the whole notebook into a course through
// the same pipeline the studio uses. Library grid ↔ workspace, one component file.
// Design contract: notes/research/notebook-sankofa-plan-18jul.md (from the full eva/ dissection).

import { useEffect, useRef, useState } from 'react';

const T = {
  card: { border: '1px solid #f2e3d5', borderRadius: 16, background: '#fff', boxShadow: '0 1px 4px rgba(58,46,34,0.05)' },
  cap: { fontSize: 11.5, color: '#9b8465' },
  accent: '#e8604c',
};
const TYPE_META = {
  note: ['📝', 'note'], text: ['📋', 'pasted'], link: ['🔗', 'link'],
  pdf: ['📄', 'PDF'], image: ['🖼', 'image'], voice: ['🎙', 'voice'],
};
const TRUST_COLOR = { user: '#2f7d4a', extracted: '#4477aa', ai: '#c98f2d' };

export function NotebooksContent() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const load = () => fetch('/api/notebooks').then((r) => r.json()).then((d) => setList(d.notebooks ?? [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  const create = async () => {
    const title = window.prompt('Name your notebook (what are you collecting?)');
    if (!title) return;
    const res = await fetch('/api/notebooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    const d = await res.json();
    if (d.id) { await load(); setOpenId(d.id); }
  };

  if (list === null) return <div style={{ ...T.card, padding: 40, textAlign: 'center', color: '#9b8465' }}>Opening your notebooks…</div>;
  if (openId) return <Workspace id={openId} onBack={() => { setOpenId(null); load(); }} />;

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 27, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0 }}>Notebooks</h1>
          <p style={{ ...T.cap, margin: '4px 0 0' }}>Collect anything — notes, links, files, your voice — then turn a notebook into a course.</p>
        </div>
        <button onClick={create} style={{ border: 'none', borderRadius: 999, background: T.accent, color: '#fff', padding: '9px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer' }}>+ New notebook</button>
      </div>
      {list.length === 0 ? (
        <div style={{ ...T.card, marginTop: 18, padding: '46px 20px', textAlign: 'center', color: '#9b8465' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📓</div>
          <div style={{ fontWeight: 700, color: '#2b211a' }}>Start your first notebook</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>type notes, paste articles, drop links or PDFs, even talk — forever turns it into a course</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
          {list.map((n) => (
            <button key={n.id} onClick={() => setOpenId(n.id)} className="pcard"
              style={{ ...T.card, borderRadius: 18, padding: '16px 18px', textAlign: 'left', cursor: 'pointer' }}>
              <div style={{ fontSize: 26 }}>📓</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#2b211a', marginTop: 8, lineHeight: 1.3 }}>{n.title}</div>
              <div style={{ ...T.cap, marginTop: 6 }}>{n.blockCount} block{n.blockCount === 1 ? '' : 's'} · {new Date(n.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>
              {n.generatedCourseId ? <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 800, color: '#2f7d4a' }}>✓ course generated</div>
                : n.lastGeneratedJobId ? <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 800, color: '#c98f2d' }}>⏳ generating…</div> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Workspace({ id, onBack }) {
  const [data, setData] = useState(null);
  const load = () => fetch(`/api/notebooks/${id}`).then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, [id]);
  if (!data?.notebook) return <div style={{ ...T.card, padding: 40, textAlign: 'center', color: '#9b8465' }}>Opening…</div>;
  const { notebook, blocks } = data;
  return (
    <div style={{ maxWidth: 1080 }}>
      <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: '#9b8465', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', padding: 0 }}>← all notebooks</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0, flex: 1, minWidth: 0 }}>{notebook.title}</h1>
        <SynthesizeButton id={id} blocks={blocks} onDone={load} />
        <GenerateButton id={id} notebook={notebook} blocks={blocks} onKick={load} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 14, alignItems: 'start', marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {blocks.length === 0 ? (
            <div style={{ ...T.card, padding: '30px 20px', textAlign: 'center', color: '#9b8465', fontSize: 13 }}>Empty page — add your first block →</div>
          ) : blocks.map((b) => <Block key={b._id} nb={id} b={b} onChanged={load} />)}
        </div>
        <Intake id={id} onAdded={load} />
      </div>
    </div>
  );
}

function Block({ nb, b, onChanged }) {
  const [icon, label] = TYPE_META[b.type] ?? ['•', b.type];
  const remove = async () => {
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'DELETE' });
    onChanged();
  };
  const isAi = b.trust === 'ai';
  return (
    <div style={{ ...T.card, padding: '12px 16px', ...(isAi ? { background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', borderColor: '#f0c39a' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{isAi ? '✨' : icon}</span>
        <span style={{ ...T.cap, fontWeight: 800 }}>{label.toUpperCase()}</span>
        <span title={`provenance: ${b.trust}`} style={{ fontSize: 10.5, fontWeight: 800, color: TRUST_COLOR[b.trust] ?? '#9b8465', background: `${TRUST_COLOR[b.trust] ?? '#9b8465'}14`, borderRadius: 999, padding: '2px 8px' }}>{b.trust}</span>
        {b.origin ? <span style={T.cap}>{b.origin}</span> : null}
        <button onClick={remove} title="remove block" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#c9bda1', cursor: 'pointer', fontSize: 13 }}>✕</button>
      </div>
      {b.title ? <div style={{ fontSize: 14, fontWeight: 800, color: '#2b211a', marginTop: 6 }}>{b.title}</div> : null}
      <div style={{ fontSize: 13.5, color: '#3a3327', marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
        {b.type === 'voice' ? (b.transcript || b.content) : b.type === 'link' ? `${(b.content ?? '').slice(0, 400)}${(b.content ?? '').length > 400 ? '…' : ''}` : b.content}
      </div>
      {b.url ? <a href={b.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#4477aa', fontWeight: 700 }}>{b.url}</a> : null}
    </div>
  );
}

// The eva IntakeFlow feel: one input surface, a type switcher, Enter adds, voice via Web Speech.
function Intake({ id, onAdded }) {
  const [mode, setMode] = useState('note'); // note | text | link | voice
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);

  const add = async (payload) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/notebooks/${id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'could not add');
      setValue('');
      onAdded();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    if (mode === 'note') add({ type: 'note', content: v, source: 'typed' });
    if (mode === 'text') add({ type: 'text', content: v, source: 'pasted' });
    if (mode === 'link') add({ type: 'link', url: v });
    if (mode === 'voice') add({ type: 'voice', transcript: v, source: 'voice' });
  };

  // eva's Web Speech pattern: client-side STT into the input; the transcript becomes the block.
  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('voice input needs Chrome/Edge (Web Speech API)'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => setValue([...e.results].map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    setMode('voice');
    rec.start();
  };

  const chip = (m, label) => (
    <button key={m} onClick={() => setMode(m)}
      style={{ border: mode === m ? `1.5px solid ${T.accent}` : '1.5px solid #f2e3d5', borderRadius: 999, background: mode === m ? '#fdf0ee' : '#fff', color: mode === m ? '#8a3a12' : '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
      {label}
    </button>
  );

  return (
    <div style={{ ...T.card, borderRadius: 18, padding: '14px 16px', position: 'sticky', top: 12 }}>
      <div style={{ ...T.cap, fontWeight: 800, marginBottom: 8 }}>ADD TO THIS NOTEBOOK</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {chip('note', '📝 Note')}
        {chip('text', '📋 Paste')}
        {chip('link', '🔗 Link')}
        <button onClick={toggleVoice}
          style={{ border: listening ? `1.5px solid ${T.accent}` : '1.5px solid #f2e3d5', borderRadius: 999, background: listening ? '#fdf0ee' : '#fff', color: listening ? '#c0522d' : '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          {listening ? '🎙 listening… tap to stop' : '🎙 Voice'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mode !== 'text') { e.preventDefault(); submit(); } }}
        placeholder={mode === 'link' ? 'https:// — the page text is extracted for you' : mode === 'voice' ? 'speak, then edit the transcript before adding' : mode === 'text' ? 'paste anything — an article, your old notes…' : 'write a note… (Enter adds it)'}
        spellCheck={false}
        style={{ width: '100%', minHeight: mode === 'text' ? 140 : 74, boxSizing: 'border-box', resize: 'vertical', border: '1px solid #f2e3d5', borderRadius: 12, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.55, color: '#2b211a', fontFamily: mode === 'link' ? 'ui-monospace, monospace' : 'inherit' }} />
      <button onClick={submit} disabled={busy || !value.trim()}
        style={{ marginTop: 8, width: '100%', border: 'none', borderRadius: 10, background: busy || !value.trim() ? '#e9ddcb' : T.accent, color: '#fff', padding: '9px 0', fontSize: 13, fontWeight: 800, cursor: busy || !value.trim() ? 'default' : 'pointer' }}>
        {busy ? 'adding…' : '+ Add block'}
      </button>
      {err ? <div style={{ marginTop: 8, fontSize: 12, color: '#a33d2e', fontWeight: 700 }}>{err}</div> : null}
      <div style={{ ...T.cap, marginTop: 10, lineHeight: 1.5 }}>PDF & image blocks land next round — links already pull the article text in.</div>
    </div>
  );
}

// The notebook's OWN act of creation (eva: inputs -> generated blocks; NotebookLM: grounded +
// cited). The result lands back in the notebook as an ai-provenance block — visibly the
// notebook's work, never confused with yours.
function SynthesizeButton({ id, blocks, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('study_note');
  const kick = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/notebooks/${id}/synthesize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'synthesis failed');
      onDone();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}
        style={{ border: '1px solid #f2e3d5', borderRadius: 10, background: '#fff', color: '#6b563d', padding: '7px 10px', fontSize: 12.5, fontWeight: 700 }}>
        <option value="study_note">study note</option>
        <option value="summary">summary</option>
        <option value="questions">self-test questions</option>
      </select>
      <button onClick={kick} disabled={busy || blocks.length === 0}
        style={{ border: 'none', borderRadius: 999, background: busy || blocks.length === 0 ? '#e9ddcb' : T.accent, color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: busy || blocks.length === 0 ? 'default' : 'pointer' }}>
        {busy ? 'synthesizing from your blocks…' : '✨ Synthesize'}
      </button>
      {err ? <span style={{ fontSize: 12, color: '#a33d2e', fontWeight: 700, maxWidth: 320 }}>{err}</span> : null}
    </div>
  );
}

function GenerateButton({ id, notebook, blocks, onKick }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const kick = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/notebooks/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'generation failed to start');
      onKick();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ textAlign: 'right' }}>
      {notebook.generatedCourseId ? (
        <a href={`/course/${notebook.generatedCourseId}`} style={{ border: 'none', borderRadius: 999, background: '#2f7d4a', color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>▶ open the generated course</a>
      ) : notebook.lastGeneratedJobId ? (
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#c98f2d' }}>⏳ course generating — check My Courses shortly</span>
      ) : (
        <button onClick={kick} disabled={busy || blocks.length === 0}
          style={{ border: '1.5px solid #d8cbb6', borderRadius: 999, background: '#fff', color: busy || blocks.length === 0 ? '#c9bda1' : '#6b563d', padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: busy || blocks.length === 0 ? 'default' : 'pointer' }}>
          {busy ? 'starting…' : '🎓 also make a course'}
        </button>
      )}
      {err ? <div style={{ marginTop: 6, fontSize: 12, color: '#a33d2e', fontWeight: 700, maxWidth: 380 }}>{err}</div> : null}
    </div>
  );
}
