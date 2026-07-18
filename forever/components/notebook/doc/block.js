'use client';

// DOC BLOCK — one block of the document: moment/drawing/handboard/image/text cards,
// whisper actions (edit, listen, attach, move, resize), provenance tints.

import { useState } from 'react';

import { C, TRUST_TINT } from '../theme.js';
import { Doc, Inline } from './markdown.js';
import { DrawingEditor, SvgDrawing, downloadDrawing } from '../drawing.js';
import { HandBoard } from '../hand-board.js';

export function DocBlock({ nb, b, pages = [], selected, onSelect, onChanged, onNavigate, legacyIll = new Map() }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showExtract, setShowExtract] = useState(false);
  const [editingInk, setEditingInk] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [attSize, setAttSize] = useState(0); // attached-image size: 0 small, 1 medium, 2 large
  const moveToPage = async (pg) => {
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: pg }) });
    onChanged();
  };
  const attachFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const up = await fetch('/api/uploads', { method: 'POST', body: fd });
    const upd = await up.json();
    if (up.ok) {
      await fetch(`/api/notebooks/${nb}/blocks/${b._id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: file.type === 'application/pdf' ? 'pdf' : 'image', uploadId: upd.uploadId, fileName: file.name }) });
      onChanged();
    }
    setAttaching(false);
  };
  const patchAtt = async (attachmentId, meta) => {
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}/attach`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachmentId, ...meta }) });
    onChanged();
  };
  const attachLink = async (url) => {
    setAttaching(false);
    if (!url?.trim()) return;
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'link', url: url.trim() }) });
    onChanged();
  };
  const save = async () => {
    setBusy(true);
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draftText }) }).catch(() => {});
    setBusy(false);
    setEditing(false);
    onChanged();
  };
  const tidy = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${b._id}/improve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: draftText }) });
      const d = await r.json();
      if (r.ok) setDraftText(d.improved);
    } finally { setBusy(false); }
  };
  const [narrating, setNarrating] = useState(false);
  const listen = async (e) => {
    e.stopPropagation();
    if (narrating) return;
    setNarrating(true);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${b._id}/narrate`, { method: 'POST' });
      const d = await r.json();
      if (d.audioUrl) { new Audio(d.audioUrl).play(); onChanged(); }
    } finally { setNarrating(false); }
  };
  const remove = async () => { await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'DELETE' }); onChanged(); };
  const when = new Date(b.createdAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const provenance = b.trust === 'ai' ? 'AI' : b.trust === 'extracted' ? 'extracted' : 'you';

  // MOMENT: the one card that KEEPS a visible design (unique Forever feature)
  if (b.type === 'moment') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: 14, border: `1.5px solid #F3D8CE`, borderRadius: 12, background: '#FFFAF7', cursor: 'pointer' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.accent }}>▶ {b.title}</div>
        {b.transcript ? <div style={{ fontSize: 14, color: C.ink, fontStyle: 'italic', margin: '6px 0' }}>“{b.transcript}”</div> : null}
        {b.content ? <div style={{ fontSize: 13.5, color: C.sub }}>{b.content}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a href={b.url} onClick={(e) => e.stopPropagation()} style={{ borderRadius: 999, background: C.accent, color: '#fff', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, textDecoration: 'none' }}>Replay moment</a>
          <span className="nbk-acts" style={{ fontSize: 11, color: C.sub, alignSelf: 'center' }}>{b.origin} · {when}</span>
        </div>
      </div>
    );
  }

  if (b.type === 'handboard') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        <HandBoard spec={b.content} />
        <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.sub }}>hand board · AI · grounded · {when}</span>
          <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
        </div>
      </div>
    );
  }

  if (b.type === 'drawing') {
    // a saved page must stay writable, like Xournal: ✏️ reopens the editor over the same ink
    if (editingInk) {
      return (
        <div style={{ margin: '10px 0' }}>
          <DrawingEditor
            initial={b.content}
            onSave={async (data) => {
              await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: data }) });
              setEditingInk(false);
              onChanged();
            }}
            onCancel={() => setEditingInk(false)}
          />
        </div>
      );
    }
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ position: 'relative', margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        <SvgDrawing data={b.content} />
        <button onClick={(e) => { e.stopPropagation(); setEditingInk(true); }} title="keep writing on this drawing"
          style={{ position: 'absolute', top: 16, right: 18, border: '1px solid #EBD9C4', borderRadius: 999, background: '#FFFFFFEE', color: C.ink, padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>✏️ write</button>
        <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.sub }}>drawing · you · {when}</span>
          <button onClick={(e) => { e.stopPropagation(); downloadDrawing(b.content, 'svg', 'drawing'); }} style={ghost()}>⬇ svg</button>
          <button onClick={(e) => { e.stopPropagation(); downloadDrawing(b.content, 'png', 'drawing'); }} style={ghost()}>⬇ png</button>
          <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
        </div>
      </div>
    );
  }

  // IMAGE source: picture first, description collapsed
  if (b.type === 'image') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        {b.url ? <img src={b.url} alt={b.title ?? ''} style={{ width: '100%', borderRadius: 10 }} /> : null}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{b.title ?? 'Image'}</span>
          <span style={{ fontSize: 11, color: C.sub }}>image · {provenance} · {when}</span>
          {b.content ? (
            <button onClick={(e) => { e.stopPropagation(); setShowExtract((v) => !v); }} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.extracted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              {showExtract ? 'hide details' : 'view extracted details'}
            </button>
          ) : null}
        </div>
        {showExtract ? <div style={{ fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 1.6 }}>{b.content}</div> : null}
      </div>
    );
  }

  return (
    <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '4px -10px', padding: '8px 10px', cursor: 'pointer' }}>
      {b.title ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0 4px' }}>
          <span style={{ fontSize: b.trust === 'ai' ? 22 : 16.5, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' }}><Inline text={(b.title ?? '').replace(/^✨\s*/, '')} onNavigate={onNavigate} /></span>
          {b.trust === 'ai' ? <span style={{ fontSize: 10, fontWeight: 800, color: C.ai, background: '#FBF3E4', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>AI · grounded</span> : null}
        </div>
      ) : null}
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} spellCheck={false}
            style={{ width: '100%', minHeight: 100, boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', fontSize: 14.5, lineHeight: 1.65, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={save} disabled={busy} style={{ border: 'none', borderRadius: 999, background: '#1E9A61', color: '#fff', padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>save</button>
            <button onClick={tidy} disabled={busy} style={{ border: `1px solid ${C.border}`, borderRadius: 999, background: '#fff', color: C.ai, padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{busy ? '…' : '✨ tidy'}</button>
            <button onClick={() => setEditing(false)} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12, cursor: 'pointer' }}>cancel</button>
          </div>
        </div>
      ) : (
        <Doc text={(() => {
          let t = b.type === 'voice' ? (b.transcript || b.content) : (b.content ?? '');
          // Sankofa's context-cap law, applied to READING: huge pasted text collapses
          if (!expanded && b.trust === 'user' && t.length > 1500) t = `${t.slice(0, 1500).split('\n').slice(0, -1).join('\n')}\n\n…`;
          // weave legacy illustrations under their matching section headings
          if (b.trust === 'ai' && legacyIll.size && !/!\[/.test(t)) {
            t = t.split('\n').map((ln) => {
              const m = ln.match(/^#{1,3} (.+)$/);
              const u = m ? legacyIll.get(m[1].trim().toLowerCase()) : null;
              return u ? `${ln}\n![${m[1].trim()}](${u})` : ln;
            }).join('\n');
          }
          return t;
        })()} onNavigate={onNavigate} skipTitle={(b.title ?? '').replace(/^✨\s*/, '')} />
      )}
      {(b.attachments ?? []).map((att) => att.kind === 'image' && att.url ? (
        <div key={att.id} onClick={(e) => e.stopPropagation()} data-att={att.id}
          style={{ float: att.placement === 'left' ? 'left' : att.placement === 'right' ? 'right' : 'none',
            width: { s: '26%', m: '52%', l: '100%' }[att.size ?? 'm'], minWidth: 160,
            margin: att.placement === 'left' ? '4px 14px 6px 0' : att.placement === 'right' ? '4px 0 6px 14px' : '6px 0' }}>
          <img src={att.url} alt={att.title ?? ''} style={{ width: '100%', borderRadius: 10, display: 'block' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 2 }}>
            {[['left', '◧'], ['full', '▣'], ['right', '◨']].map(([pl, icon]) => (
              <button key={pl} onClick={() => patchAtt(att.id, { placement: pl })} title={`place image ${pl}`}
                style={{ ...ghost(), opacity: (att.placement ?? 'full') === pl ? 1 : 0.45 }}>{icon}</button>
            ))}
            <button onClick={() => patchAtt(att.id, { size: { s: 'm', m: 'l', l: 's' }[att.size ?? 'm'] })} title="cycle size" style={ghost()}>⤢</button>
          </div>
        </div>
      ) : (
        <a key={att.id} href={att.url ?? undefined} target={att.url ? '_blank' : undefined} rel="noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', gap: 5, fontSize: 12, color: C.extracted, fontWeight: 700, textDecoration: 'none', marginRight: 10 }}>
          {att.kind === 'pdf' ? '📄' : '🔗'} {att.title ?? att.kind}
        </a>
      ))}
      {/* hover-only whisper row */}
      <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 11, color: C.sub, background: TRUST_TINT[b.trust] ?? 'transparent', borderRadius: 6, padding: '1px 7px' }}>{provenance} · {when}</span>
        {['note', 'text', 'moment'].includes(b.type) ? (
          <button onClick={(e) => { e.stopPropagation(); setDraftText(b.content ?? ''); setEditing(true); }} style={ghost()}>✏️</button>
        ) : null}
        {b.audioUrl ? <audio controls src={b.audioUrl} style={{ height: 26 }} onClick={(e) => e.stopPropagation()} /> : null}
        {!b.audioUrl && ['note', 'text'].includes(b.type) ? (
          <button onClick={listen} title="read this note aloud (Sankofa-style narration)" style={ghost()}>{narrating ? '…' : '🔊 listen'}</button>
        ) : null}
        <button onClick={(e) => { e.stopPropagation(); setAttaching((v) => !v); }} title="attach a link to this block" style={ghost()}>📎</button>
        {b.trust === 'user' && String(b.content ?? '').length > 1500 ? (
          <button onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }} style={ghost()}>{expanded ? '▴ collapse' : `▾ show all (${Math.round(String(b.content ?? '').length / 1000)}k)`}</button>
        ) : null}
        {pages.length > 1 ? (
          <select value={b.page ?? 'Notes'} onClick={(e) => e.stopPropagation()} onChange={(e) => moveToPage(e.target.value)}
            title="move this block to another page"
            style={{ border: `1px solid ${C.border}`, borderRadius: 7, background: '#fff', color: C.sub, fontSize: 10.5, fontWeight: 700, padding: '1px 4px' }}>
            {pages.map((pg) => <option key={pg} value={pg}>⇢ {pg}</option>)}
          </select>
        ) : null}
        <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
      </div>
      {attaching ? (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
        <label style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: '#fff', color: C.sub, fontSize: 11.5, fontWeight: 800, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          🖼 png / pdf<input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={attachFile} style={{ display: 'none' }} />
        </label>
        <input autoFocus placeholder="or paste a link — Enter attaches it to this block"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter') attachLink(e.currentTarget.value); if (e.key === 'Escape') setAttaching(false); }}
          style={{ flex: 1, boxSizing: 'border-box', border: `1px dashed ${C.border}`, borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }} />
        </div>
      ) : null}
    </div>
  );
}
const ghost = () => ({ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 12.5, padding: 0 });

// ---------- live + draft panels ----------
