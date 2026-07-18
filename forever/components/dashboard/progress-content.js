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
const hashCover = (id) => COVERS[[...String(id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % COVERS.length];
// Distinct covers: the user's lessons (sorted by id, stable) deal covers in order — no two
// visible lessons share an image until there are more lessons than covers.
const coverMapFor = (ids) => new Map([...new Set(ids)].sort().map((id, i) => [id, COVERS[i % COVERS.length]]));
const STATUS_COLOR = { New: '#9b8465', Learning: '#c98f2d', Developing: '#4477aa', Strong: '#2f7d4a', 'Review due': '#c0522d' };
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

// Colored identity per card: tinted icon chip + label — one accent color per concern.
const CardHead = ({ icon, color, label, right, mb = 0 }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: mb }}>
    <span style={{ width: 26, height: 26, borderRadius: 8, background: `${color}18`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{icon}</span>
    <span style={{ ...T.cap, fontWeight: 800, flex: 1, minWidth: 0 }}>{label}</span>
    {right ?? null}
  </div>
);

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
  const [tab, setTab] = useState('overview'); // hooks stay ABOVE the early return (Rules of Hooks)
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
  const dueN = useCountUp(data?.dueCount ?? 0);
  const savedN = useCountUp((data?.bookmarks ?? []).length);
  if (data === null) return <Skeleton />;
  const inProgress = items.filter((p) => !p.completed);
  const t = data.today ?? {};
  const rec = data.recommended;
  const know = data.knowledge ?? [];
  const knowById = new Map(know.map((k) => [k.lessonId, k]));
  const coverMap = coverMapFor((data.progress ?? []).map((p) => p.lessonId));
  const coverFor = (id) => coverMap.get(id) ?? hashCover(id);
  // MEMORY copy is COMPUTED from the bank's real state — no sentence renders the same for two
  // different learners. Gap math mirrors the store's SM-2 (good: ×2.5, capped 60 days).
  const bms = data.bookmarks ?? [];
  const nextUp = (data.upcoming ?? [])[0] ?? null;
  const nextBk = nextUp ? bms.find((b) => String(b._id ?? b.id) === String(nextUp.id)) : null;
  const wk = (d) => new Date(d).toLocaleDateString('en', { weekday: 'long' });
  const nextGap = (bk) => Math.min(60, Math.max(1, Math.round((bk?.reviewInterval ?? 1) * 2.5)));
  const dueBk = bms.find((b) => b.reviewDue && new Date(b.reviewDue).getTime() <= Date.now()) ?? null;
  const memHead = (data.dueCount ?? 0) > 0
    ? `${data.dueCount} ${data.dueCount === 1 ? 'memory is' : 'memories are'} fading right now`
    : nextUp ? 'Nothing due — your memory holds'
    : bms.length ? 'Every moment reviewed — bank at rest'
    : 'Plant your first memory';
  const memSub = (data.dueCount ?? 0) > 0 && dueBk
    ? `recall “${String(dueBk.note || dueBk.context || 'it').slice(0, 34)}” today and its gap stretches to ${nextGap(dueBk)} days`
    : nextUp ? `“${String(nextUp.label).slice(0, 38)}” returns ${wk(nextUp.due)} — right before you'd forget it`
    : bms.length ? 'new bookmarks join the schedule the moment you save them'
    : 'press B in any lesson — that moment returns tomorrow as a recall prompt';
  const scheduled = bms.filter((b) => b.reviewDue && new Date(b.reviewDue).getTime() > Date.now());
  const farthest = scheduled.reduce((m, b) => Math.max(m, new Date(b.reviewDue).getTime()), 0);
  const focusBk = dueBk ?? nextBk ?? bms.find((b) => b.reviewDue) ?? null;
  const dueDays = Array.from({ length: 14 }, (_, i) => {
    const dt = new Date(Date.now() + i * 24 * 3600 * 1000);
    const key = dt.toISOString().slice(0, 10);
    const n = bms.filter((b) => b.reviewDue && (i === 0
      ? (new Date(b.reviewDue).getTime() <= Date.now() || String(b.reviewDue).slice(0, 10) === key)
      : String(b.reviewDue).slice(0, 10) === key)).length;
    return { key, label: i === 0 ? 'now' : dt.toLocaleDateString('en', { weekday: 'narrow' }), n };
  });
  const forecastCap = scheduled.length
    ? `${scheduled.length} return${scheduled.length === 1 ? '' : 's'} on the calendar · farthest ${new Date(farthest).toLocaleDateString('en', { month: 'short', day: 'numeric' })}`
    : bms.length ? 'grade a recall and its next return lands here' : 'bookmarks build this calendar — none saved yet';
  const TabBtn = ({ id, children }) => (
    <button onClick={() => setTab(id)} style={{
      border: 'none', borderBottom: tab === id ? `2.5px solid ${T.accent}` : '2.5px solid transparent',
      background: 'transparent', color: tab === id ? '#2b211a' : '#9b8465', cursor: 'pointer',
      fontWeight: 800, fontSize: 13.5, padding: '9px 2px', marginRight: 22,
    }}>{children}</button>
  );

  return (
    <div style={{ maxWidth: 1080 }}>
      <style>{`
        .pcard{transition:transform .18s, box-shadow .18s} .pcard:hover{transform:translateY(-3px); box-shadow:0 10px 26px rgba(58,46,34,0.13)!important}
        .ringArc{transition:stroke-dasharray .9s cubic-bezier(.22,1,.36,1)}
        @keyframes pulseDot{0%,100%{box-shadow:0 0 0 0 rgba(232,96,76,.5)}50%{box-shadow:0 0 0 6px rgba(232,96,76,0)}}
        @keyframes toastIn{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
        @keyframes blinkDot{50%{opacity:.3}}
        @keyframes cellIn{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
        .hmcell{transition:background .6s, outline .3s}
        @media (prefers-reduced-motion: no-preference){ .hmcell{animation:cellIn .4s ease-out both} }
        @media (prefers-reduced-motion: reduce){ .pcard,.ringArc,.hmcell{transition:none!important;animation:none!important} }
        .twocol{display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:14px; align-items:start}
        @media (max-width: 980px){ .twocol{grid-template-columns:1fr} }
        .eqcol{display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:14px; align-items:start}
        @media (max-width: 980px){ .eqcol{grid-template-columns:1fr} }
      `}</style>
      {toast ? <div style={{ position: 'fixed', bottom: 22, right: 22, zIndex: 60, background: '#2b211a', color: '#fff', borderRadius: 14, padding: '12px 18px', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', animation: 'toastIn .35s ease-out', fontSize: 14 }}>🎉 Badge earned: <b>{toast}</b></div> : null}

      {/* ===== header ===== */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ ...T.h1, margin: 0 }}>Progress</h1>
          <p style={{ ...T.cap, margin: '4px 0 0' }}>What you learned, what you may forget, and the best next step. <span title="auto-refreshes every 20 seconds" style={{ color: '#2f9e5f', fontWeight: 700, whiteSpace: 'nowrap' }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2f9e5f', marginRight: 4, animation: 'blinkDot 2s infinite' }} />live</span></p>
        </div>
        {data.streak ? <span style={{ ...T.body, fontWeight: 800, color: '#c0522d' }}>🔥 {data.streak}-day streak <span style={{ ...T.cap, fontWeight: 400 }}>· best {data.bestStreak}</span></span> : null}
      </div>

      {/* ===== tabs (progressive disclosure: one dose per view) ===== */}
      <div style={{ borderBottom: '1px solid #f2e3d5', marginTop: 18 }}>
        <TabBtn id="overview">Overview</TabBtn>
        <TabBtn id="lessons">Lessons{inProgress.length ? ` · ${inProgress.length}` : ''}</TabBtn>
        <TabBtn id="memory">Memory{(data.dueCount ?? 0) ? ` · ${data.dueCount} due` : ''}</TabBtn>
        <TabBtn id="awards">Awards</TabBtn>
      </div>

      {tab === 'overview' ? (
        <div style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          {/* HERO — the biggest element on screen (research: the primary KPI dominates), with
              the lesson's own cover imagery. One CTA on the whole view. */}
          {rec ? (
            <a href={`/course/${rec.lessonId}?t=${rec.tMs}&scene=${rec.sceneIndex}`} className="pcard"
              style={{ gridColumn: '1 / -1', position: 'relative', borderRadius: 20, overflow: 'hidden', textDecoration: 'none', minHeight: 210, display: 'flex', alignItems: 'flex-end', boxShadow: '0 6px 24px rgba(58,46,34,0.12)' }}>
              <img src="/images/progress-compass.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 62%' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(43,33,26,0.02) 15%, rgba(43,33,26,0.72))' }} />
              <div style={{ position: 'relative', padding: '22px 24px', width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 1, color: '#ffd9c9' }}>UP NEXT{rec.minutes ? ` · ~${rec.minutes} MIN` : ''}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 4, textShadow: '0 1px 6px rgba(0,0,0,0.4)', fontFamily: 'var(--font-newsreader), Georgia, serif' }}>{rec.lessonTitle}</div>
                  {rec.nextSceneTitle ? <div style={{ fontSize: 13.5, color: 'rgba(255,255,255,0.85)', marginTop: 3 }}>Scene {rec.sceneIndex + 1} · {rec.nextSceneTitle}</div> : null}
                </div>
                <span style={{ background: T.accent, color: '#fff', borderRadius: 999, padding: '11px 26px', fontWeight: 800, fontSize: 14.5, boxShadow: '0 4px 14px rgba(232,96,76,0.45)', whiteSpace: 'nowrap' }}>Continue ▸</span>
              </div>
            </a>
          ) : <div style={{ gridColumn: '1 / -1' }}><EmptyCard /></div>}

          {/* TWO-COLUMN BENTO below the hero (research: F-pattern — work on the left,
              targets & memory in the right rail). Every card is an entry point to its tab. */}
          <div className="twocol" style={{ gridColumn: '1 / -1' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              {/* KPI METRIC STRIP — segmented, dividers, tabular numerals */}
              <div style={{ ...T.card, borderRadius: 20, display: 'flex', alignItems: 'stretch' }}>
                {[[t.scenes ?? 0, 'scenes today'], [t.checkpoints ?? 0, 'checkpoints ✓'], [t.reviews ?? 0, 'reviews'], [t.minutes ?? 0, 'focused min']].map(([n, l], i) => (
                  <div key={l} style={{ flex: 1, padding: '18px 8px', textAlign: 'center', borderLeft: i ? '1px solid #f2e3d5' : 'none' }}>
                    <div style={{ fontSize: 30, fontWeight: 800, color: n > 0 ? '#2b211a' : '#cbbfa8', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
                    <div style={{ ...T.cap, marginTop: 7 }}>{l}</div>
                  </div>
                ))}
              </div>

              {/* JUMP BACK IN — media tiles, not rows: cover forward, live bar under each */}
              {inProgress.length ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '2px 2px 8px' }}>
                    <span style={{ ...T.cap, fontWeight: 800 }}>JUMP BACK IN</span>
                    <button onClick={() => setTab('lessons')} style={{ border: 'none', background: 'transparent', color: T.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>All lessons →</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(3, Math.max(1, inProgress.length))}, 1fr)`, gap: 12 }}>
                    {inProgress.slice(0, 3).map((p) => {
                      const watching = Date.now() - new Date(p.updatedAt).getTime() < 3 * 60 * 1000;
                      return (
                        <a key={p._id} className="pcard" href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`} style={{ ...T.card, borderRadius: 16, overflow: 'hidden', textDecoration: 'none', color: '#2b211a', display: 'block' }}>
                          <div style={{ position: 'relative', aspectRatio: '16/9' }}>
                            <img src={coverFor(p.lessonId)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(43,33,26,0.65))' }} />
                            <div style={{ position: 'absolute', left: 9, bottom: 7, color: '#fff', fontSize: 10.5, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5, textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                              {watching ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e8604c', animation: 'pulseDot 1.6s infinite' }} /> : null}
                              {(p.completedCount ?? 0)}/{p.sceneCount} SCENES
                            </div>
                            <span style={{ position: 'absolute', right: 8, top: 8, background: 'rgba(43,33,26,0.55)', color: '#fff', borderRadius: 999, padding: '3px 9px', fontSize: 10, fontWeight: 800 }}>{(p.percent ?? 0) > 0 ? `${p.percent}%` : 'NEW'}</span>
                          </div>
                          <div style={{ padding: '10px 12px 12px' }}>
                            <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.35, minHeight: 34, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.lessonTitle || p.lessonId}</div>
                            <div style={{ marginTop: 8, height: 4, borderRadius: 99, background: '#f4e9dc', overflow: 'hidden' }}>
                              <div style={{ width: `${Math.max(2, p.percent ?? 0)}%`, height: '100%', background: T.accent, transition: 'width .8s' }} />
                            </div>
                            <div style={{ ...T.cap, marginTop: 6 }}>{(p.scenePercent ?? 0) > 0 ? `scene ${p.sceneIndex + 1} · ${p.scenePercent}% watched` : (p.completedCount ?? 0) > 0 ? `resume scene ${p.sceneIndex + 1}` : `${p.sceneCount} scenes · ~${Math.max(5, (p.sceneCount ?? 0) * 2)} min`}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* KNOWLEDGE — the distribution, not a list: one stacked bar + the single next move */}
              {know.length ? (
                <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ ...T.cap, fontWeight: 800 }}>KNOWLEDGE · {know.length} LESSON{know.length === 1 ? '' : 'S'}</span>
                    <button onClick={() => setTab('lessons')} style={{ border: 'none', background: 'transparent', color: T.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Evidence →</button>
                  </div>
                  {(() => {
                    const order = ['Strong', 'Developing', 'Learning', 'Review due', 'New'];
                    const distr = order.map((st) => [st, know.filter((kk) => kk.status === st).length]).filter(([, n]) => n > 0);
                    const nextK = know.find((kk) => kk.status !== 'Strong');
                    return (
                      <>
                        <div style={{ display: 'flex', height: 10, borderRadius: 99, overflow: 'hidden', marginTop: 12, gap: 2 }}>
                          {distr.map(([st, n]) => (
                            <span key={st} style={{ flex: n, background: STATUS_COLOR[st] ?? '#9b8465', opacity: st === 'New' ? 0.3 : 1 }} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
                          {distr.map(([st, n]) => (
                            <span key={st} style={{ fontSize: 11.5, fontWeight: 800, color: STATUS_COLOR[st], background: `${STATUS_COLOR[st]}12`, borderRadius: 999, padding: '3px 10px' }}>{n} {st}</span>
                          ))}
                        </div>
                        {nextK ? <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: T.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>next: {nextK.next} — {nextK.lessonTitle}</div> : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
            </div>

            {/* RIGHT RAIL — targets, memory, rhythm */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
              <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px' }}>
                <div style={{ ...T.cap, fontWeight: 800, marginBottom: 8 }}>WEEKLY TARGET</div>
                <WeeklyTarget total={data.weekTotal ?? 0} goal={data.weekGoal ?? 10} actions={data.weekActions ?? {}} pace={data.pace ?? ''} bare />
              </div>

              <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ ...T.cap, fontWeight: 800 }}>MEMORY</span>
                  <button onClick={() => setTab('memory')} style={{ border: 'none', background: 'transparent', color: T.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Open →</button>
                </div>
                {(data.dueCount ?? 0) > 0 ? (
                  <a href="/bookmarks" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, textDecoration: 'none' }}>
                    <span style={{ ...T.body, fontWeight: 800 }}>🧠 {data.dueCount} review{data.dueCount === 1 ? '' : 's'} due</span>
                    <span style={{ color: '#c0522d', fontWeight: 800, fontSize: 12.5 }}>Start →</span>
                  </a>
                ) : (data.upcoming ?? []).length ? (
                  <div style={{ marginTop: 6 }}>
                    {(data.upcoming ?? []).slice(0, 3).map((u) => (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '4px 0' }}>
                        <span style={{ color: '#2b211a', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.label}</span>
                        <span style={{ ...T.cap, whiteSpace: 'nowrap' }}>{new Date(u.due).toLocaleDateString('en', { weekday: 'short' })}</span>
                      </div>
                    ))}
                  </div>
                ) : <div style={{ ...T.cap, marginTop: 8, lineHeight: 1.5 }}>Press <b style={{ color: '#2b211a' }}>B</b> in any lesson to bookmark a moment — it becomes your first review.</div>}
              </div>

              <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={{ ...T.cap, fontWeight: 800 }}>LAST 14 DAYS</span>
                  <button onClick={() => setTab('awards')} style={{ border: 'none', background: 'transparent', color: T.accent, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>Full year →</button>
                </div>
                <MiniHeat days={data.heatmap ?? []} />
              </div>

              {(data.tomorrow?.review || data.tomorrow?.continueTitle) ? (
                <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px', fontSize: 12.5, color: '#9b8465', lineHeight: 1.55 }}>
                  <CardHead icon="🌅" color="#c98f2d" label="TOMORROW'S FIRST BLOCK" mb={6} />
                  {data.tomorrow.review ? <>Review “{data.tomorrow.review}”{data.tomorrow.continueTitle ? ', then ' : ''}</> : null}
                  {data.tomorrow.continueTitle ? <>continue <b style={{ color: '#2b211a' }}>{data.tomorrow.continueTitle}</b></> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'lessons' ? (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <span style={T.cap}>{inProgress.length} in flight{items.length - inProgress.length > 0 ? ` · ${items.length - inProgress.length} completed` : ''} — status and next step live on each card</span>
            <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ fontSize: 12, border: '1px solid #f2e3d5', borderRadius: 10, background: '#fff', color: '#6b563d', padding: '5px 10px' }}>
              <option value="recent">Recently active</option>
              <option value="percent">Most progress</option>
              <option value="alpha">A → Z</option>
            </select>
          </div>
          {items.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {items.map((p) => <LessonRow key={p._id} p={p} k={knowById.get(p.lessonId)} cover={coverFor(p.lessonId)} />)}
            </div>
          ) : <EmptyCard />}
        </div>
      ) : null}

      {tab === 'memory' ? (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* banner — the vine plus the bank's real size, one glance */}
          <div style={{ position: 'relative', height: 108, borderRadius: 20, overflow: 'hidden', boxShadow: '0 4px 18px rgba(58,46,34,0.08)' }}>
            <img src="/images/progress-vine.png" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 30%' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, rgba(255,255,255,0.94) 30%, rgba(222,240,222,0.5))' }} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', gap: 14 }}>
              <div>
                <div style={{ fontSize: 19, fontWeight: 700, color: '#2b211a', fontFamily: 'var(--font-newsreader), Georgia, serif' }}>{memHead}</div>
                <div style={{ fontSize: 12, color: '#6b563d', marginTop: 3 }}>{memSub}</div>
              </div>
              <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.78)', border: '1px solid rgba(242,227,213,0.9)', borderRadius: 14, padding: '9px 18px' }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#2f7d4a', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{savedN}</div>
                <div style={{ ...T.cap, marginTop: 3 }}>saved moment{(data.bookmarks ?? []).length === 1 ? '' : 's'}</div>
              </div>
            </div>
          </div>

          {/* stat row — queue, forecast bars, bank */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
            <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px', display: 'flex', flexDirection: 'column', borderTop: '3px solid #e8604c' }}>
              <CardHead icon="🧠" color="#e8604c" label="REVIEW QUEUE" />
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: (data.dueCount ?? 0) > 0 ? '#c0522d' : '#cbbfa8', fontVariantNumeric: 'tabular-nums' }}>{dueN}</span>
                <span style={T.cap}>due now</span>
              </div>
              {(data.dueCount ?? 0) > 0 ? (
                <a href="/bookmarks" style={{ marginTop: 12, alignSelf: 'flex-start', background: T.accent, color: '#fff', borderRadius: 999, padding: '8px 18px', fontWeight: 800, fontSize: 12.5, textDecoration: 'none', boxShadow: '0 3px 10px rgba(232,96,76,0.35)' }}>Start review</a>
              ) : (
                <div style={{ ...T.cap, marginTop: 12, lineHeight: 1.5 }}>{nextUp ? `clear until ${wk(nextUp.due)} — a good recall then stretches its gap to ${nextGap(nextBk)} day${nextGap(nextBk) === 1 ? '' : 's'}` : <>press <b style={{ color: '#2b211a' }}>B</b> in a lesson to save your first moment</>}</div>
              )}
            </div>
            <ForecastCard days={dueDays} caption={forecastCap} />
            <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px', borderTop: '3px solid #2f7d4a' }}>
              <CardHead icon="🌱" color="#2f7d4a" label="MEMORY BANK" />
              {[['moments saved', (data.bookmarks ?? []).length],
                ['recalls done', data.stats?.totalReviews ?? 0],
                ['held on last recall', (data.bookmarks ?? []).filter((bk) => bk.lastGrade === 'good').length],
                ['mature · 21d+ gap', (data.bookmarks ?? []).filter((bk) => (bk.reviewInterval ?? 1) >= 21).length]].map(([l, n]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', marginTop: 2 }}>
                  <span style={{ fontSize: 12.5, color: '#9b8465' }}>{l}</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: n > 0 ? '#2f7d4a' : '#cbbfa8', background: n > 0 ? '#2f7d4a14' : 'transparent', borderRadius: 999, padding: '2px 10px', fontVariantNumeric: 'tabular-nums' }}>{n}</span>
                </div>
              ))}
            </div>
          </div>

          {focusBk ? <ForgettingCurve bk={focusBk} /> : null}

          <div className="eqcol">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {(data.upcoming ?? []).length ? (
            <div style={{ ...T.card, padding: T.pad }}>
              <CardHead icon="⏳" color="#c98f2d" label="COMING BACK" mb={8} />
              {(data.upcoming ?? []).map((u) => {
                const ub = bms.find((b) => String(b._id ?? b.id) === String(u.id));
                const iv = Math.round(ub?.reviewInterval ?? 1);
                const [st, sc] = iv >= 21 ? ['Mature', '#2f7d4a'] : iv >= 2 ? ['Sprout', '#c98f2d'] : ['Seed', '#9b8465'];
                return (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, padding: '6px 0' }}>
                    <span style={{ color: '#2b211a', minWidth: 0, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.label}</span>
                    <span title={`current gap: ${iv} day${iv === 1 ? '' : 's'} — grows toward Mature at 21+ days`} style={{ fontSize: 10.5, fontWeight: 800, color: sc, background: `${sc}14`, borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>{st} · {iv}d</span>
                    <span style={{ ...T.cap, fontWeight: 700, whiteSpace: 'nowrap' }}>{new Date(u.due).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
          {(data.weak ?? []).length ? (
            <div style={{ ...T.card, padding: T.pad }}>
              <div style={{ ...T.cap, fontWeight: 800, marginBottom: 6, color: '#c0522d' }}>NEEDS REINFORCEMENT</div>
              {(data.weak ?? []).map((w) => (
                <a key={w.id} href={`/course/${w.lessonId}?scene=${encodeURIComponent(w.sceneId ?? '')}&t=${w.tMs}`} style={{ display: 'block', fontSize: 12.5, color: '#c0522d', padding: '3px 0', textDecoration: 'none' }}>▶ {w.label}</a>
              ))}
            </div>
          ) : null}
          <Reflection saved={t.reflection} bare />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div style={{ ...T.card, padding: T.pad }}>
            <CardHead icon="🌿" color="#2f7d4a" label="LEARNING HEALTH" mb={8} />
            {[['Progress', `${data.stats?.totalScenes ?? 0} scene${(data.stats?.totalScenes ?? 0) === 1 ? '' : 's'} · ${data.stats?.lessonsDone ?? 0} lesson${(data.stats?.lessonsDone ?? 0) === 1 ? '' : 's'}`, true],
              ['Recall', (data.stats?.totalReviews ?? 0) >= 3 ? `${data.stats.totalReviews} recalls — trend visible`
                : (data.stats?.totalReviews ?? 0) > 0 ? `${data.stats.totalReviews} of 3 recalls for a trend`
                : nextUp ? `first recall opens ${wk(nextUp.due)}` : 'no recalls yet', (data.stats?.totalReviews ?? 0) >= 3],
              ['Verified', (data.stats?.totalCheckpoints ?? 0) > 0 ? `${data.stats.totalCheckpoints} checkpoint${data.stats.totalCheckpoints === 1 ? '' : 's'} passed` : 'answer any quiz inside a lesson', (data.stats?.totalCheckpoints ?? 0) > 0]].map(([l, v, ok]) => (
              <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 0', fontSize: 12.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? '#2f9e5f' : '#e3d7c2', flexShrink: 0 }} />
                <span style={{ flex: 1, color: '#9b8465' }}>{l}</span>
                <span style={{ color: ok ? '#2b211a' : '#b3a889', fontWeight: 700 }}>{v}</span>
              </div>
            ))}
          </div>
          {(data.tomorrow?.review || data.tomorrow?.continueTitle) ? (
            <div style={{ ...T.card, padding: T.pad, fontSize: 12.5, color: '#9b8465', lineHeight: 1.55 }}>
              <CardHead icon="🌅" color="#c98f2d" label="TOMORROW'S FIRST BLOCK" mb={6} />
              {data.tomorrow.review ? <>Review “{data.tomorrow.review}”{data.tomorrow.continueTitle ? ', then ' : ''}</> : null}
              {data.tomorrow.continueTitle ? <>continue <b style={{ color: '#2b211a' }}>{data.tomorrow.continueTitle}</b></> : null}
            </div>
          ) : null}
          </div>
          </div>
        </div>
      ) : null}

      {tab === 'awards' ? (
        <div style={{ marginTop: 24 }}>
          <YearStats days={data.heatmap ?? []} bestStreak={data.bestStreak ?? 0} />
          <div style={{ marginTop: 14 }}>
            <Heatmap days={data.heatmap ?? []} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 14 }}>
            {(data.badges ?? []).map((b) => <BadgeMeter key={b.label} b={b} />)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// One lesson = one row card: cover, scene pills, status chip, evidence and the computed next
// step all together — the old separate Knowledge table lived inside these cards' data anyway.
function LessonRow({ p, k, cover }) {
  const started = (p.tMs ?? 0) > 0 || (p.completedCount ?? 0) > 0;
  const label = p.completed ? '↻ REVISIT' : (p.completedCount ?? 0) > 0 ? `▶ RESUME · SCENE ${p.sceneIndex + 1}` : (p.tMs ?? 0) > 0 ? `▶ CONTINUE SCENE ${p.sceneIndex + 1}` : '▶ START LESSON';
  const watching = Date.now() - new Date(p.updatedAt).getTime() < 3 * 60 * 1000 && !p.completed;
  const status = k?.status ?? (p.completed ? 'Strong' : 'New');
  const col = STATUS_COLOR[status] ?? '#9b8465';
  const ev = k?.evidence ?? {};
  const evidence = [
    ev.scenes > 0 ? `${ev.scenes}/${ev.sceneCount} scenes` : (p.scenePercent ?? 0) > 0 && !p.completed ? `scene ${p.sceneIndex + 1} · ${p.scenePercent}% watched` : started ? 'just started' : `${p.sceneCount} scenes · ~${Math.max(5, (p.sceneCount ?? 0) * 2)} min`,
    ev.checkpoints > 0 ? `${ev.checkpoints} checkpoint${ev.checkpoints === 1 ? '' : 's'} ✓` : null,
    ev.goodReviews > 0 ? `${ev.goodReviews} good review${ev.goodReviews === 1 ? '' : 's'}` : null,
    ago(p.updatedAt),
  ].filter(Boolean).join(' · ');
  return (
    <a className="pcard" href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`}
      style={{ display: 'flex', gap: 16, alignItems: 'stretch', ...T.card, borderRadius: 18, padding: 12, textDecoration: 'none', color: '#2b211a' }}>
      <div style={{ position: 'relative', width: 168, minHeight: 108, borderRadius: 12, overflow: 'hidden', flexShrink: 0 }}>
        <img src={cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(43,33,26,0.6))' }} />
        <div style={{ position: 'absolute', left: 10, bottom: 8, color: '#fff', fontSize: 11, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {watching ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#e8604c', animation: 'pulseDot 1.6s infinite' }} title="watching now" /> : null}
          {p.completed ? 'COMPLETED ✓' : `${p.completedCount ?? 0}/${p.sceneCount} SCENES`}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.3, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.lessonTitle || p.lessonId}</span>
          <span style={{ fontSize: 11.5, fontWeight: 800, whiteSpace: 'nowrap', color: col, background: `${col}14`, borderRadius: 999, padding: '3px 10px', flexShrink: 0 }}>{status}</span>
        </div>
        {p.sceneCount > 0 && p.sceneCount <= 24 ? (
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: p.sceneCount }, (_, i) => (
              <span key={i} style={{ flex: 1, maxWidth: 18, height: 8, borderRadius: 3, background: i < (p.completedCount ?? 0) ? '#4fae5c' : i === p.sceneIndex && !p.completed ? '#f47368' : '#f2e8dc' }} />
            ))}
          </div>
        ) : null}
        <div style={{ ...T.cap, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{evidence}</div>
        {k?.next && !p.completed ? <div style={{ fontSize: 12, fontWeight: 700, color: T.accent, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>next: {k.next}</div> : null}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, paddingRight: 8, flexShrink: 0 }}>
        <Ring percent={p.completed ? 100 : (p.percent ?? 0)} done={p.completed} started={started} />
        <span style={{ fontSize: 11, fontWeight: 800, color: T.accent, border: `1.5px solid ${T.accent}`, borderRadius: 999, padding: '5px 13px', whiteSpace: 'nowrap' }}>{label}</span>
      </div>
    </a>
  );
}

function LessonCard({ p }) {
  return (
    <a className="pcard" href={`/course/${p.lessonId}?t=${p.tMs}&scene=${p.sceneIndex}`}
      style={{ border: `1px solid ${UI.border}`, borderRadius: 18, overflow: 'hidden', background: UI.card, textDecoration: 'none', color: UI.text, boxShadow: '0 2px 10px rgba(58,46,34,0.06)' }}>
      <div style={{ position: 'relative', height: 108, overflow: 'hidden' }}>
        <img src={hashCover(p.lessonId)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(43,33,26,0.55))' }} />
        <div style={{ position: 'absolute', right: 10, bottom: -14 }}><Ring percent={p.percent} done={p.completed} started={(p.tMs ?? 0) > 0 || (p.completedCount ?? 0) > 0} /></div>
        <div style={{ position: 'absolute', left: 12, bottom: 8, color: '#fff', fontSize: 11.5, fontWeight: 800, textShadow: '0 1px 4px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {Date.now() - new Date(p.updatedAt).getTime() < 3 * 60 * 1000 && !p.completed ? (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e8604c', animation: 'pulseDot 1.6s infinite' }} title="watching now" />
          ) : null}
          {p.completed ? 'COMPLETED ✓' : (p.completedCount ?? 0) > 0 ? `▶ RESUME · SCENE ${p.sceneIndex + 1}` : (p.tMs ?? 0) > 0 ? `▶ CONTINUE SCENE ${p.sceneIndex + 1}` : '▶ START LESSON'}
        </div>
      </div>
      <div style={{ padding: '16px 14px 13px' }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.3, minHeight: 38, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.lessonTitle || p.lessonId}</div>
        {p.sceneCount > 0 && p.sceneCount <= 24 ? (
          <div style={{ display: 'flex', gap: 3, margin: '9px 0 7px' }}>
            {Array.from({ length: p.sceneCount }, (_, i) => (
              <span key={i} style={{ flex: 1, maxWidth: 14, height: 9, borderRadius: 3, background: i < (p.completedCount ?? 0) ? '#2f9e5f' : i === p.sceneIndex && !p.completed ? '#f47368' : '#f2e8dc' }} />
            ))}
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: UI.muted }}>
          <span>{(p.scenePercent ?? 0) > 0 && !p.completed ? `scene ${p.sceneIndex + 1} · ${p.scenePercent}% watched` : (p.completedCount ?? 0) > 0 ? `${p.completedCount}/${p.sceneCount} scenes` : (p.tMs ?? 0) > 0 ? `just started · ${p.sceneCount} scenes` : `${p.sceneCount} scenes · not started`}</span>
          <span>{ago(p.updatedAt)}</span>
        </div>
      </div>
    </a>
  );
}

function Ring({ percent, done, started = true }) {
  const r = 24; const c = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return (
    <svg width="62" height="62" viewBox="0 0 62 62" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.25))' }}>
      <circle cx="31" cy="31" r={r} fill="rgba(255,255,255,0.92)" />
      <circle cx="31" cy="31" r={r} fill="none" stroke="#f2e8dc" strokeWidth="5" />
      <circle className="ringArc" cx="31" cy="31" r={r} fill="none" stroke={done ? '#2f9e5f' : '#f47368'} strokeWidth="5" strokeLinecap="round"
        strokeDasharray={`${(on ? (percent / 100) * c : 0)} ${c}`} transform="rotate(-90 31 31)" />
      <text x="31" y="35" textAnchor="middle" fontSize="13" fontWeight="800" fill={done ? '#2f9e5f' : '#c0522d'}>{done ? '✓' : percent > 0 ? `${percent}%` : '▶'}</text>
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
  const today = byDate.get(todayKey) ?? { scenes: 0, reviews: 0, bookmarks: 0, checkpoints: 0, notebook: 0 };
  const todayTotal = useCountUp((today.scenes ?? 0) + (today.reviews ?? 0) + (today.bookmarks ?? 0) + (today.checkpoints ?? 0) + (today.notebook ?? 0));
  // FULL GRID (GitHub-style): 52 complete weeks ending this week — every column has all 7
  // cells; days after today render as faint placeholders so the rectangle is never ragged.
  const WEEKS = 52;
  const end = new Date();
  const start = new Date(end); start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const cells = [];
  const monthRow = [];
  let lastMonth = '';
  for (let w = 0; w < WEEKS; w += 1) {
    const colDate = new Date(start); colDate.setDate(start.getDate() + w * 7);
    const m = colDate.toLocaleString('en', { month: 'short' });
    monthRow.push(m !== lastMonth ? m : '');
    lastMonth = m;
    for (let d = 0; d < 7; d += 1) {
      const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
      const key = dt.toISOString().slice(0, 10);
      const rec = byDate.get(key);
      cells.push({ key, w, d, future: dt > end, n: (rec?.scenes ?? 0) + (rec?.reviews ?? 0) + (rec?.bookmarks ?? 0) + (rec?.checkpoints ?? 0) + (rec?.notebook ?? 0) });
    }
  }
  const shade = (n) => (n === 0 ? '#efe7da' : n < 2 ? '#c5e6c0' : n < 4 ? '#8ed08d' : n < 7 ? '#4fae5c' : '#2f7d4a');
  return (
    <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#2b211a' }}>Activity <span style={{ color: '#9b8465', fontWeight: 400 }}>· last 12 months</span></div>
        <div style={{ fontSize: 12, color: (today.scenes + today.reviews + (today.bookmarks ?? 0) + (today.checkpoints ?? 0) + (today.notebook ?? 0)) > 0 ? '#2f7d4a' : '#9b8465', fontWeight: 700 }}>
          today: {todayTotal} action{todayTotal === 1 ? '' : 's'}
        </div>
      </div>
      {/* month axis spans the SAME grid as the cells — labels align with their columns */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gap: 3, marginBottom: 4 }}>
        {monthRow.map((m, i) => <span key={i} style={{ fontSize: 8.5, color: '#9b8465', overflow: 'visible', whiteSpace: 'nowrap' }}>{m}</span>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${WEEKS}, 1fr)`, gridTemplateRows: 'repeat(7, 1fr)', gridAutoFlow: 'column', gap: 3 }}>
        {cells.map((c) => (
          <span key={c.key} className="hmcell" title={c.future ? '' : `${c.key}: ${c.n} action${c.n === 1 ? '' : 's'}`}
            style={{
              aspectRatio: '1', borderRadius: 2.5, minWidth: 0,
              background: c.future ? 'transparent' : shade(c.n),
              boxShadow: c.future || c.n > 0 ? 'none' : 'inset 0 0 0 1px rgba(58,46,34,0.05)',
              border: c.future ? '1px dashed #f2e3d5' : 'none',
              outline: c.key === todayKey ? '1.5px solid #2f7d4a' : 'none', outlineOffset: 1,
              animationDelay: `${(c.w * 7 + c.d) * 1.5}ms`,
            }} />
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end', marginTop: 9, fontSize: 9.5, color: '#9b8465' }}>
        less {[0, 1, 3, 5, 8].map((n) => <span key={n} style={{ width: 10, height: 10, borderRadius: 2, background: shade(n) }} />)} more
      </div>
    </div>
  );
}

// 14-day strip for the Overview rail — same shade scale as the year heatmap, today outlined.
function MiniHeat({ days }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const shade = (n) => (n === 0 ? '#efe7da' : n < 2 ? '#c5e6c0' : n < 4 ? '#8ed08d' : n < 7 ? '#4fae5c' : '#2f7d4a');
  const cells = [];
  const now = new Date();
  for (let i = 13; i >= 0; i -= 1) {
    const dt = new Date(now); dt.setDate(now.getDate() - i);
    const key = dt.toISOString().slice(0, 10);
    const rec = byDate.get(key);
    cells.push({ key, n: (rec?.scenes ?? 0) + (rec?.reviews ?? 0) + (rec?.bookmarks ?? 0) + (rec?.checkpoints ?? 0) + (rec?.notebook ?? 0) + (rec?.bookmarks ?? 0), today: i === 0 });
  }
  const active = cells.filter((c) => c.n > 0).length;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(14, 1fr)', gap: 4 }}>
        {cells.map((c) => (
          <span key={c.key} className="hmcell" title={`${c.key}: ${c.n} action${c.n === 1 ? '' : 's'}`}
            style={{ aspectRatio: '1', borderRadius: 4, background: shade(c.n), outline: c.today ? '1.5px solid #2f7d4a' : 'none', outlineOffset: 1 }} />
        ))}
      </div>
      <div style={{ ...T.cap, marginTop: 8 }}>{active} of 14 day{active === 1 ? '' : 's'} active · {cells.reduce((a, c) => a + c.n, 0)} actions</div>
    </div>
  );
}

// Anki-style future-due chart: one column per day for two weeks, straight from each
// bookmark's reviewDue. Today red, tomorrow amber, later green — urgency fades to growth.
function ForecastCard({ days, caption }) {
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px', borderTop: '3px solid #eb9a3d' }}>
      <CardHead icon="📅" color="#eb9a3d" label="REVIEWS AHEAD · 14 DAYS" />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 76, marginTop: 12 }}>
        {days.map((d, i) => (
          <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, minWidth: 0, height: '100%' }}>
            {d.n > 0 ? <span style={{ fontSize: 9.5, fontWeight: 800, color: '#2b211a' }}>{d.n}</span> : null}
            <div title={`${d.key}: ${d.n} due`} style={{ width: '100%', borderRadius: 4, height: d.n > 0 ? `${Math.max(14, (d.n / max) * 48)}px` : '4px', background: d.n === 0 ? '#f0e8db' : i === 0 ? '#e8604c' : i === 1 ? '#eb9a3d' : '#8ccf8a' }} />
            <span style={{ fontSize: 8.5, color: i === 0 ? '#2b211a' : '#b3a889', fontWeight: i === 0 ? 800 : 400 }}>{d.label}</span>
          </div>
        ))}
      </div>
      <div style={{ ...T.cap, marginTop: 8 }}>{caption}</div>
    </div>
  );
}

// Ebbinghaus curve for ONE moment: modeled recall decays from the last touch toward the
// scheduled return, which lands at the classic ~35% review point. The % is a model estimate
// (labeled as such); the dates and the schedule are real records.
function ForgettingCurve({ bk }) {
  const start = new Date(bk.lastReviewed ?? bk.createdAt ?? Date.now()).getTime();
  const end = new Date(bk.reviewDue).getTime();
  const now = Date.now();
  const span = Math.max(1, end - start);
  const tau = span / 1.05; // S(end) = e^-1.05 ≈ 0.35
  const S = (t) => Math.exp(-Math.max(0, t - start) / tau);
  const W = 560, H = 128, pad = 14;
  const x = (t) => pad + ((t - start) / (span * 1.25)) * (W - 2 * pad);
  const y = (v) => 16 + (1 - v) * (H - 48);
  const ptArr = Array.from({ length: 48 }, (_, i) => {
    const t = start + (i / 47) * span * 1.25;
    return [x(t), y(S(t))];
  });
  const fmt = ([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`;
  const solidArr = ptArr.slice(0, 39);
  const solid = solidArr.map(fmt).join(' ');
  const after = ptArr.slice(38).map(fmt).join(' ');
  const area = `${solid} ${solidArr[solidArr.length - 1][0].toFixed(1)},${y(0)} ${pad},${y(0)}`;
  const nowT = Math.min(Math.max(now, start), end);
  const nowPct = Math.round(S(nowT) * 100);
  const label = String(bk.note || bk.context || 'this moment').slice(0, 30);
  const day = (t) => new Date(t).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div style={{ ...T.card, borderRadius: 20, padding: '16px 18px', borderTop: '3px solid #4477aa' }}>
      <CardHead icon="📉" color="#4477aa" label={`FORGETTING CURVE · “${label}”`}
        right={<span style={{ ...T.cap, whiteSpace: 'nowrap' }}>modeled recall now ≈ <b style={{ color: nowPct > 60 ? '#2f7d4a' : nowPct > 35 ? '#c98f2d' : '#c0522d', fontSize: 13 }}>{nowPct}%</b></span>} />
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 8, display: 'block' }}>
        <defs>
          <linearGradient id="fcArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e8604c" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#e8604c" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <rect x={pad} y={y(1)} width={W - 2 * pad} height={y(0.6) - y(1)} fill="#2f9e5f" opacity="0.06" />
        <rect x={pad} y={y(0.6)} width={W - 2 * pad} height={y(0.35) - y(0.6)} fill="#eb9a3d" opacity="0.07" />
        <rect x={pad} y={y(0.35)} width={W - 2 * pad} height={y(0) - y(0.35)} fill="#e8604c" opacity="0.05" />
        <text x={pad + 4} y={y(0.8)} fontSize="8" fontWeight="700" fill="#2f9e5f" opacity="0.75">strong</text>
        <text x={pad + 4} y={y(0.47)} fontSize="8" fontWeight="700" fill="#c98f2d" opacity="0.8">fading</text>
        <text x={pad + 4} y={y(0.16)} fontSize="8" fontWeight="700" fill="#c0522d" opacity="0.7">at risk</text>
        <line x1={pad} y1={y(1)} x2={W - pad} y2={y(1)} stroke="#f2e3d5" strokeDasharray="3 4" />
        <line x1={pad} y1={y(0.35)} x2={W - pad} y2={y(0.35)} stroke="#f2e3d5" strokeDasharray="3 4" />
        <text x={W - pad} y={y(1) - 4} textAnchor="end" fontSize="8.5" fill="#b3a889">100%</text>
        <text x={W - pad} y={y(0.35) - 4} textAnchor="end" fontSize="8.5" fill="#b3a889">35% — the review lands here</text>
        <polygon points={area} fill="url(#fcArea)" />
        <polyline points={after} fill="none" stroke="#d8cbb6" strokeWidth="2" strokeDasharray="4 5" />
        <polyline points={solid} fill="none" stroke="#e8604c" strokeWidth="2.5" strokeLinecap="round" />
        <line x1={x(nowT)} y1={14} x2={x(nowT)} y2={H - 28} stroke="#2b211a" strokeDasharray="2 3" opacity="0.5" />
        <circle cx={x(nowT)} cy={y(S(nowT))} r="4.5" fill="#2b211a" stroke="#fff" strokeWidth="1.5" />
        <text x={Math.min(x(nowT) + 6, W - 44)} y={22} fontSize="9" fontWeight="700" fill="#2b211a">now · {nowPct}%</text>
        <circle cx={x(end)} cy={y(S(end))} r="5.5" fill="#2f9e5f" stroke="#fff" strokeWidth="1.5" />
        <text x={pad} y={H - 6} fontSize="8.5" fill="#b3a889">{day(start)} — saved</text>
        <text x={x(end)} y={H - 6} textAnchor="middle" fontSize="9" fontWeight="800" fill="#2f7d4a">{day(end)} — review</text>
      </svg>
      <div style={{ ...T.cap, marginTop: 4 }}>memory decays along the Ebbinghaus curve — the return on {new Date(end).toLocaleDateString('en', { weekday: 'long' })} resets it to full, then the gap stretches</div>
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
    <div>
      <style>{`@keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}} .sk{background:linear-gradient(100deg,#fdf1ea 30%,#fff 50%,#fdf1ea 70%); background-size:800px 100%; animation:shimmer 1.4s infinite linear; border:1px solid #f5e6d9; border-radius:20px}`}</style>
      <div className="sk" style={{ height: 210, marginBottom: 14 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div className="sk" style={{ height: 110 }} />
        <div className="sk" style={{ height: 110 }} />
      </div>
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


// Year in numbers — computed from the day records, filling Awards with real content.
function YearStats({ days, bestStreak }) {
  const acts = days.map((d) => (d.scenes ?? 0) + (d.reviews ?? 0) + (d.bookmarks ?? 0) + (d.checkpoints ?? 0) + (d.notebook ?? 0));
  const total = acts.reduce((a, n) => a + n, 0);
  const activeDays = acts.filter((n) => n > 0).length;
  const best = days.reduce((m, d) => {
    const n = (d.scenes ?? 0) + (d.reviews ?? 0) + (d.bookmarks ?? 0) + (d.checkpoints ?? 0) + (d.notebook ?? 0);
    return n > m.n ? { n, date: d.date } : m;
  }, { n: 0, date: null });
  const tiles = [
    [total, 'actions this year'],
    [activeDays, 'active days'],
    [best.n, best.date ? `best day · ${new Date(best.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}` : 'best day'],
    [bestStreak, 'longest streak'],
  ];
  return (
    <div style={{ ...T.card, borderRadius: 20, display: 'flex' }}>
      {tiles.map(([n, l], i) => (
        <div key={l} style={{ flex: 1, padding: '16px 8px', textAlign: 'center', borderLeft: i ? '1px solid #f2e3d5' : 'none' }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: n > 0 ? '#2b211a' : '#cbbfa8', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
          <div style={{ ...T.cap, marginTop: 6 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

// A badge is a live meter: the ring fills as the evidence approaches the target.
function BadgeMeter({ b }) {
  const pct = b.target > 0 ? Math.round((b.current / b.target) * 100) : 0;
  const r = 26; const c = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 80); return () => clearTimeout(t); }, []);
  return (
    <div title={`${b.label}: ${b.current}/${b.target}`} style={{ ...T.card, borderRadius: 18, padding: '14px 8px 12px', textAlign: 'center', borderColor: b.earned ? '#f0c39a' : '#f2e3d5', background: b.earned ? 'linear-gradient(180deg,#fffdf9,#fff5ec)' : '#fff' }}>
      <div style={{ position: 'relative', width: 64, height: 64, margin: '0 auto' }}>
        <svg width="64" height="64" viewBox="0 0 64 64" style={{ position: 'absolute', inset: 0 }}>
          <circle cx="32" cy="32" r={r} fill="none" stroke="#f2e8dc" strokeWidth="4.5" />
          <circle className="ringArc" cx="32" cy="32" r={r} fill="none" stroke={b.earned ? '#2f9e5f' : '#f47368'} strokeWidth="4.5" strokeLinecap="round"
            strokeDasharray={`${(on ? (pct / 100) * c : 0)} ${c}`} transform="rotate(-90 32 32)" />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, filter: b.earned ? 'none' : 'grayscale(0.9) opacity(0.55)' }}>{b.icon}</div>
      </div>
      <div style={{ fontSize: 11, fontWeight: 800, color: b.earned ? '#8a3a12' : '#9b8465', marginTop: 8, lineHeight: 1.25 }}>{b.label}</div>
      <div style={{ fontSize: 10, color: b.earned ? '#2f9e5f' : '#c9bda1', marginTop: 2, fontWeight: 700 }}>{b.earned ? 'earned ✓' : `${b.current}/${b.target}`}</div>
    </div>
  );
}
