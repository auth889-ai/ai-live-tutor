// Home route. Landing page linking to the real entry points so http://localhost:3000
// loads (the missing '/' was the "Failed to Load Page"). Grows into the dashboard
// (My Courses / Continue Learning / streak) from the mockups in Phase 5.

import { listLessonIds } from '../lib/storage/lesson-store.js';

export default async function HomePage() {
  const lessons = await listLessonIds();

  const card = {
    display: 'block',
    padding: '16px 20px',
    borderRadius: 12,
    border: '1px solid #e8ddc9',
    background: '#fff',
    textDecoration: 'none',
    color: 'inherit',
    marginBottom: 12,
  };

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 32, marginBottom: 4 }}>Forever</h1>
      <p style={{ color: '#8a6d3b', marginTop: 0 }}>
        AI tutor course platform — paste any material, get a human-style course lesson.
      </p>

      <div style={{ marginTop: 28 }}>
        <a href="/studio" style={card}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>🎬 Studio</div>
          <div style={{ color: '#8a6d3b', fontSize: 14 }}>Paste learning material and generate a lesson.</div>
        </a>
        <a href="/dev/lesson" style={card}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>▶ Demo lesson</div>
          <div style={{ color: '#8a6d3b', fontSize: 14 }}>Watch a pre-generated multi-scene lesson play.</div>
        </a>
      </div>

      <h2 style={{ fontSize: 18, marginTop: 32 }}>Saved lessons</h2>
      {lessons.length === 0 ? (
        <p style={{ color: '#8a6d3b', fontSize: 14 }}>None yet — generate one in the Studio.</p>
      ) : (
        <ul>
          {lessons.map((id) => (
            <li key={id}>
              <a href={`/course/${id}`}>{id}</a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
