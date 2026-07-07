'use client';

// Sign in / create account. One form, two actions — the session is an HttpOnly cookie set by
// the auth routes, so no tokens ever touch client JS. After sign-in, on to the Studio.
// Premium split layout: image cover with brand + promise on the left, focused form card on
// the right; the cover collapses on narrow screens.

import { useState } from 'react';

const UI = { text: '#2b211a', muted: '#8a6d3b', border: '#f0e2d0', accent: '#f47368', accentDark: '#e8604c' };

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(path) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Something went wrong');
      window.location.href = '/studio';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const field = {
    width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #eadfce',
    fontSize: 15, marginTop: 6, boxSizing: 'border-box', background: '#fffdf9', outlineColor: UI.accent,
  };
  const label = { display: 'block', fontSize: 13, fontWeight: 700, color: UI.muted, marginTop: 16 };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', background: '#fdf6ee', color: UI.text }}>
      <style>{`@media (max-width: 860px) { .login-cover { display: none !important; } }`}</style>

      {/* image cover */}
      <section
        className="login-cover"
        style={{
          flex: 1.2, position: 'relative', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
          backgroundImage: 'linear-gradient(180deg, rgba(30,20,12,0.15) 30%, rgba(30,20,12,0.72)), url(/images/study-22.jpg)',
          backgroundSize: 'cover', backgroundPosition: 'center', padding: 44, color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'absolute', top: 34, left: 44 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: UI.accent, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 17 }}>F</span>
          <span style={{ fontWeight: 800, fontSize: 19 }}>Forever <span style={{ fontWeight: 500, fontSize: 13, opacity: 0.85 }}>AI Tutor</span></span>
        </div>
        <blockquote style={{ margin: 0, maxWidth: 520 }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.25 }}>
            Bring any material.<br />Leave with a course that teaches like the best.
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 18, fontSize: 13.5, opacity: 0.92, flexWrap: 'wrap' }}>
            <span>✓ Narrated live board</span>
            <span>✓ Real code, really executed</span>
            <span>✓ Source-proofed claims</span>
          </div>
        </blockquote>
      </section>

      {/* form */}
      <section style={{ flex: 1, display: 'grid', placeItems: 'center', padding: '40px 20px' }}>
        <div style={{ width: '100%', maxWidth: 400, background: '#fff', border: '1px solid #f0e2d0', borderRadius: 18, padding: '30px 30px 26px', boxShadow: '0 8px 30px rgba(58,46,34,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: UI.accent, color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>F</span>
            <span style={{ fontWeight: 800, fontSize: 17 }}>Welcome to Forever</span>
          </div>
          <p style={{ color: UI.muted, fontSize: 13.5, marginTop: 2 }}>
            Sign in or create an account — your courses and notebooks stay private to you.
          </p>

          <label style={label}>Email</label>
          <input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          <label style={label}>Password</label>
          <input type="password" autoComplete="current-password" placeholder="8+ characters" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && submit('/api/auth/login')} style={field} />

          {error && (
            <p style={{ color: '#a33d2e', background: '#fdf0ee', border: '1px solid #efc7bf', borderRadius: 10, padding: '9px 12px', fontSize: 13, marginTop: 14, marginBottom: 0 }}>
              {error}
            </p>
          )}

          <button disabled={busy} onClick={() => submit('/api/auth/login')}
            style={{ width: '100%', marginTop: 18, padding: '12px 0', borderRadius: 10, border: 'none', background: busy ? '#f5b8ae' : UI.accent, color: '#fff', fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'One moment…' : 'Sign in'}
          </button>
          <button disabled={busy} onClick={() => submit('/api/auth/register')}
            style={{ width: '100%', marginTop: 10, padding: '12px 0', borderRadius: 10, border: `1.5px solid ${UI.accent}`, background: '#fff', color: UI.accentDark, fontSize: 15, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
            Create a free account
          </button>

          <p style={{ color: '#b39b7d', fontSize: 12, textAlign: 'center', marginTop: 16, marginBottom: 0 }}>
            Open source · AGPL-3.0 · built on Qwen Cloud
          </p>
        </div>
      </section>
    </main>
  );
}
