'use client';

// CONTINUE-LEARNING CARD (Coursera/Udemy fixed-position resume + Readwise daily review):
// the first thing a returning student sees — resume exactly where they stopped, today's
// review count, and the streak. All deterministic reads of /api/study.
import { useEffect, useState } from 'react';

export function ContinueCard() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/api/study').then((r) => r.json()).then(setData).catch(() => {}); }, []);
  if (!data?.signedIn) return null;
  const next = (data.progress ?? []).find((p) => !p.completed);
  if (!next && !data.dueCount && !data.streak) return null;
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch', marginBottom: 18 }}>
      {next ? (
        <a href={`/course/${next.lessonId}?t=${next.tMs}&scene=${next.sceneIndex}`} style={{ flex: '2 1 320px', textDecoration: 'none', border: '1.5px solid #f0c39a', borderRadius: 14, background: 'linear-gradient(180deg,#fffdf9,#fff5ec)', padding: '14px 16px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#8a3a12', marginBottom: 4 }}>▶ CONTINUE LEARNING</div>
          <div style={{ fontWeight: 800, color: '#2b211a' }}>{next.lessonTitle || next.lessonId}</div>
          <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: '#f2e8dc', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(2, next.percent)}%`, height: '100%', background: 'linear-gradient(90deg,#e8604c,#d35400)' }} />
          </div>
          <div style={{ marginTop: 5, fontSize: 12, color: '#8a6d3b' }}>Scene {next.sceneIndex + 1} of {next.sceneCount} · {next.percent}% — picks up exactly where you left off</div>
        </a>
      ) : null}
      {data.dueCount > 0 ? (
        <a href="/bookmarks" style={{ flex: '1 1 160px', textDecoration: 'none', border: '1px solid #f0dcd5', borderRadius: 14, background: '#fffcfa', padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#8e44ad' }}>🧠 {data.dueCount}</div>
          <div style={{ fontSize: 12.5, color: '#8a6d3b' }}>moment{data.dueCount === 1 ? '' : 's'} due for review today</div>
        </a>
      ) : null}
      {data.streak > 0 ? (
        <div style={{ flex: '1 1 140px', border: '1px solid #f0dcd5', borderRadius: 14, background: '#fffcfa', padding: '14px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#d35400' }}>🔥 {data.streak}</div>
          <div style={{ fontSize: 12.5, color: '#8a6d3b' }}>day streak — any scene or review keeps it alive</div>
        </div>
      ) : null}
    </div>
  );
}
