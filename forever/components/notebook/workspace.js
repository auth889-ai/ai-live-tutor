'use client';

// NOTEBOOK WORKSPACE — the redesign (user spec, 2026-07-19): a DOCUMENT, not a feed.
//   ┌ topbar: title · counts · Synthesize ─────────────────────────────┐
//   │ PAGES+SOURCES │  the document (white, max 820px)  │ CONTEXT panel │
//   └ compact composer fixed under the document ────────────────────────┘
// Laws carried over: provenance never lies (but whispers — tiny, on hover);
// AI output is a DRAFT until the student accepts it; illustrations live INSIDE
// their sections; the journal is a view, not the notebook.

import { useEffect, useRef, useState } from 'react';

import { DrawingEditor, SvgDrawing, downloadDrawing } from './drawing.js';
import { PageInk } from './ink/page-ink.js';
import { HandBoard } from './hand-board.js';

const C = {
  appBg: '#F6F3EE', surface: '#FFFFFF', ink: '#211A14', sub: '#77695B', border: '#EBE3D8',
  accent: '#e8604c', user: '#2f7d4a', extracted: '#4477aa', ai: '#a06a1f',
};
const TRUST_TINT = { user: '#EDF7EF', extracted: '#EDF3FB', ai: '#FBF3E4' };

