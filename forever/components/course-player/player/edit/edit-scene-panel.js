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
  const changedLines = lines.filter((l) => l.text !== l.original);
  const changedObjects = objects.filter((o) => o.content !== o.original);
  const addedLines = newLines.filter((l) => l.text.trim());
  const changedMarks = markSets.filter((m) => JSON.stringify(m.annotations) !== m.original);
  const dirty = changedLines.length + changedObjects.length + addedLines.length + changedMarks.length > 0;

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
            <MarkEditor key={set.objectId} url={set.url} annotations={set.annotations}
              onChange={(annotations) => setMarkSets((prev) => prev.map((m, j) => (j === i ? { ...m, annotations } : m)))} />
          ))}
        </div>
      )}

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
