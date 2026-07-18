'use client';

// 📓 Notebooks — the Sankofa input-first pattern: a notebook is YOUR object. You feed it any
// input — typed notes, pasted text, links (auto-extracted), PDFs/images, your voice — as typed
// blocks with provenance badges, then one button turns the whole notebook into a course through
// the same pipeline the studio uses. Library grid ↔ workspace, one component file.
// Design contract: notes/research/notebook-sankofa-plan-18jul.md (from the full eva/ dissection).

import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const T = {
  card: { border: '1px solid #f2e3d5', borderRadius: 16, background: '#fff', boxShadow: '0 1px 4px rgba(58,46,34,0.05)' },
  cap: { fontSize: 11.5, color: '#9b8465' },
  accent: '#e8604c',
};
const TYPE_META = {
  note: ['📝', 'note'], text: ['📋', 'pasted'], link: ['🔗', 'link'],
  pdf: ['📄', 'PDF'], image: ['🖼', 'image'], voice: ['🎙', 'voice'],
};
const TRUST_COLOR = { user: '#2f7d4a', extracted: '#4477aa', ai: '#c98f2d' };
const TYPE_COLOR = { note: '#2f7d4a', text: '#6b563d', link: '#4477aa', pdf: '#c0522d', image: '#8e44ad', voice: '#c98f2d' };

