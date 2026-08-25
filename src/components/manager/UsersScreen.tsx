import React, { useState, useEffect } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { AppUser, UserRole, Permission, PermissionLabel, UserRoleLabel } from '../../types/user';
import { fmtInt, timeAgo } from '../../utils/format';
import { ApiError } from '../../data/apiClient';
import * as api from '../../data/api';

/**
 * User administration.
 *
 * Two things are new, both consequences of auth being real:
 *
 *  - A manager sets the colleague's FIRST PASSWORD, and the account must change
 *    it on first sign-in. Previously every account — including ones created
 *    here — signed in with the `demo1234` string compiled into the bundle.
 *
 *  - Deactivating actually ends their sessions. It used to only hide the UI;
 *    `AuthContext.refreshFrom` was written to handle it and never called.
 *
 * Users are still deactivated, never deleted: history must stay auditable.
 */

/** Per-user activity, fetched on demand — it's a fold over all their calls. */
function ActivitySummary({ target }: { target: AppUser }) {
  const [data, setData] = useState<{
    calls: number; interested: number; assigned: number; portfolio: number; lastAt?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const team = await api.dashboard.team();
        const row = team.brokers.find(b => b.id === target.id);
        if (!cancelled && row) {
          setData({
            calls: row.calls, interested: row.interested,
            assigned: row.assigned, portfolio: row.portfolio,
          });
        }
        if (!cancelled && !row) setData({ calls: 0, interested: 0, assigned: 0, portfolio: 0 });
      } catch {
        if (!cancelled) setData(null);
      }
    })();
    return () => { cancelled = true; };
  }, [target.id]);

  const cell = (v: string, l: string) => (
    <div><div className="tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700 }}>{v}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{l}</div></div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface-2)', marginBottom: 16 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 10 }}>Activity summary</div>
      {!data ? (
        <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px' }}>
          {cell(fmtInt(data.assigned + data.portfolio), 'units held')}
          {cell(fmtInt(data.calls), 'calls')}
          {cell(fmtInt(data.interested), 'interested')}
          {cell(data.lastAt ? timeAgo(data.lastAt) : '—', 'last activity')}
        </div>
      )}
    </div>
  );
}

