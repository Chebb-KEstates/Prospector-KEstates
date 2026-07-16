import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { AppUser, UserRole, Permission, PermissionLabel, UserRoleLabel } from '../../types/user';
import { isInterested } from '../../types/models';
import { fmtInt, timeAgo } from '../../utils/format';

/** Summarised per-user activity: what they hold, their calling, and recent assignments. */
function ActivitySummary({ target }: { target: AppUser }) {
  const { assignedTo, leadsOf, callsBy, audit } = useVault();
  const held = assignedTo(target.id);
  const units = held.length;
  const portfolio = held.filter(p => p.state === 'portfolio').length;
  const leads = leadsOf(target.id).length;
  const calls = callsBy(target.id);
  const interested = calls.filter(c => isInterested(c.outcome)).length;
  const lastAt = calls.length ? calls.map(c => c.at).reduce((a, b) => (a > b ? a : b)) : undefined;
  const recentAssigns = audit
    .filter(a => a.action === 'assign' && a.detail.includes(target.name))
    .slice(0, 5);

  const cell = (v: string, l: string) => (
    <div><div className="tabular-nums" style={{ fontSize: '1.15rem', fontWeight: 700 }}>{v}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{l}</div></div>
  );

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, background: 'var(--surface-2)', marginBottom: 16 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 10 }}>Activity summary</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 22px' }}>
        {cell(fmtInt(units), 'units held')}
        {cell(fmtInt(leads), 'leads held')}
        {cell(fmtInt(portfolio), 'in portfolio')}
        {cell(fmtInt(calls.length), 'calls')}
        {cell(fmtInt(interested), 'interested')}
        {cell(lastAt ? timeAgo(lastAt) : 'never', 'last activity')}
      </div>
      {recentAssigns.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-light)' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 6 }}>Recent assignments</div>
          {recentAssigns.map(a => (
            <div key={a.id} style={{ fontSize: '0.75rem', display: 'flex', gap: 8, padding: '2px 0' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>{timeAgo(a.at)}</span>
              <span className="truncate">{a.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function UsersScreen() {
  const { users, saveUser } = useVault();
  const { user } = useAuth();
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [showNew, setShowNew] = useState(false);

  const [form, setForm] = useState({
    name: '', email: '', role: UserRole.broker as UserRole,
    team: '', active: true, permissions: new Set<Permission>(),
    viewCapOverride: '',
  });

  const resetForm = () => setForm({
    name: '', email: '', role: UserRole.broker,
    team: '', active: true, permissions: new Set<Permission>(),
    viewCapOverride: '',
  });

  const openEdit = (u: AppUser) => {
    setEditing(u);
    setForm({
      name: u.name, email: u.email, role: u.role,
      team: u.team, active: u.active,
      permissions: new Set(u.permissions),
      viewCapOverride: u.viewCapOverride?.toString() ?? '',
    });
  };

  const handleSave = async () => {
    if (!user) return;
    const id = editing?.id ?? `u-${Date.now()}`;
    const appUser = new AppUser(
      id, form.name.trim(), form.email.trim(), form.role,
      form.active, form.team.trim(),
      form.permissions.size > 0 ? form.permissions : undefined,
      form.viewCapOverride ? parseInt(form.viewCapOverride) : undefined,
      editing?.createdAt ?? new Date().toISOString(),
    );
    const action = editing ? 'Edited' : 'Created';
    await saveUser(appUser, user.id, action);
    setEditing(null);
    setShowNew(false);
    resetForm();
  };

  // Soft-delete: deactivate keeps the account listed with its full history for
  // past employees; we never hard-delete (Security Playbook — auditability).
  const setActive = async (u: AppUser, active: boolean) => {
    if (!user) return;
    if (active === false && !window.confirm(`Deactivate ${u.name}? They keep their history but can no longer sign in.`)) return;
    await saveUser(u.copyWith({ active }), user.id, active ? 'Reactivated' : 'Deactivated');
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

      {(showNew || editing) && (
        <div className="modal-overlay" onClick={() => { setShowNew(false); setEditing(null); }}>
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
                    {u.active ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td>{u.viewCapOverride ?? 'Default'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-sm btn-ghost" onClick={() => openEdit(u)}>Edit</button>
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