export function NotebooksContent() {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const load = () => fetch('/api/notebooks').then((r) => r.json()).then((d) => setList(d.notebooks ?? [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);

  if (list === null) return <div style={{ ...T.card, padding: 40, textAlign: 'center', color: '#9b8465' }}>Opening your notebooks…</div>;
  const navigateByTitle = (title) => {
    const hit = (list ?? []).find((n) => String(n.title).trim().toLowerCase() === String(title).trim().toLowerCase());
    if (hit) setOpenId(hit.id);
    else load().then(() => {
      // auto-created by a link rebuild moments ago — refetch then open
      fetch('/api/notebooks').then((r) => r.json()).then((d) => {
        const again = (d.notebooks ?? []).find((n) => String(n.title).trim().toLowerCase() === String(title).trim().toLowerCase());
        if (again) { setList(d.notebooks); setOpenId(again.id); }
      });
    });
  };
  if (creating) return <CreateWizard onDone={async (id) => { setCreating(false); await load(); if (id) setOpenId(id); }} />;
  if (openId) return <Workspace id={openId} onBack={() => { setOpenId(null); load(); }} onNavigate={(idOrTitle) => { if (String(idOrTitle).startsWith('nbk_')) setOpenId(idOrTitle); else navigateByTitle(idOrTitle); }} />;

  return (
    <div style={{ maxWidth: 1080 }}>
      <div style={{ position: 'relative', borderRadius: 20, overflow: 'hidden', minHeight: 150, display: 'flex', alignItems: 'flex-end', boxShadow: '0 6px 22px rgba(58,46,34,0.12)' }}>
        <img src="/images/notebook-cover.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(43,33,26,0.04) 30%, rgba(43,33,26,0.62))' }} />
        <div style={{ position: 'relative', width: '100%', padding: '18px 22px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 26, color: '#fff', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0, textShadow: '0 1px 6px rgba(0,0,0,0.35)' }}>Notebooks</h1>
            <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.92)', margin: '3px 0 0' }}>Collect anything — and your notebook writes back: grounded notes, summaries, self-tests.</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowGraph((v) => !v)} style={{ border: '1.5px solid rgba(255,255,255,0.75)', borderRadius: 999, background: showGraph ? '#fff' : 'rgba(255,255,255,0.15)', color: showGraph ? '#8a3a12' : '#fff', padding: '9px 16px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>🕸 Graph</button>
            <button onClick={() => setCreating(true)} style={{ border: 'none', borderRadius: 999, background: T.accent, color: '#fff', padding: '9px 20px', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 14px rgba(232,96,76,0.45)' }}>+ New notebook</button>
          </div>
        </div>
      </div>
      {showGraph ? <KnowledgeGraphPanel onOpen={(id) => { setShowGraph(false); setOpenId(id); }} /> : null}
      {list.length === 0 ? (
        <div style={{ ...T.card, marginTop: 18, padding: '46px 20px', textAlign: 'center', color: '#9b8465' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>📓</div>
          <div style={{ fontWeight: 700, color: '#2b211a' }}>Start your first notebook</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>type notes, paste articles, drop links, even talk — then let the notebook synthesize what you collected</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginTop: 18 }}>
          {list.map((n) => (
            <button key={n.id} onClick={() => setOpenId(n.id)} className="pcard"
              style={{ ...T.card, borderRadius: 18, padding: 0, textAlign: 'left', cursor: 'pointer', overflow: 'hidden' }}>
              <div style={{ position: 'relative', height: 64 }}>
                <img src="/images/notebook-cover.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${(n.id.charCodeAt(4) * 7) % 100}% ${(n.id.charCodeAt(5) * 7) % 100}%` }} />
                <span style={{ position: 'absolute', left: 12, bottom: -14, width: 34, height: 34, borderRadius: 10, background: '#fff', border: '1px solid #f2e3d5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, boxShadow: '0 2px 8px rgba(58,46,34,0.15)' }}>📓</span>
              </div>
              <div style={{ padding: '20px 16px 14px' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#2b211a', lineHeight: 1.3 }}>{n.title}</div>
              <div style={{ ...T.cap, marginTop: 6 }}>{n.blockCount} block{n.blockCount === 1 ? '' : 's'} · {new Date(n.updatedAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</div>

              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The eva IntakeFlow, ported: one question per screen, progress bar, Enter to advance, back
// restores, optional steps skippable — and the outcome-driven law (research: ~60s to value):
// by step 3 the user has a notebook WITH their first captured thought in it.
const WIZARD_STEPS = [
  { key: 'title', q: 'What topic is this notebook for?', hint: 'e.g. "Graph algorithms", "System design prep", "Organic chemistry unit 3"', required: true, max: 120 },
  { key: 'intent', q: 'What do you want to get out of it?', hint: 'e.g. "pass the interview", "finally understand DP" — the synthesizer aims at this', required: false, max: 500 },
  { key: 'known', q: 'What do you already know about it?', hint: 'fragments are fine — they become your first note', required: false, max: 2000 },
  { key: 'explore', q: 'What confuses you, or what do you most want to explore?', hint: 'the synthesizer leans into exactly this', required: false, max: 500 },
  { key: 'level', q: 'How would you describe your level?', hint: 'e.g. "beginner", "solved 100 LeetCode", "revising before finals"', required: false, max: 120 },
  { key: 'first', q: 'Drop your first material', hint: 'write a note, paste anything, or drop a link — your notebook starts alive', required: false, max: 20000 },
];

function CreateWizard({ onDone }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({});
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const cur = WIZARD_STEPS[step];

  const next = async () => {
    const v = value.trim();
    if (cur.required && !v) { setErr('this one is required — it names your notebook'); return; }
    if (v.length > cur.max) { setErr(`keep it under ${cur.max} characters`); return; }
    setErr('');
    const nextAnswers = { ...answers, [cur.key]: v };
    setAnswers(nextAnswers);
    if (step < WIZARD_STEPS.length - 1) {
      setStep(step + 1);
      setValue(nextAnswers[WIZARD_STEPS[step + 1].key] ?? '');
      return;
    }
    setBusy(true);
    try {
      const intent = [nextAnswers.intent, nextAnswers.level ? `level: ${nextAnswers.level}` : ''].filter(Boolean).join(' · ');
      const res = await fetch('/api/notebooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: nextAnswers.title, intent }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'could not create the notebook');
      // Every wizard seed becomes a REAL block with visible provenance — the Sankofa seeds
      // live inside the notebook, not in a hidden field.
      const seeds = [
        nextAnswers.known?.trim() ? { type: 'note', content: nextAnswers.known.trim(), source: 'typed', title: 'What I already know' } : null,
        nextAnswers.explore?.trim() ? { type: 'note', content: nextAnswers.explore.trim(), source: 'typed', title: 'What I want to explore' } : null,
      ].filter(Boolean);
      const first = (nextAnswers.first ?? '').trim();
      if (first) {
        const isUrl = /^https?:\/\/\S+$/i.test(first);
        seeds.push(isUrl ? { type: 'link', url: first } : { type: 'note', content: first, source: 'typed' });
      }
      for (const seed of seeds) {
        // eslint-disable-next-line no-await-in-loop -- sequential keeps seq + link rebuilds ordered
        await fetch(`/api/notebooks/${d.id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(seed) }).catch(() => {});
      }
      onDone(d.id);
    } catch (e) {
      setErr(String(e.message ?? e));
      setBusy(false);
    }
  };

  const back = () => {
    if (step === 0) { onDone(null); return; }
    setStep(step - 1);
    setValue(answers[WIZARD_STEPS[step - 1].key] ?? '');
    setErr('');
  };

  return (
    <div style={{ maxWidth: 620, margin: '40px auto 0' }}>
      <div style={{ height: 3, borderRadius: 2, background: '#f2e8dc', overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${((step + 1) / WIZARD_STEPS.length) * 100}%`, height: '100%', background: T.accent, transition: 'width .4s' }} />
      </div>
      <div style={{ ...T.cap, marginBottom: 18 }}>{step + 1} of {WIZARD_STEPS.length}</div>
      <h1 style={{ fontSize: 26, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0 }}>{cur.q}</h1>
      <div style={{ ...T.cap, margin: '8px 0 16px' }}>{cur.hint}</div>
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && cur.key !== 'first') { e.preventDefault(); next(); } }}
        rows={cur.key === 'first' ? 5 : 1}
        maxLength={cur.max}
        style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', border: '1.5px solid #f0dcd5', borderRadius: 14, padding: '13px 16px', fontSize: 15.5, lineHeight: 1.5, color: '#2b211a', background: '#fff', outline: 'none' }} />
      {err ? <div style={{ marginTop: 8, fontSize: 12.5, color: '#a33d2e', fontWeight: 700 }}>{err}</div> : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button onClick={back} disabled={busy} style={{ border: '1px solid #f2e3d5', borderRadius: 999, background: '#fff', color: '#9b8465', padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>← back</button>
        <button onClick={next} disabled={busy}
          style={{ border: 'none', borderRadius: 999, background: busy ? '#e9ddcb' : T.accent, color: '#fff', padding: '9px 24px', fontSize: 13.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'preparing your notebook…' : step === WIZARD_STEPS.length - 1 ? '✓ Create notebook' : 'Next →'}
        </button>
        {!cur.required && step < WIZARD_STEPS.length - 1 ? (
          <button onClick={() => { setValue(''); setErr(''); setAnswers({ ...answers, [cur.key]: '' }); setStep(step + 1); }} disabled={busy}
            style={{ border: 'none', background: 'transparent', color: '#b3a889', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>skip this step</button>
        ) : null}
      </div>
    </div>
  );
}

function Workspace({ id, onBack, onNavigate }) {
  const [data, setData] = useState(null);
  const [revealId, setRevealId] = useState(null);
  const [live, setLive] = useState(null); // { stage, plan, sections[], rejected[], error }
  const load = () => fetch(`/api/notebooks/${id}`).then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, [id]);

  // The Sankofa arc, live: EventSource over the real pipeline stages — reading -> planning ->
  // writing §N -> sections streaming in -> saved. Every status is a genuine stage.
  const runStream = (qs) => {
    if (live && !live.done && !live.error) return;
    setLive({ stage: 'connecting', sections: [], rejected: [] });
    const es = new EventSource(`/api/notebooks/${id}/synthesize/stream?${qs}`);
    es.addEventListener('status', (e) => { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, stage: d.stage, statusMeta: d })); });
    es.addEventListener('plan', (e) => { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, plan: d })); });
    es.addEventListener('section', (e) => { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, sections: [...(cur?.sections ?? []), d] })); });
    es.addEventListener('image', (e) => { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, images: [...(cur?.images ?? []), d] })); });
    es.addEventListener('rejected', (e) => { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, rejected: [...(cur?.rejected ?? []), d] })); });
    es.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      es.close();
      setRevealId(null);
      setLive((cur) => ({ ...cur, done: true }));
      setTimeout(() => { setLive(null); load(); }, 900);
      if (d.blockId) setRevealId(null);
    });
    es.addEventListener('error', (e) => {
      try { const d = JSON.parse(e.data); setLive((cur) => ({ ...cur, error: d.message })); } catch { setLive((cur) => ({ ...cur, error: 'stream lost' })); }
      es.close();
    });
  };
  if (!data?.notebook) return <div style={{ ...T.card, padding: 40, textAlign: 'center', color: '#9b8465' }}>Opening…</div>;
  const { notebook, blocks } = data;
  return (
    <div style={{ maxWidth: 1080 }}>
      <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: '#9b8465', fontSize: 12.5, fontWeight: 800, cursor: 'pointer', padding: 0 }}>← all notebooks</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600, margin: 0, flex: 1, minWidth: 0 }}>{notebook.title}</h1>
        <SynthesizeButton blocks={blocks} busy={Boolean(live) && !live.done && !live.error} onRun={(mode) => runStream(`mode=${mode}`)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 14, alignItems: 'start', marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {live ? <LiveSynthesis live={live} /> : null}
          <Flashback blocks={blocks} />
          {(data.backlinks ?? []).length ? (
            <div style={{ ...T.card, padding: '10px 14px', borderLeft: '3px solid #4477aa' }}>
              <div style={{ ...T.cap, fontWeight: 800, marginBottom: 6 }}>🔗 LINKED FROM</div>
              {(data.backlinks ?? []).map((bl, i) => (
                <button key={i} onClick={() => onNavigate?.(bl.notebookId)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: '#4477aa' }}>{bl.title}</span>
                  {bl.preview ? <span style={{ fontSize: 12, color: '#9b8465' }}> — “{bl.preview.slice(0, 90)}{bl.preview.length > 90 ? '…' : ''}”</span> : null}
                </button>
              ))}
            </div>
          ) : null}
          {blocks.length === 0 ? (
            <div style={{ ...T.card, padding: '30px 20px', textAlign: 'center', color: '#9b8465', fontSize: 13 }}>Empty page — add your first block →</div>
          ) : groupByDay(blocks).map(([day, dayBlocks]) => (
            <div key={day}>
              <div style={{ ...T.cap, fontWeight: 800, margin: '6px 0 8px' }}>{day}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {dayBlocks.map((b) => <Block key={b._id} nb={id} b={b} onChanged={load} reveal={b._id === revealId} onNavigate={onNavigate} />)}
              </div>
            </div>
          ))}
          <AskBox disabled={Boolean(live) && !live.done && !live.error} onAsk={(q) => runStream(`mode=ask&question=${encodeURIComponent(q)}`)} />
        </div>
        <Intake id={id} onAdded={load} />
      </div>
    </div>
  );
}

// Journal timeline: entries grouped under day headers (research: timeline views + flashbacks
// drive return visits) — newest day first, order inside a day preserved.
// Small honest markdown renderer for synthesized/extracted blocks: #/##/### headings, - bullets,
// **bold**, `code`, and [n] citations as chips pointing at your numbered blocks. No library,
// no HTML injection — everything becomes React nodes.
function looksLikeMarkdown(text) {
  return /^#{1,3} |\n- |\n#{1,3} /.test(text ?? '');
}

function inline(text, keyBase) {
  const parts = [];
  let rest = String(text ?? '');
  let k = 0;
  const CITE = /\[(\d+)\]/;
  const BOLD = /\*\*([^*]+)\*\*/;
  const CODE = /`([^`]+)`/;
  while (rest.length) {
    const m = [CITE, BOLD, CODE].map((re) => ({ re, m: rest.match(re) })).filter((x) => x.m).sort((a, b) => a.m.index - b.m.index)[0];
    if (!m) { parts.push(rest); break; }
    if (m.m.index > 0) parts.push(rest.slice(0, m.m.index));
    if (m.re === CITE) parts.push(<sup key={`${keyBase}-${k += 1}`} style={{ background: '#eef3f9', color: '#4477aa', borderRadius: 6, padding: '1px 5px', fontSize: 10, fontWeight: 800, marginLeft: 1 }}>{m.m[1]}</sup>);
    else if (m.re === BOLD) parts.push(<b key={`${keyBase}-${k += 1}`}>{m.m[1]}</b>);
    else parts.push(<code key={`${keyBase}-${k += 1}`} style={{ background: '#f7f0e6', borderRadius: 5, padding: '1px 5px', fontSize: 12, fontFamily: 'ui-monospace, monospace' }}>{m.m[1]}</code>);
    rest = rest.slice(m.m.index + m.m[0].length);
  }
  return parts;
}

// [[Title]] -> clickable wiki chip (knowledge engine): click opens that notebook.
function WikiText({ text, onNavigate }) {
  const parts = [];
  let rest = String(text ?? '');
  let k = 0;
  while (rest.length) {
    const m = rest.match(/\[\[([^\]]+)\]\]/);
    if (!m) { parts.push(rest); break; }
    if (m.index > 0) parts.push(rest.slice(0, m.index));
    const title = m[1].trim();
    parts.push(
      <button key={k += 1} onClick={() => onNavigate?.(title)}
        style={{ border: 'none', background: '#eef3f9', color: '#4477aa', borderRadius: 7, padding: '0 6px', fontSize: 'inherit', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
        {title}
      </button>,
    );
    rest = rest.slice(m.index + m[0].length);
  }
  return <>{parts}</>;
}

function Markdownish({ text, skipTitle = null, animate = false, onNavigate = null }) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  let list = null;
  let seg = 0;
  const flush = () => { if (list) { out.push(<ul key={`ul${out.length}`} style={{ margin: '4px 0 10px', paddingLeft: 20 }}>{list}</ul>); list = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    const anim = animate ? { animation: 'nbSegIn .5s ease-out both', animationDelay: `${Math.min(seg * 350, 3500)}ms` } : {};
    if (/^#{1,3} /.test(ln)) {
      const t = ln.replace(/^#{1,3} /, '');
      if (skipTitle && t.trim() === skipTitle.trim()) continue;
      flush(); seg += 1;
      out.push(<div key={i} style={{ fontSize: ln.startsWith('###') ? 13 : 14.5, fontWeight: 800, color: '#2b211a', margin: '12px 0 4px', ...anim }}>{inline(t, i)}</div>);
    } else if (/^- /.test(ln)) {
      if (!list) seg += 1;
      (list ??= []).push(<li key={i} style={{ margin: '2px 0', ...(animate ? { animation: 'nbSegIn .5s ease-out both', animationDelay: `${Math.min(seg * 350, 3500)}ms` } : {}) }}>{inline(ln.slice(2), i)}</li>);
    } else if (ln.startsWith('— grounded in your blocks:')) {
      flush(); seg += 1;
      const refs = [...ln.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
      out.push(<div key={i} style={{ display: 'flex', gap: 5, alignItems: 'center', marginTop: 10, flexWrap: 'wrap', ...anim }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: '#9b8465' }}>GROUNDED IN YOUR BLOCKS</span>
        {refs.map((r) => <span key={r} style={{ background: '#eef3f9', color: '#4477aa', borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 800 }}>#{r}</span>)}
      </div>);
    } else if (ln.trim()) {
      flush(); seg += 1;
      out.push(<p key={i} style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap', ...anim }}>{inline(ln, i)}</p>);
    }
  }
  flush();
  return <div style={{ fontSize: 13.5, color: '#3a3327', marginTop: 6, lineHeight: 1.6, overflowWrap: 'break-word' }}>{out}</div>;
}

function groupByDay(blocks) {
  const groups = new Map();
  for (const b of blocks) {
    const day = new Date(b.createdAt).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(b);
  }
  return [...groups.entries()].reverse();
}

// Flashback (journal pattern): resurface one of YOUR older entries — deterministic per day,
// only when something is genuinely older than a day. Never canned.
function Flashback({ blocks }) {
  const old = blocks.filter((b) => Date.now() - new Date(b.createdAt).getTime() > 24 * 3600 * 1000 && b.trust !== 'ai');
  if (old.length === 0) return null;
  const seed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const b = old[seed % old.length];
  const text = (b.type === 'voice' ? (b.transcript || b.content) : b.content) ?? '';
  return (
    <div style={{ ...T.card, borderStyle: 'dashed', padding: '10px 14px', background: '#fdf6f0' }}>
      <span style={{ ...T.cap, fontWeight: 800 }}>🕰 FROM YOUR NOTES · {new Date(b.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
      <div style={{ fontSize: 12.5, color: '#6b563d', marginTop: 4, fontStyle: 'italic' }}>“{text.slice(0, 180)}{text.length > 180 ? '…' : ''}”</div>
    </div>
  );
}

function Block({ nb, b, onChanged, reveal = false, onNavigate }) {
  const [icon, label] = TYPE_META[b.type] ?? ['•', b.type];
  const [audio, setAudio] = useState(b.audioUrl ?? null);
  const [voicing, setVoicing] = useState(false);
  const narrate = async () => {
    setVoicing(true);
    try {
      const res = await fetch(`/api/notebooks/${nb}/blocks/${b._id}/narrate`, { method: 'POST' });
      const d = await res.json();
      if (res.ok && d.audioUrl) setAudio(d.audioUrl);
    } finally {
      setVoicing(false);
    }
  };
  const remove = async () => {
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'DELETE' });
    onChanged();
  };
  const isAi = b.trust === 'ai';
  return (
    <div style={{ ...T.card, padding: '12px 16px', borderLeft: `3px solid ${isAi ? '#f0c39a' : TYPE_COLOR[b.type] ?? '#f2e3d5'}`, ...(isAi ? { background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', borderColor: '#f0c39a', borderLeftColor: '#e8a03c' } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{isAi ? '✨' : icon}</span>
        <span style={{ ...T.cap, fontWeight: 800 }}>{label.toUpperCase()}</span>
        <span title={`provenance: ${b.trust}`} style={{ fontSize: 10.5, fontWeight: 800, color: TRUST_COLOR[b.trust] ?? '#9b8465', background: `${TRUST_COLOR[b.trust] ?? '#9b8465'}14`, borderRadius: 999, padding: '2px 8px' }}>{b.trust}</span>
        {b.origin ? <span style={T.cap}>{b.origin}</span> : null}
        {!audio && ['note', 'text', 'voice'].includes(b.type) && (b.content ?? '').length > 60 ? (
          <button onClick={narrate} disabled={voicing} title="read this block aloud (Qwen3-TTS)"
            style={{ marginLeft: 'auto', border: '1px solid #f2e3d5', borderRadius: 999, background: '#fff', color: voicing ? '#c9bda1' : '#6b563d', padding: '2px 10px', fontSize: 11, fontWeight: 800, cursor: voicing ? 'default' : 'pointer' }}>
            {voicing ? 'voicing…' : '🔊 read to me'}
          </button>
        ) : null}
        <button onClick={remove} title="remove block" style={{ marginLeft: audio || !['note', 'text', 'voice'].includes(b.type) || (b.content ?? '').length <= 60 ? 'auto' : 6, border: 'none', background: 'transparent', color: '#c9bda1', cursor: 'pointer', fontSize: 13 }}>✕</button>
      </div>
      {b.title ? <div style={{ fontSize: 14, fontWeight: 800, color: '#2b211a', marginTop: 6 }}>{b.title}</div> : null}
      {(() => {
        const raw = b.type === 'voice' ? (b.transcript || b.content) : b.type === 'link' ? `${(b.content ?? '').slice(0, 400)}${(b.content ?? '').length > 400 ? '…' : ''}` : (b.content ?? '');
        // never repeat the title as the first content line (image captions, synthesized notes)
        const cleanTitle = (b.title ?? '').replace(/^✨\s*/, '').trim();
        const deduped = cleanTitle && raw.split('\n')[0].trim().replace(/[.:]$/, '') === cleanTitle.replace(/[.:]$/, '')
          ? raw.split('\n').slice(1).join('\n').replace(/^\n+/, '') : raw;
        return (
          <>
            {reveal ? <style>{`@keyframes nbSegIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style> : null}
            {looksLikeMarkdown(deduped)
              ? <Markdownish text={deduped} skipTitle={cleanTitle} animate={reveal} onNavigate={onNavigate} />
              : <div style={{ fontSize: 13.5, color: '#3a3327', marginTop: 6, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}><WikiText text={deduped} onNavigate={onNavigate} /></div>}
          </>
        );
      })()}
      {b.type === 'image' && b.url ? <img src={b.url} alt={b.title ?? ''} style={{ width: '100%', borderRadius: 12, marginTop: 8 }} /> : b.url ? <a href={b.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#4477aa', fontWeight: 700 }}>{b.url}</a> : null}
      {audio ? <audio controls src={audio} style={{ width: '100%', height: 32, marginTop: 8 }} /> : null}
    </div>
  );
}

