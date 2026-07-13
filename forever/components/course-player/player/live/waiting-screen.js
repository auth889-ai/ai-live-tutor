'use client';

// Waiting screen (one job): what the student sees between "the plan exists" and "the first
// scene is watchable" — the lesson's chapter cards assembling, never a blank spinner.

const V = (name) => `var(${name})`;

export function WaitingScreen({ lesson }) {
  const planned = lesson.plannedScenes ?? [];
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 20px', color: V('--ink-body'), fontFamily: 'var(--font-inter), system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 7, marginBottom: 16 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="forever-dot" style={{ width: 10, height: 10, borderRadius: '50%', background: V('--coral'), animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
        <h1 style={{ fontFamily: 'var(--font-fraunces), Georgia, serif', fontSize: 26, margin: 0, letterSpacing: '-0.02em', color: V('--ink') }}>
          {lesson.lessonTitle}
        </h1>
        <p style={{ fontSize: 14, color: V('--ink-muted'), marginTop: 8 }}>
          {planned.length > 0
            ? `The agent society is writing scene 1 of ${planned.length} — playback starts the moment it's ready.`
            : 'The agent society is designing your teaching sequence…'}
        </p>
      </div>

      {planned.map((brief, index) => (
        <div key={index} className="forever-row" style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', marginBottom: 8,
          background: '#FFFDFB', border: `1px solid ${V('--border')}`, borderRadius: 14,
          animationDelay: `${index * 90}ms`,
        }}>
          <span style={{
            width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
            fontSize: 12, fontWeight: 700, background: index === 0 ? V('--coral') : V('--surface-sunken'),
            color: index === 0 ? '#fff' : V('--ink-muted'),
          }}>
            {index + 1}
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 650, color: V('--ink'), lineHeight: 1.3 }}>{brief.title}</span>
            {brief.pedagogicalRole && (
              <span style={{ fontSize: 11.5, color: V('--ink-muted') }}>{brief.pedagogicalRole.replace(/_/g, ' ')}</span>
            )}
          </span>
          {index === 0 && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: '#a06b1f', background: '#fef3e2', borderRadius: 999, padding: '3px 11px', whiteSpace: 'nowrap' }}>
              writing now
            </span>
          )}
        </div>
      ))}
    </main>
  );
}
