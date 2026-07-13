'use client';

// Ask-the-Tutor panel (one job): the student asks anything mid-lesson; the lesson's own
// specialist teacher answers in-register, grounded in the current scene. Playback holds
// while the student types (a real tutor stops talking when a hand goes up). The Socratic
// follow-up keeps them thinking — answers teach, never just tell.

import { useRef, useState } from 'react';

const V = (name) => `var(${name})`;

export function AskTutor({ lessonId, sceneId, sceneTitle, setHold }) {
  const [question, setQuestion] = useState('');
  const [thread, setThread] = useState([]); // {q, answer, grounding, followUp}
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function ask() {
    const q = question.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/lessons/${lessonId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, sceneId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The tutor could not answer');
      setThread((prev) => [...prev, { q, at: sceneTitle, ...data }]);
      setQuestion('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      marginTop: 14, background: '#FFFFFF', border: `1px solid ${V('--border')}`, borderRadius: 16,
      padding: '14px 16px', boxShadow: V('--card-shadow'),
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: thread.length ? 10 : 6 }}>
        <span style={{ fontSize: 15 }}>🙋</span>
        <span style={{ fontWeight: 750, fontSize: 13.5, color: V('--ink') }}>Ask the tutor</span>
        <span style={{ fontSize: 11.5, color: V('--ink-muted') }}>— about this scene or anything in the lesson</span>
      </div>

      {thread.map((turn, index) => (
        <div key={index} style={{ marginBottom: 10, fontSize: 13.5, lineHeight: 1.55 }}>
          <div style={{ fontWeight: 650, color: V('--ink') }}>You <span style={{ fontWeight: 400, color: V('--ink-muted'), fontSize: 11.5 }}>(at “{turn.at}”)</span>: {turn.q}</div>
          <div style={{ color: V('--ink-body'), marginTop: 3 }}>{turn.answer}</div>
          {turn.followUp && (
            <div style={{ marginTop: 5, color: '#8A6021', background: '#FEF3E2', borderRadius: 9, padding: '6px 10px', fontSize: 12.5 }}>
              🤔 {turn.followUp}
            </div>
          )}
          {turn.grounding && (
            <div style={{ marginTop: 3, fontSize: 11, color: V('--ink-muted') }}>grounding: {turn.grounding}</div>
          )}
        </div>
      ))}
      {error && <div style={{ fontSize: 12.5, color: '#a33d2e', marginBottom: 8 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={() => setHold?.(true)}
          onBlur={() => setHold?.(false)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          placeholder={busy ? 'The tutor is thinking…' : 'Type a question — playback pauses while you type'}
          disabled={busy}
          style={{
            flex: 1, border: `1px solid ${V('--border')}`, borderRadius: 10, padding: '9px 12px',
            fontSize: 13.5, fontFamily: 'inherit', background: '#FFFDFB', color: V('--ink'),
          }}
        />
        <button onClick={ask} disabled={busy || question.trim().length < 3} className="forever-btn"
          style={{ borderRadius: 10, padding: '9px 18px', fontSize: 13, fontWeight: 750, cursor: 'pointer' }}>
          {busy ? '…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