// The knowledge graph (blueprint 1.5): one node per notebook, one edge per real [[link]].
// Circle layout — deterministic, no physics; click a node to open its notebook.
function KnowledgeGraphPanel({ onOpen }) {
  const [graph, setGraph] = useState(null);
  useEffect(() => { fetch('/api/notebooks/graph').then((r) => r.json()).then(setGraph).catch(() => setGraph({ nodes: [], edges: [] })); }, []);
  const flow = useMemo(() => {
    const n = graph?.nodes ?? [];
    const R = Math.max(160, n.length * 34);
    return {
      nodes: n.map((node, i) => ({
        id: node.id,
        position: { x: Math.round(R * Math.cos((2 * Math.PI * i) / Math.max(1, n.length))), y: Math.round(R * Math.sin((2 * Math.PI * i) / Math.max(1, n.length))) },
        data: { label: `${node.label} (${node.blockCount})` },
        style: { border: '2px solid #e8604c', borderRadius: 12, background: '#fff', fontSize: 12, fontWeight: 700, color: '#2b211a', padding: 6 },
      })),
      edges: (graph?.edges ?? []).map((e) => ({ ...e, animated: true, style: { stroke: '#4477aa' }, labelStyle: { fontSize: 9, fill: '#9b8465' } })),
    };
  }, [graph]);
  return (
    <div style={{ ...T.card, borderRadius: 20, marginTop: 14, height: 380, overflow: 'hidden' }}>
      {graph === null ? <div style={{ padding: 30, textAlign: 'center', color: '#9b8465' }}>drawing your knowledge graph…</div> : (
        (graph.nodes ?? []).length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: '#9b8465' }}>write [[Notebook Title]] inside any note — real links draw this graph</div> : (
          <ReactFlow nodes={flow.nodes} edges={flow.edges} fitView onNodeClick={(_, node) => onOpen?.(node.id)} proOptions={{ hideAttribution: true }}>
            <Background color="#f2e3d5" />
            <Controls showInteractive={false} />
          </ReactFlow>
        )
      )}
    </div>
  );
}