// ---------- tiny markdown (headings, bullets, bold, code, [n] cites, ![img](url), [[wiki]]) ----------
function Inline({ text, onNavigate }) {
  const parts = [];
  let rest = String(text ?? '');
  let k = 0;
  const RES = [
    { re: /\[\[([^\]]+)\]\]/, r: (m) => <button key={k += 1} onClick={() => onNavigate?.(m[1].trim())} style={{ border: 'none', background: '#EDF3FB', color: C.extracted, borderRadius: 6, padding: '0 5px', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{m[1].trim()}</button> },
    { re: /\[(\d+)\]/, r: (m) => <sup key={k += 1} style={{ background: '#EDF3FB', color: C.extracted, borderRadius: 5, padding: '0 4px', fontSize: 10, fontWeight: 800, marginLeft: 1 }}>{m[1]}</sup> },
    { re: /\*\*([^*]+)\*\*/, r: (m) => <b key={k += 1}>{m[1]}</b> },
    { re: /`([^`]+)`/, r: (m) => <code key={k += 1} style={{ background: '#F4EEE5', borderRadius: 4, padding: '0 4px', fontSize: '0.88em', fontFamily: 'ui-monospace, monospace' }}>{m[1]}</code> },
  ];
  while (rest.length) {
    const hits = RES.map((x) => ({ ...x, m: rest.match(x.re) })).filter((x) => x.m).sort((a, b) => a.m.index - b.m.index);
    if (!hits.length) { parts.push(rest); break; }
    const h = hits[0];
    if (h.m.index > 0) parts.push(rest.slice(0, h.m.index));
    parts.push(h.r(h.m));
    rest = rest.slice(h.m.index + h.m[0].length);
  }
  return <>{parts}</>;
}

export function Doc({ text, onNavigate, skipTitle = null }) {
  const rawLines = String(text ?? '').split('\n');
  // legacy notes carry doubled headings ("## X" then "X" or "# X") — collapse them at render
  const lines = [];
  for (const ln of rawLines) {
    const prev = lines.filter((x) => x.trim()).at(-1) ?? '';
    const norm = (x) => x.replace(/^#+\s*/, '').trim().toLowerCase();
    if (ln.trim() && norm(ln) === norm(prev) && (/^#/.test(ln) || /^#/.test(prev))) continue;
    lines.push(ln);
  }
  const out = [];
  let list = null;
  const flush = () => { if (list) { out.push(<ul key={`u${out.length}`} style={{ margin: '4px 0 12px', paddingLeft: 22 }}>{list}</ul>); list = null; } };
  for (let i = 0; i < lines.length; i += 1) {
    const ln = lines[i];
    const img = ln.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (img) {
      flush();
      out.push(<img key={i} src={img[2]} alt={img[1]} style={{ width: '58%', minWidth: 260, borderRadius: 10, float: 'right', margin: '4px 0 10px 16px' }} />);
    } else if (/^#{1,3} /.test(ln)) {
      const t = ln.replace(/^#{1,3} /, '');
      if (skipTitle && t.trim().toLowerCase() === skipTitle.trim().toLowerCase()) continue;
      flush();
      out.push(<div key={i} style={{ clear: 'both', fontSize: 20, fontWeight: 700, color: C.ink, margin: '22px 0 8px', letterSpacing: '-0.01em' }}><Inline text={t} onNavigate={onNavigate} /></div>);
    } else if (/^- /.test(ln)) {
      (list ??= []).push(<li key={i} style={{ margin: '3px 0', fontSize: 15.5, lineHeight: 1.65 }}><Inline text={ln.slice(2)} onNavigate={onNavigate} /></li>);
    } else if (ln.startsWith('— grounded in your blocks:')) {
      flush();
      const refs = [...ln.matchAll(/\[(\d+)\]/g)].map((m) => m[1]);
      out.push(<div key={i} style={{ clear: 'both', display: 'flex', gap: 5, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.sub }}>GROUNDED IN</span>
        {refs.map((r) => <span key={r} style={{ background: '#EDF3FB', color: C.extracted, borderRadius: 999, padding: '0 8px', fontSize: 10.5, fontWeight: 800 }}>#{r}</span>)}
      </div>);
    } else if (ln.trim()) {
      flush();
      out.push(<p key={i} style={{ margin: '0 0 12px', fontSize: 16, lineHeight: 1.7, color: C.ink, whiteSpace: 'pre-wrap', maxWidth: '68ch' }}><Inline text={ln} onNavigate={onNavigate} /></p>);
    }
  }
  flush();
  return <div style={{ overflow: 'hidden' }}>{out}</div>;
}

// ---------------- the workspace ----------------
export function NotebookWorkspace({ id, onBack, onNavigate }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('write'); // write | journal
  const [activePage, setActivePage] = useState(null);
  const [inkMode, setInkMode] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [selected, setSelected] = useState(null); // block id for the context panel
  const [live, setLive] = useState(null);
  const [draft, setDraftState] = useState(null); // finished draft awaiting accept
  const [mode, setMode] = useState('study_note');
  const load = () => fetch(`/api/notebooks/${id}`).then((r) => r.json()).then(setData).catch(() => {});
  useEffect(() => { load(); }, [id]);

  const runStream = (qs, { asDraft = true } = {}) => {
    if (live && !live.done && !live.error) return;
    setDraftState(null);
    setLive({ stage: 'connecting', sections: [] });
    const es = new EventSource(`/api/notebooks/${id}/synthesize/stream?${qs}${asDraft ? '&draft=1' : ''}`);
    es.addEventListener('status', (e) => { const d = JSON.parse(e.data); setLive((c) => ({ ...c, stage: d.stage, meta: d })); });
    es.addEventListener('plan', (e) => { const d = JSON.parse(e.data); setLive((c) => ({ ...c, plan: d })); });
    es.addEventListener('section', (e) => { const d = JSON.parse(e.data); setLive((c) => ({ ...c, sections: [...(c?.sections ?? []), d] })); });
    es.addEventListener('image', (e) => { const d = JSON.parse(e.data); setLive((c) => ({ ...c, sections: (c?.sections ?? []).map((sx) => sx.heading === d.heading ? { ...sx, imageUrl: d.url } : sx) })); });
    es.addEventListener('done', (e) => {
      const d = JSON.parse(e.data);
      es.close();
      if (d.draft) { setDraftState(d.draft); setLive(null); } else { setLive(null); load(); }
    });
    es.addEventListener('error', (e) => {
      try { setLive((c) => ({ ...c, error: JSON.parse(e.data).message })); } catch { setLive((c) => ({ ...c, error: 'stream lost' })); }
      es.close();
    });
  };

  const acceptDraft = async () => {
    if (!draft) return;
    await fetch(`/api/notebooks/${id}/blocks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'note', title: `✨ ${draft.title}`, content: draft.markdown, source: 'generated', trust: 'ai', page: activePage ?? 'Notes' }),
    });
    setDraftState(null);
    load();
  };

  if (!data?.notebook) return <div style={{ padding: 60, textAlign: 'center', color: C.sub }}>Opening…</div>;
  const { notebook, blocks, backlinks = [] } = data;
  const pages = [...new Set(blocks.map((b) => b.page ?? 'Notes'))];
  if (activePage && !pages.includes(activePage)) pages.push(activePage);
  const sources = blocks.filter((b) => ['image', 'pdf', 'link', 'moment'].includes(b.type));
  const legacyIll = new Map(blocks.filter((b) => b.type === 'image' && b.trust === 'ai' && b.url && b.title).map((b) => [b.title.trim().toLowerCase(), b.url]));
  const docBlocks = blocks.filter((b) => (activePage ? (b.page ?? 'Notes') === activePage : true) && !(b.type === 'image' && b.trust === 'ai') && b.origin !== 'page-ink');
  const inkPage = activePage ?? 'Notes';
  const inkBlock = blocks.find((b) => b.origin === 'page-ink' && (b.page ?? 'Notes') === inkPage) ?? null;
  const sel = blocks.find((b) => b._id === selected) ?? null;

  return (
    <div style={{ background: C.appBg, minHeight: '80vh', borderRadius: 18, border: `1px solid ${C.border}` }}>
      <style>{`
        .nbk-blk .nbk-acts{opacity:0;transition:opacity .15s}
        .nbk-blk:hover .nbk-acts{opacity:1}
        .nbk-blk{border-radius:10px}
        .nbk-blk:hover{background:#FBF8F3}
        .nbk-blk.sel{background:#FBF4EC;outline:1.5px solid #EBD9C4}
        @media (max-width: 1080px){
          .nbk-grid{grid-template-columns:1fr !important}
          .nbk-rail-left,.nbk-rail-right{border:none !important}
          .nbk-rail-left>div,.nbk-rail-right>div{position:static !important;max-height:none !important}
        }
      `}</style>

      {/* topbar — sticky: the document scrolls, the chrome does not (app-shell pattern) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, zIndex: 30, background: C.appBg, borderRadius: '18px 18px 0 0' }}>
        <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notebook.title}</div>
          <div style={{ fontSize: 11.5, color: C.sub }}>{pages.length} page{pages.length === 1 ? '' : 's'} · {sources.length} source{sources.length === 1 ? '' : 's'} · {blocks.length} blocks</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => setInkMode((v) => !v)} title="write on the page with your finger or pen"
            style={{ border: inkMode ? 'none' : `1px solid ${C.border}`, borderRadius: 999, background: inkMode ? C.accent : '#fff', color: inkMode ? '#fff' : C.sub, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>
            ✍️ {inkMode ? 'writing on page' : 'pen'}
          </button>
          <PagePager pages={pages} active={activePage} onPick={(pg) => { setView('write'); setActivePage(pg); }} />
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 9, background: '#fff', color: C.sub, padding: '6px 9px', fontSize: 12, fontWeight: 700 }}>
            <option value="study_note">study note</option>
            <option value="detailed">deep-dive</option>
            <option value="summary">summary</option>
            <option value="questions">self-test</option>
          </select>
          <button onClick={() => {
            const md = [`# ${notebook.title}`, notebook.intent ? `> ${notebook.intent}` : '', ...docBlocks.map((b) => {
              if (b.type === 'drawing') return '*(drawing)*';
              const body = b.type === 'voice' ? (b.transcript || b.content) : b.content;
              return `${b.title ? `## ${String(b.title).replace(/^✨\s*/, '')}\n` : ''}${body ?? ''}`;
            })].filter(Boolean).join('\n\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
            a.download = `${notebook.title.replace(/[^\w]+/g, '-').slice(0, 50)}.md`;
            a.click();
          }} title="export this view as Markdown" style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.sub, padding: '7px 11px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>⬇</button>
          <button title="AI draws a handwritten note board from this notebook" onClick={async () => {
            const r = await fetch(`/api/notebooks/${id}/handboard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page: activePage ?? 'Notes' }) });
            if (r.ok) load();
          }} style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.sub, padding: '7px 11px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>✍️ board</button>
          <button onClick={() => runStream(`mode=${mode}`)} disabled={Boolean(live)}
            style={{ border: 'none', borderRadius: 999, background: live ? '#D8CBB9' : C.accent, color: '#fff', padding: '8px 18px', fontSize: 12.5, fontWeight: 800, cursor: live ? 'default' : 'pointer' }}>
            {live ? 'writing…' : '✨ Synthesize'}
          </button>
        </div>
      </div>

      <div className="nbk-grid" style={{ display: 'grid', gridTemplateColumns: '215px minmax(0, 1fr) 300px', gap: 0, alignItems: 'stretch' }}>
        {/* ---------- left: pages + sources ---------- */}
        <div className="nbk-rail-left" style={{ borderRight: `1px solid ${C.border}` }}>
        <div style={{ position: 'sticky', top: 62, maxHeight: 'calc(100vh - 76px)', overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.6, marginBottom: 6 }}>PAGES</div>
            <SideItem label="All pages" on={activePage === null && view === 'write'} onClick={() => { setView('write'); setActivePage(null); }} />
            {pages.map((pg, i) => <SideItem key={pg} num={i + 1} label={pg} on={activePage === pg && view === 'write'} onClick={() => { setView('write'); setActivePage(pg); }} />)}
            <NewPage onCreate={(name) => { setView('write'); setActivePage(name); }} />
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.6, marginBottom: 6 }}>SOURCES</div>
            {sources.length === 0 ? <div style={{ fontSize: 12, color: C.sub }}>none yet</div>
              : sources.slice(0, 14).map((b) => (
                <SideItem key={b._id} label={(b.title ?? b.origin ?? b.type).slice(0, 26)} on={selected === b._id}
                  thumb={b.type === 'image' && b.url ? b.url : null}
                  icon={b.type === 'image' && b.url ? null : { image: '🖼', pdf: 'PDF', link: '🔗', moment: '▶' }[b.type]}
                  iconBg={{ image: '#F3EAFB', pdf: '#FBE9E4', link: '#E9F1FB', moment: '#FDEFE7' }[b.type]}
                  onClick={() => { setSelected(b._id); }} />
              ))}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <SideItem label="🗓 Journal view" on={view === 'journal'} onClick={() => setView(view === 'journal' ? 'write' : 'journal')} />
          </div>
        </div>
        </div>

        {/* ---------- center: THE DOCUMENT ---------- */}
        <div style={{ padding: '22px 26px 90px', position: 'relative' }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            const files = [...(e.dataTransfer?.files ?? [])].slice(0, 3)
              .filter((f) => f.type === 'application/pdf' || f.type.startsWith('image/'));
            if (!files.length) return;
            setDropBusy(true);
            try {
              for (const file of files) {
                const fd = new FormData();
                fd.append('file', file);
                const up = await fetch('/api/uploads', { method: 'POST', body: fd });
                const upd = await up.json();
                if (up.ok) {
                  await fetch(`/api/notebooks/${id}/blocks`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: file.type === 'application/pdf' ? 'pdf' : 'image', uploadId: upd.uploadId, fileName: file.name, mediaType: file.type, source: 'upload', page: activePage ?? 'Notes' }),
                  });
                }
              }
              load();
            } finally { setDropBusy(false); }
          }}>
          {dragOver || dropBusy ? (
            <div style={{ position: 'absolute', inset: 12, zIndex: 20, border: '2.5px dashed #e8604c', borderRadius: 16, background: '#FDF0EEEE', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', fontSize: 15, fontWeight: 800, color: '#e8604c' }}>
              {dropBusy ? 'adding to your notebook…' : 'drop PDF or image here — it becomes a source block'}
            </div>
          ) : null}
          <div style={{ maxWidth: 820, margin: '0 auto', background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: '30px 38px 26px', minHeight: 420, position: 'relative' }}>
            <PageInk nb={id} page={inkPage} inkBlock={inkBlock} active={inkMode && view === 'write'} color={C.accent} onDirty={() => {}} />
            <div style={{ fontSize: 25, fontWeight: 700, color: C.ink, fontFamily: 'var(--font-newsreader), Georgia, serif' }}>{activePage ?? notebook.title}</div>
            {notebook.intent ? <div style={{ fontSize: 12.5, color: C.sub, margin: '3px 0 6px' }}>Goal — {notebook.intent}</div> : null}
            <div style={{ height: 1, background: C.border, margin: '14px 0 18px' }} />

            {live ? <LivePanel live={live} /> : null}
            {draft ? <DraftPanel draft={draft} onAccept={acceptDraft} onDiscard={() => setDraftState(null)} /> : null}

            {view === 'journal' ? (
              <Journal blocks={docBlocks} />
            ) : docBlocks.length === 0 && !live && !draft ? (
              <div style={{ color: C.sub, fontSize: 14, padding: '30px 0' }}>An empty page. Write below — or bring in a link, file, or voice note with ＋.</div>
            ) : (
              docBlocks.map((b) => (
                <DocBlock key={b._id} nb={id} b={b} selected={selected === b._id} legacyIll={legacyIll}
                  onSelect={() => setSelected(selected === b._id ? null : b._id)}
                  onChanged={load} onNavigate={onNavigate} />
              ))
            )}
          </div>
          <Composer id={id} page={activePage ?? 'Notes'} onAdded={load} />
        </div>

        {/* ---------- right: context panel ---------- */}
        <ContextPanel nb={id} sel={sel} backlinks={backlinks} onNavigate={onNavigate} onChanged={load}
          onExplain={(bid) => runStream(`mode=detailed&focus=${bid}&blocks=${bid}`)}
          onContinue={(bid) => runStream(`mode=continue&blockId=${bid}`, { asDraft: false })}
          onQuiz={() => runStream('mode=questions')}
          onSummary={() => runStream('mode=summary')}
          onAsk={(q) => runStream(`mode=ask&question=${encodeURIComponent(q)}`, { asDraft: false })} />
      </div>
    </div>
  );
}

function SideItem({ label, on, onClick, num = null, icon = null, iconBg = null, thumb = null }) {
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', borderRadius: 8, background: on ? '#F9E9E4' : 'transparent', color: on ? C.ink : C.sub, padding: '6px 9px', fontSize: 12.5, fontWeight: on ? 800 : 600, cursor: 'pointer' }}>
      {num != null ? <span style={{ width: 18, height: 18, borderRadius: 6, background: on ? C.accent : '#EFE7DB', color: on ? '#fff' : C.sub, fontSize: 10.5, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{num}</span> : null}
      {thumb ? <img src={thumb} alt="" style={{ width: 26, height: 20, objectFit: 'cover', borderRadius: 5, flexShrink: 0 }} /> : null}
      {icon ? <span style={{ width: 20, height: 20, borderRadius: 6, background: iconBg ?? '#EFE7DB', fontSize: 11, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span> : null}
      <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  );
}

// Page 3 of 7 pager (mockup topbar): cycles All -> page1 -> ... -> pageN
function PagePager({ pages, active, onPick }) {
  if (pages.length < 2) return null;
  const seq = [null, ...pages];
  const idx = seq.findIndex((x) => x === active);
  const go = (d) => onPick(seq[(idx + d + seq.length) % seq.length]);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', padding: '4px 6px' }}>
      <button onClick={() => go(-1)} style={{ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 13 }}>‹</button>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap' }}>{active === null ? 'All pages' : `Page ${idx} of ${pages.length}`}</span>
      <button onClick={() => go(1)} style={{ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 13 }}>›</button>
    </span>
  );
}

function NewPage({ onCreate }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState('');
  if (!open) return <button onClick={() => setOpen(true)} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '6px 9px' }}>+ New page</button>;
  return (
    <input autoFocus value={v} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && v.trim()) { onCreate(v.trim().slice(0, 80)); setOpen(false); setV(''); } if (e.key === 'Escape') setOpen(false); }}
      placeholder="page name ⏎" style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 8, padding: '5px 9px', fontSize: 12 }} />
  );
}

// ---------- document blocks: quiet by default, actions on hover ----------
function DocBlock({ nb, b, selected, onSelect, onChanged, onNavigate, legacyIll = new Map() }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showExtract, setShowExtract] = useState(false);
  const [editingInk, setEditingInk] = useState(false);
  const save = async () => {
    setBusy(true);
    await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: draftText }) }).catch(() => {});
    setBusy(false);
    setEditing(false);
    onChanged();
  };
  const tidy = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${b._id}/improve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ draft: draftText }) });
      const d = await r.json();
      if (r.ok) setDraftText(d.improved);
    } finally { setBusy(false); }
  };
  const [narrating, setNarrating] = useState(false);
  const listen = async (e) => {
    e.stopPropagation();
    if (narrating) return;
    setNarrating(true);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${b._id}/narrate`, { method: 'POST' });
      const d = await r.json();
      if (d.audioUrl) { new Audio(d.audioUrl).play(); onChanged(); }
    } finally { setNarrating(false); }
  };
  const remove = async () => { await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'DELETE' }); onChanged(); };
  const when = new Date(b.createdAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' });
  const provenance = b.trust === 'ai' ? 'AI' : b.trust === 'extracted' ? 'extracted' : 'you';

  // MOMENT: the one card that KEEPS a visible design (unique Forever feature)
  if (b.type === 'moment') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: 14, border: `1.5px solid #F3D8CE`, borderRadius: 12, background: '#FFFAF7', cursor: 'pointer' }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.accent }}>▶ {b.title}</div>
        {b.transcript ? <div style={{ fontSize: 14, color: C.ink, fontStyle: 'italic', margin: '6px 0' }}>“{b.transcript}”</div> : null}
        {b.content ? <div style={{ fontSize: 13.5, color: C.sub }}>{b.content}</div> : null}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <a href={b.url} onClick={(e) => e.stopPropagation()} style={{ borderRadius: 999, background: C.accent, color: '#fff', padding: '4px 12px', fontSize: 11.5, fontWeight: 800, textDecoration: 'none' }}>Replay moment</a>
          <span className="nbk-acts" style={{ fontSize: 11, color: C.sub, alignSelf: 'center' }}>{b.origin} · {when}</span>
        </div>
      </div>
    );
  }

  if (b.type === 'handboard') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        <HandBoard spec={b.content} />
        <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.sub }}>hand board · AI · grounded · {when}</span>
          <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
        </div>
      </div>
    );
  }

  if (b.type === 'drawing') {
    // a saved page must stay writable, like Xournal: ✏️ reopens the editor over the same ink
    if (editingInk) {
      return (
        <div style={{ margin: '10px 0' }}>
          <DrawingEditor
            initial={b.content}
            onSave={async (data) => {
              await fetch(`/api/notebooks/${nb}/blocks/${b._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: data }) });
              setEditingInk(false);
              onChanged();
            }}
            onCancel={() => setEditingInk(false)}
          />
        </div>
      );
    }
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ position: 'relative', margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        <SvgDrawing data={b.content} />
        <button onClick={(e) => { e.stopPropagation(); setEditingInk(true); }} title="keep writing on this drawing"
          style={{ position: 'absolute', top: 16, right: 18, border: '1px solid #EBD9C4', borderRadius: 999, background: '#FFFFFFEE', color: C.ink, padding: '4px 12px', fontSize: 11.5, fontWeight: 800, cursor: 'pointer' }}>✏️ write</button>
        <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: C.sub }}>drawing · you · {when}</span>
          <button onClick={(e) => { e.stopPropagation(); downloadDrawing(b.content, 'svg', 'drawing'); }} style={ghost()}>⬇ svg</button>
          <button onClick={(e) => { e.stopPropagation(); downloadDrawing(b.content, 'png', 'drawing'); }} style={ghost()}>⬇ png</button>
          <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
        </div>
      </div>
    );
  }

  // IMAGE source: picture first, description collapsed
  if (b.type === 'image') {
    return (
      <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '10px 0', padding: '8px 10px', cursor: 'pointer' }}>
        {b.url ? <img src={b.url} alt={b.title ?? ''} style={{ width: '100%', borderRadius: 10 }} /> : null}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{b.title ?? 'Image'}</span>
          <span style={{ fontSize: 11, color: C.sub }}>image · {provenance} · {when}</span>
          {b.content ? (
            <button onClick={(e) => { e.stopPropagation(); setShowExtract((v) => !v); }} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: C.extracted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              {showExtract ? 'hide details' : 'view extracted details'}
            </button>
          ) : null}
        </div>
        {showExtract ? <div style={{ fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 1.6 }}>{b.content}</div> : null}
      </div>
    );
  }

  return (
    <div className={`nbk-blk${selected ? ' sel' : ''}`} onClick={onSelect} style={{ margin: '4px -10px', padding: '8px 10px', cursor: 'pointer' }}>
      {b.title ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0 4px' }}>
          <span style={{ fontSize: b.trust === 'ai' ? 22 : 16.5, fontWeight: 700, color: C.ink, letterSpacing: '-0.01em' }}><Inline text={(b.title ?? '').replace(/^✨\s*/, '')} onNavigate={onNavigate} /></span>
          {b.trust === 'ai' ? <span style={{ fontSize: 10, fontWeight: 800, color: C.ai, background: '#FBF3E4', borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' }}>AI · grounded</span> : null}
        </div>
      ) : null}
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} spellCheck={false}
            style={{ width: '100%', minHeight: 100, boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', fontSize: 14.5, lineHeight: 1.65, fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button onClick={save} disabled={busy} style={{ border: 'none', borderRadius: 999, background: '#1E9A61', color: '#fff', padding: '5px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>save</button>
            <button onClick={tidy} disabled={busy} style={{ border: `1px solid ${C.border}`, borderRadius: 999, background: '#fff', color: C.ai, padding: '5px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{busy ? '…' : '✨ tidy'}</button>
            <button onClick={() => setEditing(false)} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12, cursor: 'pointer' }}>cancel</button>
          </div>
        </div>
      ) : (
        <Doc text={(() => {
          let t = b.type === 'voice' ? (b.transcript || b.content) : (b.content ?? '');
          // weave legacy illustrations under their matching section headings
          if (b.trust === 'ai' && legacyIll.size && !/!\[/.test(t)) {
            t = t.split('\n').map((ln) => {
              const m = ln.match(/^#{1,3} (.+)$/);
              const u = m ? legacyIll.get(m[1].trim().toLowerCase()) : null;
              return u ? `${ln}\n![${m[1].trim()}](${u})` : ln;
            }).join('\n');
          }
          return t;
        })()} onNavigate={onNavigate} skipTitle={(b.title ?? '').replace(/^✨\s*/, '')} />
      )}
      {(b.attachments ?? []).map((att) => att.kind === 'image' && att.url ? (
        <img key={att.id} src={att.url} alt={att.title ?? ''} style={{ width: '52%', minWidth: 220, borderRadius: 10, display: 'block', margin: '6px 0' }} />
      ) : (
        <a key={att.id} href={att.url ?? undefined} target={att.url ? '_blank' : undefined} rel="noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ display: 'inline-flex', gap: 5, fontSize: 12, color: C.extracted, fontWeight: 700, textDecoration: 'none', marginRight: 10 }}>
          {att.kind === 'pdf' ? '📄' : '🔗'} {att.title ?? att.kind}
        </a>
      ))}
      {/* hover-only whisper row */}
      <div className="nbk-acts" style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
        <span style={{ fontSize: 11, color: C.sub, background: TRUST_TINT[b.trust] ?? 'transparent', borderRadius: 6, padding: '1px 7px' }}>{provenance} · {when}</span>
        {['note', 'text', 'moment'].includes(b.type) ? (
          <button onClick={(e) => { e.stopPropagation(); setDraftText(b.content ?? ''); setEditing(true); }} style={ghost()}>✏️</button>
        ) : null}
        {b.audioUrl ? <audio controls src={b.audioUrl} style={{ height: 26 }} onClick={(e) => e.stopPropagation()} /> : null}
        {!b.audioUrl && ['note', 'text'].includes(b.type) ? (
          <button onClick={listen} title="read this note aloud (Sankofa-style narration)" style={ghost()}>{narrating ? '…' : '🔊 listen'}</button>
        ) : null}
        <button onClick={(e) => { e.stopPropagation(); remove(); }} style={ghost()}>✕</button>
      </div>
    </div>
  );
}
const ghost = () => ({ border: 'none', background: 'transparent', color: C.sub, cursor: 'pointer', fontSize: 12.5, padding: 0 });

// ---------- live + draft panels ----------
function LivePanel({ live }) {
  const line = live.error ? `✗ ${live.error}`
    : live.stage === 'reading' ? `reading your ${live.meta?.blocks ?? ''} blocks…`
    : live.stage === 'planning' ? 'planning the sections…'
    : live.stage === 'writing' ? `writing §${live.meta?.index}/${live.meta?.total} — ${live.meta?.heading}`
    : live.stage === 'illustrating' ? `illustrating — ${live.meta?.heading}…`
    : 'connecting…';
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: '12px 16px', marginBottom: 16, background: '#FDFBF7' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ai }}>{line}</div>
      {live.plan ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {live.plan.headings.map((h, i) => {
            const done = (live.sections ?? []).some((sx) => sx.heading === h);
            return <span key={h} style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '2px 10px', border: `1px solid ${C.border}`, color: done ? '#1E9A61' : C.sub, background: done ? '#EDF7EF' : '#fff' }}>{done ? '✓' : i + 1} {h}</span>;
          })}
        </div>
      ) : null}
      {(live.sections ?? []).map((sec) => (
        <div key={sec.heading} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{sec.heading}</div>
          {sec.imageUrl ? <img src={sec.imageUrl} alt="" style={{ width: '46%', minWidth: 220, borderRadius: 10, float: 'right', margin: '2px 0 8px 12px' }} /> : null}
          <Doc text={sec.markdown} />
          <div style={{ clear: 'both' }} />
        </div>
      ))}
    </div>
  );
}

function DraftPanel({ draft, onAccept, onDiscard }) {
  return (
    <div style={{ border: '1.5px solid #E8D9BE', borderRadius: 12, padding: '14px 18px', marginBottom: 16, background: '#FDFAF3' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.ai }}>AI DRAFT — not saved yet</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{draft.title}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onAccept} style={{ border: 'none', borderRadius: 999, background: '#1E9A61', color: '#fff', padding: '6px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>✓ accept into page</button>
          <button onClick={onDiscard} style={{ border: `1px solid ${C.border}`, borderRadius: 999, background: '#fff', color: C.sub, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>discard</button>
        </span>
      </div>
      <Doc text={draft.markdown} />
    </div>
  );
}

// ---------- journal (the old feed, demoted to a view) ----------
function Journal({ blocks }) {
  const groups = new Map();
  for (const b of blocks) {
    const day = new Date(b.createdAt).toLocaleDateString('en', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(b);
  }
  return [...groups.entries()].reverse().map(([day, list]) => (
    <div key={day} style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.sub, margin: '10px 0 4px' }}>{day}</div>
      {list.map((b) => (
        <div key={b._id} style={{ display: 'flex', gap: 10, fontSize: 13, color: C.ink, padding: '3px 0' }}>
          <span style={{ color: C.sub, fontVariantNumeric: 'tabular-nums' }}>{new Date(b.createdAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })}</span>
          <span>{{ note: '📝', text: '📋', link: '🔗', pdf: '📄', image: '🖼', voice: '🎙', moment: '▶' }[b.type]}</span>
          <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(b.title || b.content || b.transcript || b.type).slice(0, 90)}</span>
        </div>
      ))}
    </div>
  ));
}

// ---------- compact composer (fixed under the document) ----------
function Composer({ id, page, onAdded }) {
  const [v, setV] = useState('');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const fileRef = useRef(null);
  const kindRef = useRef('pdf');
  const [listening, setListening] = useState(false);
  const [drawOpen, setDrawOpen] = useState(false);
  const recRef = useRef(null);

  const [err, setErr] = useState('');
  const post = async (payload) => {
    setBusy(true);
    setErr('');
    try {
      const r = await fetch(`/api/notebooks/${id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, page }) });
      if (!r.ok) throw new Error((await r.json()).error || `save failed (HTTP ${r.status})`);
      setV('');
      onAdded();
    } catch (e) {
      setErr(String(e.message ?? e));
    } finally { setBusy(false); setBusyLabel(''); }
  };
  const submit = () => {
    const t = v.trim();
    if (!t) return;
    if (/^https?:\/\/\S+$/i.test(t)) post({ type: 'link', url: t });
    else post({ type: 'note', content: t, source: 'typed' });
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setBusyLabel(kindRef.current === 'pdf' ? 'extracting PDF…' : 'reading image…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/uploads', { method: 'POST', body: fd });
      const upd = await up.json();
      if (up.ok) await post({ type: kindRef.current, uploadId: upd.uploadId, fileName: file.name, mediaType: file.type, source: 'upload' });
    } finally { setBusy(false); setBusyLabel(''); setMenu(false); }
  };
  const voice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (listening) { recRef.current?.stop(); return; }
    const rec = new SR();
    recRef.current = rec;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e) => setV([...e.results].map((r) => r[0].transcript).join(' '));
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
    setMenu(false);
  };

  return (
    <div style={{ maxWidth: 820, margin: '12px auto 0', position: 'sticky', bottom: 12 }}>
      {drawOpen ? (
        <DrawingEditor
          onSave={async (data) => { setDrawOpen(false); await post({ type: 'drawing', content: data, source: 'typed' }); }}
          onCancel={() => setDrawOpen(false)} />
      ) : null}
      {menu ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {[['📄 PDF', () => { kindRef.current = 'pdf'; fileRef.current?.click(); }], ['🖼 Image', () => { kindRef.current = 'image'; fileRef.current?.click(); }], ['🎙 Voice', voice], ['✏️ Draw', () => { setDrawOpen(true); setMenu(false); }]].map(([label, fn]) => (
            <button key={label} onClick={fn} style={{ border: `1px solid ${C.border}`, borderRadius: 999, background: '#fff', color: C.sub, padding: '6px 14px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 14, padding: '8px 12px', boxShadow: '0 6px 18px rgba(58,46,34,0.08)' }}>
        <button onClick={() => setMenu((m) => !m)} title="add PDF, image, or voice" style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 17, cursor: 'pointer', padding: 0 }}>＋</button>
        <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder={busy ? (busyLabel || 'working…') : listening ? 'listening — speak, then Enter…' : `Write on “${page}” — a note, or paste a link…`}
          disabled={busy}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 14, color: C.ink, background: 'transparent' }} />
        <button onClick={submit} disabled={busy || !v.trim()} style={{ border: 'none', borderRadius: 10, background: busy || !v.trim() ? '#E8DFD2' : C.accent, color: '#fff', width: 30, height: 30, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>↑</button>
      </div>
      {err ? <div style={{ marginTop: 6, fontSize: 12, color: '#D64545', fontWeight: 700, background: '#fff', borderRadius: 8, padding: '4px 10px', display: 'inline-block' }}>{err}</div> : null}
      <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: 'none' }} />
    </div>
  );
}

// ---------- right: contextual intelligence ----------
function ContextPanel({ nb, sel, backlinks, onNavigate, onChanged, onExplain, onContinue, onAsk, onQuiz, onSummary }) {
  const [tab, setTab] = useState('ai');
  const [q, setQ] = useState('');
  const [teachText, setTeachText] = useState('');
  const [teachBusy, setTeachBusy] = useState(false);
  const [teachResult, setTeachResult] = useState(null);
  const teach = async () => {
    if (!sel) return;
    setTeachBusy(true);
    setTeachResult(null);
    try {
      const r = await fetch(`/api/notebooks/${nb}/blocks/${sel._id}/teachback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ explanation: teachText }) });
      const d = await r.json();
      setTeachResult(r.ok ? d : { error: d.error });
      if (r.ok) { setTeachText(''); onChanged(); }
    } finally { setTeachBusy(false); }
  };
  const T2 = (idd, label) => (
    <button key={idd} onClick={() => setTab(idd)} style={{ border: 'none', borderBottom: tab === idd ? `2px solid ${C.accent}` : '2px solid transparent', background: 'transparent', color: tab === idd ? C.ink : C.sub, fontSize: 12, fontWeight: 800, padding: '8px 2px', marginRight: 14, cursor: 'pointer' }}>{label}</button>
  );
  return (
    <div className="nbk-rail-right" style={{ borderLeft: `1px solid ${C.border}`, minWidth: 0 }}>
    <div style={{ position: 'sticky', top: 62, maxHeight: 'calc(100vh - 76px)', overflowY: 'auto', padding: '4px 16px 16px' }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>{T2('ai', 'AI')}{T2('back', 'Backlinks')}{T2('review', 'Explain back')}</div>

      {tab === 'ai' ? (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 420 }}>
          {sel ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Selected content</div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: '#F4EEE5', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0 }}>{{ image: '🖼', pdf: '📄', link: '🔗', moment: '▶', voice: '🎙' }[sel.type] ?? '📝'}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflowe: 'ellipsis' }}>{(sel.title || sel.content || sel.transcript || '').slice(0, 40)}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>{sel.page ?? 'Notes'}</div>
                </div>
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>Select any block in the document to act on it.</div>}

          <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>What would you like to do?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <ActionRow icon="✨" title="Explain" sub="explain this in simple terms" disabled={!sel} onClick={() => sel && onExplain(sel._id)} />
            <ActionRow icon="🎓" title="Explain it back" sub="help me teach this back" disabled={!sel} onClick={() => sel && setTab('review')} />
            <ActionRow icon="🧠" title="Create quiz" sub="generate practice questions" onClick={() => onQuiz()} />
            <ActionRow icon="📋" title="Summarize" sub="create a short summary" onClick={() => onSummary()} />
            {sel && sel.trust === 'user' && ['note', 'text'].includes(sel.type) ? <ActionRow icon="✍️" title="Continue writing" sub="the AI extends your draft" onClick={() => onContinue(sel._id)} /> : null}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 16 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, marginBottom: 6 }}>Ask anything about this notebook</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { onAsk(q.trim()); setQ(''); } }}
                placeholder="Ask a question…" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 12, padding: '9px 11px', fontSize: 12.5 }} />
              <button onClick={() => { if (q.trim()) { onAsk(q.trim()); setQ(''); } }} style={{ border: 'none', borderRadius: 12, background: C.accent, color: '#fff', width: 34, fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>↑</button>
            </div>
            <div style={{ fontSize: 10.5, color: C.sub, marginTop: 6 }}>AI answers come from your sources and notes.</div>
          </div>
        </div>
      ) : null}

      {tab === 'back' ? (
        backlinks.length === 0 ? <div style={{ fontSize: 12.5, color: C.sub }}>No links point here yet — write [[{'{'}notebook{'}'}]] in any note.</div>
          : backlinks.map((bl, i) => (
            <button key={i} onClick={() => onNavigate?.(bl.notebookId)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', cursor: 'pointer', padding: '5px 0' }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: C.extracted }}>{bl.title}</div>
              {bl.preview ? <div style={{ fontSize: 11.5, color: C.sub }}>“{bl.preview.slice(0, 80)}…”</div> : null}
            </button>
          ))
      ) : null}

      {tab === 'review' ? (
        <div>
          {sel ? (
            <>
              <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 8 }}>Explain “{(sel.title || sel.content || '').slice(0, 50)}” in your own words — the tutor checks it and schedules what you miss.</div>
              <textarea value={teachText} onChange={(e) => setTeachText(e.target.value)} spellCheck={false}
                style={{ width: '100%', minHeight: 100, boxSizing: 'border-box', border: `1px solid ${C.border}`, borderRadius: 10, padding: '8px 10px', fontSize: 13, lineHeight: 1.6 }} />
              <button onClick={teach} disabled={teachBusy || teachText.trim().length < 20}
                style={{ marginTop: 6, border: 'none', borderRadius: 999, background: teachBusy || teachText.trim().length < 20 ? '#CFE0D2' : '#1E9A61', color: '#fff', padding: '7px 16px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                {teachBusy ? 'checking…' : '✓ check my explanation'}
              </button>
              {teachResult?.error ? <div style={{ fontSize: 12, color: '#D64545', marginTop: 6, fontWeight: 700 }}>{teachResult.error}</div> : null}
              {teachResult?.verdict ? <div style={{ fontSize: 12.5, color: C.ink, marginTop: 8 }}>Verdict: <b>{teachResult.verdict}</b>{teachResult.missing?.length ? ` — ${teachResult.missing.length} revision item(s) scheduled` : ' — nothing missing 🎉'}<div style={{ color: C.sub, marginTop: 4 }}>the full check landed in your notebook</div></div> : null}
            </>
          ) : <div style={{ fontSize: 12.5, color: C.sub }}>Select a block first, then explain it back.</div>}
        </div>
      ) : null}
    </div>
    </div>
  );
}

function ActionRow({ icon, title, sub, onClick, disabled = false }) {
  return (
    <button onClick={onClick} disabled={disabled}
      style={{ display: 'flex', gap: 10, alignItems: 'center', textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 12, background: '#fff', padding: '9px 12px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: '#FDEFE7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{title}</div>
        <div style={{ fontSize: 11, color: C.sub }}>{sub}</div>
      </span>
    </button>
  );
}

function CtxBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.ink, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{children}</button>;
}
