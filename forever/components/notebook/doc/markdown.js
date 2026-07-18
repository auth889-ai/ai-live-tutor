'use client';

// DOC MARKDOWN — Inline spans ([[wiki]], [n] cites, bold, code) + the Doc renderer.

import { C } from '../theme.js';

// marker palette (the reference-board look): a key term keeps ONE color everywhere —
// deterministic hash, so "vertices" is always orange-ish, "edges" always blue, across notes
const MARKS = ['#FDE68A88', '#FBD38D88', '#BFDBFE88', '#DDD6FE88', '#BBF7D088', '#FBCFE888'];
export function markColor(term) {
  let h = 0;
  const t = String(term).trim().toLowerCase();
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return MARKS[h % MARKS.length];
}

export function Inline({ text, onNavigate }) {
  const parts = [];
  let rest = String(text ?? '');
  let k = 0;
  const RES = [
    { re: /\[\[([^\]]+)\]\]/, r: (m) => <button key={k += 1} onClick={() => onNavigate?.(m[1].trim())} style={{ border: 'none', background: '#EDF3FB', color: C.extracted, borderRadius: 6, padding: '0 5px', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>{m[1].trim()}</button> },
    { re: /\[(\d+)\]/, r: (m) => <sup key={k += 1} style={{ background: '#EDF3FB', color: C.extracted, borderRadius: 5, padding: '0 4px', fontSize: 10, fontWeight: 800, marginLeft: 1 }}>{m[1]}</sup> },
    { re: /\*\*([^*]+)\*\*/, r: (m) => <b key={k += 1} style={{ background: markColor(m[1]), borderRadius: 4, padding: '0 4px' }}>{m[1]}</b> },
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