// The eva IntakeFlow feel: one input surface, a type switcher, Enter adds, voice via Web Speech.
const DAILY_PROMPTS = [
  'What clicked for you today?',
  'What still feels confusing — in your own words?',
  'Explain the last thing you learned as if to a friend.',
  'What would you ask the tutor tomorrow?',
  'Which example finally made it make sense?',
  'What do you want to remember a month from now?',
];

function Intake({ id, onAdded }) {
  const [mode, setMode] = useState('note'); // note | text | link | voice
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [err, setErr] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef(null);
  const fileRef = useRef(null);
  const fileKind = useRef('pdf');
  // Journal pattern: a rotating daily prompt seeds reflection — deterministic by date.
  const daySeed = Number(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
  const prompts = [DAILY_PROMPTS[daySeed % DAILY_PROMPTS.length], DAILY_PROMPTS[(daySeed + 3) % DAILY_PROMPTS.length]];

  const pickFile = (kind) => { fileKind.current = kind; fileRef.current?.click(); };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    setBusyLabel(fileKind.current === 'pdf' ? 'extracting the PDF text (can take a minute)…' : 'the Vision agent is reading the image…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/uploads', { method: 'POST', body: fd });
      const upd = await up.json();
      if (!up.ok) throw new Error(upd.error || 'upload failed');
      const res = await fetch(`/api/notebooks/${id}/blocks`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: fileKind.current, uploadId: upd.uploadId, fileName: file.name, mediaType: file.type, source: 'upload' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'could not add the file');
      onAdded();
    } catch (e2) {
      setErr(String(e2.message ?? e2));
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  };

  const add = async (payload) => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/notebooks/${id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'could not add');
      setValue('');
      onAdded();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const v = value.trim();
    if (!v) return;
    if (mode === 'note') add({ type: 'note', content: v, source: 'typed' });
    if (mode === 'text') add({ type: 'text', content: v, source: 'pasted' });
    if (mode === 'link') add({ type: 'link', url: v });
    if (mode === 'voice') add({ type: 'voice', transcript: v, source: 'voice' });
  };

  // eva's Web Speech pattern: client-side STT into the input; the transcript becomes the block.
  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setErr('voice input needs Chrome/Edge (Web Speech API)'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => setValue([...e.results].map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    setMode('voice');
    rec.start();
  };

  const chip = (m, label) => (
    <button key={m} onClick={() => setMode(m)}
      style={{ border: mode === m ? `1.5px solid ${T.accent}` : '1.5px solid #f2e3d5', borderRadius: 999, background: mode === m ? '#fdf0ee' : '#fff', color: mode === m ? '#8a3a12' : '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
      {label}
    </button>
  );

  return (
    <div style={{ ...T.card, borderRadius: 18, padding: '14px 16px', position: 'sticky', top: 12, borderTop: `3px solid ${T.accent}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, background: '#e8604c18', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>✍️</span>
        <span style={{ ...T.cap, fontWeight: 800 }}>ADD TO THIS NOTEBOOK</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {prompts.map((q) => (
          <button key={q} onClick={() => { setMode('note'); setValue(q + '\n\n'); }}
            style={{ border: '1px dashed #e8b7a4', borderRadius: 10, background: '#fdf6f0', color: '#8a5a3a', padding: '5px 10px', fontSize: 11.5, cursor: 'pointer', textAlign: 'left' }}>
            💭 {q}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {chip('note', '📝 Note')}
        {chip('text', '📋 Paste')}
        {chip('link', '🔗 Link')}
        <button onClick={() => pickFile('pdf')} style={{ border: '1.5px solid #f2e3d5', borderRadius: 999, background: '#fff', color: '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>📄 PDF</button>
        <button onClick={() => pickFile('image')} style={{ border: '1.5px solid #f2e3d5', borderRadius: 999, background: '#fff', color: '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>🖼 Image</button>
        <input ref={fileRef} type="file" accept={'.pdf,image/png,image/jpeg,image/webp'} onChange={onFile} style={{ display: 'none' }} />
        <button onClick={toggleVoice}
          style={{ border: listening ? `1.5px solid ${T.accent}` : '1.5px solid #f2e3d5', borderRadius: 999, background: listening ? '#fdf0ee' : '#fff', color: listening ? '#c0522d' : '#9b8465', padding: '4px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
          {listening ? '🎙 listening… tap to stop' : '🎙 Voice'}
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mode !== 'text') { e.preventDefault(); submit(); } }}
        placeholder={mode === 'link' ? 'https:// — the page text is extracted for you' : mode === 'voice' ? 'speak, then edit the transcript before adding' : mode === 'text' ? 'paste anything — an article, your old notes…' : 'write a note… (Enter adds it)'}
        spellCheck={false}
        style={{ width: '100%', minHeight: mode === 'text' ? 140 : 74, boxSizing: 'border-box', resize: 'vertical', border: '1px solid #f2e3d5', borderRadius: 12, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.55, color: '#2b211a', fontFamily: mode === 'link' ? 'ui-monospace, monospace' : 'inherit' }} />
      <button onClick={submit} disabled={busy || !value.trim()}
        style={{ marginTop: 8, width: '100%', border: 'none', borderRadius: 10, background: busy || !value.trim() ? '#e9ddcb' : T.accent, color: '#fff', padding: '9px 0', fontSize: 13, fontWeight: 800, cursor: busy || !value.trim() ? 'default' : 'pointer' }}>
        {busy ? (busyLabel || 'adding…') : '+ Add block'}
      </button>
      {err ? <div style={{ marginTop: 8, fontSize: 12, color: '#a33d2e', fontWeight: 700 }}>{err}</div> : null}
      <div style={{ ...T.cap, marginTop: 10, lineHeight: 1.5 }}>links pull the article text · PDFs are extracted · images are read by the Vision agent</div>
    </div>
  );
}

// The notebook's OWN act of creation (eva: inputs -> generated blocks; NotebookLM: grounded +
// cited). The result lands back in the notebook as an ai-provenance block — visibly the
// notebook's work, never confused with yours.
function SynthesizeButton({ blocks, busy, onRun }) {
  const [mode, setMode] = useState('study_note');
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={busy}
        style={{ border: '1px solid #f2e3d5', borderRadius: 10, background: '#fff', color: '#6b563d', padding: '7px 10px', fontSize: 12.5, fontWeight: 700 }}>
        <option value="study_note">study note</option>
        <option value="summary">summary</option>
        <option value="questions">self-test questions</option>
      </select>
      <button onClick={() => onRun(mode)} disabled={busy || blocks.length === 0}
        style={{ border: 'none', borderRadius: 999, background: busy || blocks.length === 0 ? '#c9bda1' : T.accent, color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 800, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
        {busy ? 'writing live…' : '✨ Synthesize'}
      </button>
    </div>
  );
}

// The live panel — eva's streaming stage, honestly: each line is a REAL pipeline event.
function LiveSynthesis({ live }) {
  const stageLine = live.error ? `✗ ${live.error}`
    : live.done ? '✓ saved to your notebook'
    : live.stage === 'reading' ? `reading your ${live.statusMeta?.blocks ?? ''} blocks…`
    : live.stage === 'planning' ? 'planning the sections…'
    : live.stage === 'writing' ? `writing §${live.statusMeta?.index}/${live.statusMeta?.total} — ${live.statusMeta?.heading}`
    : live.stage === 'illustrating' ? `illustrating — ${live.statusMeta?.heading}…`
    : live.stage === 'images-unavailable' ? 'writing (illustrations need an image-serving workspace — noted once)'
    : live.stage === 'image-failed' ? `image failed for “${live.statusMeta?.heading}” — continuing`
    : 'connecting…';
  const doneHeadings = new Set((live.sections ?? []).map((sx) => sx.heading));
  return (
    <div style={{ ...T.card, borderRadius: 18, padding: '14px 16px', borderTop: '3px solid #c98f2d', background: 'linear-gradient(180deg,#fffdf9,#fff7ee)' }}>
      <style>{`@keyframes nbSegIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}} @keyframes livePulse{50%{opacity:.45}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: live.error ? '#a33d2e' : live.done ? '#2f9e5f' : '#c98f2d', animation: live.done || live.error ? 'none' : 'livePulse 1.2s infinite' }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: live.error ? '#a33d2e' : '#8a5a3a' }}>{stageLine}</span>
      </div>
      {live.plan ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {live.plan.headings.map((h, i) => (
            <span key={h} style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 10px',
              background: doneHeadings.has(h) ? '#eaf7ee' : '#fff',
              color: doneHeadings.has(h) ? '#2f7d4a' : '#b3a889',
              border: '1px solid #eadfce' }}>
              {doneHeadings.has(h) ? '✓ ' : `${i + 1}. `}{h}
            </span>
          ))}
        </div>
      ) : null}
      {(live.sections ?? []).map((sec) => (
        <div key={sec.heading} style={{ marginTop: 10, animation: 'nbSegIn .5s ease-out both' }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: '#2b211a' }}>{sec.heading}</div>
          <Markdownish text={sec.markdown.replace(/^#+ .*$/m, '').trim()} />
        </div>
      ))}
      {(live.images ?? []).map((im) => (
        <img key={im.url} src={im.url} alt={im.heading} style={{ width: '100%', borderRadius: 12, marginTop: 10, animation: 'nbSegIn .5s ease-out both' }} />
      ))}
      {(live.rejected ?? []).map((r) => (
        <div key={r.heading} style={{ marginTop: 8, fontSize: 12, color: '#a33d2e', fontWeight: 700 }}>✗ “{r.heading}” refused: {r.reason}</div>
      ))}
    </div>
  );
}

