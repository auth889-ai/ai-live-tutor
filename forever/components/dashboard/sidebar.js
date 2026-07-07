'use client';

// Dashboard sidebar (the mockup's left rail): brand, navigation, tools, and the user
// footer with SIGN OUT. Client component because sign-out is an action; everything else
// is presentation. Items that aren't built yet are shown disabled ("soon") — honest UI,
// no dead links.

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f0e2d0', accent: '#f47368', soft: '#fdece8' };

export function DashboardSidebar({ email, active = 'home' }) {
  const nav = [
    { key: 'home', icon: '🏠', label: 'Home', href: '/dashboard' },
    { key: 'studio', icon: '✨', label: 'New course', href: '/studio' },
    { key: 'courses', icon: '📚', label: 'My Courses', href: '/courses' },
  ];
  const soon = [
    ['📓', 'Notebook'],
    ['🧠', 'Quizzes'],
    ['📊', 'Progress'],
    ['🔖', 'Bookmarks'],
  ];
  const name = (email || '').split('@')[0].replace(/[._-]+/g, ' ');

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/';
  }

  return (
    <aside style={{
      width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4,
      background: '#fff', border: `1px solid ${UI.border}`, borderRadius: 18, padding: 16,
      position: 'sticky', top: 16, alignSelf: 'flex-start', minHeight: 'calc(100vh - 32px)', boxSizing: 'border-box',
    }}>
      <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: UI.text, marginBottom: 14, padding: '4px 6px' }}>
        <span style={{ width: 32, height: 32, borderRadius: 10, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16 }}>F</span>
        <span style={{ fontWeight: 800, fontSize: 18 }}>Forever <span style={{ display: 'block', fontWeight: 500, fontSize: 11, color: UI.muted }}>AI Tutor</span></span>
      </a>

      {nav.map((item) => (
        <a key={item.key} href={item.href} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12,
          textDecoration: 'none', fontSize: 14.5, fontWeight: 700,
          color: active === item.key ? UI.accent : UI.text,
          background: active === item.key ? UI.soft : 'transparent',
        }}>
          <span>{item.icon}</span> {item.label}
        </a>
      ))}

      <div style={{ fontSize: 11, fontWeight: 800, color: '#b39b7d', letterSpacing: 1, margin: '14px 0 4px', padding: '0 12px' }}>COMING SOON</div>
      {soon.map(([icon, label]) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 14, color: '#c9b394' }}>
          <span>{icon}</span> {label}
        </span>
      ))}

      <div style={{ marginTop: 'auto', borderTop: `1px solid ${UI.border}`, paddingTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 34, height: 34, borderRadius: '50%', background: UI.soft, color: UI.accent, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, textTransform: 'uppercase' }}>
          {(name || 'u')[0]}
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 700, textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Learner'}</span>
          <span style={{ display: 'block', fontSize: 11, color: UI.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
        </span>
        <button onClick={signOut} title="Sign out"
          style={{ border: `1px solid ${UI.border}`, background: '#fff', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', fontSize: 13 }}>
          ⎋
        </button>
      </div>
      <button onClick={signOut}
        style={{ marginTop: 8, width: '100%', padding: '9px 0', borderRadius: 10, border: `1px solid ${UI.border}`, background: '#fff', color: UI.muted, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
        Sign out
      </button>
    </aside>
  );
}
