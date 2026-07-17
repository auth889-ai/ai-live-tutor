'use client';

// 📊 Progress — structured like a real learning dashboard (research: Duolingo/Khan/GitHub):
//   1. stat tiles (numbers first)   2. activity band (ring + heatmap)
//   3. "Jump back in" cards         4. Completed          5. badge case
import { useEffect, useMemo, useRef, useState } from 'react';

// LIVE DATA: refetch on focus + every 20s — progress moves while a lesson plays in another
// tab; nothing on this page is a one-shot render.
function useStudyLive() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let dead = false;
    const load = () => fetch('/api/study').then((r) => r.json()).then((d) => { if (!dead) setData(d); }).catch(() => {});
    load();
    const t = setInterval(load, 20000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => { dead = true; clearInterval(t); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, []);
  return data;
}

// Count-up: numbers travel to their value on mount and on every live change.
function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f5e6d9', card: '#fff', bgSoft: '#fdf1ea' };
const COVERS = ['/images/study-29.png', '/images/study-30.png', '/images/study-31.png', '/images/study-32.png', '/images/study-33.png', '/images/study-34.png', '/images/study-35.png', '/images/study-36.png', '/images/study-37.png', '/images/study-38.png'];
const coverFor = (id) => COVERS[[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % COVERS.length];
const ago = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const SectionTitle = ({ children, sub }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '26px 0 12px' }}>
    <h2 style={{ fontSize: 17, color: UI.text, margin: 0, fontFamily: 'var(--font-newsreader), Georgia, serif' }}>{children}</h2>
    {sub ? <span style={{ fontSize: 12, color: UI.muted }}>{sub}</span> : null}
  </div>
);

