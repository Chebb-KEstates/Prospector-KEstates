import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext';
import { useVault } from '../state/VaultContext';
import { UserRole } from '../types/user';

export function LoginScreen() {
  const { signIn } = useAuth();
  const { users } = useVault();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = signIn(email, password, users);
    if (err) setError(err);
  };

  const quickSignIn = (userEmail: string) => {
    const err = signIn(userEmail, 'demo1234', users);
    if (err) setError(err);
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
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}
          >
            Sign in
          </button>
        </form>

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 12 }}>
            Demo accounts (password: <code style={{ color: 'var(--primary)' }}>demo1234</code>)
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => quickSignIn('director@demo.ae')}>
              Sign in as Director (Manager)
            </button>
            <button className="btn btn-ghost" onClick={() => quickSignIn('sara@demo.ae')}>
              Sign in as Sara (Broker)
            </button>
            <button className="btn btn-ghost" onClick={() => quickSignIn('omar@demo.ae')}>
              Sign in as Omar (Broker)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
