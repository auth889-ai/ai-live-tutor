'use client';

// NOTEBOOK WORKSPACE — the redesign (user spec, 2026-07-19): a DOCUMENT, not a feed.
//   ┌ topbar: title · counts · Synthesize ─────────────────────────────┐
//   │ PAGES+SOURCES │  the document (white, max 820px)  │ CONTEXT panel │
//   └ compact composer fixed under the document ────────────────────────┘
// Laws carried over: provenance never lies (but whispers — tiny, on hover);
// AI output is a DRAFT until the student accepts it; illustrations live INSIDE
// their sections; the journal is a view, not the notebook.

import { useEffect, useRef, useState } from 'react';

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
  const lines = String(text ?? '').split('\n');
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
      out.push(<div key={i} style={{ clear: 'both', fontSize: 19, fontWeight: 650, color: C.ink, margin: '18px 0 6px' }}><Inline text={t} onNavigate={onNavigate} /></div>);
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
      out.push(<p key={i} style={{ margin: '0 0 10px', fontSize: 15.5, lineHeight: 1.7, color: C.ink, whiteSpace: 'pre-wrap' }}><Inline text={ln} onNavigate={onNavigate} /></p>);
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
  const docBlocks = blocks.filter((b) => (activePage ? (b.page ?? 'Notes') === activePage : true));
  const sel = blocks.find((b) => b._id === selected) ?? null;

  return (
    <div style={{ background: C.appBg, minHeight: '80vh', borderRadius: 18, border: `1px solid ${C.border}` }}>
      <style>{`
        .nbk-blk .nbk-acts{opacity:0;transition:opacity .15s}
        .nbk-blk:hover .nbk-acts{opacity:1}
        .nbk-blk{border-radius:10px}
        .nbk-blk:hover{background:#FBF8F3}
        .nbk-blk.sel{background:#FBF4EC;outline:1.5px solid #EBD9C4}
      `}</style>

      {/* topbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: `1px solid ${C.border}` }}>
        <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: C.sub, fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{notebook.title}</div>
          <div style={{ fontSize: 11.5, color: C.sub }}>{pages.length} page{pages.length === 1 ? '' : 's'} · {sources.length} source{sources.length === 1 ? '' : 's'} · {blocks.length} blocks</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ border: `1px solid ${C.border}`, borderRadius: 9, background: '#fff', color: C.sub, padding: '6px 9px', fontSize: 12, fontWeight: 700 }}>
            <option value="study_note">study note</option>
            <option value="detailed">deep-dive</option>
            <option value="summary">summary</option>
            <option value="questions">self-test</option>
          </select>
          <button onClick={() => runStream(`mode=${mode}`)} disabled={Boolean(live)}
            style={{ border: 'none', borderRadius: 999, background: live ? '#D8CBB9' : C.accent, color: '#fff', padding: '8px 18px', fontSize: 12.5, fontWeight: 800, cursor: live ? 'default' : 'pointer' }}>
            {live ? 'writing…' : '✨ Synthesize'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '215px minmax(0, 1fr) 300px', gap: 0, alignItems: 'stretch' }}>
        {/* ---------- left: pages + sources ---------- */}
        <div style={{ borderRight: `1px solid ${C.border}`, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.6, marginBottom: 6 }}>PAGES</div>
            <SideItem label="All pages" on={activePage === null && view === 'write'} onClick={() => { setView('write'); setActivePage(null); }} />
            {pages.map((pg) => <SideItem key={pg} label={pg} on={activePage === pg && view === 'write'} onClick={() => { setView('write'); setActivePage(pg); }} />)}
            <NewPage onCreate={(name) => { setView('write'); setActivePage(name); }} />
          </div>
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.6, marginBottom: 6 }}>SOURCES</div>
            {sources.length === 0 ? <div style={{ fontSize: 12, color: C.sub }}>none yet</div>
              : sources.slice(0, 12).map((b) => (
                <SideItem key={b._id} label={`${{ image: '🖼', pdf: '📄', link: '🔗', moment: '▶' }[b.type]} ${(b.title ?? b.origin ?? b.type).slice(0, 24)}`} on={selected === b._id}
                  onClick={() => { setSelected(b._id); }} />
              ))}
          </div>
          <div style={{ marginTop: 'auto' }}>
            <SideItem label="🗓 Journal view" on={view === 'journal'} onClick={() => setView(view === 'journal' ? 'write' : 'journal')} />
          </div>
        </div>

        {/* ---------- center: THE DOCUMENT ---------- */}
        <div style={{ padding: '22px 26px 90px', position: 'relative' }}>
          <div style={{ maxWidth: 820, margin: '0 auto', background: C.surface, borderRadius: 14, border: `1px solid ${C.border}`, padding: '30px 38px 26px', minHeight: 420 }}>
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
                <DocBlock key={b._id} nb={id} b={b} selected={selected === b._id}
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
          onAsk={(q) => runStream(`mode=ask&question=${encodeURIComponent(q)}`, { asDraft: false })} />
      </div>
    </div>
  );
}

