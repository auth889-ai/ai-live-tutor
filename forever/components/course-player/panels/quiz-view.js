'use client';

// Interactive quiz — the lesson pauses here (parent gates playback on `answered`).
// Two kinds: MCQ (click a choice, see the worked explanation) and DESCRIPTIVE (the
// student writes a detailed answer to a concrete scenario, then gets the model answer,
// the rubric, and — when lessonId is available — real AI feedback from the lesson's own
// tutor. The "explain and solve with details" checkpoint, not a short quiz).

import { useState } from 'react';

export function QuizView({ content, onAnswered, lessonId = null, sceneId = null }) {
  if (content.kind === 'descriptive') {
    return <DescriptiveQuestion content={content} onAnswered={onAnswered} lessonId={lessonId} sceneId={sceneId} />;
  }
  return <ChoiceQuiz content={content} onAnswered={onAnswered} />;
}

function DescriptiveQuestion({ content, onAnswered, lessonId, sceneId }) {
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setRevealed(true);
    onAnswered?.(true);
    // Real AI feedback from the lesson's own tutor — graded against the rubric.
    if (lessonId && answer.trim().length >= 20) {
      setBusy(true);
      try {
        const response = await fetch(`/api/lessons/${lessonId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId,
            question: `Grade my answer like a supportive teacher. SCENARIO: ${content.scenario} QUESTION: ${content.question} RUBRIC: ${content.rubricPoints.join('; ')}. MY ANSWER: ${answer.trim()}`,
          }),
        });
        const data = await response.json();
        if (response.ok) setFeedback(data.answer);
      } catch { /* feedback is enrichment — model answer + rubric already shown */ }
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#fdf6ee', border: '2px solid #e8d5bb', fontSize: 15, lineHeight: 1.6, color: '#5a4a2a', marginBottom: 12 }}>
        <strong>📋 Scenario:</strong> {content.scenario}
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: '#3a3327', marginBottom: 12 }}>
        <span style={{ marginRight: 8 }}>✍️</span>{content.question}
      </div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        disabled={revealed}
        placeholder="Explain your answer in detail — reasoning, steps, and the values you'd use…"
        style={{ width: '100%', minHeight: 110, border: '2px solid #f0dcd5', borderRadius: 10, padding: 12, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', background: revealed ? '#faf6f2' : '#fff' }}
      />
      {!revealed && (
        <button onClick={reveal} className="forever-btn"
          style={{ marginTop: 10, borderRadius: 10, padding: '10px 22px', fontSize: 14, fontWeight: 750, cursor: 'pointer' }}>
          {answer.trim().length >= 20 ? 'Check my answer' : 'Show the model answer'}
        </button>
      )}
      {revealed && (
        <div style={{ marginTop: 14 }}>
          {busy && <div style={{ fontSize: 13.5, color: '#8a6d3b', marginBottom: 8 }}>🧑‍🏫 The tutor is reading your answer…</div>}
          {feedback && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: '#eef6fc', border: '2px solid #a9cdea', color: '#2d5f9e', fontSize: 15, lineHeight: 1.6, marginBottom: 10 }}>
              <strong>🧑‍🏫 Tutor feedback:</strong> {feedback}
            </div>
          )}
          <div style={{ padding: '12px 16px', borderRadius: 10, background: '#eafaf0', border: '2px solid #7dcf9a', color: '#1e6b3c', fontSize: 15, lineHeight: 1.65 }}>
            <strong>Model answer:</strong> {content.modelAnswer}
          </div>
          <div style={{ marginTop: 8, padding: '10px 16px', borderRadius: 10, background: '#fef8e7', border: '2px solid #e5c07b', color: '#8a6d12', fontSize: 14, lineHeight: 1.6 }}>
            <strong>A strong answer includes:</strong>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {content.rubricPoints.map((point, i) => <li key={i}>{point}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ChoiceQuiz({ content, onAnswered }) {
  const [picked, setPicked] = useState(null);
  const answered = picked !== null;

  function choose(i) {
    if (answered) return;
    setPicked(i);
    onAnswered?.(i === content.answerIndex);
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#3a3327', marginBottom: 16 }}>
        <span style={{ marginRight: 8 }}>❓</span>
        {content.question}
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {content.choices.map((choice, i) => {
          const isCorrect = i === content.answerIndex;
          const isPicked = i === picked;
          let bg = '#fff';
          let border = '#f0dcd5';
          if (answered && isCorrect) {
            bg = '#eafaf0';
            border = '#27ae60';
          } else if (answered && isPicked && !isCorrect) {
            bg = '#fdecea';
            border = '#e06c75';
          }
          return (
            <button
              key={i}
              onClick={() => choose(i)}
              disabled={answered}
              style={{ textAlign: 'left', padding: '12px 16px', borderRadius: 10, border: `2px solid ${border}`, background: bg, fontSize: 16, cursor: answered ? 'default' : 'pointer' }}
            >
              {answered && isCorrect ? '✅ ' : answered && isPicked ? '❌ ' : ''}
              {choice}
            </button>
          );
        })}
      </div>
      {answered && (
        <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 10, background: '#fef8e7', border: '2px solid #e5c07b', color: '#8a6d12', fontSize: 15, lineHeight: 1.6 }}>
          <strong>{picked === content.answerIndex ? 'Correct! ' : 'Not quite. '}</strong>
          {content.explanation}
        </div>
      )}
    </div>
  );
}
