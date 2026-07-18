'use client';

// RAILS — left-rail items: SideItem, PagePager, NewPage.

import { useState } from 'react';

import { C } from '../theme.js';

export function SideItem({ label, on, onClick, num = null, icon = null, iconBg = null, thumb = null }) {
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
export function PagePager({ pages, active, onPick }) {
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

export function NewPage({ onCreate }) {
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
