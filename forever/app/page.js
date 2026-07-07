// Home = the signed-in dashboard (mockup: My Courses / Continue Learning), or a landing
// hero for visitors. Lessons are read owner-scoped in the data layer — this page can only
// ever show YOUR courses.

import { cookies } from 'next/headers';

import { listLessons } from '../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../lib/auth/session.js';

const UI = {
  text: '#3a2e22', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff',
  accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf6ee',
};
const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  const lessons = session ? await listLessons({ forUser: session.userId }) : [];

  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px', color: UI.text }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 }}>F</span>
        <span style={{ fontWeight: 800, fontSize: 20 }}>Forever <span style={{ fontWeight: 500, fontSize: 13, color: UI.muted }}>AI Tutor</span></span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          {session ? (
            <a href="/studio" style={btn(true)}>+ New course</a>
          ) : (
            <a href="/login" style={btn(true)}>Sign in</a>
          )}
        </span>
      </header>

      {!session ? (
        <section style={{ textAlign: 'center', padding: '70px 0' }}>
          <h1 style={{ fontSize: 40, margin: 0 }}>
            Everything you need to <span style={{ color: UI.accent }}>learn effectively</span>
            <br />from any source
          </h1>
          <p style={{ color: UI.muted, fontSize: 17, maxWidth: 560, margin: '18px auto 28px' }}>
            Upload a PDF, paste text, or drop a link — an agent society of AI teachers turns it into
            a narrated, interactive course with a live board, real code runs, and quizzes.
          </p>
          <a href="/login" style={{ ...btn(true), fontSize: 16, padding: '12px 28px' }}>Get started</a>
        </section>
      ) : (
        <>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>My Courses</h1>
          <p style={{ color: UI.muted, marginTop: 0, marginBottom: 20 }}>
            {lessons.length ? 'Keep learning — pick up where you left off.' : 'No courses yet. Create your first one from any material.'}
          </p>

          {lessons.length === 0 ? (
            <a href="/studio" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 16, padding: '48px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>＋</div>
              <div style={{ fontWeight: 700, color: UI.text }}>Generate your first course</div>
              <div style={{ fontSize: 13 }}>PDF · text · URL · image</div>
            </a>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
              {lessons.map((lesson) => (
                <a key={lesson.id} href={`/course/${lesson.id}`}
                  style={{ border: `1px solid ${UI.border}`, borderRadius: 16, padding: 18, background: UI.card, textDecoration: 'none', color: UI.text }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: UI.bgSoft, display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 12 }}>🎓</div>
                  <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, marginBottom: 6 }}>{lesson.title}</div>
                  <div style={{ fontSize: 12, color: UI.muted }}>
                    {lesson.scenes} scenes · {fmt(lesson.durationMs)}{lesson.voiced ? ' · 🔊 voiced' : ''}
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function btn(primary) {
  return {
    padding: '9px 18px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 14,
    background: primary ? UI.accent : '#fff', color: primary ? '#fff' : UI.text,
    border: primary ? 'none' : `1px solid ${UI.border}`,
  };
}
