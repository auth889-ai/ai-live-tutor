'use client';

// Interactive quiz — the lesson pauses here (parent gates playback on `answered`). The
// student clicks a choice, sees correct/incorrect, and a worked explanation. Then continues.

import { useState } from 'react';

export function QuizView({ content, onAnswered }) {
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