function SideItem({ label, on, onClick }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 8, background: on ? '#F1E9DE' : 'transparent', color: on ? C.ink : C.sub, padding: '6px 9px', fontSize: 12.5, fontWeight: on ? 800 : 600, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</button>
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
function DocBlock({ nb, b, selected, onSelect, onChanged, onNavigate }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showExtract, setShowExtract] = useState(false);
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
      {b.title ? <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink, marginBottom: 2 }}><Inline text={b.title} onNavigate={onNavigate} /></div> : null}
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
        <Doc text={b.type === 'voice' ? (b.transcript || b.content) : b.content} onNavigate={onNavigate} skipTitle={(b.title ?? '').replace(/^✨\s*/, '')} />
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
  const recRef = useRef(null);

  const post = async (payload) => {
    setBusy(true);
    try {
      await fetch(`/api/notebooks/${id}/blocks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, page }) });
      setV('');
      onAdded();
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
      {menu ? (
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          {[['📄 PDF', () => { kindRef.current = 'pdf'; fileRef.current?.click(); }], ['🖼 Image', () => { kindRef.current = 'image'; fileRef.current?.click(); }], ['🎙 Voice', voice]].map(([label, fn]) => (
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
      <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={onFile} style={{ display: 'none' }} />
    </div>
  );
}

// ---------- right: contextual intelligence ----------
function ContextPanel({ nb, sel, backlinks, onNavigate, onChanged, onExplain, onContinue, onAsk }) {
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
    <div style={{ borderLeft: `1px solid ${C.border}`, padding: '4px 16px 16px', minWidth: 0 }}>
      <div style={{ borderBottom: `1px solid ${C.border}`, marginBottom: 12 }}>{T2('ai', 'AI')}{T2('back', 'Backlinks')}{T2('review', 'Explain back')}</div>

      {tab === 'ai' ? (
        <div>
          {sel ? (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: C.sub, letterSpacing: 0.5 }}>SELECTED</div>
              <div style={{ fontSize: 13, color: C.ink, margin: '4px 0 8px', fontStyle: 'italic' }}>“{(sel.title || sel.content || sel.transcript || '').slice(0, 90)}”</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <CtxBtn onClick={() => onExplain(sel._id)}>🔍 Explain in detail (draft)</CtxBtn>
                {sel.trust === 'user' && ['note', 'text'].includes(sel.type) ? <CtxBtn onClick={() => onContinue(sel._id)}>✍️ Continue my writing</CtxBtn> : null}
                <CtxBtn onClick={() => setTab('review')}>🎓 Explain it back</CtxBtn>
              </div>
            </div>
          ) : <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 12 }}>Select a block to act on it — or ask the whole notebook:</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) { onAsk(q.trim()); setQ(''); } }}
              placeholder="Ask your notebook…" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.border}`, borderRadius: 10, padding: '7px 10px', fontSize: 12.5 }} />
            <button onClick={() => { if (q.trim()) { onAsk(q.trim()); setQ(''); } }} style={{ border: 'none', borderRadius: 10, background: C.ink, color: '#fff', padding: '0 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>Ask</button>
          </div>
          <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>answers come only from your blocks, cited</div>
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
  );
}

function CtxBtn({ onClick, children }) {
  return <button onClick={onClick} style={{ textAlign: 'left', border: `1px solid ${C.border}`, borderRadius: 10, background: '#fff', color: C.ink, padding: '8px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>{children}</button>;
}
