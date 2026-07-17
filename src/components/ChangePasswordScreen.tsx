import React, { useState } from 'react';
import { useAuth } from '../state/AuthContext';

/**
 * Forced password change.
 *
 * Shown when `mustChangePassword` is set — i.e. a manager created the account or
 * reset its password, so the current one has been spoken aloud or typed into a
 * chat. The app is not reachable until it's changed: this screen renders instead
 * of the routes, not alongside them.
 */
export function ChangePasswordScreen() {
  const { changePassword, signOut, user } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Checked here as well as server-side purely so the mismatch is caught
    // before a round trip — the server enforces everything that matters.
    if (newPassword !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await changePassword(currentPassword, newPassword);
    if (err) setError(err);
    setBusy(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: 'var(--bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 420, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 8 }}>
            Choose a new password
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Your password was set for you. Pick your own before continuing.
          </p>
        </div>

        <form onSubmit={submit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 24,
        }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: 6 }}>
              Current password
            </label>
            <input className="input" type="password" value={currentPassword} autoFocus required
              onChange={e => setCurrent(e.target.value)} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: 6 }}>
              New password
            </label>
            <input className="input" type="password" value={newPassword} required
              onChange={e => setNew(e.target.value)} placeholder="At least 10 characters" />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: 6 }}>
              Confirm new password
            </label>
            <input className="input" type="password" value={confirm} required
              onChange={e => setConfirm(e.target.value)} />
          </div>

          {error && (
            <div style={{
              padding: '8px 12px', background: 'var(--error)15',
              border: '1px solid var(--error)', borderRadius: 8,
              color: 'var(--error)', fontSize: '0.8125rem', marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={busy}
            style={{ width: '100%', justifyContent: 'center', padding: '10px 16px' }}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>
            Sign out{user ? ` (${user.email})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
