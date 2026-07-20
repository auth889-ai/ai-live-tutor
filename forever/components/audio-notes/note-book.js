'use client';

// NOTE BOOK — a premium flippable book reader for a generated lecture note (w2's paginated
// reader, elevated for the web with a real 3D page-flip). Each section becomes a colored,
// icon'd page; the reader flips between them with a book-turn animation and a page counter.

import { useMemo, useState } from 'react';

const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const clean = (v) => String(v ?? '').trim();

const TONES = [
  { bg: '#f3ecff', color: '#6b3fa0', border: '#d9caff' }, // purple
  { bg: '#eafaf1', color: '#1f8a4d', border: '#bfebd5' }, // green
  { bg: '#fff2e0', color: '#b06a2e', border: '#ffe1a8' }, // orange
  { bg: '#eaf1ff', color: '#3a6ea5', border: '#c8daff' }, // blue
  { bg: '#ffeef0', color: '#c0522d', border: '#ffd4cf' }, // red
  { bg: '#fdeaf4', color: '#b83a7e', border: '#ffd1e8' }, // pink
];

function buildPages(note = {}) {
  const pages = [];
  pages.push({ icon: '📖', title: note.title || note.lectureTopic || 'Lecture Notes', kind: 'cover',
    subtitle: clean(note.overview), tone: 0 });
  const add = (icon, title, items, kind = 'list') => { if (arr(items).length) pages.push({ icon, title, items: arr(items), kind, tone: pages.length % TONES.length }); };
  add('🎯', 'Learning objectives', note.learningObjectives);
  add('💡', 'Key concepts', note.keyConcepts);
  add('📗', 'Definitions', note.definitions, 'defs');
  add('📝', 'Detailed notes', note.detailedNotes);
  add('🪜', 'Step by step', note.stepByStepExplanation);
  add('🔍', 'Examples', note.examples);
  add('∑', 'Formulas', note.formulas);
  if (clean(note.summary)) pages.push({ icon: '✅', title: 'Summary', kind: 'para', subtitle: clean(note.summary), tone: pages.length % TONES.length });
  add('🎓', 'Exam focus', note.examFocus);
  add('❓', 'Questions to review', note.questionsToReview);
  add('📋', 'Possible exam questions', note.possibleExamQuestions);
  return pages.length ? pages : [{ icon: '📖', title: note.title || 'Notes', kind: 'para', subtitle: 'No content.', tone: 0 }];
}

// flatten a note to plain text / markdown for read-aloud + export
function noteToMarkdown(note = {}) {
  const arrMd = (t, v) => arr(v).length ? `\n## ${t}\n` + arr(v).map((x) => `- ${typeof x === 'string' ? x : (x.term ? `**${x.term}:** ${x.definition || x.meaning || ''}` : (x.question || x.text || JSON.stringify(x)))}`).join('\n') + '\n' : '';
  return `# ${note.title || note.lectureTopic || 'Lecture Notes'}\n\n${clean(note.overview)}\n`
    + arrMd('Learning objectives', note.learningObjectives) + arrMd('Key concepts', note.keyConcepts)
    + arrMd('Definitions', note.definitions) + arrMd('Detailed notes', note.detailedNotes)
    + arrMd('Step by step', note.stepByStepExplanation) + arrMd('Examples', note.examples)
    + arrMd('Formulas', note.formulas) + (clean(note.summary) ? `\n## Summary\n${clean(note.summary)}\n` : '')
    + arrMd('Exam focus', note.examFocus) + arrMd('Questions to review', note.questionsToReview)
    + arrMd('Possible exam questions', note.possibleExamQuestions);
}

// definitions + key concepts become flashcards (front = term, back = meaning)
function buildFlashcards(note = {}) {
  const cards = [];
  for (const d of arr(note.definitions)) {
    if (typeof d === 'object' && d.term) cards.push({ front: d.term, back: d.definition || d.meaning || '' });
    else if (typeof d === 'string' && d.includes(':')) { const [f, ...b] = d.split(':'); cards.push({ front: f.trim(), back: b.join(':').trim() }); }
  }
  for (const c of arr(note.keyConcepts)) {
    if (typeof c === 'object' && c.term) cards.push({ front: c.term, back: c.definition || c.explanation || '' });
  }
  return cards;
}

