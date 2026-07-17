// /dashboard — the signed-in home (sidebar shell): welcome banner, continue learning,
// courses. Auth-gated: no session -> /login. Pandio palette: pale warm white page, white
// cards, thin peach borders, coral accent, pastel chips.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { listLessons } from '../../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../../lib/auth/session.js';
import { ContinueCard } from '../../components/dashboard/continue-card.js';
import { DashboardSidebar } from '../../components/dashboard/sidebar.js';
import { CourseGrid, fmtDuration } from '../../components/dashboard/course-grid.js';

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff', accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf1ea' };

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
        <ContinueCard />
        {/* welcome banner */}
        <section style={{
          display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18, borderRadius: 20, overflow: 'hidden',
          background: 'linear-gradient(115deg, #fff 40%, #fdece8)', border: `1px solid ${UI.border}`, boxShadow: '0 2px 10px rgba(58,46,34,0.06)',
        }}>
          <div style={{ padding: '26px 0 26px 26px', flex: 1, minWidth: 240 }}>
            <h1 style={{ fontSize: 27, margin: 0, textTransform: 'capitalize', letterSpacing: -0.4 }}>Welcome back, {firstName}! 👋</h1>
            <p style={{ color: UI.muted, margin: '8px 0 14px', fontSize: 14.5 }}>Keep learning and stay consistent. You're doing great!</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={pill('#fdece8', UI.accentDark)}>🎓 {lessons.length} course{lessons.length === 1 ? '' : 's'}</span>
              <span style={pill('#fef3e2', '#a06b1f')}>⏱ {fmtDuration(lessons.reduce((n, l) => n + l.durationMs, 0))} of lessons</span>
              <span style={pill('#e9f4ec', '#2f7d4a')}>🔊 {lessons.filter((l) => l.voiced).length} voiced</span>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/study-29.png" alt="A learner studying at a bookshelf desk"
            style={{ width: 220, height: 170, objectFit: 'cover', alignSelf: 'stretch', flexShrink: 0 }} />
        </section>

        {latest && (
          <section style={{ background: UI.card, border: `1px solid ${UI.border}`, borderRadius: 20, padding: 18, marginBottom: 18, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
            <div style={{ position: 'relative', width: 148, height: 96, borderRadius: 14, overflow: 'hidden', flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/study-31.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(20,12,6,0.32)' }}>
                <span style={{ width: 40, height: 40, borderRadius: '50%', background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 16, boxShadow: '0 6px 16px rgba(0,0,0,0.3)' }}>▶</span>
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: UI.accent, letterSpacing: 0.8, marginBottom: 5 }}>CONTINUE LEARNING</div>
              <div style={{ fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>{latest.title}</div>
              <div style={{ fontSize: 13, color: UI.muted, marginTop: 5 }}>🎬 {latest.scenes} scenes · ⏱ {fmtDuration(latest.durationMs)}{latest.voiced ? ' · 🔊 voiced' : ''}</div>
            </div>
            <a className="forever-glow" href={`/course/${latest.id}`} style={{ background: UI.accent, color: '#fff', padding: '13px 26px', borderRadius: 12, textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap', boxShadow: '0 8px 20px rgba(244,115,104,0.35)' }}>
              Continue learning ▶
            </a>
          </section>
        )}

        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 20, margin: 0, letterSpacing: -0.3 }}>My Courses</h2>
            <a href="/studio" style={{ color: UI.accent, fontWeight: 800, fontSize: 13.5, textDecoration: 'none' }}>+ New course</a>
          </div>
          <CourseGrid lessons={lessons} />
        </section>
      </main>
    </div>
  );
}

function pill(bg, color) {
  return { background: bg, color, borderRadius: 999, padding: '6px 14px', fontSize: 12.5, fontWeight: 700 };
}
