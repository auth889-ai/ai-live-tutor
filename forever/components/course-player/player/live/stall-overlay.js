'use client';

// Stall overlay (one job): shown when playback catches up with the society mid-build.
// The pause was ours, so the message says so — and the resume is automatic.

const V = (name) => `var(${name})`;

export function StallOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
      background: 'rgba(27,16,13,.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
    }}>
      <div style={{
        background: 'rgba(255,250,246,.96)', borderRadius: 16, padding: '18px 26px', textAlign: 'center',
        boxShadow: '0 14px 40px rgba(27,16,13,.35)', maxWidth: 420,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 10 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="forever-dot" style={{ width: 9, height: 9, borderRadius: '50%', background: V('--coral'), animationDelay: `${i * 200}ms` }} />
          ))}
        </div>
        <div style={{ fontWeight: 800, fontSize: 15.5, color: V('--ink') }}>✍️ The society is writing the next scene…</div>
        <div style={{ fontSize: 12.5, color: V('--ink-muted'), marginTop: 5 }}>
          You watched faster than it writes — playback resumes automatically.
        </div>
      </div>
    </div>
  );
}
