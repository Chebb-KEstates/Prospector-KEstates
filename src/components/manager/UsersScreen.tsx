import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { AppUser, UserRole, Permission, PermissionLabel, defaultPermissions, UserRoleLabel } from '../../types/user';

export function UsersScreen() {
  const { users, saveUser, deleteUser } = useVault();
  const { user } = useAuth();
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', role: UserRole.broker as UserRole,
    team: '', active: true, permissions: new Set<Permission>(),
    viewCapOverride: '', password: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => setForm({
    name: '', email: '', role: UserRole.broker,
    team: '', active: true, permissions: new Set<Permission>(),
    viewCapOverride: '', password: '',
  });

  const openEdit = (u: AppUser) => {
    setEditing(u);
    setFormError(null);
    setForm({
      name: u.name, email: u.email, role: u.role,
      team: u.team, active: u.active,
      permissions: new Set(u.permissions),
      viewCapOverride: u.viewCapOverride?.toString() ?? '',
      password: '',
    });
  };

  const handleSave = async () => {
    if (!user) return;
    setFormError(null);
    const password = form.password.trim();
    // New accounts need an initial password; edits may leave it blank to keep it.
    if (!editing && password.length < 4) {
      setFormError('Set an initial password (at least 4 characters) for the new user.');
      return;
    }
    const id = editing?.id ?? `u-${Date.now()}`;
    const appUser = new AppUser(
      id, form.name.trim(), form.email.trim(), form.role,
      form.active, form.team.trim(),
      form.permissions.size > 0 ? form.permissions : undefined,
      form.viewCapOverride ? parseInt(form.viewCapOverride) : undefined,
      editing?.createdAt ?? new Date().toISOString(),
    );
    const action = editing ? 'Edited' : 'Created';
    try {
      await saveUser(appUser, user.id, action, password.length > 0 ? password : undefined);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save user.');
      return;
    }
    setEditing(null);
    setShowNew(false);
    resetForm();
  };

  const handleDelete = async (u: AppUser) => {
    if (!user || !window.confirm(`Remove account for ${u.name}?`)) return;
    await deleteUser(u, user.id);
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
        <button className="btn btn-primary" onClick={() => { setShowNew(true); setEditing(null); resetForm(); setFormError(null); }}>
          + Add user
        </button>
      </div>

      {(showNew || editing) && (
        <div className="modal-overlay" onClick={() => { setShowNew(false); setEditing(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>
              {editing ? 'Edit User' : 'New User'}
            </h3>

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
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>View cap override (optional)</label>
                <input className="input" type="number" value={form.viewCapOverride}
                  onChange={e => setForm(p => ({ ...p, viewCapOverride: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>
                  {editing ? 'Reset password (leave blank to keep)' : 'Initial password'}
                </label>
                <input className="input" type="password" autoComplete="new-password"
                  value={form.password} placeholder={editing ? '••••••••' : 'Set a password'}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              </div>

              {formError && (
                <div style={{
                  padding: '8px 12px', background: 'var(--error)15',
                  border: '1px solid var(--error)', borderRadius: 8,
                  color: 'var(--error)', fontSize: '0.8125rem',
                }}>
                  {formError}
                </div>
              )}

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

              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => { setShowNew(false); setEditing(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={handleSave}>
                  {editing ? 'Save changes' : 'Create user'}
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
              <th>View cap</th>
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
                    {u.active ? 'Active' : 'Disabled'}
                  </span>
                </td>
                <td>{u.viewCapOverride ?? 'Default'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)}>Edit</button>
                    {u.id !== user?.id && (
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u)}>Remove</button>
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
