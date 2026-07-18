'use client';

// LIVE + DRAFT — the SSE status theater and the draft-until-accept panel.

import { C } from '../theme.js';
import { Doc } from '../doc/markdown.js';

export function LivePanel({ live }) {
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

export function DraftPanel({ draft, onAccept, onDiscard }) {
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

export function Journal({ blocks }) {
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
