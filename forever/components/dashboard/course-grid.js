// Course cards grid — shared by /dashboard and /courses (one definition, no drift).
// Pure presentation; pages supply the owner-scoped lesson cards. Pandio palette: pale warm
// white page, white cards, thin peach borders, coral accent. Each card gets a study-photo
// cover (deterministic by index) — image headers are what make a library feel premium.

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff', accent: '#f47368', bgSoft: '#fdf1ea' };

const COVERS = ['/images/study-29.png', '/images/study-30.png', '/images/study-31.png', '/images/study-32.png', '/images/study-33.png'];

export const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function CourseGrid({ lessons }) {
  if (lessons.length === 0) {
    return (
      <a href="/studio" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 18, padding: '48px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft }}>
        <div style={{ fontSize: 34, marginBottom: 8 }}>＋</div>
        <div style={{ fontWeight: 700, color: UI.text }}>Generate your first course</div>
        <div style={{ fontSize: 13 }}>PDF · text · URL · image</div>
      </a>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
      {lessons.map((lesson, index) => (
        <a key={lesson.id} href={`/course/${lesson.id}`}
          style={{ border: `1px solid ${UI.border}`, borderRadius: 18, overflow: 'hidden', background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
          <div style={{ position: 'relative', height: 116, overflow: 'hidden' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lesson.coverImage || COVERS[index % COVERS.length]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(255,255,255,0.92)', borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 800, color: UI.accent }}>
              {lesson.voiced ? '🔊 VOICED' : 'COURSE'}
            </span>
          </div>
          <div style={{ padding: '14px 16px 16px' }}>
            <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.35, marginBottom: 8, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{lesson.title}</div>
            <div style={{ fontSize: 12.5, color: UI.muted, display: 'flex', gap: 10 }}>
              <span>🎬 {lesson.scenes} scenes</span>
              <span>⏱ {fmtDuration(lesson.durationMs)}</span>
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}
