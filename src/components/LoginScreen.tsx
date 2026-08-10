import React, { useState, useEffect } from 'react';
import { useAuth } from '../state/AuthContext';
import { auth } from '../data/api';
import { APP_VERSION } from '../version';

type DevUser = { id: string; name: string; email: string; role: string };

/**
 * Sign in.
 *
 * Password sign-in is the norm and is the ONLY option on the live site. Locally,
 * when the server has dev-login enabled (PROSPECTOR_DEV_LOGIN, never set in
 * production), it also offers a passwordless "switch user" picker so the app can
 * be tested as any user without typing passwords.
 */
export function LoginScreen() {
  const { signIn, devSignIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Dev-only "switch user": populated from the server (empty on the live site).
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    auth.config()
      .then(c => setDevUsers(c.devLogin ? c.users : []))
      .catch(() => setDevUsers([]));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    if (err) setError(err);
    setBusy(false);
  };

  const pickUser = async (id: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await devSignIn(id);
    if (err) setError(err);
    setBusy(false);
  };

  const devMode = devUsers.length > 0;

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
      position: 'relative',
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        padding: 32,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <h1 style={{
            fontSize: '1.75rem', fontWeight: 700,
            color: 'var(--gold)', marginBottom: 8,
          }}>
            Prospector
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Internal calling-data platform
          </p>
        </div>

        {devMode && !showPassword && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Switch user (local testing)</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>Pick a user to sign in as — no password needed.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {devUsers.map(u => (
                <button key={u.id} type="button" className="btn" disabled={busy}
                  onClick={() => pickUser(u.id)}
                  style={{ justifyContent: 'space-between', textAlign: 'left', padding: '10px 14px' }}>
                  <span style={{ fontWeight: 600 }}>{u.name}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{u.role}</span>
                </button>
              ))}
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--error)15', border: '1px solid var(--error)', borderRadius: 8, color: 'var(--error)', fontSize: '0.8125rem' }}>{error}</div>
            )}
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => { setShowPassword(true); setError(null); }}>
              Sign in with a password instead
            </button>
          </div>
        )}

        {(!devMode || showPassword) && (
        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: 24,
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block', fontSize: '0.8125rem',
              fontWeight: 500, marginBottom: 6, color: 'var(--text)',
            }}>
              Email
            </label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@company.ae"
              required
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{
              display: 'block', fontSize: '0.8125rem',
              fontWeight: 500, marginBottom: 6, color: 'var(--text)',
            }}>
              Password
            </label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', background: 'var(--error)15',
              border: '1px solid var(--error)', borderRadius: 8,
              color: 'var(--error)', fontSize: '0.8125rem',
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {devMode && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={() => { setShowPassword(false); setError(null); }}>
              ← Back to switch user
            </button>
          )}
        </form>
        )}

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Accounts are created by your manager.
        </p>
        <p style={{ marginTop: 8, textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-tertiary)', letterSpacing: '0.02em' }}>
          Prospector · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}
