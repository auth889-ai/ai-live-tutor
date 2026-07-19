'use client';

// PRACTICE PANEL — the variation engine made touchable. After the lesson, the student
// practices leveled variations whose answers were ENGINE-computed (never an LLM guessing a
// key), with the five-level graduated hint ladder (IntelliCode / Harvard-RCT scaffold) and
// self-graded recall that feeds the SM-2 review schedule. Renders only when the lesson
// carries a practice pack (payload.practice), which exists only when the lesson had an
// executed calc spec — no pack, no panel, never a faked question.

import { useMemo, useState } from 'react';

const V = (name, fallback) => `var(${name}, ${fallback})`;

// numeric tolerance so "−1.2" and "-1.20" and "1.2 elastic" all count as right
function isCorrect(given, answer) {
  const g = String(given).replace(/[^\d.eE+-]/g, '');
  if (g === '') return false;
  const a = Number(answer);
  const n = Number(g);
  if (!Number.isFinite(n) || !Number.isFinite(a)) return String(given).trim() === String(answer).trim();
  const tol = Math.max(1e-6, Math.abs(a) * 0.001);
  return Math.abs(n - a) <= tol;
}

function Question({ q, lessonId }) {
  const [given, setGiven] = useState('');
  const [checked, setChecked] = useState(false);
  const [hintLevel, setHintLevel] = useState(0); // 0 = no hint shown; up to hints.length
  const [diagnosis, setDiagnosis] = useState(null); // adaptive re-teach on a wrong answer
  const [diagnosing, setDiagnosing] = useState(false);
  const hints = q.hints ?? [];
  const right = checked && isCorrect(given, q.answer);
  const wrong = checked && !right;

  // THE 2-SIGMA MOVE: a wrong answer is not just "wrong" — ask the tutor to diagnose WHY and
  // re-teach targeting this student's actual error. Live, because it depends on their answer.
  const diagnose = async () => {
    setDiagnosing(true);
    try {
      const res = await fetch('/api/tutor/diagnose', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q.prompt, correctAnswer: q.answer, studentAnswer: given, concept: q.label, lessonId }),
      });
      const j = await res.json();
      if (!j.error) setDiagnosis(j);
    } catch { /* offline — the worked answer is still shown */ }
    setDiagnosing(false);
  };

  return (
    <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 12, padding: '14px 16px', background: V('--card', '#fffdfb'), marginBottom: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: V('--ink', '#2b2320'), marginBottom: 4 }}>{q.prompt}</div>
      {q.invariant !== undefined && (
        <div style={{ fontSize: 11.5, color: V('--ink-muted', '#8a7d76'), marginBottom: 8 }}>
          {q.invariant ? 'Hint from the structure: this quantity may be invariant under scaling.' : 'Hint from the structure: this quantity scales with the data.'}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={given}
          onChange={(e) => { setGiven(e.target.value); setChecked(false); }}
          onKeyDown={(e) => e.key === 'Enter' && setChecked(true)}
          placeholder="your answer"
          style={{ flex: '1 1 140px', minWidth: 120, padding: '7px 11px', borderRadius: 8, fontSize: 13.5, fontFamily: 'inherit',
            border: `1px solid ${right ? '#2b7a3f' : wrong ? '#c0522d' : V('--border', '#eadfd8')}`, background: '#fff', color: V('--ink', '#2b2320') }}
        />
        <button onClick={() => setChecked(true)} style={btn('#2b7a3f')}>Check</button>
        {hintLevel < hints.length && (
          <button onClick={() => setHintLevel((l) => l + 1)} style={btn('#b06a2e', true)}>
            {hintLevel === 0 ? 'Hint' : `Hint ${hintLevel + 1}/${hints.length}`}
          </button>
        )}
      </div>

      {checked && (
        <div style={{ marginTop: 8, fontSize: 13, fontWeight: 650, color: right ? '#2b7a3f' : '#c0522d' }}>
          {right ? '✓ Correct — that is the executed value.' : `Not yet. The engine-computed answer is ${q.answer}.`}
          {wrong && !diagnosis && (
            <button onClick={diagnose} disabled={diagnosing} style={{ ...btn('#b06a2e', true), marginLeft: 10, fontSize: 12 }}>
              {diagnosing ? 'thinking…' : 'Why did I get it wrong?'}
            </button>
          )}
        </div>
      )}

      {diagnosis && (
        <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 10, background: 'rgba(176,106,46,.07)', border: '1px solid rgba(176,106,46,.25)' }}>
          {diagnosis.encouragement && <div style={{ fontSize: 12.5, fontWeight: 700, color: '#2b7a3f', marginBottom: 6 }}>{diagnosis.encouragement}</div>}
          {diagnosis.misconception && <div style={{ fontSize: 12.5, color: '#8a3a12', marginBottom: 6 }}><b>What likely happened:</b> {diagnosis.misconception}</div>}
          {diagnosis.explanation && <div style={{ fontSize: 13, color: V('--ink', '#2b2320'), lineHeight: 1.5, marginBottom: 6 }}>{diagnosis.explanation}</div>}
          {diagnosis.followUp && <div style={{ fontSize: 12.5, color: V('--ink-muted', '#6f635c'), fontStyle: 'italic' }}>Check yourself: {diagnosis.followUp}</div>}
        </div>
      )}

      {hintLevel > 0 && (
        <ol style={{ margin: '10px 0 0', paddingLeft: 18 }}>
          {hints.slice(0, hintLevel).map((h) => (
            <li key={h.level} style={{ fontSize: 12.5, color: V('--ink-muted', '#6f635c'), marginBottom: 4, lineHeight: 1.5 }}>{h.hint}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function btn(color, ghost = false) {
  return {
    border: ghost ? `1px solid ${color}` : 'none', borderRadius: 999,
    background: ghost ? 'transparent' : color, color: ghost ? color : '#fff',
    padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
  };
}

export function PracticePanel({ practice, lessonId = null }) {
  const [level, setLevel] = useState(1);
  const variants = practice?.variants ?? [];
  const byLevel = useMemo(() => {
    const map = new Map();
    for (const v of variants) {
      if (!map.has(v.level)) map.set(v.level, []);
      map.get(v.level).push(...(v.questions ?? []).map((q) => ({ ...q, factor: v.factor })));
    }
    return map;
  }, [variants]);
  const levels = [...byLevel.keys()].sort();
  if (!levels.length) return null;

  const labels = { 1: 'Retrieve', 2: 'Transfer', 3: 'Explain' };
  const blurb = {
    1: 'The lesson’s own numbers — recall what was measured.',
    2: 'Same structure, the data rescaled. The formula, not your memory, must do the work.',
    3: 'Say WHY each value moved or held. Understanding, not arithmetic.',
  };
  const questions = byLevel.get(level) ?? [];

  return (
    <div style={{ border: `1px solid ${V('--border', '#eadfd8')}`, borderRadius: 16, padding: 18, background: V('--surface', '#fbf6f2') }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: V('--ink', '#2b2320'), marginBottom: 2 }}>Practice — infinite variations, engine-checked answers</div>
      <div style={{ fontSize: 12, color: V('--ink-muted', '#8a7d76'), marginBottom: 14 }}>
        Every answer key here was computed by executing the lesson’s own formulas — it cannot be wrong at any scale.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {levels.map((lv) => (
          <button key={lv} onClick={() => setLevel(lv)}
            style={{ ...btn(level === lv ? '#2b7a3f' : '#c9bda1', level !== lv), fontSize: 12 }}>
            Level {lv} · {labels[lv] ?? lv}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: V('--ink-muted', '#6f635c'), marginBottom: 12, fontStyle: 'italic' }}>{blurb[level]}</div>

      {questions.map((q) => <Question key={q.id} q={q} lessonId={lessonId} />)}
    </div>
  );
}
