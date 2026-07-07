// Home = the signed-in dashboard (mockup: My Courses / Continue Learning), or a landing
// hero for visitors. Lessons are read owner-scoped in the data layer — this page can only
// ever show YOUR courses.

import { cookies } from 'next/headers';

import { listLessons } from '../lib/storage/lesson-store.js';
import { SESSION_COOKIE, verifySessionToken } from '../lib/auth/session.js';
import { DashboardSidebar } from '../components/dashboard/sidebar.js';

const UI = {
  text: '#3a2e22', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff',
  accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf6ee',
};
const fmt = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  const lessons = session ? await listLessons({ forUser: session.userId }) : [];

  // Visitors get the cover page; signed-in users get the sidebar dashboard (mockup layout).
  if (!session) {
    return (
      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 20px', color: UI.text }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 30 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 }}>F</span>
          <span style={{ fontWeight: 800, fontSize: 20 }}>Forever <span style={{ fontWeight: 500, fontSize: 13, color: UI.muted }}>AI Tutor</span></span>
          <span style={{ marginLeft: 'auto' }}><a href="/login" style={btn(true)}>Sign in</a></span>
        </header>
        <Landing />
      </main>
    );
  }

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
              <div style={{ fontSize: 13, color: UI.muted, marginTop: 4 }}>{latest.scenes} scenes · {fmt(latest.durationMs)}{latest.voiced ? ' · 🔊 voiced' : ''}</div>
            </div>
            <a href={`/course/${latest.id}`} style={{ ...btn(true), padding: '12px 24px', whiteSpace: 'nowrap' }}>Continue learning ▶</a>
          </section>
        )}

        <section id="courses">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={{ fontSize: 19, margin: 0 }}>My Courses</h2>
            <a href="/studio" style={{ color: UI.accent, fontWeight: 700, fontSize: 13.5, textDecoration: 'none' }}>+ New course</a>
          </div>

          {lessons.length === 0 ? (
            <a href="/studio" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 16, padding: '48px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>＋</div>
              <div style={{ fontWeight: 700, color: UI.text }}>Generate your first course</div>
              <div style={{ fontSize: 13 }}>PDF · text · URL · image</div>
            </a>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
              {lessons.map((lesson) => (
                <a key={lesson.id} href={`/course/${lesson.id}`}
                  style={{ border: `1px solid ${UI.border}`, borderRadius: 16, padding: 18, background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 1px 2px rgba(58,46,34,0.05)' }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: UI.bgSoft, display: 'grid', placeItems: 'center', fontSize: 20, marginBottom: 12 }}>🎓</div>
                  <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3, marginBottom: 6 }}>{lesson.title}</div>
                  <div style={{ fontSize: 12, color: UI.muted }}>
                    {lesson.scenes} scenes · {fmt(lesson.durationMs)}{lesson.voiced ? ' · 🔊 voiced' : ''}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function btn(primary) {
  return {
    padding: '9px 18px', borderRadius: 10, textDecoration: 'none', fontWeight: 700, fontSize: 14,
    background: primary ? UI.accent : '#fff', color: primary ? '#fff' : UI.text,
    border: primary ? 'none' : `1px solid ${UI.border}`,
  };
}

// The cover page (OpenMAIC-style landing): what Forever is, the scene types, how it works,
// the agent society — everything a visitor (or a judge) needs before signing in.
function Landing() {
  const card = { border: `1px solid ${UI.border}`, borderRadius: 16, padding: 20, background: UI.card, textAlign: 'left' };
  const h2 = { fontSize: 26, margin: '0 0 6px', textAlign: 'center' };
  const sub = { color: UI.muted, textAlign: 'center', marginTop: 0, marginBottom: 26 };
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999,
    border: `1px solid ${UI.border}`, background: '#fff', fontSize: 13, fontWeight: 700,
  };

  return (
    <>
      {/* hero */}
      <section style={{ textAlign: 'center', padding: '56px 0 40px' }}>
        <div style={{ ...chip, background: UI.bgSoft, marginBottom: 18 }}>
          <span style={{ color: UI.accent }}>●</span> Qwen agent society · AGPL-3.0 · Global AI Hackathon Track 3
        </div>
        <h1 style={{ fontSize: 46, lineHeight: 1.15, margin: 0 }}>
          Any material becomes a course
          <br />
          <span style={{ color: UI.accent }}>taught like the best teacher you ever had</span>
        </h1>
        <p style={{ color: UI.muted, fontSize: 17, maxWidth: 640, margin: '18px auto 26px' }}>
          A society of AI teachers turns your PDFs, articles, notes and images into narrated interactive
          lessons — a tutor that writes on a board, runs real code, animates algorithms step by step,
          asks questions, and proves every claim against your source.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 22 }}>
          <a href="/login" style={{ ...btn(true), fontSize: 16, padding: '12px 28px' }}>Get started</a>
          <a href="#how" style={{ ...btn(false), fontSize: 16, padding: '12px 28px' }}>How it works</a>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <span style={chip}>✏️ Paste text</span>
          <span style={chip}>📄 Upload a PDF</span>
          <span style={chip}>🔗 Drop a web article</span>
          <span style={chip}>🖼 Teach from an image</span>
        </div>

        {/* hero visual — study anywhere */}
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-end', marginTop: 38, flexWrap: 'wrap' }}>
          {[['/images/study-26.png', 'Learners in a grand library', -2.5, 150], ['/images/study-23.png', 'A laptop and notebook study setup', 0, 200], ['/images/study-25.png', 'Studying in a café', 2.5, 150]].map(([src, alt, tilt, h]) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt={alt}
              style={{ height: h, width: 'auto', maxWidth: '85vw', objectFit: 'cover', borderRadius: 16, transform: `rotate(${tilt}deg)`, boxShadow: '0 16px 40px rgba(58,46,34,0.18)', border: '5px solid #fff' }} />
          ))}
        </div>
      </section>

      {/* scene types */}
      <section style={{ padding: '28px 0' }}>
        <h2 style={h2}>One lesson, four kinds of scenes</h2>
        <p style={sub}>The society orchestrates them all — explanation, animation, checkpoints, and proof.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          <div style={card}>
            <div style={{ fontSize: 26 }}>🖊️</div>
            <div style={{ fontWeight: 800, margin: '8px 0 4px' }}>Narrated board</div>
            <div style={{ fontSize: 13.5, color: UI.muted }}>The tutor speaks while writing — notes, diagrams, formulas and PDF figures appear in sync with the voice, seekable like a video.</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 26 }}>🧮</div>
            <div style={{ fontWeight: 800, margin: '8px 0 4px' }}>Algorithm dry-runs</div>
            <div style={{ fontSize: 13.5, color: UI.muted }}>Code is REALLY executed: active line, pointers riding the array, visited nodes staying marked, the queue changing — narrated step by step, never imagined.</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 26 }}>✍️</div>
            <div style={{ fontWeight: 800, margin: '8px 0 4px' }}>Quiz checkpoints</div>
            <div style={{ fontSize: 13.5, color: UI.muted }}>The lesson pauses until you answer — retrieval questions drawn from what was just taught, with worked answers.</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 26 }}>📎</div>
            <div style={{ fontWeight: 800, margin: '8px 0 4px' }}>Source proof</div>
            <div style={{ fontSize: 13.5, color: UI.muted }}>Every claim cites its chunk; figures carry a “Source · page N” chip. A grounding auditor blocks anything the material doesn't support.</div>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" style={{ padding: '28px 0' }}>
        <h2 style={h2}>From material to classroom in three steps</h2>
        <p style={sub}>Watch the society work with real per-scene progress — no fake spinners.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          {[
            ['1', 'Bring anything', 'Paste text, upload a PDF or image, or drop an article URL. PDFs keep their figures and page renders — the tutor teaches from the real pictures.'],
            ['2', 'The society composes', 'A domain router picks the right specialist (the Coding Instructor for code), the Board Director designs each scene, the Execution Tracer runs the real algorithm, critics object, an arbiter approves.'],
            ['3', 'Attend your course', 'A voiced, seekable lesson with episodes, progress, keyboard controls and quizzes — in your private library, on any device.'],
          ].map(([n, title, body]) => (
            <div key={n} style={card}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16 }}>{n}</div>
              <div style={{ fontWeight: 800, margin: '10px 0 4px' }}>{title}</div>
              <div style={{ fontSize: 13.5, color: UI.muted }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* the society */}
      <section style={{ padding: '28px 0 8px' }}>
        <h2 style={h2}>The agent society</h2>
        <p style={sub}>Distinct agents with one job each — they divide the work, debate, and an arbiter settles conflicts.</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {['🧭 Domain Router', '👨‍🏫 Coding Instructor', '📚 Teacher', '🖊️ Board Director', '⚙️ Execution Tracer', '💻 Code Runner', '🎙 Voice Writer', '🔍 Grounding Auditor', '🎓 Pedagogy Critic', '⚖️ Arbiter'].map((agent) => (
            <span key={agent} style={chip}>{agent}</span>
          ))}
        </div>
      </section>

      {/* closing CTA band */}
      <section
        style={{
          marginTop: 40, borderRadius: 20, overflow: 'hidden', position: 'relative', textAlign: 'center',
          backgroundImage: 'linear-gradient(180deg, rgba(30,20,12,0.55), rgba(30,20,12,0.7)), url(/images/study-27.png)',
          backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff', padding: '54px 20px',
        }}
      >
        <h2 style={{ fontSize: 30, margin: 0 }}>Learn anything. Forever.</h2>
        <p style={{ opacity: 0.9, maxWidth: 480, margin: '10px auto 22px', fontSize: 15 }}>
          Your first course is minutes away — bring the material you already have.
        </p>
        <a href="/login" style={{ ...btn(true), fontSize: 16, padding: '13px 32px', boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>Start free</a>
      </section>

      <footer style={{ borderTop: `1px solid ${UI.border}`, marginTop: 44, padding: '22px 0', textAlign: 'center', color: UI.muted, fontSize: 13 }}>
        <span style={{ fontWeight: 800, color: UI.text }}>◎ Forever</span> — an open-source AI tutor course platform ·
        built on Qwen Cloud for the Global AI Hackathon (Track 3: Agent Society) · AGPL-3.0
      </footer>
    </>
  );
}
