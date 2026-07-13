'use client';

// Pending-scene display (one job): render the scenes the society is still WRITING —
// visible and honest, never clickable. Two placements, same data: sidebar rows and
// timeline-strip chips.

const V = (name) => `var(${name})`;

function WritingBadge({ label }) {
  return (
    <span style={{ fontSize: 11, color: V('--ink-muted'), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span className="forever-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: V('--coral') }} />
      {label}
    </span>
  );
}

export function PendingSceneRows({ pending, startNumber }) {
  return pending.map((brief, k) => (
    <div key={`pending-${k}`} style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
      padding: '10px 10px 10px 13px', marginBottom: 6, borderRadius: 12,
      border: `1px dashed ${V('--border')}`, background: 'rgba(255,253,251,.6)', opacity: 0.75,
    }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
        fontSize: 11.5, fontWeight: 700, background: V('--surface-sunken'), color: V('--ink-muted'),
      }}>
        {startNumber + k}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: V('--ink-muted') }}>{brief.title}</span>
        <WritingBadge label={`writing${brief.pedagogicalRole ? ` · ${brief.pedagogicalRole.replace(/_/g, ' ')}` : '…'}`} />
      </span>
    </div>
  ));
}

export function PendingSceneChips({ pending, startNumber }) {
  return pending.map((brief, k) => (
    <div key={`pending-strip-${k}`} style={{
      flexShrink: 0, width: 192, textAlign: 'left', padding: '10px 13px', borderRadius: 12,
      border: `1px dashed ${V('--border')}`, background: 'rgba(255,253,251,.55)', opacity: 0.7,
    }}>
      <div style={{ fontSize: 12, fontWeight: 650, marginBottom: 3, color: V('--ink-muted'), lineHeight: 1.3 }}>
        {startNumber + k}. {brief.title}
      </div>
      <WritingBadge label="writing…" />
    </div>
  ));
}
