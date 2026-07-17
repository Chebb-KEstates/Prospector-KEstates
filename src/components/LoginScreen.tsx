import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext';

/**
 * Sign in.
 *
 * The one-click demo buttons are gone. They signed in with `demo1234` — a
 * password compiled into the JS bundle that every account matched, printed on
 * the login screen. That was survivable for a local IndexedDB demo and is not
 * survivable against a real database of owner data.
 */
export function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const err = await signIn(email, password);
    if (err) setError(err);
    setBusy(false);
  };

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
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Accounts are created by your manager.
        </p>
      </div>
    </div>
  );
}
