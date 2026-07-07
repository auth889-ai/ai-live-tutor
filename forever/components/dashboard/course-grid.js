// Course cards grid — shared by /dashboard and /courses (one definition, no drift).
// Pure presentation; pages supply the owner-scoped lesson cards.

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff', bgSoft: '#fdf6ee' };

export const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function CourseGrid({ lessons }) {
  if (lessons.length === 0) {
    return (
      <a href="/studio" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 16, padding: '48px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>＋</div>
        <div style={{ fontWeight: 700, color: UI.text }}>Generate your first course</div>
        <div style={{ fontSize: 13 }}>PDF · text · URL · image</div>
      </a>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
      {lessons.map((lesson) => (
        <a key={lesson.id} href={`/course/${lesson.id}`}
          style={{ border: `1px solid ${UI.border}`, borderRadius: 16, padding: 18, background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 1px 2px rgba(58,46,34,0.05)' }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: UI.bgSoft, display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 12 }}>🎓</div>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, marginBottom: 6 }}>{lesson.title}</div>
          <div style={{ fontSize: 12, color: UI.muted }}>
            {lesson.scenes} scenes · {fmtDuration(lesson.durationMs)}{lesson.voiced ? ' · 🔊 voiced' : ''}
          </div>
        </a>
      ))}
    </div>
  );
}
