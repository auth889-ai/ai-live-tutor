'use client';

// HAND BOARD — a handwritten-style note board, rendered DYNAMICALLY from a JSON spec.
// The AI plans the board (title, sections, marker highlights, graph doodles) grounded in
// the user's blocks; this engine draws it. Nothing here is fixed content — same law as
// the course boards: AI binds structure, never hardcoded values.

const HL = { yellow: '#FDE68A', orange: '#FBD38D', blue: '#BFDBFE', purple: '#DDD6FE', green: '#BBF7D0', pink: '#FBCFE8' };
const NODE_COLORS = ['#F5B7B1', '#AED6F1', '#ABEBC6', '#F9E79F', '#D7BDE2', '#F5CBA7'];
const HANDF = 'var(--caveat), "Segoe Script", "Comic Sans MS", cursive';

function Marked({ text, marks }) {
  let parts = [String(text ?? '')];
  for (const m of marks ?? []) {
    const term = String(m.term ?? '').trim();
    if (!term) continue;
    parts = parts.flatMap((p) => {
      if (typeof p !== 'string') return [p];
      const i = p.toLowerCase().indexOf(term.toLowerCase());
      if (i < 0) return [p];
      return [p.slice(0, i),
        <span key={`${term}-${i}`} style={{ background: HL[m.color] ?? HL.yellow, borderRadius: 4, padding: '0 5px' }}>{p.slice(i, i + term.length)}</span>,
        p.slice(i + term.length)];
    });
  }
  return parts;
}

function GraphDoodle({ d }) {
  const nodes = (d.nodes ?? []).slice(0, 6);
  const n = nodes.length;
  if (n === 0) return null;
  const cx = 115; const cy = 100; const R = n === 1 ? 0 : 68;
  const pos = Object.fromEntries(nodes.map((nd, i) => [String(nd.label),
    [cx + R * Math.cos((2 * Math.PI * i) / n - Math.PI / 2), cy + R * Math.sin((2 * Math.PI * i) / n - Math.PI / 2)]]));
  return (
    <svg viewBox="0 0 230 200" style={{ width: '100%', maxWidth: 230 }}>
      {(d.edges ?? []).map(([a, b], i) => (pos[a] && pos[b]
        ? <line key={i} x1={pos[a][0]} y1={pos[a][1]} x2={pos[b][0]} y2={pos[b][1]} stroke="#211A14" strokeWidth="1.6" />
        : null))}
      {nodes.map((nd, i) => (
        <g key={i}>
          <circle cx={pos[nd.label][0]} cy={pos[nd.label][1]} r="21" fill={NODE_COLORS[i % NODE_COLORS.length]} stroke="#211A14" strokeWidth="1.6" />
          <text x={pos[nd.label][0]} y={pos[nd.label][1] + 6} textAnchor="middle" fontSize="17" fontFamily={HANDF} fontWeight="700" fill="#211A14">{String(nd.label).slice(0, 4)}</text>
        </g>
      ))}
      {d.caption ? <text x="115" y="193" textAnchor="middle" fontSize="14" fontFamily={HANDF} fill="#77695B">{String(d.caption).slice(0, 34)}</text> : null}
    </svg>
  );
}

export function HandBoard({ spec }) {
  let s;
  try { s = typeof spec === 'string' ? JSON.parse(spec) : spec; } catch { return null; }
  if (!s?.title && !(s?.sections ?? []).length) return null;
  const marks = s.marks ?? [];
  const diagrams = s.diagrams ?? [];
  return (
    <div style={{
      border: '1.5px solid #EBE3D8', borderRadius: 14, padding: '22px 26px', margin: '6px 0',
      background: '#FFFEFB', backgroundImage: 'radial-gradient(#E4DDD1 1px, transparent 1.3px)', backgroundSize: '19px 19px',
      display: 'grid', gridTemplateColumns: diagrams.length ? 'minmax(0,1fr) 230px' : '1fr', gap: 18, alignItems: 'start',
    }}>
      <div>
        <div style={{ fontFamily: HANDF, fontSize: 31, fontWeight: 700, color: '#211A14', lineHeight: 1.1 }}>
          <span style={{ boxShadow: `inset 0 -10px 0 ${HL.yellow}` }}>{s.title}</span>
        </div>
        {(s.sections ?? []).slice(0, 6).map((sec, i) => (
          <div key={i} style={{ marginTop: 16 }}>
            {sec.heading ? (
              <div style={{ fontFamily: HANDF, fontSize: 21, fontWeight: 700, color: '#211A14', marginBottom: 5 }}>
                <span style={{ background: HL.yellow, borderRadius: 4, padding: '0 7px' }}>{sec.heading}</span>
              </div>
            ) : null}
            {sec.para ? <div style={{ fontFamily: HANDF, fontSize: 18.5, color: '#211A14', lineHeight: 1.45, maxWidth: '46ch' }}><Marked text={sec.para} marks={marks} /></div> : null}
            {(sec.bullets ?? []).slice(0, 7).map((b, j) => (
              <div key={j} style={{ fontFamily: HANDF, fontSize: 18.5, color: '#211A14', lineHeight: 1.5, display: 'flex', gap: 8 }}>
                <span>•</span><span><Marked text={b} marks={marks} /></span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {diagrams.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 12 }}>
          {diagrams.slice(0, 3).map((d, i) => <GraphDoodle key={i} d={d} />)}
        </div>
      ) : null}
    </div>
  );
}
