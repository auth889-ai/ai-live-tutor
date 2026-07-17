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
  const t = data.today ?? {};
  const rec = data.recommended;
  const know = data.knowledge ?? [];
  const STATUS_COLOR = { 'New': '#b3a889', 'Learning': '#d9a441', 'Developing': '#2980b9', 'Strong': '#2f9e5f', 'Review due': '#c0522d' };

  return (
    <div style={{ maxWidth: 940 }}>
      <style>{`
        .pcard{transition:transform .18s, box-shadow .18s} .pcard:hover{transform:translateY(-3px); box-shadow:0 10px 26px rgba(58,46,34,0.14)!important}
        .ringArc{transition:stroke-dasharray .9s cubic-bezier(.22,1,.36,1)}
        @keyframes pulseDot{0%,100%{box-shadow:0 0 0 0 rgba(232,96,76,.5)}50%{box-shadow:0 0 0 6px rgba(232,96,76,0)}}
        @keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes cellIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
        .hmcell{transition:background .6s, outline .3s}
        @media (prefers-reduced-motion: no-preference){ .hmcell{animation:cellIn .4s ease-out both} }
        @media (prefers-reduced-motion: reduce){ .pcard,.ringArc,.hmcell{transition:none!important;animation:none!important} }
      `}</style>
      {toast ? <div style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 60, background: '#2b211a', color: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'toastIn .35s ease-out', fontSize: 14 }}>🎉 Badge earned: <b>{toast}</b></div> : null}

      <h1 style={{ fontSize: 26, color: UI.text, margin: '0 0 3px', fontFamily: 'var(--font-newsreader), Georgia, serif' }}>Progress</h1>
      <p style={{ color: UI.muted, fontSize: 13, margin: '0 0 16px' }}>What you learned, what you may forget, and the best next step.</p>

      {/* 1 · TODAY */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1.1 1 300px', border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '14px 16px', boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: UI.text, marginBottom: 8 }}>Today {data.streak ? <span style={{ color: '#d35400', fontWeight: 700 }}>· 🔥 {data.streak}-day streak</span> : null}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: UI.text }}>
            <span><b style={{ fontSize: 17 }}>{t.scenes ?? 0}</b> <span style={{ color: UI.muted }}>scenes</span></span>
            <span><b style={{ fontSize: 17, color: (t.checkpoints ?? 0) > 0 ? '#2f9e5f' : UI.text }}>{t.checkpoints ?? 0}</b> <span style={{ color: UI.muted }}>checkpoints ✓</span></span>
            <span><b style={{ fontSize: 17 }}>{t.reviews ?? 0}</b> <span style={{ color: UI.muted }}>reviews</span></span>
            <span><b style={{ fontSize: 17 }}>{t.minutes ?? 0}</b> <span style={{ color: UI.muted }}>focused min</span></span>
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: UI.muted, borderTop: `1px solid ${UI.border}`, paddingTop: 8 }}>
            {(t.checkpoints ?? 0) === 0
              ? 'Complete a checkpoint after your next scene to start verifying what you learned.'
              : (data.dueCount ?? 0) > 0
                ? `Nice — ${t.checkpoints} verified today. ${data.dueCount} review${data.dueCount === 1 ? '' : 's'} waiting.`
                : 'Verified learning today — reviews will return on their schedule.'}
          </div>
        </div>

        {/* 2 · RECOMMENDED NEXT */}
        {rec ? (
          <a href={`/course/${rec.lessonId}?t=${rec.tMs}&scene=${rec.sceneIndex}`} className="pcard"
            style={{ flex: '1.4 1 320px', textDecoration: 'none', border: '1.5px solid #f0c39a', borderRadius: 16, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', padding: '14px 16px', boxShadow: '0 2px 10px rgba(211,84,0,0.10)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8a3a12', marginBottom: 5 }}>★ RECOMMENDED NEXT{rec.minutes ? ` · ~${rec.minutes} MIN` : ''}</div>
            <div style={{ fontWeight: 800, color: UI.text, fontSize: 15.5 }}>{rec.lessonTitle}</div>
            {rec.nextSceneTitle ? <div style={{ fontSize: 13, color: '#8a3a12', marginTop: 2 }}>Scene {rec.sceneIndex + 1} — {rec.nextSceneTitle}</div> : null}
            <div style={{ fontSize: 12, color: UI.muted, marginTop: 6 }}>Why: {rec.reason}</div>
            <div style={{ marginTop: 10 }}><span style={{ background: '#e8604c', color: '#fff', borderRadius: 999, padding: '7px 16px', fontWeight: 800, fontSize: 13 }}>Continue learning</span></div>
          </a>
        ) : null}
      </div>

      {/* 4 · LEARNING HEALTH (honest, data-gated) */}
      <SectionTitle sub="no invented scores — each line unlocks with evidence">Learning health</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <Health label="Progress" value={`${data.stats?.totalScenes ?? 0} scenes · ${data.stats?.lessonsDone ?? 0} lessons done`} good />
        <Health label="Recall" value={(data.stats?.totalReviews ?? 0) >= 3 ? `${data.stats.totalReviews} reviews done` : 'Not enough data'} note={(data.stats?.totalReviews ?? 0) >= 3 ? null : 'complete 3 reviews to unlock'} good={(data.stats?.totalReviews ?? 0) >= 3} />
        <Health label="Verified concepts" value={(data.stats?.totalCheckpoints ?? 0) > 0 ? `${data.stats.totalCheckpoints} checkpoints ✓` : 'Not measured yet'} note={(data.stats?.totalCheckpoints ?? 0) > 0 ? null : 'answer a quiz in any lesson'} good={(data.stats?.totalCheckpoints ?? 0) > 0} />
        <Health label="Review status" value={(data.dueCount ?? 0) > 0 ? `${data.dueCount} due — start today` : 'On track'} good={(data.dueCount ?? 0) === 0} />
      </div>

      {/* 5 · KNOWLEDGE */}
      {know.length > 0 ? (
        <>
          <SectionTitle sub="evidence-based: checkpoints, reviews, recency">Knowledge progress</SectionTitle>
          <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', overflow: 'hidden' }}>
            {know.map((k, i) => (
              <div key={k.lessonId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderTop: i ? `1px solid ${UI.border}` : 'none', fontSize: 13.5 }}>
                <span style={{ color: UI.text, fontWeight: 700 }}>{k.lessonTitle}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {k.checkpointsPassed > 0 ? <span style={{ fontSize: 11.5, color: UI.muted }}>{k.checkpointsPassed} ✓</span> : null}
                  <span style={{ color: STATUS_COLOR[k.status] ?? UI.muted, fontWeight: 800, fontSize: 12.5 }}>{k.status}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {/* 6 · CONTINUE LEARNING */}
      {inProgress.length > 0 ? (
        <>
          <SectionTitle sub={`${inProgress.length} lesson${inProgress.length === 1 ? '' : 's'}`}>Continue learning</SectionTitle>
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
      ) : <EmptyCard />}

      {/* 7 · REVIEWS & WEAK */}
      <SectionTitle sub="memory, scheduled honestly">Reviews & memory</SectionTitle>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px', border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '13px 16px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>{(data.dueCount ?? 0) > 0 ? `Due today · ${data.dueCount}` : 'Nothing due today'}</div>
          {(data.dueCount ?? 0) > 0 ? (
            <a href="/bookmarks" style={{ display: 'inline-block', background: '#8e44ad', color: '#fff', borderRadius: 999, padding: '6px 16px', fontWeight: 800, fontSize: 12.5, textDecoration: 'none' }}>Start review</a>
          ) : (data.upcoming ?? []).length > 0 ? (
            (data.upcoming ?? []).map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: UI.muted, padding: '4px 0' }}>
                <span style={{ color: UI.text }}>{u.label}</span>
                <span>{new Date(u.due).toLocaleDateString('en', { weekday: 'short' })}</span>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12.5, color: UI.muted }}>Your first review appears after you bookmark a moment or pass a checkpoint.</div>
          )}
        </div>
        {(data.weak ?? []).length > 0 ? (
          <div style={{ flex: '1 1 280px', border: '1.5px solid #f0c39a', borderRadius: 16, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', padding: '13px 16px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#8a3a12', marginBottom: 8 }}>Needs reinforcement</div>
            {(data.weak ?? []).map((w) => (
              <a key={w.id} href={`/course/${w.lessonId}?scene=${encodeURIComponent(w.sceneId ?? '')}&t=${w.tMs}`} style={{ display: 'block', fontSize: 12.5, color: '#c0522d', padding: '4px 0', textDecoration: 'none' }}>▶ {w.label}</a>
            ))}
          </div>
        ) : null}
      </div>

      {/* 8 · REFLECTION */}
      <Reflection saved={t.reflection} />

      {/* 9 · TOMORROW */}
      {(data.tomorrow?.review || data.tomorrow?.continueTitle) ? (
        <div style={{ marginTop: 14, border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '13px 16px', fontSize: 13, color: UI.muted }}>
          <b style={{ color: UI.text }}>Tomorrow's first block:</b>{' '}
          {data.tomorrow.review ? <>review “{data.tomorrow.review}”{data.tomorrow.continueTitle ? ', then ' : ''}</> : null}
          {data.tomorrow.continueTitle ? <>continue <b style={{ color: UI.text }}>{data.tomorrow.continueTitle}</b></> : null}
        </div>
      ) : null}

      {/* 10 · WEEKLY TARGET */}
      <SectionTitle sub="scenes + checkpoints + reviews all count">Weekly learning target</SectionTitle>
      <WeeklyTarget total={data.weekTotal ?? 0} goal={data.weekGoal ?? 10} actions={data.weekActions ?? {}} pace={data.pace ?? ''} />

      {/* 11 · HEATMAP */}
      <SectionTitle sub="real learning actions only — opening the app counts for nothing">Activity</SectionTitle>
      <Heatmap days={data.heatmap ?? []} />

      {/* 12 · ACHIEVEMENTS (collapsed) */}
      <details style={{ marginTop: 22 }}>
        <summary style={{ cursor: 'pointer', fontSize: 15, color: UI.text, fontFamily: 'var(--font-newsreader), Georgia, serif' }}>
          Achievements · {(data.badges ?? []).filter((b) => b.earned).length} of {(data.badges ?? []).length}
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 10, marginTop: 12 }}>
          {(data.badges ?? []).map((b) => (
            <div key={b.label} title={b.label} style={{ border: `1px solid ${b.earned ? '#f0c39a' : UI.border}`, borderRadius: 14, background: b.earned ? 'linear-gradient(180deg,#fffdf9,#fff5ec)' : '#fff', padding: '12px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: 24, filter: b.earned ? 'none' : 'grayscale(1) opacity(0.35)' }}>{b.icon}</div>
              <div style={{ fontSize: 10, color: b.earned ? '#8a3a12' : '#c9bda1', marginTop: 4, lineHeight: 1.2, fontWeight: 700 }}>{b.label}</div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Health({ label, value, note, good = false }) {
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 14, background: '#fff', padding: '11px 14px' }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: UI.muted }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: good ? UI.text : '#b3a889', marginTop: 3 }}>{value}</div>
      {note ? <div style={{ fontSize: 11, color: '#c9bda1', marginTop: 2 }}>{note}</div> : null}
    </div>
  );
}

function Reflection({ saved }) {
  const [sent, setSent] = useState(null);
  const choose = (c) => {
    setSent(c);
    fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'reflection', choice: c }) }).catch(() => {});
  };
  const chosen = sent ?? saved;
  return (
    <div style={{ marginTop: 14, border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '13px 16px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: UI.text, marginBottom: 8 }}>What felt unclear today?</div>
      {chosen ? (
        <div style={{ fontSize: 12.5, color: '#2f9e5f' }}>Noted: “{chosen}” — your tutor will lean into this next session.</div>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['The core idea', 'The dry run steps', 'The code', 'Everything was clear'].map((c) => (
            <button key={c} onClick={() => choose(c)} style={{ border: `1.5px solid ${UI.border}`, borderRadius: 999, background: '#fff', color: UI.muted, fontSize: 12, fontWeight: 700, padding: '5px 13px', cursor: 'pointer' }}>{c}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function WeeklyTarget({ total, goal, actions, pace }) {
  const [saving, setSaving] = useState(false);
  const setGoal = (g) => { setSaving(true); fetch('/api/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'goal', weekGoal: g }) }).finally(() => setSaving(false)); };
  const pct = Math.min(100, Math.round((total / goal) * 100));
  return (
    <div style={{ border: `1px solid ${UI.border}`, borderRadius: 16, background: '#fff', padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: UI.text }}>{total} of {goal} verified learning actions</div>
        <select disabled={saving} defaultValue={goal} onChange={(e) => setGoal(Number(e.target.value))} style={{ border: `1px solid ${UI.border}`, borderRadius: 8, background: '#fff', color: UI.muted, fontSize: 12, padding: '3px 8px' }}>
          {[5, 10, 15, 20, 30].map((g) => <option key={g} value={g}>goal: {g}/week</option>)}
        </select>
      </div>
      <div style={{ marginTop: 9, height: 8, borderRadius: 5, background: '#f2e8dc', overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: pct >= 100 ? '#2f9e5f' : 'linear-gradient(90deg,#e8604c,#d35400)', transition: 'width .6s' }} />
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: UI.muted, flexWrap: 'wrap' }}>
        <span>scenes+checkpoints <b style={{ color: UI.text }}>{(actions.scenes ?? 0) + (actions.checkpoints ?? 0)}</b></span>
        <span>reviews <b style={{ color: UI.text }}>{actions.reviews ?? 0}</b></span>
        <span style={{ color: pct >= 100 ? '#2f9e5f' : '#c0522d' }}>{pace}</span>
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
