'use client';

// COMPOSER — the fixed input under the document: note/link typing, + menu (PDF, image,
// voice, draw), upload plumbing.

import { useRef, useState } from 'react';

import { C } from '../theme.js';
import { DrawingEditor } from '../drawing.js';

export function Composer({ id, page, onAdded }) {
  const [v, setV] = useState('');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const fileRef = useRef(null);
  const kindRef = useRef('pdf');
  const [listening, setListening] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const recRef = useRef(null);

  const [err, setErr] = useState('');
  const post = async (payload) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/notebooks/${id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, page }) });
      if (!r.ok) throw new Error((await r.json()).error || `save failed (HTTP ${r.status})`);
      setV('');
      onAdded();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally { setBusy(false); setBusyLabel(''); }
  };
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) post({ type: 'link', url: t });
    else post({ type: 'note', content: t, source: 'typed' });
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBusyLabel(kindRef.current === 'pdf' ? 'extracting PDF…' : 'reading image…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/uploads', { method: 'POST', body: fd });
      const upd = await up.json();
      if (up.ok) await post({ type: kindRef.current, uploadId: upd.uploadId, fileName: file.name, mediaType: file.type, source: 'upload' });
    } finally { setBusy(false); setBusyLabel(''); setMenu(false); }
  };
  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => setV([...e.results].map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
    setMenu(false);
  };

  return (
    <div style={{ maxWidth: 820, margin: '12px auto 0', position: 'sticky', bottom: 12 }}>
      {drawOpen ? (
        <DrawingEditor
          onSave={async (data) => { setDrawOpen(false); await post({ type: 'drawing', content: data, source: 'typed' }); }}
          onCancel={() => setDrawOpen(false)} />
      ) : null}
      {menu ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {[['📄 PDF', () => { kindRef.current = 'pdf'; fileRef.current?.click(); }], ['🖼 Image', () => { kindRef.current = 'image'; fileRef.current?.click(); }], ['🎙 Voice', voice], ['✏️ Draw', () => { setDrawOpen(true); setMenu(false); }]].map(([label, fn]) => (
            <button key={label} onClick={fn} style={{ border: `1px solid ${C.border}`, borderRadius: 999, background: '#fff', color: C.sub, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '8px 12px', boxShadow: '0 6px 18px rgba(58,46,34,0.08)' }}>
        <button onClick={() => setMenu((m) => !m)} title="add PDF, image, or voice" style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 17, cursor: 'pointer', padding: 0 }}>＋</button>
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={busy ? (busyLabel || 'working…') : listening ? 'listening — speak, then Enter…' : `Write on “${page}” — a note, or paste a link…`}
          disabled={busy}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: C.ink, background: 'transparent' }} />
        <button onClick={submit} disabled={busy || !v.trim()} style={{ border: 'none', borderRadius: 10, background: busy || !v.trim() ? '#E8DFD2' : C.accent, color: '#fff', width: 30, height: 30, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>↑</button>
      </div>
      {err ? <div style={{ marginTop: 6, fontSize: 12, color: '#D64545', fontWeight: 700, background: '#fff', borderRadius: 8, padding: '4px 10px', display: 'inline-block' }}>{err}</div> : null}
      <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: 'none' }} />
    </div>
  );
}

// ---------- right: contextual intelligence ----------
