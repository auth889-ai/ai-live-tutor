'use client';

// Society Audit Trail — the LangGraph review loop's real debate on THIS scene, made visible:
// proposal -> critic objections (with evidence) -> Arbiter's binding verdict -> repair. Track 3
// scores exactly this ("how agents resolve disagreements and conflicts"); the society already
// does it, this is where a judge SEES it. Real data from scene.transcript (the honesty edge —
// no faked headline). Collapsed by default so it never intrudes on learning; one click to reveal.
//
// Dual output (the Aegis idea): the short `body` per row is the audience-legible line; expanding a
// row shows the evidence refs + the full verdict decision (the audit detail).

import { useState } from 'react';

import { roleOf, refLabel, summarizeTranscript } from '../../../lib/board/audit/audit-trail.js';

const KIND_STYLE = {
  proposal: { border: '#e8d5bb', tint: '#fdf9f3', ink: '#6a5a3a' },
  objection: { border: '#e5c07b', tint: '#fef8e7', ink: '#8a6d12' },
  evidence: { border: '#e8d5bb', tint: '#fdf9f3', ink: '#6a5a3a' },
  revision: { border: '#a9cdea', tint: '#eef6fc', ink: '#2d5f9e' },
  verdict: { border: '#7dcf9a', tint: '#eafaf0', ink: '#1e6b3c' },
  handoff: { border: '#e8d5bb', tint: '#fdf9f3', ink: '#6a5a3a' },
};

export function AuditTrailView({ transcript }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);

  // Never render a fake empty debate — the strip only appears when the society actually worked.
  const summary = summarizeTranscript(transcript);
  if (!summary) return null;

  const { objections, revisions, hasVerdict } = summary;

  return (
    <div style={{ maxWidth: 760, margin: '10px auto 0', border: '1px solid #ecdcc9', borderRadius: 12, background: 'rgba(255,252,249,.9)', overflow: 'hidden' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 16px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontSize: 14 }}
      >
        <span style={{ fontWeight: 750, color: '#5a4a2a' }}>🏛 The Society's Work</span>
        <span style={{ color: '#8a6d3b', fontSize: 12.5 }}>
          {transcript.length} steps
          {objections ? ` · ${objections} objection${objections > 1 ? 's' : ''}` : ''}
          {revisions ? ` · ${revisions} repair${revisions > 1 ? 's' : ''}` : ''}
        </span>
        <span style={{ marginLeft: 'auto', color: '#1e6b3c', fontWeight: 700, fontSize: 12.5 }}>verified ✓</span>
        <span style={{ color: '#b79a6f', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '4px 12px 12px', display: 'grid', gap: 6 }}>
          {transcript.map((m, i) => {
            const role = roleOf(m.fromRole);
            const s = KIND_STYLE[m.kind] ?? KIND_STYLE.proposal;
            const refs = (m.evidenceRefs ?? []).map(refLabel).filter(Boolean);
            const hasDetail = refs.length > 0 || m.verdict;
            const isOpen = expanded === i;
            return (
              <div key={`${m.id ?? 'msg'}-${i}`} style={{ border: `1.5px solid ${s.border}`, background: s.tint, borderRadius: 9, padding: '9px 12px' }}>
                <div
                  onClick={() => hasDetail && setExpanded(isOpen ? null : i)}
                  style={{ display: 'flex', alignItems: 'baseline', gap: 8, cursor: hasDetail ? 'pointer' : 'default' }}
                >
                  <span style={{ fontSize: 14 }}>{role.icon}</span>
                  <span style={{ fontWeight: 700, color: s.ink, fontSize: 13.5, whiteSpace: 'nowrap' }}>{role.label}</span>
                  <span style={{ color: '#4a3f2e', fontSize: 14, lineHeight: 1.5 }}>
                    {m.kind === 'verdict' ? <strong>{m.body}</strong> : m.body}
                  </span>
                  {hasDetail && <span style={{ marginLeft: 'auto', color: s.ink, fontSize: 11, opacity: 0.7 }}>{isOpen ? '−' : '＋'}</span>}
                </div>
                {isOpen && hasDetail && (
                  <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px dashed ${s.border}`, fontSize: 12.5, color: s.ink, lineHeight: 1.6 }}>
                    {refs.length > 0 && <div><strong>Evidence:</strong> {refs.join(' · ')}</div>}
                    {m.verdict && (
                      <div><strong>Ruling:</strong> {m.verdict.decision}{m.verdict.binding ? ' (binding)' : ''}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize: 12, color: '#1e6b3c', textAlign: 'center', marginTop: 2 }}>
            ✓ Scene verified — every fact grounded to the source, taught to the subject's rules{hasVerdict ? ', conflicts resolved by the Arbiter' : ''}.
          </div>
        </div>
      )}
    </div>
  );
}
