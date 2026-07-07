// /dashboard — the signed-in home (sidebar shell): welcome, continue learning, courses.
// Auth-gated: no session -> /login. The public cover page lives at / — separate routes,
// separate jobs.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { listLessons } from '../../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { CourseGrid, fmtDuration } from '../../components/dashboard/course-grid.js';

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff', accent: '#f47368', bgSoft: '#fdf6ee' };

export default async function DashboardPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');

  const lessons = await listLessons({ forUser: session.userId });
  const firstName = (session.email || '').split('@')[0].split(/[._-]/)[0];
  const latest = lessons[0] ?? null;

  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start', color: UI.text }}>
      <DashboardSidebar email={session.email} active="home" />

      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ margin: '10px 0 22px' }}>
          <h1 style={{ fontSize: 28, margin: 0, textTransform: 'capitalize' }}>Welcome back, {firstName}! 👋</h1>
          <p style={{ color: UI.muted, margin: '6px 0 0' }}>Keep learning and stay consistent. You're doing great!</p>
        </header>

        {latest && (
          <section style={{ background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 18, padding: 20, marginBottom: 18, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 1px 2px rgba(58,46,34,0.05)' }}>
            <div style={{ width: 92, height: 92, borderRadius: 16, background: UI.bgSoft, display: 'grid', placeItems: 'center', fontSize: 38, flexShrink: 0 }}>▶</div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: UI.accent, letterSpacing: 0.5, marginBottom: 4 }}>CONTINUE LEARNING</div>
              <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>{latest.title}</div>
              <div style={{ fontSize: 13, color: UI.muted, marginTop: 4 }}>{latest.scenes} scenes · {fmtDuration(latest.durationMs)}{latest.voiced ? ' · 🔊 voiced' : ''}</div>
            </div>
            <a href={`/course/${latest.id}`} style={{ background: UI.accent, color: '#fff', padding: '12px 24px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, whiteSpace: 'nowrap' }}>
              Continue learning ▶
            </a>
          </section>
        )}

        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 19, margin: 0 }}>My Courses</h2>
            <a href="/studio" style={{ color: UI.accent, fontWeight: 700, fontSize: 13.5, textDecoration: 'none' }}>+ New course</a>
          </div>
          <CourseGrid lessons={lessons} />
        </section>
      </main>
    </div>
  );
}
