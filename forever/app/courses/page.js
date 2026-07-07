// /courses — the full course library (sidebar shell). Auth-gated like /dashboard.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { listLessons } from '../../lib/storage/lesson-store.js';
import { listCourses } from '../../lib/storage/course-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { CourseGrid } from '../../components/dashboard/course-grid.js';

const UI = { text: '#2b211a', muted: '#8a6d3b', accent: '#f47368' };

export default async function CoursesPage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');

  const [lessons, courses] = await Promise.all([
    listLessons({ forUser: session.userId }),
    listCourses({ forUser: session.userId }),
  ]);
  const linked = new Set(); // hide lessons that belong to a course card

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
        {courses.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {courses.map((course, index) => (
                <a key={course.id} href={`/courses/${course.id}`}
                  style={{ border: '1px solid #f5e6d9', borderRadius: 18, overflow: 'hidden', background: '#fff', textDecoration: 'none', color: '#2b211a', boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
                  <div style={{ position: 'relative' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={course.coverImage || ['/images/study-30.png', '/images/study-32.png', '/images/study-26.png'][index % 3]} alt=""
                      style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
                    <span className="forever-glow" style={{ position: 'absolute', top: 10, left: 10, background: '#f47368', color: '#fff', borderRadius: 999, padding: '5px 13px', fontSize: 11, fontWeight: 800, letterSpacing: 0.6 }}>
                      📚 FULL COURSE
                    </span>
                  </div>
                  <div style={{ padding: 18, background: 'linear-gradient(115deg, #fff 55%, #fdf1ea)' }}>
                  <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.35, marginBottom: 8 }}>{course.title}</div>
                  <div style={{ fontSize: 12.5, color: '#8a6d3b' }}>{course.episodes} episode{course.episodes === 1 ? '' : 's'} · {course.ready}/{course.lessons} lessons ready</div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
        <CourseGrid lessons={lessons} />
      </main>
    </div>
  );
}
