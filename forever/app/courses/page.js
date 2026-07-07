// /courses — the full course library (sidebar shell). Auth-gated like /dashboard.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { listLessons } from '../../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { CourseGrid } from '../../components/dashboard/course-grid.js';

const UI = { text: '#2b211a', muted: '#8a6d3b', accent: '#f47368' };

export default async function CoursesPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');

  const lessons = await listLessons({ forUser: session.userId });

  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start', color: UI.text }}>
      <DashboardSidebar email={session.email} active="courses" />
      <main style={{ flex: 1, minWidth: 0 }}>
        <header style={{ margin: '10px 0 22px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 28, margin: 0 }}>My Courses</h1>
            <p style={{ color: UI.muted, margin: '6px 0 0' }}>{lessons.length} course{lessons.length === 1 ? '' : 's'} in your library.</p>
          </div>
          <a href="/studio" style={{ color: UI.accent, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>+ New course</a>
        </header>
        <CourseGrid lessons={lessons} />
      </main>
    </div>
  );
}
