// /courses/:id — the course syllabus (Udemy anatomy): episodes as sections, lesson rows
// with type icon + duration + play-or-generate. Owner-scoped like everything else.

import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import { loadCourse } from '../../../lib/storage/course-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../../lib/auth/session.js';
import { DashboardSidebar } from '../../../components/dashboard/sidebar.js';
import { GenerateLessonButton } from '../../../components/dashboard/generate-lesson-button.js';

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff', accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf1ea' };

const TYPE_ICONS = { concept: '💡', build: '🛠', see_it: '🎬', pitfalls: '⚠️', practice: '✍️', recap: '🔁' };

export default async function CourseSyllabusPage({ params }) {
  const { id } = await params;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (!session) redirect('/login');

  const course = await loadCourse(id, { forUser: session.userId });
  if (!course) notFound();

  const { outline, lessonLinks = {}, lessonJobs = {} } = course;
  const allLessons = outline.episodes.flatMap((episode) => episode.lessons);
  const readyCount = allLessons.filter((lesson) => lessonLinks[lesson.id]?.lessonId).length;
  const pct = Math.round((readyCount / allLessons.length) * 100);

  return (
    <div style={{ display: 'flex', gap: 18, maxWidth: 1280, margin: '0 auto', padding: 16, alignItems: 'flex-start', color: UI.text }}>
      <DashboardSidebar email={session.email} active="courses" />

      <main style={{ flex: 1, minWidth: 0, maxWidth: 900 }}>
        <a href="/courses" style={{ color: UI.muted, fontSize: 13, textDecoration: 'none' }}>← All courses</a>
        <header style={{ margin: '10px 0 18px' }}>
          <h1 style={{ fontSize: 27, margin: 0, letterSpacing: -0.4 }}>{outline.title}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <div style={{ flex: 1, maxWidth: 320, height: 8, borderRadius: 4, background: '#f3e3d5' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: UI.accent }} />
            </div>
            <span style={{ fontSize: 13, color: UI.muted, fontWeight: 700 }}>
              {readyCount}/{allLessons.length} lessons generated · {pct}%
            </span>
          </div>
        </header>

        {outline.episodes.map((episode, epIndex) => (
          <section key={episode.id} style={{ background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 18, marginBottom: 14, overflow: 'hidden', boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
            <div style={{ padding: '14px 18px', background: UI.bgSoft, display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontWeight: 800, fontSize: 15.5 }}>Episode {epIndex + 1} · {episode.title}</span>
              <span style={{ fontSize: 12, color: UI.muted, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                ~{episode.estimatedMinutes} min · quiz of {episode.quizQuestionCount}
              </span>
            </div>
            {episode.lessons.map((lesson, index) => {
              const link = lessonLinks[lesson.id];
              return (
                <div key={lesson.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderTop: `1px solid ${UI.border}` }}>
                  <span style={{ width: 30, height: 30, borderRadius: 9, background: link ? '#e9f4ec' : UI.bgSoft, display: 'grid', placeItems: 'center', fontSize: 14, flexShrink: 0 }}>
                    {link ? '✓' : TYPE_ICONS[lesson.lessonType] ?? '📘'}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 700, fontSize: 14.5, lineHeight: 1.3 }}>
                      {epIndex + 1}.{index + 1} {lesson.title}
                    </span>
                    <span style={{ fontSize: 12, color: UI.muted }}>
                      {lesson.lessonType.replace('_', ' ')} · ~{lesson.estimatedMinutes} min{lesson.objective ? ` — ${lesson.objective}` : ''}
                    </span>
                  </span>
                  {link ? (
                    <a href={`/course/${link.lessonId}`} style={{ background: UI.accent, color: '#fff', borderRadius: 999, padding: '7px 18px', fontSize: 12.5, fontWeight: 800, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      ▶ Play
                    </a>
                  ) : (
                    <GenerateLessonButton courseId={id} outlineLessonId={lesson.id} initialJobId={lessonJobs[lesson.id]?.jobId ?? null} />
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </main>
    </div>
  );
}
