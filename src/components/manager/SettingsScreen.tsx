import React, { useState, useEffect } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { VaultSettings } from '../../types/models';
import { ApiError } from '../../data/apiClient';
import * as api from '../../data/api';

export function SettingsScreen() {
  const { settings, saveSettings } = useVault();
  const { user } = useAuth();
  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [myIp, setMyIp] = useState<string | null>(null);

  // The server-seen IP, so the office lock can be set to the right address.
  useEffect(() => { api.settings.myIp().then(setMyIp).catch(() => setMyIp(null)); }, []);

  const handleSave = async () => {
    if (!user) return;
    setError(null);
    try {
      await saveSettings(new VaultSettings(
        form.notInterestedCooldownDays,
        form.listedCooldownDays,
        form.maxNoAnswerAttempts,
        form.assignmentExpiryDays,
        form.portfolioStaleDays,
        form.dailyViewCap,
        form.wifiLockEnabled,
        form.officeIp,
        form.assignmentSlaHours,
        form.noAnswerExtensionHours,
        form.noAnswerMaxHoldDays,
        form.portfolioRenewDays,
        form.expiringSoonHours,
      ));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      // These values gate cooldowns and the reveal cap, so the server bounds
      // them. A rejection has to be shown, not swallowed.
      setError(err instanceof ApiError ? err.message : 'Could not save those settings.');
    }
  };

  const field = (label: string, key: keyof typeof form, type = 'number', note?: string, zeroable = false) => {
    const isZero = zeroable && form[key] === 0;
    return (
      <div>
        <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4, fontWeight: 500 }}>
          {label}
        </label>
        <input
          className="input"
          type={type}
          min={type === 'number' ? (zeroable ? 0 : 1) : undefined}
          value={form[key] as string | number}
          onChange={e => setForm(p => ({
            ...p,
            [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value,
          }))}
          style={{ maxWidth: 200 }}
        />
        {isZero
          ? <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginTop: 4, fontWeight: 600 }}>No limit — this timer is off.</div>
          : note && <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{note}</div>}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Settings</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved && <span style={{ color: 'var(--success)', fontSize: '0.8125rem' }}>Saved ✓</span>}
          <button className="btn btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>

      {/* These values gate the cooldowns and the reveal cap, so the server bounds
          them and can reject a save. Silently swallowing that would leave the
          manager believing a protection had been changed when it hadn't. */}
      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--error)', color: 'var(--error)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Cooldown</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {field('Not interested cooldown (days)', 'notInterestedCooldownDays', 'number', 'Owner stays in cooling before returning to pool')}
            {field('Already listed cooldown (days)', 'listedCooldownDays', 'number')}
            {field('Portfolio staleness (days)', 'portfolioStaleDays', 'number', 'Days without call before a portfolio unit is flagged stale')}
          </div>
        </div>

        {/* The assignment timer — how long a broker keeps a unit before it
            returns to the pool for someone else. These drive the countdown in
            the tables and the automatic recycling sweep. */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Assignment timer</h3>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 16 }}>
            How long a broker holds a unit before it is released back to the pool.
            Set any field to <b>0</b> to remove that limit.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {field('Time to make contact (hours)', 'assignmentSlaHours', 'number', 'Countdown when a unit is first assigned', true)}
            {field('No-answer extension (hours)', 'noAnswerExtensionHours', 'number', 'Each no-answer / unreachable call resets the clock to this', true)}
            {field('Maximum hold (days)', 'noAnswerMaxHoldDays', 'number', 'Hard cap from assignment — no-answers cannot extend past this', true)}
            {field('Portfolio renewal (days)', 'portfolioRenewDays', 'number', 'Interested units keep this long, renewed by calling or saving notes', true)}
            {field('"Running out of time" alert (hours)', 'expiringSoonHours', 'number', 'When a unit turns amber and appears on the home screen', true)}
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Office-network lock</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Set the office IP here, then turn the lock ON per broker under <strong>Users</strong>. A locked user is
              signed out the moment they use the app from outside this address.
            </div>
            <div>
              <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4, fontWeight: 500 }}>
                Office IP / network
              </label>
              <input className="input" type="text" value={form.officeIp}
                onChange={e => setForm(p => ({ ...p, officeIp: e.target.value }))}
                placeholder="e.g. 203.0.113.10 or 203.0.113.0/24" style={{ maxWidth: 320 }} />
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                {myIp
                  ? <>Your current IP is <strong>{myIp}</strong>.{' '}
                      <button type="button" className="btn btn-sm btn-ghost" style={{ padding: '1px 8px' }}
                        onClick={() => setForm(p => ({ ...p, officeIp: p.officeIp.trim() ? `${p.officeIp.trim()}, ${myIp}` : myIp }))}>
                        Add my IP
                      </button></>
                  : 'Enter your office’s public IP.'}
                <br />Accepts several, comma-separated, and IPv4 ranges (e.g. <code>203.0.113.0/24</code>).
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--warning)', marginTop: 6 }}>
                ⚠ Use the office’s <em>public</em> IP, not a 192.168.x internal one. If it's wrong, locked users can't get
                in (recover by clearing it in the database). Empty = no one is locked, whatever their per-user setting.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
