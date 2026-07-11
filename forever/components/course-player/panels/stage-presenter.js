'use client';

// Single-focus stage — the "video feeling" (playbook: Khan/Ng/Striver/3B1B). At each clock
// moment it shows only the object the tutor is narrating RIGHT NOW (board note / code /
// diagram / trace), full-frame, and crossfades when focus moves — like a video cutting
// between shots. The scene title persists for orientation; the voice carries the detail
// (minimal on-screen text); the subtitle tracks the narration.

import { useMemo, useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { boardStateAt } from '../../../lib/playback/engine/action-engine.js';
import { CodePanel } from './code-panel.js';
import { DiagramPanel } from './diagram-panel.js';
import { MathView } from './math-view.js';
import { ImageView } from './image-view.js';
import { CalloutView } from './callout-view.js';
import { QuizView } from './quiz-view.js';
import { TryItPanel } from './try-it-panel.js';
import { AlgorithmStage } from '../algorithm-stage/algorithm-stage.js';

export function StagePresenter({ scene, tMs, title, setHold }) {
  const state = useMemo(() => boardStateAt(scene.timeline, tMs), [scene, tMs]);
  const lastFocus = useRef(scene.objects[0]?.id);
  const [answered, setAnswered] = useState(() => new Set());

  const activeLine = state.activeSpeech ? scene.voiceLines.find((l) => l.id === state.activeSpeech) : null;
  let focusId = activeLine?.targetObjectId;
  if (!focusId) {
    for (const o of scene.objects) if (state.writing.has(o.id) || state.codeReveal.has(o.id)) focusId = o.id;
  }
  if (focusId) lastFocus.current = focusId;
  const focusObj = scene.objects.find((o) => o.id === lastFocus.current) || scene.objects[0];
  const subtitle = activeLine?.text ?? '';

  // Voice-synced trace step. Best: the active line's EXPLICIT traceStep (the Voice Writer wrote
  // one line per step, so the words are guaranteed to match the marked node). Fallback: the Nth
  // line targeting the diagram drives the Nth step. Either way the marking tracks the narration,
  // not a fuzzy write-reveal.
  const diagramLines = focusObj ? scene.voiceLines.filter((l) => l.targetObjectId === focusObj.id) : [];
  const orderIndex = state.activeSpeech ? diagramLines.findIndex((l) => l.id === state.activeSpeech) : -1;
  const activeStep = Number.isInteger(activeLine?.traceStep) && activeLine.targetObjectId === focusObj?.id
    ? activeLine.traceStep
    : orderIndex >= 0
      ? orderIndex
      : null;

  // Hold playback while an unanswered quiz is on screen.
  const quizBlocking = focusObj?.renderHint === 'quiz' && !answered.has(focusObj.id);
  useEffect(() => {
    setHold?.(quizBlocking);
    return () => setHold?.(false);
  }, [quizBlocking, setHold]);

  return (
    <div style={{ background: 'linear-gradient(180deg, #FFFDFB 0%, #FBF2ED 100%)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        padding: '11px 20px', borderBottom: '1px solid rgba(235,214,203,.8)', textAlign: 'center',
        fontFamily: 'var(--font-fraunces), Georgia, serif', fontWeight: 620, fontSize: 19,
        color: 'var(--ink, #2A1713)', letterSpacing: '-0.02em',
      }}>
        {title}
      </div>
      <div style={{ minHeight: 340, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={focusObj?.id}
            style={{ width: '100%' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {focusObj && (
              <Focus
                object={focusObj}
                state={state}
                focusRef={activeLine?.targetObjectId === focusObj.id ? activeLine?.focusRef : undefined}
                activeStep={activeStep}
                setHold={setHold}
                onQuizAnswered={() => setAnswered((prev) => new Set(prev).add(focusObj.id))}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div style={{ minHeight: 54, padding: '13px 26px', background: 'rgba(255,252,250,.92)', borderTop: '1px solid rgba(235,214,203,.8)', color: 'var(--ink-body, #45302A)', fontSize: 16.5, textAlign: 'center', lineHeight: 1.55 }}>
        {/* Karaoke sync: when TTS word timings exist, the word being SPOKEN right now lights
            up (Mayer's temporal contiguity — eye and ear on the same thing). Spec §D4: spoken
            word on a blush pill in deep coral; past words settle to ink — no hard flicker. */}
        {activeLine?.words?.length ? (
          activeLine.words.map((w, i) => (
            <span key={i} style={tMs >= w.startMs && tMs < w.endMs
              ? { background: '#FDE1DB', borderRadius: 5, padding: '1px 3px', color: 'var(--coral-deep, #BC3F34)', fontWeight: 650 }
              : tMs >= w.endMs ? { color: 'var(--ink, #2A1713)' } : { color: 'var(--ink-muted, #84685E)' }}>
              {w.word}{' '}
            </span>
          ))
        ) : subtitle}
      </div>
      {/* Student practice: the scene's code seeds an editable sandbox run (Koedinger: doing
          beats watching). Shown for code demos and algorithm trace scenes. */}
      {(focusObj?.renderHint === 'code' || focusObj?.renderHint === 'algorithm') && (
        <TryItPanel
          key={focusObj.id}
          seedCode={focusObj.renderHint === 'algorithm' ? focusObj.content?.code ?? '' : String(focusObj.content ?? '')}
          language={focusObj.renderHint === 'algorithm' ? focusObj.content?.language ?? 'python' : 'python'}
        />
      )}
    </div>
  );
}

function Focus({ object, state, focusRef, activeStep, setHold, onQuizAnswered }) {
  if (object.renderHint === 'quiz') {
    return <QuizView content={object.content} onAnswered={onQuizAnswered} />;
  }
  if (object.renderHint === 'code') {
    // focusRef = the line number the tutor is currently discussing (highlight it).
    const activeLine = focusRef != null ? Number(focusRef) : null;
    return <CodePanel codeObject={object} revealProgress={state.codeReveal.get(object.id)?.progress ?? 1} outputShown={state.outputShown.has(object.id)} activeLine={activeLine} />;
  }
  if (object.renderHint === 'diagram') {
    const progress = state.writing.get(object.id)?.progress ?? 1;
    return <div style={{ maxWidth: 720, margin: '0 auto' }}><DiagramPanel content={object.content} progress={progress} activeNode={focusRef != null ? String(focusRef) : null} activeStep={activeStep} /></div>;
  }
  if (object.renderHint === 'algorithm') {
    // The elite DSA/ML dry run: one ExecutionTrace, all panels synced. The active voice line's
    // traceStep drives the step (voice-synced); write-progress is the fallback before audio
    // timing. setHold lets the student EXPLORE steps while playback waits.
    return <AlgorithmStage trace={object.content} stepIndex={activeStep} progress={state.writing.get(object.id)?.progress ?? 1} setHold={setHold} />;
  }
  if (object.renderHint === 'math') {
    return <MathView content={object.content} />;
  }
  if (object.renderHint === 'image') {
    return <ImageView content={object.content} progress={state.writing.get(object.id)?.progress ?? 1} />;
  }
  if (object.renderHint === 'callout') {
    return <CalloutView content={object.content} />;
  }
  return <Handwritten object={object} progress={state.writing.get(object.id)?.progress ?? 1} />;
}

// Handwritten note revealed word-by-word at the pace of the narration.
function Handwritten({ object, progress }) {
  const text = object.renderHint === 'list' ? object.content.items.map((i) => `•  ${i}`).join('\n') : String(object.content);
  const words = text.split(/(\s+)/);
  const wordCount = words.filter((w) => w.trim()).length;
  const visible = Math.max(1, Math.floor(progress * wordCount + 1e-9));
  let shown = 0;
  const out = words.map((w) => {
    if (!w.trim()) return w;
    shown += 1;
    return shown <= visible ? w : '';
  }).join('');

  const isTitle = object.objectType?.includes('title');
  if (isTitle) {
    // Editorial title card (spec law 4: serif/sans tension, script never carries a headline):
    // Fraunces display in espresso with a thin amber rule — the MasterClass chapter card.
    return (
      <div style={{ textAlign: 'center', maxWidth: 820, margin: '0 auto' }}>
        <div style={{
          fontFamily: 'var(--font-fraunces), Georgia, serif', fontWeight: 600, fontSize: 46,
          color: 'var(--ink, #2A1713)', letterSpacing: '-0.03em', lineHeight: 1.12, textWrap: 'balance',
        }}>
          {out}
        </div>
        <div style={{ width: 46, height: 2, background: 'var(--amber, #B87F24)', opacity: 0.8, borderRadius: 1, margin: '22px auto 0' }} />
      </div>
    );
  }
  // Handwritten notes keep the board's handwriting identity — but on a crafted mat, never
  // floating in a void: bright card, warm border, the layered shadow recipe.
  return (
    <div style={{
      fontFamily: 'var(--font-caveat), Caveat, cursive',
      fontSize: 28,
      color: 'var(--ink-body, #45302A)',
      whiteSpace: 'pre-wrap',
      textAlign: 'left',
      maxWidth: 720,
      margin: '0 auto',
      lineHeight: 1.55,
      background: 'var(--surface, #FFFDFB)',
      border: '1px solid var(--border, #EBD6CB)',
      borderRadius: 16,
      padding: '24px 30px',
      boxShadow: 'var(--card-shadow, 0 2px 8px rgba(190,120,100,.12))',
    }}>
      {out}
    </div>
  );
}
