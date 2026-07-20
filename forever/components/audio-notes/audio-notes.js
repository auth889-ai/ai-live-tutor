'use client';

// AUDIO → NOTES — the w2 liveLectureNotes feature, in forever. Upload a lecture recording (or
// paste a transcript); the focus-server transcribes it (faster-whisper) and Qwen turns it into
// a rich structured note (overview, key concepts, definitions, examples, summary, exam questions).
// A stable device id is kept in localStorage so notes persist and list across visits.

import { useEffect, useState } from 'react';

const V = (n, f) => `var(${n}, ${f})`;

function deviceId() {
  if (typeof window === 'undefined') return 'web';
  let id = localStorage.getItem('forever_focus_device');
  if (!id) { id = (crypto.randomUUID?.() || `web-${Date.now()}-${Math.random().toString(16).slice(2)}`); localStorage.setItem('forever_focus_device', id); }
  return id;
}

export function AudioNotes() {
  const [mode, setMode] = useState('live'); // live | audio | transcript
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [past, setPast] = useState([]);
  const [listening, setListening] = useState(false);
  const recRef = useState(() => ({ current: null }))[0];

  const hdr = () => ({ 'x-device-id': deviceId() });

  // LIVE IN CLASS: the browser's speech recognition transcribes the lecture in real time; the
  // running transcript fills below, and "stop & generate" turns it into structured notes.
  const startListening = () => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) { setError('Live listening needs Chrome (Web Speech API). Use "Upload audio" or "Paste transcript" instead.'); return; }
    setError(null);
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    let finalText = transcript ? transcript + ' ' : '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
      }
      setTranscript(finalText + interim);
    };
    rec.onerror = (e) => { if (e.error !== 'no-speech') setError(`mic: ${e.error}`); };
    rec.onend = () => { if (recRef.current) rec.start(); }; // keep going through pauses until stopped
    recRef.current = rec;
    rec.start();
    setListening(true);
  };
  const stopListening = () => {
    const rec = recRef.current; recRef.current = null;
    try { rec?.stop(); } catch { /* */ }
    setListening(false);
  };

  const loadPast = async () => {
    try {
      const r = await fetch('/api/live-lecture-notes/', { headers: hdr() });
      const j = await r.json();
      const list = j?.data?.notes || j?.data || [];
      setPast(Array.isArray(list) ? list.slice(0, 12) : []);
    } catch { /* ignore */ }
  };
  useEffect(() => { loadPast(); }, []);

  const generate = async () => {
    setError(null); setNote(null); setBusy(true);
    try {
      let res;
      if (mode === 'live') {
        if (listening) stopListening();
        if (!transcript.trim()) { setError('Nothing captured yet — press "Start listening" during the lecture.'); setBusy(false); return; }
        res = await fetch('/api/live-lecture-notes/from-transcript', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr() },
          body: JSON.stringify({ transcript, title: title || 'Live lecture' }),
        });
      } else if (mode === 'transcript') {
        if (!transcript.trim()) { setError('Paste a transcript first.'); setBusy(false); return; }
        res = await fetch('/api/live-lecture-notes/from-transcript', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...hdr() },
          body: JSON.stringify({ transcript, title: title || 'Lecture' }),
        });
      } else {
        if (!file) { setError('Choose an audio file first.'); setBusy(false); return; }
        const fd = new FormData();
        fd.append('audio', file);
        fd.append('title', title || file.name);
        res = await fetch('/api/live-lecture-notes/from-audio', { method: 'POST', headers: hdr(), body: fd });
      }
      const j = await res.json();
      if (!j.ok) { setError(j.message || j.error || 'Failed to generate notes.'); }
      else { setNote(j.data?.note || j.data); loadPast(); }
    } catch (e) { setError(String(e?.message ?? e)); }
    setBusy(false);
  };

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: V('--ink', '#2b2320'), margin: '0 0 4px' }}>🎙️ Audio → Notes</h1>
      <p style={{ fontSize: 13, color: V('--ink-muted', '#8a7d76'), margin: '0 0 18px' }}>
        Upload a lecture recording or paste a transcript — the AI transcribes and turns it into clean, structured study notes.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {[['live', '🎧 Listen in class'], ['audio', 'Upload audio'], ['transcript', 'Paste transcript']].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)} style={chip(mode === m)}>{label}</button>
        ))}
      </div>

      <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 14, padding: 16, background: V('--card', '#fffdfb'), marginBottom: 18 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)"
          style={{ width: '100%', padding: '8px 11px', borderRadius: 8, border: `1px solid ${V('--border', '#eadfd8')}`, fontSize: 13.5, marginBottom: 10, fontFamily: 'inherit' }} />
        {mode === 'live' ? (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              {!listening ? (
                <button onClick={startListening} style={{ border: 'none', borderRadius: 999, background: '#c0522d', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>● Start listening</button>
              ) : (
                <button onClick={stopListening} style={{ border: 'none', borderRadius: 999, background: '#2b7a3f', color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>■ Stop listening</button>
              )}
              <span style={{ fontSize: 12, color: listening ? '#c0522d' : V('--ink-muted', '#8a7d76'), fontWeight: 600 }}>
                {listening ? '🔴 listening — the lecture is being transcribed live…' : 'Open this in class and press Start — it writes the transcript as the teacher speaks.'}
              </span>
            </div>
            <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={7} placeholder="The live transcript appears here as you listen… (you can edit it before generating notes)"
              style={{ width: '100%', padding: 11, borderRadius: 8, border: `1px solid ${listening ? '#c0522d' : V('--border', '#eadfd8')}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
          </div>
        ) : mode === 'audio' ? (
          <input type="file" accept="audio/*,video/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
        ) : (
          <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={7} placeholder="Paste the lecture transcript here…"
            style={{ width: '100%', padding: 11, borderRadius: 8, border: `1px solid ${V('--border', '#eadfd8')}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
        )}
        <div style={{ marginTop: 12 }}>
          <button onClick={generate} disabled={busy} style={{ border: 'none', borderRadius: 999, background: busy ? '#c9bda1' : '#2b7a3f', color: '#fff', padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'AI is writing your notes…' : (mode === 'live' ? '✨ Stop & write notes' : '✨ Generate notes')}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#c0522d', fontSize: 12.5 }}>{error}</div>}
      </div>

      {note && <NoteCard note={note} />}

      {past.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 8 }}>Your notes</div>
          {past.map((n) => (
            <div key={n._id || n.id} onClick={() => setNote(n.note || n)} style={{ padding: '8px 0', borderBottom: `1px solid ${V('--border', '#f0e8e2')}`, fontSize: 13, cursor: 'pointer', color: V('--ink', '#2b2320') }}>
              {(n.note?.title || n.topic || n.title || 'Untitled note')} <span style={{ color: V('--ink-muted', '#8a7d76'), fontSize: 11.5 }}>· {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteCard({ note }) {
  const list = (v) => Array.isArray(v) ? v : (v ? [v] : []);
  const Section = ({ title, items }) => items.length ? (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 5 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((x, i) => (
        <li key={i} style={{ fontSize: 13, color: V('--ink', '#3a322e'), marginBottom: 4, lineHeight: 1.55 }}>
          {typeof x === 'string' ? x : (x.term ? <><b>{x.term}:</b> {x.definition || x.meaning || ''}</> : JSON.stringify(x))}
        </li>
      ))}</ul>
    </div>
  ) : null;

  return (
    <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 16, padding: 20, background: V('--surface', '#fbf6f2') }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 8 }}>{note.title || note.lectureTopic || 'Lecture Notes'}</div>
      {note.overview && <p style={{ fontSize: 13.5, color: V('--ink', '#3a322e'), lineHeight: 1.6, marginTop: 0 }}>{note.overview}</p>}
      <Section title="Learning objectives" items={list(note.learningObjectives)} />
      <Section title="Key concepts" items={list(note.keyConcepts)} />
      <Section title="Definitions" items={list(note.definitions)} />
      <Section title="Detailed notes" items={list(note.detailedNotes)} />
      <Section title="Step by step" items={list(note.stepByStepExplanation)} />
      <Section title="Examples" items={list(note.examples)} />
      <Section title="Formulas" items={list(note.formulas)} />
      {note.summary && <><div style={{ fontSize: 13, fontWeight: 800, marginBottom: 5, color: V('--ink', '#2b2320') }}>Summary</div><p style={{ fontSize: 13, color: V('--ink', '#3a322e'), lineHeight: 1.6, marginTop: 0 }}>{note.summary}</p></>}
      <Section title="Exam focus" items={list(note.examFocus)} />
      <Section title="Questions to review" items={list(note.questionsToReview)} />
      <Section title="Possible exam questions" items={list(note.possibleExamQuestions)} />
    </div>
  );
}

function chip(active) {
  return { border: active ? 'none' : `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 999, background: active ? '#2b7a3f' : 'transparent', color: active ? '#fff' : V('--ink', '#2b2320'), padding: '6px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
}
