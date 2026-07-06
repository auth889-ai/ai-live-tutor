'use client';

// Tutor callout card — colored box + icon per purpose (research: per-purpose, restraint).
// The premium "human tutor" device that lands across every subject.

const STYLES = {
  mistake: { icon: '⚠️', label: 'Common Mistake', bg: '#fdecea', border: '#e06c75', color: '#8a2a22' },
  checkpoint: { icon: '🤔', label: 'Pause & Think', bg: '#eaf2fb', border: '#4a90d9', color: '#1f4e79' },
  recap: { icon: '📌', label: 'Key Takeaways', bg: '#eef8ef', border: '#27ae60', color: '#1c6b3a' },
  tip: { icon: '💡', label: 'Pro Tip', bg: '#fef8e7', border: '#e5c07b', color: '#8a6d12' },
  analogy: { icon: '🔗', label: 'Analogy', bg: '#f4eefb', border: '#8e44ad', color: '#5b2d78' },
  insight: { icon: '✨', label: 'Key Insight', bg: '#fff3ec', border: '#d35400', color: '#8a3a12' },
};

export function CalloutView({ content }) {
  const s = STYLES[content.variant] ?? STYLES.tip;
  const bodyList = Array.isArray(content.body);
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', background: s.bg, border: `2px solid ${s.border}`, borderRadius: 12, padding: '16px 20px' }}>
      <div style={{ fontWeight: 700, color: s.color, marginBottom: 8, fontSize: 16 }}>
        <span style={{ marginRight: 8 }}>{s.icon}</span>
        {content.title || s.label}
      </div>
      {bodyList ? (
        <ul style={{ margin: 0, paddingLeft: 22, color: s.color, fontSize: 16, lineHeight: 1.6 }}>
          {content.body.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <div style={{ color: s.color, fontSize: 17, lineHeight: 1.6 }}>{content.body}</div>
      )}
    </div>
  );
}
