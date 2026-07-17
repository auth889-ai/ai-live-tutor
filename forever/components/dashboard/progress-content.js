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

export function ProgressContent() {
  const data = useStudyLive();
  const [sort, setSort] = useState('recent');
  // Badge toast: celebrate the moment a badge flips to earned (compared to last visit).
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
  const doneItems = items.filter((p) => p.completed);
  const st = data.stats ?? {};

  return (
    <div style={{ maxWidth: 940 }}>
      <style>{`
        .pcard{transition:transform .18s, box-shadow .18s} .pcard:hover{transform:translateY(-3px); box-shadow:0 10px 26px rgba(58,46,34,0.14)!important}
        .ringArc{transition:stroke-dasharray .9s cubic-bezier(.22,1,.36,1)}
        .dotcell{transition:background .5s}
        @keyframes pulseDot{0%,100%{box-shadow:0 0 0 0 rgba(232,96,76,.5)}50%{box-shadow:0 0 0 6px rgba(232,96,76,0)}}
        @keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes cellIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
        .hmcell{transition:background .6s, outline .3s}
        @media (prefers-reduced-motion: no-preference){ .hmcell{animation:cellIn .4s ease-out both} }
        @media (prefers-reduced-motion: reduce){ .pcard,.ringArc,.hmcell{transition:none!important;animation:none!important} }
      `}</style>
      {toast ? (
        <div style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 60, background: '#2b211a', color: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'toastIn .35s ease-out', fontSize: 14 }}>
          🎉 Badge earned: <b>{toast}</b>
        </div>
      ) : null}
      <h1 style={{ fontSize: 26, color: UI.text, margin: '0 0 3px', fontFamily: 'var(--font-newsreader), Georgia, serif' }}>Progress</h1>
      <p style={{ color: UI.muted, fontSize: 13, margin: '0 0 18px' }}>Every number below is earned — scenes finished, moments reviewed, days shown up.</p>

      {/* 1 · stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <Tile big={`🔥 ${data.streak ?? 0}`} label="day streak" sub={`best ${data.bestStreak ?? 0}`} />
        <Tile big={st.totalScenes ?? 0} label="scenes finished" sub="all time" />
        <Tile big={st.totalReviews ?? 0} label="reviews done" sub={`${data.forecast?.today ?? 0} due today`} accent={(data.forecast?.today ?? 0) > 0} />
        <Tile big={st.lessonsDone ?? 0} label="lessons completed" sub={`${inProgress.length} in progress`} />
      </div>

      {/* 2 · activity band */}
      <SectionTitle sub="shows up in every card below">This week</SectionTitle>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <WeeklyRing scenes={data.weekScenes ?? 0} goal={data.weekGoal ?? 10} />
        <Heatmap days={data.heatmap ?? []} />
      </div>

      {/* 3 · jump back in */}
      {inProgress.length > 0 ? (
        <>
          <SectionTitle sub={`${inProgress.length} lesson${inProgress.length === 1 ? '' : 's'}`}>Jump back in</SectionTitle>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ border: `1px solid ${UI.border}`, borderRadius: 8, background: '#fff', color: UI.muted, fontSize: 12, padding: '4px 8px' }}>
              <option value="recent">Recently active</option>
              <option value="percent">Most complete</option>
              <option value="alpha">A → Z</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
            {inProgress.map((p) => <LessonCard key={p._id} p={p} />)}
          </div>
        </>
      ) : (
        <EmptyCard />
      )}

      {/* 4 · completed */}
      {doneItems.length > 0 ? (
        <>
          <SectionTitle sub="rewatch any time">Completed</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 16 }}>
            {doneItems.map((p) => <LessonCard key={p._id} p={p} />)}
          </div>
        </>
      ) : null}

      {/* 5 · badge case */}
      <SectionTitle sub={`${(data.badges ?? []).filter((b) => b.earned).length} of ${(data.badges ?? []).length} earned`}>Badge case</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10 }}>
        {(data.badges ?? []).map((b) => (
          <div key={b.label} title={b.label} style={{ border: `1px solid ${b.earned ? '#f0c39a' : UI.border}`, borderRadius: 14, background: b.earned ? 'linear-gradient(180deg,#fffdf9,#fff5ec)' : '#fff', padding: '12px 6px', textAlign: 'center', boxShadow: b.earned ? '0 2px 8px rgba(211,84,0,0.10)' : 'none' }}>
            <div style={{ fontSize: 24, filter: b.earned ? 'none' : 'grayscale(1) opacity(0.35)' }}>{b.icon}</div>
            <div style={{ fontSize: 10, color: b.earned ? '#8a3a12' : '#c9bda1', marginTop: 4, lineHeight: 1.2, fontWeight: 700 }}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tile({ big, label, sub, accent = false }) {
  const numeric = typeof big === 'number';
  const shown = useCountUp(numeric ? big : 0);
  return (
    <div style={{ border: `1px solid ${accent ? '#f0c39a' : UI.border}`, borderRadius: 16, background: accent ? 'linear-gradient(180deg,#fffdf9,#fff5ec)' : '#fff', padding: '14px 16px', boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: UI.text, lineHeight: 1 }}>{numeric ? shown : big}</div>
      <div style={{ fontSize: 12.5, color: UI.muted, marginTop: 5, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 11, color: accent ? '#c0522d' : '#b3a889', marginTop: 1 }}>{sub}</div>
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
