'use client';

// Interactive quiz — the lesson pauses here (parent gates playback on `answered`).
// Two kinds: MCQ (click a choice, see the worked explanation) and DESCRIPTIVE (the
// student writes a detailed answer to a concrete scenario, then gets the model answer,
// the rubric, and — when lessonId is available — real AI feedback from the lesson's own
// tutor. The "explain and solve with details" checkpoint, not a short quiz).

import { useState } from 'react';

// Checkpoint telemetry (the learned-vs-watched unlock): every quiz answer is recorded —
// correct answers verify concepts on the Progress page; misses mark reinforcement needs.
function recordCheckpoint(lessonId, quizId, correct) {
  const lid = lessonId || (typeof window !== 'undefined' ? window.location.pathname.split('/course/')[1]?.split('?')[0] : null);
  if (!lid) return;
  fetch('/api/study', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'checkpoint', lessonId: lid, quizId, correct: Boolean(correct) }),
  }).catch(() => {});
}

export function QuizView({ content, onAnswered, lessonId = null, sceneId = null }) {
  if (content.kind === 'descriptive') {
    return <DescriptiveQuestion content={content} onAnswered={onAnswered} lessonId={lessonId} sceneId={sceneId} />;
  }
  if (content.kind === 'teach_back') {
    return <TeachBack content={content} onAnswered={onAnswered} lessonId={lessonId} sceneId={sceneId} />;
  }
  return <ChoiceQuiz content={content} onAnswered={onAnswered} />;
}

// TEACH-BACK — the Feynman checkpoint: the student teaches the concept to a named audience in
// their own words; the tutor grades per named dimension; the rewritten model explanation lands
// last so the student compares TEACHER-to-TEACHER, not answer-to-answer. Understanding is
// proven by teaching (the spec's "learning by teaching", made a concrete checkpoint kind).
function TeachBack({ content, onAnswered, lessonId, sceneId }) {
  const [explanation, setExplanation] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  async function grade() {
    setRevealed(true);
    onAnswered?.(true);
    if (lessonId && explanation.trim().length >= 30) {
      setBusy(true);
      try {
        const response = await fetch(`/api/lessons/${lessonId}/ask`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sceneId,
            question: `Grade my TEACHING of this concept, dimension by dimension, like a supportive mentor watching me teach. I was asked to explain "${content.question}" to ${content.audience}. GRADE EACH DIMENSION by name (met / partly / missed, one sentence each): ${content.dimensions.join('; ')}. Then say the ONE thing that would most improve my explanation. MY EXPLANATION: ${explanation.trim()}`,
          }),
        });
        const data = await response.json();
        if (response.ok) setFeedback(data.answer);
      } catch { /* enrichment only — the model explanation below always shows */ }
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#f4eefb', border: '2px solid #b490cf', fontSize: 15, lineHeight: 1.6, color: '#5b2d78', marginBottom: 12 }}>
        <strong>🧑‍🏫 Your turn to TEACH:</strong> Explain this to <strong>{content.audience}</strong> — in your own words, no jargon they wouldn't know.
      </div>
      <div style={{ fontSize: 19, fontWeight: 700, color: '#3a3327', marginBottom: 10 }}>{content.question}</div>
      <div style={{ fontSize: 13, color: '#8a6d3b', marginBottom: 8 }}>
        A strong explanation: {content.dimensions.join(' · ')}
      </div>
      <textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        disabled={revealed}
        placeholder={`Teach it the way you'd say it out loud to ${content.audience}…`}
        style={{ width: '100%', minHeight: 120, border: '2px solid #e6d8f0', borderRadius: 10, padding: 12, fontSize: 15, fontFamily: 'inherit', boxSizing: 'border-box', background: revealed ? '#faf7fc' : '#fff' }}
      />
      {!revealed && (
        <button onClick={grade} className="forever-btn"
          style={{ marginTop: 10, borderRadius: 10, padding: '10px 22px', fontSize: 14, fontWeight: 750, cursor: 'pointer' }}>
          {explanation.trim().length >= 30 ? 'Grade my teaching' : 'Show the model explanation'}
        </button>
      )}
      {revealed && (
        <div style={{ marginTop: 14 }}>
          {busy && <div style={{ fontSize: 13.5, color: '#8a6d3b', marginBottom: 8 }}>🧑‍🏫 The tutor is watching your lesson…</div>}
          {feedback && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: '#eef6fc', border: '2px solid #a9cdea', color: '#2d5f9e', fontSize: 15, lineHeight: 1.6, marginBottom: 10, whiteSpace: 'pre-wrap' }}>
              <strong>🧑‍🏫 Dimension-by-dimension:</strong> {feedback}
            </div>
          )}
          <div style={{ padding: '12px 16px', borderRadius: 10, background: '#eafaf0', border: '2px solid #7dcf9a', color: '#1e6b3c', fontSize: 15, lineHeight: 1.65 }}>
            <strong>How a teacher might say it:</strong> {content.modelExplanation}
          </div>
        </div>
      )}
    </div>
  );
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
    const correct = i === content.answerIndex;
    recordCheckpoint(null, content.question?.slice(0, 40), correct);
    onAnswered?.(correct);
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
