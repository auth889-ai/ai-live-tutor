'use client';

// Sign in / create account. One form, two actions — the session is an HttpOnly cookie set by
// the auth routes, so no tokens ever touch client JS. After sign-in, on to the Studio.

import { useState } from 'react';

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

  const field = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #e8ddc9', fontSize: 15, marginTop: 8 };

  return (
    <main style={{ maxWidth: 380, margin: '80px auto', padding: '0 16px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24 }}>Forever</h1>
      <p style={{ color: '#8a6d3b', fontSize: 14 }}>Sign in — your courses and notes are private to your account.</p>
      <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
      <input type="password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
      {error && <p style={{ color: '#c0392b', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button disabled={busy} onClick={() => submit('/api/auth/login')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#d35400', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
          Sign in
        </button>
        <button disabled={busy} onClick={() => submit('/api/auth/register')} style={{ flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #d35400', background: '#fff', color: '#d35400', fontSize: 15, cursor: 'pointer' }}>
          Create account
        </button>
      </div>
    </main>
  );
}
