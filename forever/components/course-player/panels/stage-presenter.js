'use client';

// Single-focus stage — the "video feeling" (playbook: Khan/Ng/Striver/3B1B). At each clock
// moment it shows only the object the tutor is narrating RIGHT NOW (board note / code /
// diagram / trace), full-frame, and crossfades when focus moves — like a video cutting
// between shots. The scene title persists for orientation; the voice carries the detail
// (minimal on-screen text); the subtitle tracks the narration.

import { useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { boardStateAt } from '../../../lib/playback/engine/action-engine.js';
import { CodePanel } from './code-panel.js';
import { DiagramPanel } from './diagram-panel.js';
import { MathView } from './math-view.js';
import { ImageView } from './image-view.js';
import { CalloutView } from './callout-view.js';

export function StagePresenter({ scene, tMs, title }) {
  const state = useMemo(() => boardStateAt(scene.timeline, tMs), [scene, tMs]);
  const lastFocus = useRef(scene.objects[0]?.id);

  const activeLine = state.activeSpeech ? scene.voiceLines.find((l) => l.id === state.activeSpeech) : null;
  let focusId = activeLine?.targetObjectId;
  if (!focusId) {
    for (const o of scene.objects) if (state.writing.has(o.id) || state.codeReveal.has(o.id)) focusId = o.id;
  }
  if (focusId) lastFocus.current = focusId;
  const focusObj = scene.objects.find((o) => o.id === lastFocus.current) || scene.objects[0];
  const subtitle = activeLine?.text ?? '';

  return (
    <div style={{ background: '#fdf8f0', border: '1px solid #e8ddc9', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 20px', borderBottom: '1px solid #efe6d3', fontFamily: 'var(--font-caveat), Caveat, cursive', fontSize: 26, color: '#c0392b', textAlign: 'center' }}>
        {title}
      </div>
      <div style={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={focusObj?.id}
            style={{ width: '100%' }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          >
            {focusObj && <Focus object={focusObj} state={state} />}
          </motion.div>
        </AnimatePresence>
      </div>
      <div style={{ minHeight: 54, padding: '12px 24px', background: '#fffdf8', borderTop: '1px solid #efe6d3', color: '#5a4a2a', fontSize: 18, textAlign: 'center', lineHeight: 1.5 }}>
        {subtitle}
      </div>
    </div>
  );
}

function Focus({ object, state }) {
  if (object.renderHint === 'code') {
    return <CodePanel codeObject={object} revealProgress={state.codeReveal.get(object.id)?.progress ?? 1} outputShown={state.outputShown.has(object.id)} />;
  }
  if (object.renderHint === 'diagram') {
    const progress = state.writing.get(object.id)?.progress ?? 1;
    return <div style={{ maxWidth: 720, margin: '0 auto' }}><DiagramPanel content={object.content} progress={progress} /></div>;
  }
  if (object.renderHint === 'math') {
    return <MathView content={object.content} />;
  }
  if (object.renderHint === 'image') {
    return <ImageView content={object.content} />;
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
  return (
    <div
      style={{
        fontFamily: 'var(--font-caveat), Caveat, cursive',
        fontSize: isTitle ? 40 : 30,
        color: isTitle ? '#c0392b' : '#3a3327',
        whiteSpace: 'pre-wrap',
        textAlign: isTitle ? 'center' : 'left',
        maxWidth: 760,
        margin: '0 auto',
        lineHeight: 1.6,
      }}
    >
      {out}
    </div>
  );
}