// DESIGN TOKENS (one system, no drift): a single card style, a single accent, an 8px
// spacing scale, and a strict type scale. Premium = restraint + rhythm, not more boxes.
const T = {
  card: { border: '1px solid #f2e3d5', borderRadius: 16, background: '#fff', boxShadow: '0 1px 4px rgba(58,46,34,0.05)' },
  pad: 18, gap: 12, sectionGap: 30,
  h1: { fontSize: 27, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600 },
  h2: { fontSize: 15.5, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif', fontWeight: 600 },
  body: { fontSize: 13.5, color: '#2b211a' },
  cap: { fontSize: 11.5, color: '#9b8465' },
  accent: '#e8604c',
};

const Section = ({ title, sub, children, style }) => (
  <section style={{ marginTop: T.sectionGap, ...style }}>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
      <h2 style={{ ...T.h2, margin: 0 }}>{title}</h2>
      {sub ? <span style={T.cap}>{sub}</span> : null}
    </div>
    {children}
  </section>
);

export function ProgressContent() {
  const data = useStudyLive();
  const [sort, setSort] = useState('recent');
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!data?.badges) return;
    const earned = data.badges.filter((b) => b.earned).map((b) => b.label);
    try {
      const prev = new Set(JSON.parse(localStorage.getItem('forever:badges') || '[]'));
      const fresh = earned.filter((l) => !prev.has(l));
      if (fresh.length && prev.size) { setToast(fresh[0]); setTimeout(() => setToast(null), 4200); }
      localStorage.setItem('forever:badges', JSON.stringify(earned));
    } catch { /* private mode */ }
  }, [data?.badges]);
  const items = useMemo(() => {
    const xs = [...(data?.progress ?? [])];
    if (sort === 'percent') xs.sort((a, b) => b.percent - a.percent);
    if (sort === 'alpha') xs.sort((a, b) => String(a.lessonTitle).localeCompare(String(b.lessonTitle)));
    return xs;
  }, [data, sort]);
  if (data === null) return <Skeleton />;
  const inProgress = items.filter((p) => !p.completed);
  const t = data.today ?? {};
  const rec = data.recommended;
  const know = data.knowledge ?? [];
  const STATUS_COLOR = { New: '#9b8465', Learning: '#c98f2d', Developing: '#4477aa', Strong: '#2f7d4a', 'Review due': '#c0522d' };

  return (
    <div style={{ maxWidth: 1080 }}>
      <style>{`
        .pcard{transition:transform .18s, box-shadow .18s} .pcard:hover{transform:translateY(-3px); box-shadow:0 10px 26px rgba(58,46,34,0.13)!important}
        .ringArc{transition:stroke-dasharray .9s cubic-bezier(.22,1,.36,1)}
        @keyframes pulseDot{0%,100%{box-shadow:0 0 0 0 rgba(232,96,76,.5)}50%{box-shadow:0 0 0 6px rgba(232,96,76,0)}}
        @keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes cellIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
        .hmcell{transition:background .6s, outline .3s}
        @media (prefers-reduced-motion: no-preference){ .hmcell{animation:cellIn .4s ease-out both} }
        @media (prefers-reduced-motion: reduce){ .pcard,.ringArc,.hmcell{transition:none!important;animation:none!important} }
        .twocol{display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:20px; align-items:start}
        @media (max-width: 980px){ .twocol{grid-template-columns:1fr} }
      `}</style>
      {toast ? <div style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 60, background: '#2b211a', color: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'toastIn .35s ease-out', fontSize: 14 }}>🎉 Badge earned: <b>{toast}</b></div> : null}

      {/* ===== header ===== */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ ...T.h1, margin: 0 }}>Progress</h1>
          <p style={{ ...T.cap, margin: '4px 0 0' }}>What you learned, what you may forget, and the best next step.</p>
        </div>
        {data.streak ? <span style={{ ...T.body, fontWeight: 800, color: '#c0522d' }}>🔥 {data.streak}-day streak <span style={{ ...T.cap, fontWeight: 400 }}>· best {data.bestStreak}</span></span> : null}
      </div>

      {/* ===== hero: recommended next (ONE primary action, ONE gradient) ===== */}
      {rec ? (
        <a href={`/course/${rec.lessonId}?t=${rec.tMs}&scene=${rec.sceneIndex}`} className="pcard"
          style={{ ...T.card, display: 'flex', gap: 0, marginTop: 20, textDecoration: 'none', overflow: 'hidden' }}>
          <div style={{ width: 6, background: T.accent }} />
          <div style={{ padding: T.pad, flex: 1 }}>
            <div style={{ ...T.cap, fontWeight: 800, letterSpacing: 0.4, color: '#c0522d' }}>RECOMMENDED NEXT{rec.minutes ? ` · ~${rec.minutes} MIN` : ''}</div>
            <div style={{ ...T.body, fontWeight: 800, fontSize: 17, marginTop: 5 }}>{rec.lessonTitle}</div>
            {rec.nextSceneTitle ? <div style={{ ...T.body, color: '#6b563d', marginTop: 2 }}>Scene {rec.sceneIndex + 1} · {rec.nextSceneTitle}</div> : null}
            <div style={{ ...T.cap, marginTop: 6 }}>Why: {rec.reason}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', paddingRight: T.pad }}>
            <span style={{ background: T.accent, color: '#fff', borderRadius: 999, padding: '9px 20px', fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap' }}>Continue ▸</span>
          </div>
        </a>
      ) : null}

      {/* ===== two-column dashboard ===== */}
      <div className="twocol" style={{ marginTop: 20 }}>
        {/* ---- MAIN ---- */}
        <div>
          <Section title="Continue learning" sub={`${inProgress.length} lesson${inProgress.length === 1 ? '' : 's'}`} style={{ marginTop: 0 }}>
            {inProgress.length ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
                  {inProgress.map((p) => <LessonCard key={p._id} p={p} />)}
                </div>
                {inProgress.length > 2 ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                    <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...T.cap, border: T.card.border, borderRadius: 8, background: '#fff', padding: '4px 8px' }}>
                      <option value="recent">Recently active</option>
                      <option value="percent">Most complete</option>
                      <option value="alpha">A → Z</option>
                    </select>
                  </div>
                ) : null}
              </>
            ) : <EmptyCard />}
          </Section>

          {know.length ? (
            <Section title="Knowledge" sub="evidence: checkpoints · reviews · recency">
              <div style={{ ...T.card }}>
                {know.map((k, i) => (
                  <div key={k.lessonId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 18px', borderTop: i ? T.card.border : 'none' }}>
                    <span style={{ ...T.body, fontWeight: 700 }}>{k.lessonTitle}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {k.checkpointsPassed > 0 ? <span style={T.cap}>{k.checkpointsPassed} ✓</span> : null}
                      <span style={{ fontSize: 12, fontWeight: 800, color: STATUS_COLOR[k.status] ?? T.cap.color, background: `${STATUS_COLOR[k.status] ?? '#9b8465'}14`, borderRadius: 999, padding: '3px 11px' }}>{k.status}</span>
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Activity" sub="real learning actions only">
            <Heatmap days={data.heatmap ?? []} />
          </Section>

          <details style={{ marginTop: T.sectionGap }}>
            <summary style={{ cursor: 'pointer', ...T.h2 }}>Achievements · {(data.badges ?? []).filter((b) => b.earned).length} of {(data.badges ?? []).length}</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10, marginTop: 12 }}>
              {(data.badges ?? []).map((b) => (
                <div key={b.label} title={b.label} style={{ ...T.card, padding: '12px 6px', textAlign: 'center', borderColor: b.earned ? '#f0c39a' : '#f2e3d5' }}>
                  <div style={{ fontSize: 22, filter: b.earned ? 'none' : 'grayscale(1) opacity(0.35)' }}>{b.icon}</div>
                  <div style={{ fontSize: 9.5, color: b.earned ? '#8a3a12' : '#c9bda1', marginTop: 4, lineHeight: 1.2, fontWeight: 700 }}>{b.label}</div>
                </div>
              ))}
            </div>
          </details>
        </div>

        {/* ---- RAIL ---- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.gap }}>
          <div style={{ ...T.card, padding: T.pad }}>
            <div style={{ ...T.cap, fontWeight: 800, marginBottom: 10 }}>TODAY</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[[t.scenes ?? 0, 'scenes'], [t.checkpoints ?? 0, 'checkpoints ✓'], [t.reviews ?? 0, 'reviews'], [t.minutes ?? 0, 'focused min']].map(([n, l]) => (
                <div key={l}><div style={{ fontSize: 20, fontWeight: 800, color: '#2b211a', lineHeight: 1 }}>{n}</div><div style={{ ...T.cap, marginTop: 2 }}>{l}</div></div>
              ))}
            </div>
            <div style={{ ...T.cap, marginTop: 12, paddingTop: 10, borderTop: T.card.border, lineHeight: 1.5 }}>
              {(t.checkpoints ?? 0) === 0 ? 'Complete a checkpoint after your next scene to start verifying what you learned.' : (data.dueCount ?? 0) > 0 ? `${data.dueCount} review${data.dueCount === 1 ? '' : 's'} waiting — 4 minutes well spent.` : 'Verified learning today. Reviews return on schedule.'}
            </div>
          </div>

          <div style={{ ...T.card, padding: T.pad }}>
            <div style={{ ...T.cap, fontWeight: 800, marginBottom: 10 }}>LEARNING HEALTH</div>
            {[['Progress', `${data.stats?.totalScenes ?? 0} scenes · ${data.stats?.lessonsDone ?? 0} lessons`, true],
              ['Recall', (data.stats?.totalReviews ?? 0) >= 3 ? `${data.stats.totalReviews} reviews` : 'Not enough data', (data.stats?.totalReviews ?? 0) >= 3],
              ['Verified', (data.stats?.totalCheckpoints ?? 0) > 0 ? `${data.stats.totalCheckpoints} checkpoints` : 'Not measured yet', (data.stats?.totalCheckpoints ?? 0) > 0],
              ['Reviews', (data.dueCount ?? 0) > 0 ? `${data.dueCount} due today` : 'On track', (data.dueCount ?? 0) === 0]].map(([l, v, ok]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 12.5 }}>
                <span style={{ color: '#9b8465' }}>{l}</span>
                <span style={{ color: ok ? '#2b211a' : '#b3a889', fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>

          <div style={{ ...T.card, padding: T.pad }}>
            <div style={{ ...T.cap, fontWeight: 800, marginBottom: 8 }}>WEEKLY TARGET</div>
            <WeeklyTarget total={data.weekTotal ?? 0} goal={data.weekGoal ?? 10} actions={data.weekActions ?? {}} pace={data.pace ?? ''} bare />
          </div>

          <div style={{ ...T.card, padding: T.pad }}>
            <div style={{ ...T.cap, fontWeight: 800, marginBottom: 8 }}>REVIEWS & MEMORY</div>
            {(data.dueCount ?? 0) > 0 ? (
              <a href="/bookmarks" style={{ display: 'inline-block', background: T.accent, color: '#fff', borderRadius: 999, padding: '7px 16px', fontWeight: 800, fontSize: 12.5, textDecoration: 'none' }}>Start review · {data.dueCount}</a>
            ) : (data.upcoming ?? []).length ? (data.upcoming ?? []).map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0' }}>
                <span style={{ color: '#2b211a' }}>{u.label}</span><span style={T.cap}>{new Date(u.due).toLocaleDateString('en', { weekday: 'short' })}</span>
              </div>
            )) : <div style={{ ...T.cap, lineHeight: 1.5 }}>Nothing due. Your first review appears after a bookmark or checkpoint.</div>}
            {(data.weak ?? []).length ? (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: T.card.border }}>
                <div style={{ ...T.cap, fontWeight: 800, marginBottom: 4 }}>NEEDS REINFORCEMENT</div>
                {(data.weak ?? []).map((w) => (
                  <a key={w.id} href={`/course/${w.lessonId}?scene=${encodeURIComponent(w.sceneId ?? '')}&t=${w.tMs}`} style={{ display: 'block', fontSize: 12.5, color: '#c0522d', padding: '3px 0', textDecoration: 'none' }}>▶ {w.label}</a>
                ))}
              </div>
            ) : null}
          </div>

          <Reflection saved={t.reflection} bare />

          {(data.tomorrow?.review || data.tomorrow?.continueTitle) ? (
            <div style={{ ...T.card, padding: T.pad, fontSize: 12.5, color: '#9b8465', lineHeight: 1.55 }}>
              <div style={{ ...T.cap, fontWeight: 800, marginBottom: 6 }}>TOMORROW'S FIRST BLOCK</div>
              {data.tomorrow.review ? <>Review “{data.tomorrow.review}”{data.tomorrow.continueTitle ? ', then ' : ''}</> : null}
              {data.tomorrow.continueTitle ? <>continue <b style={{ color: '#2b211a' }}>{data.tomorrow.continueTitle}</b></> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LessonCard({ p }) {
  return (
    <a className="pcard" href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`}
      style={{ border: `1px solid ${UI.border}`, borderRadius: 18, overflow: 'hidden', background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
      <div style={{ position: 'relative', height: 108, overflow: 'hidden' }}>
        <img src={coverFor(p.lessonId)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(43,33,26,0.55))' }} />
        <div style={{ position: 'absolute', right: 10, bottom: -14 }}><Ring percent={p.percent} done={p.completed} /></div>
        <div style={{ position: 'absolute', left: 12, bottom: 8, color: '#fff', fontSize: 11.5, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {Date.now() - new Date(p.updatedAt).getTime() < 3 * 60 * 1000 && !p.completed ? (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e8604c', animation: 'pulseDot 1.6s infinite' }} title="watching now" />
          ) : null}
          {p.completed ? 'COMPLETED ✓' : `▶ RESUME · SCENE ${p.sceneIndex + 1}`}
        </div>
      </div>
      <div style={{ padding: '16px 14px 13px' }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.3, minHeight: 38 }}>{p.lessonTitle || p.lessonId}</div>
        {p.sceneCount > 0 && p.sceneCount <= 24 ? (
          <div style={{ display: 'flex', gap: 3, margin: '9px 0 7px' }}>
            {Array.from({ length: p.sceneCount }, (_, i) => (
              <span key={i} style={{ flex: 1, maxWidth: 14, height: 9, borderRadius: 3, background: i < (p.completedCount ?? 0) ? '#2f9e5f' : i === p.sceneIndex && !p.completed ? '#f47368' : '#f2e8dc' }} />
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: UI.muted }}>
          <span>{p.completedCount ?? 0}/{p.sceneCount} scenes</span>
          <span>{ago(p.updatedAt)}</span>
        </div>
      </div>
    </a>
  );
}

function Ring({ percent, done }) {
  const r = 24; const c = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return (
    <svg width="62" height="62" viewBox="0 0 62 62" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))' }}>
      <circle cx="31" cy="31" r={r} fill="rgba(255,255,255,0.92)" />
      <circle cx="31" cy="31" r={r} fill="none" stroke="#f2e8dc" strokeWidth="5" />
      <circle className="ringArc" cx="31" cy="31" r={r} fill="none" stroke={done ? '#2f9e5f' : '#f47368'} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(on ? (percent / 100) * c : 0)} ${c}`} transform="rotate(-90 31 31)" />
      <text x="31" y="35" textAnchor="middle" fontSize="13" fontWeight="800" fill={done ? '#2f9e5f' : '#c0522d'}>{done ? '✓' : `${percent}%`}</text>
    </svg>
  );
}

function WeeklyRing({ scenes, goal }) {
  const pct = Math.min(100, Math.round((scenes / goal) * 100));
  const r = 30; const c = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r={r} fill="none" stroke="#f2e8dc" strokeWidth="7" />
        <circle className="ringArc" cx="37" cy="37" r={r} fill="none" stroke={pct >= 100 ? '#2f9e5f' : '#f47368'} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(on ? (pct / 100) * c : 0)} ${c}`} transform="rotate(-90 37 37)" />
        <text x="37" y="34" textAnchor="middle" fontSize="15" fontWeight="800" fill="#2b211a">{scenes}</text>
        <text x="37" y="48" textAnchor="middle" fontSize="9" fill="#8a6d3b">of {goal}</text>
      </svg>
      <div style={{ fontSize: 12.5, color: UI.muted, maxWidth: 110 }}><b style={{ color: UI.text }}>Weekly goal</b><br />{pct >= 100 ? 'hit — keep going 🎉' : `${goal - scenes} scenes to go`}</div>
    </div>
  );
}

function Heatmap({ days }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = byDate.get(todayKey) ?? { scenes: 0, reviews: 0, bookmarks: 0 };
  const todayTotal = useCountUp((today.scenes ?? 0) + (today.reviews ?? 0));
  const weeks = [];
  const end = new Date();
  const start = new Date(end); start.setDate(end.getDate() - (16 * 7 - 1) - ((end.getDay() + 6) % 7));
  const monthMarks = [];
  for (let w = 0; w < 16; w += 1) {
    const col = [];
    for (let d = 0; d < 7; d += 1) {
      const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
      if (dt > end) break;
      const key = dt.toISOString().slice(0, 10);
      const rec = byDate.get(key);
      col.push({ key, n: (rec?.scenes ?? 0) + (rec?.reviews ?? 0) });
      if (d === 0) {
        const label = dt.toLocaleString('en', { month: 'short' });
        monthMarks.push({ w, label: label === monthMarks.lastLabel ? '' : label });
        monthMarks.lastLabel = label;
      }
    }
    weeks.push(col);
  }
  const shade = (n) => (n === 0 ? '#f4ece2' : n < 2 ? '#f8c9ad' : n < 4 ? '#f4936b' : n < 7 ? '#e8604c' : '#b93c2b');
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '12px 16px', boxShadow: '0 2px 10px rgba(58,46,34,0.06)', flex: 1, minWidth: 300 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text }}>Activity <span style={{ color: UI.muted, fontWeight: 400 }}>· last 16 weeks</span></div>
        <div style={{ fontSize: 12, color: today.scenes + today.reviews > 0 ? '#c0522d' : UI.muted, fontWeight: 700 }}>
          today: {todayTotal} {today.scenes + today.reviews === 1 ? 'action' : 'actions'}{today.scenes ? ` · ${today.scenes} scene${today.scenes === 1 ? '' : 's'}` : ''}{today.reviews ? ` · ${today.reviews} review${today.reviews === 1 ? '' : 's'}` : ''}
        </div>
      </div>
      {/* month axis */}
      <div style={{ display: 'flex', gap: 3, marginLeft: 20, marginBottom: 3 }}>
        {monthMarks.map((m, i) => (
          <span key={i} style={{ width: 12, fontSize: 8.5, color: UI.muted, overflow: 'visible', whiteSpace: 'nowrap' }}>{m.label}</span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {/* weekday axis */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: 17 }}>
          {['M', '', 'W', '', 'F', '', ''].map((l, i) => <span key={i} style={{ height: 12, fontSize: 8.5, color: UI.muted, lineHeight: '12px' }}>{l}</span>)}
        </div>
        {weeks.map((col, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {col.map((c, j) => (
              <span key={c.key} className="hmcell" title={`${c.key}: ${c.n} action${c.n === 1 ? '' : 's'}`}
                style={{
                  width: 12, height: 12, borderRadius: 3, background: shade(c.n),
                  outline: c.key === todayKey ? '1.5px solid #b93c2b' : 'none', outlineOffset: 1,
                  animationDelay: `${(i * 7 + j) * 6}ms`,
                }} />
            ))}
          </div>
        ))}
      </div>
      {/* legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 8, fontSize: 9.5, color: UI.muted }}>
        less {[0, 1, 3, 5, 8].map((n) => <span key={n} style={{ width: 10, height: 10, borderRadius: 2, background: shade(n) }} />)} more
      </div>
    </div>
  );
}

function EmptyCard() {
  return (
    <a href="/courses" style={{ display: 'block', border: `2px dashed ${UI.border}`, borderRadius: 18, padding: '42px 20px', textAlign: 'center', textDecoration: 'none', color: UI.muted, background: UI.bgSoft, marginTop: 18 }}>
      <div style={{ fontSize: 34, marginBottom: 8 }}>📊</div>
      <div style={{ fontWeight: 700, color: UI.text }}>Open any lesson and it starts tracking here</div>
      <div style={{ fontSize: 13 }}>resume points · earned bars · streaks</div>
    </a>
  );
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
      {[0, 1, 2].map((i) => <div key={i} style={{ height: 210, borderRadius: 18, background: 'linear-gradient(100deg,#fdf1ea,#fff,#fdf1ea)', border: '1px solid #f5e6d9' }} />)}
    </div>
  );
}


function Reflection({ saved, bare = false }) {
  const [sent, setSent] = useState(null);
  const choose = (c) => {
    setSent(c);
    fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reflection', choice: c }) }).catch(() => {});
  };
  const chosen = sent ?? saved;
  return (
    <div style={{ border: '1px solid #f2e3d5', borderRadius: 16, background: '#fff', padding: 18 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: '#9b8465', marginBottom: 8 }}>WHAT FELT UNCLEAR TODAY?</div>
      {chosen ? (
        <div style={{ fontSize: 12.5, color: '#2f7d4a' }}>Noted: “{chosen}” — your tutor will lean into this next session.</div>
      ) : (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {['The core idea', 'The dry run steps', 'The code', 'All clear'].map((c) => (
            <button key={c} onClick={() => choose(c)} style={{ border: '1.5px solid #f2e3d5', borderRadius: 999, background: '#fff', color: '#9b8465', fontSize: 11.5, fontWeight: 700, padding: '5px 12px', cursor: 'pointer' }}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function WeeklyTarget({ total, goal, actions, pace, bare = false }) {
  const [saving, setSaving] = useState(false);
  const setGoal = (g) => { setSaving(true); fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'goal', weekGoal: g }) }).finally(() => setSaving(false)); };
  const pct = Math.min(100, Math.round((total / goal) * 100));
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: '#2b211a' }}>{total} of {goal} actions</div>
        <select disabled={saving} defaultValue={goal} onChange={(e) => setGoal(Number(e.target.value))} style={{ fontSize: 11, border: '1px solid #f2e3d5', borderRadius: 8, background: '#fff', color: '#9b8465', padding: '2px 6px' }}>
          {[5, 10, 15, 20, 30].map((g) => <option key={g} value={g}>{g}/wk</option>)}
        </select>
      </div>
      <div style={{ marginTop: 8, height: 7, borderRadius: 5, background: '#f2e8dc', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: pct >= 100 ? '#2f9e5f' : 'linear-gradient(90deg,#e8604c,#d35400)', transition: 'width .6s' }} />
      </div>
      <div style={{ marginTop: 7, fontSize: 11.5, color: '#9b8465', lineHeight: 1.5 }}>
        scenes+checkpoints <b style={{ color: '#2b211a' }}>{(actions.scenes ?? 0) + (actions.checkpoints ?? 0)}</b> · reviews <b style={{ color: '#2b211a' }}>{actions.reviews ?? 0}</b><br />
        <span style={{ color: pct >= 100 ? '#2f7d4a' : '#c0522d' }}>{pace}</span>
      </div>
    </div>
  );
}
