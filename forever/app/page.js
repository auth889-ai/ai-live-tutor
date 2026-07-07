// / — the COVER page (OpenMAIC-style landing) for visitors. Signed-in users are sent to
// /dashboard: one route, one job. The app shell (dashboard/courses/studio) lives on its
// own routes.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, verifySessionToken } from '../lib/auth/session.js';

const UI = {
  text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff',
  accent: '#f47368', accentDark: '#e8604c', bgSoft: '#fdf6ee',
};

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = token ? verifySessionToken(token) : null;
  if (session) redirect('/dashboard');

  return (
    <main style={{ color: UI.text }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 20px' }}>
        <Landing />
      </div>
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

// The cover page (OpenMAIC-style landing): what Forever is, the scene types, how it works,
// the agent society — everything a visitor (or a judge) needs before signing in.
function Landing() {
  const card = { border: `1px solid ${UI.border}`, borderRadius: 20, padding: 24, background: UI.card, textAlign: 'left', boxShadow: '0 2px 12px rgba(58,46,34,0.06)' };
  const overline = { display: 'inline-block', background: '#fff', border: `1px solid ${UI.border}`, color: UI.accentDark, borderRadius: 999, padding: '6px 16px', fontSize: 12, fontWeight: 800, letterSpacing: 1.2, marginBottom: 14 };
  const iconChip = (bg) => ({ width: 52, height: 52, borderRadius: 14, background: bg, display: 'grid', placeItems: 'center', fontSize: 24 });
  const h2 = { fontSize: 31, margin: '0 0 8px', textAlign: 'center', letterSpacing: -0.6, fontWeight: 800 };
  const sub = { color: UI.muted, textAlign: 'center', marginTop: 0, marginBottom: 26 };
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999,
    border: `1px solid ${UI.border}`, background: '#fff', fontSize: 13, fontWeight: 700, boxShadow: '0 1px 6px rgba(58,46,34,0.06)',
  };

  return (
    <>
      {/* top nav */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '22px 0 8px' }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 }}>F</span>
        <span style={{ fontWeight: 800, fontSize: 19 }}>Forever <span style={{ fontWeight: 500, fontSize: 13, color: UI.muted }}>AI Tutor</span></span>
        <a href="/login" style={{ marginLeft: 'auto', padding: '9px 22px', borderRadius: 999, textDecoration: 'none', fontWeight: 700, fontSize: 14, background: UI.accent, color: '#fff', boxShadow: '0 6px 18px rgba(244,115,104,0.35)' }}>Sign in</a>
      </nav>

      {/* hero */}
      <section style={{ textAlign: 'center', padding: '46px 0 34px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#fdece8', border: '1px solid #f6cfc8', color: UI.accentDark, borderRadius: 999, padding: '6px 16px', fontSize: 12, fontWeight: 800, letterSpacing: 0.8, marginBottom: 20 }}>
          ● QWEN AGENT SOCIETY · OPEN SOURCE · HACKATHON TRACK 3
        </div>
        <h1 style={{ fontSize: 'clamp(34px, 5.4vw, 56px)', lineHeight: 1.08, margin: 0, letterSpacing: -1.4, fontWeight: 800 }}>
          Any material becomes a course
          <br />
          <span style={{ color: UI.accent }}>taught like the best teacher you ever had.</span>
        </h1>
        <p style={{ color: UI.muted, fontSize: 18, lineHeight: 1.55, maxWidth: 640, margin: '20px auto 30px' }}>
          A society of AI teachers turns your PDFs, articles, notes and images into narrated,
          interactive lessons — a tutor that writes on a board, runs real code, animates algorithms
          step by step, and proves every claim against your source.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 24 }}>
          <a href="/login" style={{ padding: '14px 34px', borderRadius: 12, textDecoration: 'none', fontWeight: 800, fontSize: 16, background: UI.accent, color: '#fff', boxShadow: '0 10px 30px rgba(244,115,104,0.4)' }}>Get started — it's free</a>
          <a href="#how" style={{ padding: '14px 34px', borderRadius: 12, textDecoration: 'none', fontWeight: 700, fontSize: 16, color: UI.text, border: `1.5px solid ${UI.border}`, background: '#fff' }}>How it works</a>
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
          {['✏️ Paste text', '📄 Upload a PDF', '🔗 Drop a web article', '🖼 Teach from an image'].map((t) => (
            <span key={t} style={{ background: '#fff', border: `1px solid ${UI.border}`, borderRadius: 999, padding: '7px 15px', color: UI.text }}>{t}</span>
          ))}
        </div>
      </section>

      {/* cinematic media card — the video in its own frame */}
      <section style={{ margin: '0 0 44px' }}>
        <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', boxShadow: '0 26px 70px rgba(58,46,34,0.28)', border: '6px solid #fff' }}>
          <video autoPlay muted loop playsInline poster="/images/study-23.png" style={{ display: 'block', width: '100%', height: 'auto' }}>
            <source src="/videos/hero.mp4" type="video/mp4" />
          </video>
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '38px 24px 16px', background: 'linear-gradient(180deg, transparent, rgba(18,11,6,0.72))', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, fontWeight: 700 }}>
            <span style={{ width: 34, height: 34, borderRadius: '50%', background: UI.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}>▶</span>
            Learning, the way it should feel — narrated board, real code runs, live algorithm traces.
          </div>
        </div>
      </section>

      {/* study-anywhere photo strip — the photos AND the video both live */}
      <section style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'flex-end', margin: '0 0 34px', flexWrap: 'wrap' }}>
        {[['/images/study-26.png', 'Learners in a grand library', -2.5, 150], ['/images/study-23.png', 'A laptop and notebook study setup', 0, 200], ['/images/study-25.png', 'Studying in a café', 2.5, 150]].map(([src, alt, tilt, h]) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={alt}
            style={{ height: h, width: 'auto', maxWidth: '85vw', objectFit: 'cover', borderRadius: 16, transform: `rotate(${tilt}deg)`, boxShadow: '0 16px 40px rgba(58,46,34,0.18)', border: '5px solid #fff' }} />
        ))}
      </section>

      {/* scene types */}
      <section style={{ padding: '34px 0', textAlign: 'center' }}>
        <div style={overline}>SCENE TYPES</div>
        <h2 style={h2}>One lesson, four kinds of scenes</h2>
        <p style={sub}>The society orchestrates them all — explanation, animation, checkpoints, and proof.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          <div style={card}>
            <div style={iconChip('#fde8e4')}>🖊️</div>
            <div style={{ fontWeight: 800, fontSize: 16.5, margin: '12px 0 6px' }}>Narrated board</div>
            <div style={{ fontSize: 13.5, color: UI.muted, lineHeight: 1.55 }}>The tutor speaks while writing — notes, diagrams, formulas and PDF figures appear in sync with the voice, seekable like a video.</div>
          </div>
          <div style={card}>
            <div style={iconChip('#fef3e2')}>🧮</div>
            <div style={{ fontWeight: 800, fontSize: 16.5, margin: '12px 0 6px' }}>Algorithm dry-runs</div>
            <div style={{ fontSize: 13.5, color: UI.muted, lineHeight: 1.55 }}>Code is REALLY executed: active line, pointers riding the array, visited nodes staying marked, the queue changing — narrated step by step, never imagined.</div>
          </div>
          <div style={card}>
            <div style={iconChip('#e9f4ec')}>✍️</div>
            <div style={{ fontWeight: 800, fontSize: 16.5, margin: '12px 0 6px' }}>Quiz checkpoints</div>
            <div style={{ fontSize: 13.5, color: UI.muted, lineHeight: 1.55 }}>The lesson pauses until you answer — retrieval questions drawn from what was just taught, with worked answers.</div>
          </div>
          <div style={card}>
            <div style={iconChip('#e8f0fa')}>📎</div>
            <div style={{ fontWeight: 800, fontSize: 16.5, margin: '12px 0 6px' }}>Source proof</div>
            <div style={{ fontSize: 13.5, color: UI.muted, lineHeight: 1.55 }}>Every claim cites its chunk; figures carry a “Source · page N” chip. A grounding auditor blocks anything the material doesn't support.</div>
          </div>
        </div>
      </section>

      {/* how it works */}
      <section id="how" style={{ padding: '28px 0' }}>
        <div style={{ textAlign: 'center' }}><div style={overline}>HOW IT WORKS</div></div>
        <h2 style={h2}>From material to classroom in three steps</h2>
        <p style={sub}>Watch the society work with real per-scene progress — no fake spinners.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
          {[
            ['1', 'Bring anything', 'Paste text, upload a PDF or image, or drop an article URL. PDFs keep their figures and page renders — the tutor teaches from the real pictures.'],
            ['2', 'The society composes', 'A domain router picks the right specialist (the Coding Instructor for code), the Board Director designs each scene, the Execution Tracer runs the real algorithm, critics object, an arbiter approves.'],
            ['3', 'Attend your course', 'A voiced, seekable lesson with episodes, progress, keyboard controls and quizzes — in your private library, on any device.'],
          ].map(([n, title, body]) => (
            <div key={n} style={card}>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, #f47368, #e8604c)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17, boxShadow: '0 6px 16px rgba(244,115,104,0.35)' }}>{n}</div>
              <div style={{ fontWeight: 800, margin: '10px 0 4px' }}>{title}</div>
              <div style={{ fontSize: 13.5, color: UI.muted, lineHeight: 1.55 }}>{body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* the society */}
      <section style={{ padding: '28px 0 8px' }}>
        <div style={{ textAlign: 'center' }}><div style={overline}>THE SOCIETY</div></div>
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
        <h2 style={{ fontSize: 'clamp(28px, 4vw, 38px)', margin: 0, letterSpacing: -0.8, fontWeight: 800 }}>Learn anything. Forever.</h2>
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