// eva's follow-up box: ask anything — the answer arrives as a new grounded, cited section.
function AskBox({ onAsk, disabled }) {
  const [q, setQ] = useState('');
  const submit = () => { const v = q.trim(); if (!v) return; onAsk(v); setQ(''); };
  return (
    <div style={{ ...T.card, padding: '10px 14px', display: 'flex', gap: 8, alignItems: 'center', borderStyle: 'dashed' }}>
      <span style={{ fontSize: 15 }}>💬</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Ask your notebook — answered only from your blocks, with citations…"
        style={{ flex: 1, border: 'none', outline: 'none', fontSize: 13, color: '#2b211a', background: 'transparent' }} />
      <button onClick={submit} disabled={disabled || !q.trim()}
        style={{ border: 'none', borderRadius: 999, background: disabled || !q.trim() ? '#e9ddcb' : '#2b211a', color: '#fff', padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: disabled || !q.trim() ? 'default' : 'pointer' }}>Ask</button>
    </div>
  );
}

function GenerateButton({ id, notebook, blocks, onKick }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const kick = async () => {
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/notebooks/${id}/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'generation failed to start');
      onKick();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ textAlign: 'right' }}>
      {notebook.generatedCourseId ? (
        <a href={`/course/${notebook.generatedCourseId}`} style={{ border: 'none', borderRadius: 999, background: '#2f7d4a', color: '#fff', padding: '9px 18px', fontSize: 13, fontWeight: 800, textDecoration: 'none' }}>▶ open the generated course</a>
      ) : notebook.lastGeneratedJobId ? (
        <span style={{ fontSize: 12.5, fontWeight: 800, color: '#c98f2d' }}>⏳ course generating — check My Courses shortly</span>
      ) : (
        <button onClick={kick} disabled={busy || blocks.length === 0}
          style={{ border: '1.5px solid #d8cbb6', borderRadius: 999, background: '#fff', color: busy || blocks.length === 0 ? '#c9bda1' : '#6b563d', padding: '8px 16px', fontSize: 12.5, fontWeight: 800, cursor: busy || blocks.length === 0 ? 'default' : 'pointer' }}>
          {busy ? 'starting…' : '🎓 also make a course'}
        </button>
      )}
      {err ? <div style={{ marginTop: 6, fontSize: 12, color: '#a33d2e', fontWeight: 700, maxWidth: 380 }}>{err}</div> : null}
    </div>
  );
}