export function NoteBook({ note }) {
  const pages = useMemo(() => buildPages(note), [note]);
  const cards = useMemo(() => buildFlashcards(note), [note]);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(''); // 'next' | 'prev'
  const [view, setView] = useState('book'); // book | cards
  const [speaking, setSpeaking] = useState(false);
  const page = pages[i];
  const tone = TONES[page.tone % TONES.length];

  const go = (dir) => {
    if (dir > 0 && i < pages.length - 1) { setFlip('next'); setTimeout(() => { setI((n) => n + 1); setFlip(''); }, 260); }
    if (dir < 0 && i > 0) { setFlip('prev'); setTimeout(() => { setI((n) => n - 1); setFlip(''); }, 260); }
  };

  const readAloud = () => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (speaking) { window.speechSynthesis.cancel(); setSpeaking(false); return; }
    const text = page.subtitle || (page.items || []).map((x) => typeof x === 'string' ? x : (x.term ? `${x.term}. ${x.definition || ''}` : (x.question || ''))).join('. ');
    const u = new SpeechSynthesisUtterance(`${page.title}. ${text}`);
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); setSpeaking(true);
  };

  const download = () => {
    const md = noteToMarkdown(note);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(note.title || 'lecture-notes').replace(/[^\w]+/g, '-').toLowerCase()}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const printPdf = () => {
    const md = noteToMarkdown(note).replace(/^# (.*)$/m, '<h1>$1</h1>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^- (.*)$/gm, '<li>$1</li>').replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    const w = window.open('', '_blank');
    if (w) { w.document.write(`<html><head><title>${note.title || 'Notes'}</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;line-height:1.6;color:#2b2320}h1{color:#6b3fa0}h2{color:#b06a2e;margin-top:24px}li{margin:5px 0}</style></head><body>${md}</body></html>`); w.document.close(); setTimeout(() => w.print(), 300); }
  };

  // FLASHCARD VIEW
  if (view === 'cards') {
    return <Flashcards cards={cards} onBack={() => setView('book')} />;
  }

  return (
    <div style={{ perspective: 1600 }}>
      {/* premium toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={readAloud} style={tool(speaking)}>{speaking ? '⏸ Stop' : '🔊 Read aloud'}</button>
        {cards.length > 0 && <button onClick={() => setView('cards')} style={tool()}>🃏 Flashcards ({cards.length})</button>}
        <button onClick={download} style={tool()}>⬇ Download</button>
        <button onClick={printPdf} style={tool()}>🖨 PDF</button>
      </div>

      <div style={{
        position: 'relative', borderRadius: 16, minHeight: 440, background: tone.bg,
        border: `1px solid ${tone.border}`, boxShadow: '0 10px 30px rgba(60,40,30,.12)',
        transformStyle: 'preserve-3d', transition: 'transform .26s ease',
        transform: flip === 'next' ? 'rotateY(-14deg)' : flip === 'prev' ? 'rotateY(14deg)' : 'none',
        transformOrigin: flip === 'next' ? 'left center' : 'right center',
      }}>
        {/* spine */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, background: `linear-gradient(${tone.color}, ${tone.border})`, borderRadius: '16px 0 0 16px' }} />
        <div style={{ padding: '26px 30px 60px 40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 28 }}>{page.icon}</span>
            <span style={{ fontSize: page.kind === 'cover' ? 24 : 18, fontWeight: 800, color: tone.color }}>{page.title}</span>
          </div>

          {(page.kind === 'cover' || page.kind === 'para') && page.subtitle && (
            <p style={{ fontSize: 15, lineHeight: 1.7, color: '#3a322e' }}>{page.subtitle}</p>
          )}

          {page.kind === 'defs' && (
            <div>{page.items.map((d, k) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 800, color: tone.color, fontSize: 14 }}>{typeof d === 'string' ? d : d.term}</div>
                {typeof d !== 'string' && <div style={{ fontSize: 13.5, color: '#3a322e', lineHeight: 1.6 }}>{d.definition || d.meaning || ''}</div>}
              </div>
            ))}</div>
          )}

          {page.kind === 'list' && (
            <ul style={{ margin: 0, paddingLeft: 22 }}>{page.items.map((x, k) => (
              <li key={k} style={{ fontSize: 14.5, color: '#3a322e', marginBottom: 9, lineHeight: 1.65 }}>
                {typeof x === 'string' ? x : (x.term ? <><b>{x.term}:</b> {x.definition || ''}</> : (x.question || x.text || JSON.stringify(x)))}
              </li>
            ))}</ul>
          )}
        </div>

        {/* page number */}
        <div style={{ position: 'absolute', bottom: 16, right: 24, fontSize: 12, color: tone.color, fontWeight: 700 }}>
          {i + 1} / {pages.length}
        </div>
      </div>

      {/* flip controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <button onClick={() => go(-1)} disabled={i === 0} style={navBtn(i === 0)}>← Prev</button>
        <div style={{ display: 'flex', gap: 5 }}>
          {pages.map((_, k) => (
            <span key={k} onClick={() => setI(k)} style={{ width: 8, height: 8, borderRadius: 999, cursor: 'pointer', background: k === i ? tone.color : '#d8cdc4' }} />
          ))}
        </div>
        <button onClick={() => go(1)} disabled={i === pages.length - 1} style={navBtn(i === pages.length - 1)}>Next →</button>
      </div>
    </div>
  );
}

function navBtn(disabled) {
  return { border: 'none', borderRadius: 999, background: disabled ? '#e6ddd4' : '#2b7a3f', color: disabled ? '#a99a8c' : '#fff', padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit' };
}

function tool(active) {
  return { border: `1px solid ${active ? '#c0522d' : '#eadfd8'}`, borderRadius: 999, background: active ? '#fdece8' : '#fff', color: active ? '#c0522d' : '#2b2320', padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' };
}

// FLASHCARDS — flip a card to reveal the meaning; step through the deck (spaced practice).
function Flashcards({ cards, onBack }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const c = cards[i] || { front: '', back: '' };
  const next = () => { setFlipped(false); setI((n) => (n + 1) % cards.length); };
  const prev = () => { setFlipped(false); setI((n) => (n - 1 + cards.length) % cards.length); };
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={onBack} style={tool()}>← Back to book</button>
        <span style={{ fontSize: 12.5, color: '#8a7d76', alignSelf: 'center' }}>{i + 1} / {cards.length}</span>
      </div>
      <div onClick={() => setFlipped((f) => !f)} style={{
        minHeight: 220, borderRadius: 16, display: 'grid', placeItems: 'center', textAlign: 'center', padding: 30, cursor: 'pointer',
        background: flipped ? '#eafaf1' : '#f3ecff', border: `1px solid ${flipped ? '#bfebd5' : '#d9caff'}`,
        boxShadow: '0 8px 24px rgba(60,40,30,.12)', transition: 'background .2s',
      }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: flipped ? '#1f8a4d' : '#6b3fa0', marginBottom: 10 }}>{flipped ? 'DEFINITION' : 'TERM'}</div>
          <div style={{ fontSize: flipped ? 16 : 22, fontWeight: flipped ? 500 : 800, color: '#2b2320', lineHeight: 1.5 }}>{flipped ? c.back : c.front}</div>
          <div style={{ fontSize: 11, color: '#a99a8c', marginTop: 14 }}>tap to flip</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
        <button onClick={prev} style={navBtn(false)}>← Prev</button>
        <button onClick={next} style={navBtn(false)}>Next →</button>
      </div>
    </div>
  );
}