export function UsersScreen() {
  const { users, saveUser, setUserActive, resetUserPassword } = useVault();
  const { user } = useAuth();
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<AppUser | null>(null);

  const [form, setForm] = useState({
    name: '', email: '', role: UserRole.broker as UserRole,
    team: '', active: true, permissions: new Set<Permission>(),
    ipLocked: false, initialPassword: '',
  });

  const resetForm = () => setForm({
    name: '', email: '', role: UserRole.broker,
    team: '', active: true, permissions: new Set<Permission>(),
    ipLocked: false, initialPassword: '',
  });

  const openEdit = (u: AppUser) => {
    setEditing(u);
    setError(null);
    setForm({
      name: u.name, email: u.email, role: u.role,
      team: u.team, active: u.active,
      permissions: new Set(u.permissions),
      ipLocked: u.ipLocked,
      initialPassword: '',
    });
  };

  const close = () => { setShowNew(false); setEditing(null); setError(null); resetForm(); };

  const handleSave = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError(null);
    try {
      await saveUser({
        id: editing?.id,
        name: form.name.trim(),
        email: form.email.trim(),
        role: form.role,
        team: form.team.trim(),
        active: form.active,
        permissions: form.permissions.size > 0 ? Array.from(form.permissions) : undefined,
        ipLocked: form.ipLocked,
        initialPassword: editing ? undefined : form.initialPassword,
      });
      close();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that user.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Soft-delete: deactivating keeps the account and its history for past
   * employees. We never hard-delete — the audit trail has to stay attributable.
   */
  const setActive = async (u: AppUser, active: boolean) => {
    if (!user) return;
    if (!active && !window.confirm(`Deactivate ${u.name}? They keep their history, are signed out immediately, and can no longer sign in.`)) return;
    setError(null);
    try {
      await setUserActive(u, active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change that account.');
    }
  };

  const togglePermission = (p: Permission) => {
    setForm(prev => {
      const next = new Set(prev.permissions);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return { ...prev, permissions: next };
    });
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Users</h2>
        <button className="btn btn-primary" onClick={() => { setShowNew(true); setEditing(null); resetForm(); }}>
          + Add user
        </button>
      </div>

      {error && !showNew && !editing && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--error)', color: 'var(--error)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {resetFor && (
        <ResetPasswordDialog
          target={resetFor}
          onClose={() => setResetFor(null)}
          onReset={async (pw) => { await resetUserPassword(resetFor.id, pw); setResetFor(null); }}
        />
      )}

      {(showNew || editing) && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>
              {editing ? 'Edit User' : 'New User'}
            </h3>

            {editing && <ActivitySummary target={editing} />}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>Name</label>
                <input className="input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>Email</label>
                <input className="input" type="email" value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>

              {!editing && (
                <div>
                  <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>
                    Initial password
                  </label>
                  <input className="input" type="text" value={form.initialPassword}
                    onChange={e => setForm(p => ({ ...p, initialPassword: e.target.value }))}
                    placeholder="At least 10 characters" />
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    Give this to them directly. They must change it when they first sign in.
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>Role</label>
                <select className="input" value={form.role}
                  onChange={e => setForm(p => ({ ...p, role: e.target.value as UserRole }))}>
                  <option value={UserRole.broker}>Broker</option>
                  <option value={UserRole.manager}>Manager</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>Team</label>
                <input className="input" value={form.team} onChange={e => setForm(p => ({ ...p, team: e.target.value }))} />
              </div>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.ipLocked}
                    onChange={e => setForm(p => ({ ...p, ipLocked: e.target.checked }))} />
                  Office-network lock (only usable from the office IP)
                </label>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  When on, this user is signed out if they use the app from outside the office IP (set under Settings).
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 8 }}>Permissions</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {Object.values(Permission).map(p => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.permissions.has(p)}
                        onChange={() => togglePermission(p)} />
                      {PermissionLabel[p]}
                    </label>
                  ))}
                </div>
              </div>

              {error && (
                <div style={{ fontSize: '0.8125rem', color: 'var(--error)' }}>{error}</div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={close}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
                  {busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Team</th>
              <th>Active</th>
              <th>Office lock</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 500 }}>{u.name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{u.email}</td>
                <td><span className="chip" style={{ background: 'var(--surface-2)' }}>{UserRoleLabel[u.role]}</span></td>
                <td>{u.team}</td>
                <td>
                  <span className="chip" style={{
                    background: u.active ? 'var(--success)20' : 'var(--error)20',
                    color: u.active ? 'var(--success)' : 'var(--error)',
                  }}>
                    {u.active ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td>{u.ipLocked ? 'On' : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)}>Edit</button>
                    {u.id !== user?.id && (
                      <button className="btn btn-sm btn-ghost" onClick={() => setResetFor(u)}>Reset password</button>
                    )}
                    {u.id !== user?.id && u.active && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--error)' }} onClick={() => setActive(u, false)}>Deactivate</button>
                    )}
                    {u.id !== user?.id && !u.active && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--success)' }} onClick={() => setActive(u, true)}>Reactivate</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResetPasswordDialog({ target, onClose, onReset }: {
  target: AppUser;
  onClose: () => void;
  onReset: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onReset(password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset that password.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Reset password</h3>
        <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Set a new password for <b>{target.name}</b>. They'll be signed out everywhere and
          must change it when they next sign in.
        </p>
        <input className="input" type="text" value={password} autoFocus
          onChange={e => setPassword(e.target.value)} placeholder="At least 10 characters" />
        {error && <div style={{ fontSize: '0.8125rem', color: 'var(--error)', marginTop: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || password.length === 0}>
            {busy ? 'Resetting…' : 'Reset password'}
          </button>
        </div>
      </div>
    </div>
  );
}
