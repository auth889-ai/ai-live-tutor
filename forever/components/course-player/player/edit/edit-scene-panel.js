'use client';

// Human-in-the-loop scene editor (v1): the lesson OWNER rewrites this scene's narration
// lines and plain-text board content; Save re-voices ONLY this scene server-side (per-line
// TTS cache -> only the lines actually changed cost a synthesis call). Structured objects
// (graphs, traces, code) are shown read-only — their truth comes from engines, not typing.
// On success the page reloads: the lesson re-arrives from the store with the new versioned
// audio URL, so the clock, karaoke and timeline are rebuilt from the saved artifact —
// never from optimistic client state.

import { useState } from 'react';

import { MarkEditor } from './mark-editor.js';

const V = (name) => `var(${name})`;

export function EditScenePanel({ lessonId, scene, onClose }) {
  const editableObjects = (scene.objects ?? []).filter((o) => typeof o.content === 'string');
  const imageObjects = (scene.objects ?? []).filter((o) => o.renderHint === 'image' && o.content?.url);
  const structuredCount = (scene.objects ?? []).length - editableObjects.length - imageObjects.length;
  const [lines, setLines] = useState(() => (scene.voiceLines ?? []).map((l) => ({ id: l.id, text: l.text, original: l.text })));
  const [objects, setObjects] = useState(() => editableObjects.map((o) => ({ id: o.id, content: o.content, original: o.content, hint: o.renderHint })));
  const [markSets, setMarkSets] = useState(() => imageObjects.map((o) => ({
    objectId: o.id, url: o.content.url,
    annotations: o.content.annotations ?? [],
    original: JSON.stringify(o.content.annotations ?? []),
  })));
  const [status, setStatus] = useState(''); // '' | 'saving' | error text
  const [newLines, setNewLines] = useState([]); // brand-new narration the human writes
  const [newObjs, setNewObjs] = useState([]); // human board additions: {kind, text|values|url+alt+displayWidth}
  const [imageWidths, setImageWidths] = useState(() => Object.fromEntries(imageObjects.map((o) => [o.id, o.content.displayWidth ?? 1])));
  const changedLines = lines.filter((l) => l.text !== l.original);
  const changedObjects = objects.filter((o) => o.content !== o.original);
  const addedLines = newLines.filter((l) => l.text.trim());
  const changedMarks = markSets.filter((m) => JSON.stringify(m.annotations) !== m.original);
  const addedObjs = newObjs.filter((o) => (o.kind === 'text' && o.text?.trim()) || (o.kind === 'array' && o.values?.trim()) || (o.kind === 'image' && o.url));
  const changedWidths = imageObjects.filter((o) => (imageWidths[o.id] ?? 1) !== (o.content.displayWidth ?? 1));
  const dirty = changedLines.length + changedObjects.length + addedLines.length + changedMarks.length + addedObjs.length + changedWidths.length > 0;
  const knownImages = [...new Set((scene.objects ?? []).filter((o) => o.renderHint === 'image' && o.content?.url).map((o) => o.content.url))];

  const save = async () => {
    setStatus('saving');
    try {
      const response = await fetch(`/api/lessons/${lessonId}/scenes/${scene.sceneId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          voiceLines: changedLines.map(({ id, text }) => ({ id, text })),
          objects: changedObjects.map(({ id, content }) => ({ id, content })),
          newVoiceLines: addedLines.map(({ text }) => ({ text })),
          marks: changedMarks.map(({ objectId, annotations }) => ({ objectId, annotations })),
          newObjects: addedObjs.map((o) => (o.kind === 'array'
            ? { kind: 'array', label: o.label, values: o.values.split(',').map((v) => (v.trim() === '' ? 0 : Number.isNaN(Number(v)) ? v.trim() : Number(v))) }
            : o.kind === 'image'
              ? { kind: 'image', url: o.url, alt: o.alt || 'inserted figure', displayWidth: Number(o.displayWidth) || 1 }
              : { kind: 'text', text: o.text })),
          images: changedWidths.map((o) => ({ objectId: o.id, displayWidth: Number(imageWidths[o.id]) })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) { setStatus(payload.error || `save failed (HTTP ${response.status})`); return; }
      window.location.reload(); // saved artifact is the truth — reload player from it
    } catch (error) {
      setStatus(String(error?.message || error));
    }
  };

  const areaStyle = {
    width: '100%', minHeight: 64, resize: 'vertical', fontSize: 13.5, lineHeight: 1.5, color: V('--ink'),
    background: '#fff', border: `1px solid ${V('--border')}`, borderRadius: 10, padding: '8px 10px',
    fontFamily: 'inherit',
  };

  return (
    <div style={{
      background: V('--surface-raised', '#fffcfa'), border: `1px solid ${V('--border')}`, borderRadius: 20,
      padding: 18, boxShadow: V('--card-shadow'), display: 'grid', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <div style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontWeight: 620, fontSize: 15.5 }}>
          ✏️ Edit this scene — <span style={{ fontStyle: 'italic' }}>{scene.title}</span>
        </div>
        <div style={{ fontSize: 11.5, color: V('--ink-muted') }}>
          only your changed lines are re-voiced{structuredCount > 0 ? ` · ${structuredCount} structured object(s) stay engine-truth (read-only)` : ''}
        </div>
        <button onClick={onClose} aria-label="Close editor" style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, color: V('--ink-muted') }}>✕</button>
      </div>

      {objects.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: V('--ink-muted') }}>BOARD TEXT</div>
          {objects.map((object, i) => (
            <textarea key={object.id} value={object.content} style={areaStyle}
              onChange={(e) => setObjects((prev) => prev.map((o, j) => (j === i ? { ...o, content: e.target.value } : o)))} />
          ))}
        </div>
      )}

      {markSets.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: V('--ink-muted') }}>
            TEACHING MARKS (you see the image — your marks are the verification)
          </div>
          {markSets.map((set, i) => (
            <div key={set.objectId} style={{ display: 'grid', gap: 4 }}>
              <MarkEditor url={set.url} annotations={set.annotations}
                onChange={(annotations) => setMarkSets((prev) => prev.map((m, j) => (j === i ? { ...m, annotations } : m)))} />
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5, color: V('--ink-muted') }}>
                image size
                <input type="range" min="0.2" max="1" step="0.05" value={imageWidths[set.objectId] ?? 1}
                  onChange={(e) => setImageWidths((prev) => ({ ...prev, [set.objectId]: Number(e.target.value) }))} style={{ flex: 1, maxWidth: 220 }} />
                {Math.round((imageWidths[set.objectId] ?? 1) * 100)}%
              </label>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: V('--ink-muted') }}>ADD TO BOARD (your own material — kept even without narration)</div>
        {newObjs.map((o, i) => (
          <div key={i} style={{ display: 'grid', gap: 6, border: `1px dashed ${V('--border')}`, borderRadius: 10, padding: 10 }}>
            {o.kind === 'text' && (
              <textarea value={o.text ?? ''} placeholder="Write your own text block for the board…" style={{ minHeight: 52, fontFamily: 'inherit', fontSize: 13, padding: 8, borderRadius: 8, border: `1px solid ${V('--border')}` }}
                onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            )}
            {o.kind === 'array' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <input value={o.label ?? ''} placeholder="name (e.g. nums)" style={{ width: 130, fontSize: 12.5, padding: 7, borderRadius: 8, border: `1px solid ${V('--border')}` }}
                  onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input value={o.values ?? ''} placeholder="values, comma separated: 3, 1, 4, 1, 5" style={{ flex: 1, fontSize: 12.5, padding: 7, borderRadius: 8, border: `1px solid ${V('--border')}` }}
                  onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
              </div>
            )}
            {o.kind === 'image' && (
              <div style={{ display: 'grid', gap: 6 }}>
                <select value={o.url ?? ''} style={{ fontSize: 12.5, padding: 7, borderRadius: 8, border: `1px solid ${V('--border')}` }}
                  onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}>
                  <option value="">choose one of this lesson's figures…</option>
                  {knownImages.map((u) => <option key={u} value={u}>{u.split('/').pop().slice(0, 48)}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input value={o.alt ?? ''} placeholder="what it shows (alt text)" style={{ flex: 1, fontSize: 12.5, padding: 7, borderRadius: 8, border: `1px solid ${V('--border')}` }}
                    onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))} />
                  <label style={{ fontSize: 11.5, color: V('--ink-muted'), display: 'flex', gap: 6, alignItems: 'center' }}>
                    size <input type="range" min="0.2" max="1" step="0.05" value={o.displayWidth ?? 1}
                      onChange={(e) => setNewObjs((prev) => prev.map((x, j) => (j === i ? { ...x, displayWidth: Number(e.target.value) } : x)))} />
                  </label>
                </div>
              </div>
            )}
            <button onClick={() => setNewObjs((prev) => prev.filter((_, j) => j !== i))}
              style={{ justifySelf: 'end', border: 'none', background: 'transparent', color: '#b4231f', fontSize: 11.5, cursor: 'pointer' }}>remove</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setNewObjs((prev) => [...prev, { kind: 'text' }])} style={{ border: `1px dashed ${V('--border')}`, background: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: V('--ink-muted') }}>+ Text</button>
          <button onClick={() => setNewObjs((prev) => [...prev, { kind: 'array' }])} style={{ border: `1px dashed ${V('--border')}`, background: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: V('--ink-muted') }}>+ Array</button>
          <button onClick={() => setNewObjs((prev) => [...prev, { kind: 'image', displayWidth: 1 }])} style={{ border: `1px dashed ${V('--border')}`, background: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: V('--ink-muted') }}>+ Image</button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: V('--ink-muted') }}>NARRATION (what the tutor speaks)</div>
        {lines.map((line, i) => (
          <textarea key={line.id} value={line.text} style={{ ...areaStyle, background: line.text !== line.original ? '#fff8f0' : '#fff' }}
            onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))} />
        ))}
        {newLines.map((line, i) => (
          <textarea key={`new_${i}`} value={line.text} placeholder="Write a new narration line — the tutor will speak it at the end of this scene…"
            style={{ ...areaStyle, background: '#f4fbf4', borderStyle: 'dashed' }}
            onChange={(e) => setNewLines((prev) => prev.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))} />
        ))}
        <button onClick={() => setNewLines((prev) => [...prev, { text: '' }])}
          style={{ justifySelf: 'start', border: `1px dashed ${V('--border')}`, background: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, cursor: 'pointer', color: V('--ink-muted') }}>
          + Add narration line
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="forever-btn" disabled={!dirty || status === 'saving'} onClick={save}
          style={{ padding: '9px 20px', borderRadius: 10, fontWeight: 700, cursor: dirty ? 'pointer' : 'default', opacity: dirty ? 1 : 0.5 }}>
          {status === 'saving' ? 'Re-voicing this scene…' : `Save & re-voice (${changedLines.length + changedObjects.length} change${changedLines.length + changedObjects.length === 1 ? '' : 's'})`}
        </button>
        {status && status !== 'saving' && <span style={{ fontSize: 12.5, color: '#b4231f' }}>{status}</span>}
      </div>
    </div>
  );
}
