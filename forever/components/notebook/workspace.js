'use client';

// NOTEBOOK WORKSPACE — the shell (user structure order: one concern per module):
//   theme.js                 palette + trust tints
//   doc/markdown.js          Inline + Doc renderer
//   doc/block.js             DocBlock (all block cards + whisper actions)
//   doc/composer.js          Composer input
//   rails/side.js            SideItem / PagePager / NewPage
//   panels/live.js           LivePanel / DraftPanel / Journal
//   panels/context-panel.js  right rail AI actions
//   ink/*, drawing.js        ink engine (split earlier)
// This file wires them: state, data loading, synthesis stream, layout grid.

import { useEffect, useState } from 'react';

import { C } from './theme.js';
import { Doc } from './doc/markdown.js';
import { DocBlock } from './doc/block.js';
import { Composer } from './doc/composer.js';
import { SideItem, PagePager, NewPage } from './rails/side.js';
import { LivePanel, DraftPanel, Journal } from './panels/live.js';
import { ContextPanel } from './panels/context-panel.js';
import { PageInk } from './ink/page-ink.js';

export function NotebookWorkspace({ id, onBack, onNavigate }) {
  const [data, setData] = useState(null);
  const [view, setView] = useState('write'); // write | journal
  const [activePage, setActivePage] = useState(null);
  const [inkMode, setInkMode] = useState(false);
  const [dragBlk, setDragBlk] = useState(null); // { id, y0, dy } while a block is being dragged
  const [dragOver, setDragOver] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [selected, setSelected] = useState(null); // block id for the context panel
  const [live, setLive] = useState(null);
  const [draft, setDraftState] = useState(null); // finished draft awaiting accept
  const [mode, setMode] = useState('detailed');
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
      try { setLive((c) => ({ ...c, error: JSON.parse(e.data).message })); } catch { setLive((c) => ({ ...c, error: 'generation could not start — a previous run may still be finishing; wait a few seconds and press Synthesize again' })); }
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
  const pages = [...new Set([...(notebook.pages ?? []), ...blocks.map((b) => b.page ?? 'Notes')])];
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
            <NewPage onCreate={async (name) => {
              await fetch(`/api/notebooks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pages: [...new Set([...pages, name])] }) });
              setView('write'); setActivePage(name); load();
            }} />
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
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.6, marginBottom: 6 }}>ON THIS PAGE</div>
            {docBlocks.slice(0, 30).map((b, i) => (
              <button key={b._id} data-outline={b._id} onClick={() => document.getElementById(`blk-${b._id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: C.sub, fontSize: 11.5, padding: '2.5px 6px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', borderRadius: 6 }}>
                {{ handboard: '✍️', drawing: '✏️', image: '🖼', pdf: '📄', moment: '▶', voice: '🎙' }[b.type] ?? '·'} {(b.title ?? b.content ?? b.type).replace(/^✨\s*/, '').slice(0, 30)}
              </button>
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
                <div key={b._id} id={`blk-${b._id}`}
                  style={{ position: 'relative', opacity: dragBlk?.id === b._id ? 0.55 : 1, transform: dragBlk?.id === b._id ? `translateY(${dragBlk.dy}px)` : undefined, zIndex: dragBlk?.id === b._id ? 20 : undefined }}>
                <span data-drag-handle={b._id} title="drag to reorder"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    setDragBlk({ id: b._id, y0: e.clientY, dy: 0 });
                  }}
                  onPointerMove={(e) => setDragBlk((d) => (d && d.id === b._id ? { ...d, dy: e.clientY - d.y0 } : d))}
                  onPointerUp={async (e) => {
                    const d = dragBlk;
                    setDragBlk(null);
                    if (!d || Math.abs(d.dy) < 14) return;
                    const slots = docBlocks.map((x) => {
                      const el = document.getElementById(`blk-${x._id}`);
                      const r = el.getBoundingClientRect();
                      return { id: x._id, mid: r.top + r.height / 2 };
                    });
                    const from = slots.findIndex((x) => x.id === b._id);
                    const to = slots.filter((x) => x.id !== b._id).filter((x) => x.mid < e.clientY).length;
                    if (to === from) return;
                    const order = docBlocks.map((x) => x._id).filter((x) => x !== b._id);
                    order.splice(to, 0, b._id);
                    await Promise.all(order.map((bid, idx) => {
                      const cur = docBlocks.find((x) => x._id === bid);
                      if (cur.seq === idx) return null;
                      return fetch(`/api/notebooks/${id}/blocks/${bid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: idx }) });
                    }).filter(Boolean));
                    load();
                  }}
                  style={{ position: 'absolute', left: -20, top: 12, cursor: dragBlk?.id === b._id ? 'grabbing' : 'grab', color: '#C9BDA1', fontSize: 14, touchAction: 'none', userSelect: 'none', padding: '2px 4px', zIndex: 6 }}>⠿</span>
                <DocBlock nb={id} b={b} pages={pages} selected={selected === b._id} legacyIll={legacyIll}
                  onSelect={() => setSelected(selected === b._id ? null : b._id)}
                  onChanged={load} onNavigate={onNavigate} />
                </div>
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
