// / — the COVER page (OpenMAIC-style landing) for visitors. Signed-in users are sent to
// /dashboard: one route, one job. The app shell (dashboard/courses/studio) lives on its
// own routes.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, verifySessionToken } from '../lib/auth/session.js';

const UI = {
  text: '#3a2e22', muted: '#8a6d3b', border: '#f0e2d0', card: '#fff',
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
  const card = { border: `1px solid ${UI.border}`, borderRadius: 16, padding: 20, background: UI.card, textAlign: 'left' };
  const h2 = { fontSize: 26, margin: '0 0 6px', textAlign: 'center' };
  const sub = { color: UI.muted, textAlign: 'center', marginTop: 0, marginBottom: 26 };
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 999,
    border: `1px solid ${UI.border}`, background: '#fff', fontSize: 13, fontWeight: 700,
  };

  return (
    <>
      {/* video hero */}
      <section style={{ position: 'relative', borderRadius: 26, overflow: 'hidden', margin: '18px 0 40px', color: '#fff', background: '#1a100a', boxShadow: '0 24px 70px rgba(58,46,34,0.28)' }}>
        <video autoPlay muted loop playsInline poster="/images/study-23.png"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}>
          <source src="/videos/hero.mp4" type="video/mp4" />
        </video>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(18,11,6,0.62), rgba(18,11,6,0.3) 45%, rgba(18,11,6,0.82))' }} />

        <div style={{ position: 'relative', padding: '26px 44px 62px' }}>
          <nav style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 64 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 }}>F</span>
            <span style={{ fontWeight: 800, fontSize: 19 }}>Forever <span style={{ fontWeight: 500, fontSize: 13, opacity: 0.85 }}>AI Tutor</span></span>
            <a href="/login" style={{ marginLeft: 'auto', padding: '9px 20px', borderRadius: 999, textDecoration: 'none', fontWeight: 700, fontSize: 14, color: '#fff', border: '1.5px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(6px)' }}>Sign in</a>
          </nav>

          <div style={{ maxWidth: 760 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(244,115,104,0.95)', borderRadius: 999, padding: '6px 16px', fontSize: 12, fontWeight: 800, letterSpacing: 0.8, marginBottom: 20 }}>
              ● QWEN AGENT SOCIETY · OPEN SOURCE · HACKATHON TRACK 3
            </div>
            <h1 style={{ fontSize: 54, lineHeight: 1.08, margin: 0, letterSpacing: -1.2, fontWeight: 800, textShadow: '0 2px 20px rgba(0,0,0,0.35)' }}>
              Any material becomes a course<br />
              <span style={{ color: '#ffb3a8' }}>taught like the best teacher you ever had.</span>
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: 18, lineHeight: 1.55, maxWidth: 620, margin: '20px 0 30px' }}>
              A society of AI teachers turns your PDFs, articles, notes and images into narrated,
              interactive lessons — a tutor that writes on a board, runs real code, animates algorithms
              step by step, and proves every claim against your source.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 26 }}>
              <a href="/login" style={{ padding: '14px 34px', borderRadius: 12, textDecoration: 'none', fontWeight: 800, fontSize: 16, background: UI.accent, color: '#fff', boxShadow: '0 10px 30px rgba(244,115,104,0.45)' }}>Get started — it's free</a>
              <a href="#how" style={{ padding: '14px 34px', borderRadius: 12, textDecoration: 'none', fontWeight: 700, fontSize: 16, color: '#fff', border: '1.5px solid rgba(255,255,255,0.45)', background: 'rgba(255,255,255,0.1)', backdropFilter: 'blur(6px)' }}>How it works</a>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13, fontWeight: 600 }}>
              {['✏️ Paste text', '📄 Upload a PDF', '🔗 Drop a web article', '🖼 Teach from an image'].map((t) => (
                <span key={t} style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.28)', backdropFilter: 'blur(4px)', borderRadius: 999, padding: '7px 15px' }}>{t}</span>
              ))}
            </div>
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
