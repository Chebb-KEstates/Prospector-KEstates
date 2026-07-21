import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { VaultSettings } from '../../types/models';
import { ApiError } from '../../data/apiClient';

export function SettingsScreen() {
  const { settings, saveSettings } = useVault();
  const { user } = useAuth();
  const [form, setForm] = useState({ ...settings });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const field = (label: string, key: keyof typeof form, type = 'number', note?: string) => (
    <div>
      <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4, fontWeight: 500 }}>
        {label}
      </label>
      <input
        className="input"
        type={type}
        value={form[key] as string | number}
        onChange={e => setForm(p => ({
          ...p,
          [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value,
        }))}
        style={{ maxWidth: 200 }}
      />
      {note && <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: 4 }}>{note}</div>}
    </div>
  );

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
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {field('Time to make contact (hours)', 'assignmentSlaHours', 'number', 'Countdown when a unit is first assigned')}
            {field('No-answer extension (hours)', 'noAnswerExtensionHours', 'number', 'Each no-answer / unreachable call resets the clock to this')}
            {field('Maximum hold (days)', 'noAnswerMaxHoldDays', 'number', 'Hard cap from assignment — no-answers cannot extend past this')}
            {field('Portfolio renewal (days)', 'portfolioRenewDays', 'number', 'Interested units keep this long, renewed by calling or saving notes')}
            {field('"Running out of time" alert (hours)', 'expiringSoonHours', 'number', 'When a unit turns amber and appears on the home screen')}
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Protection</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {field('Daily view cap', 'dailyViewCap', 'number', 'Owner-detail opens per broker per day')}

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.875rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.wifiLockEnabled}
                  onChange={e => setForm(p => ({ ...p, wifiLockEnabled: e.target.checked }))} />
                WiFi lock (enforced server-side at go-live)
              </label>
            </div>

            {form.wifiLockEnabled && (
              <div>
                <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4, fontWeight: 500 }}>
                  Office IP / network
                </label>
                <input className="input" type="text" value={form.officeIp}
                  onChange={e => setForm(p => ({ ...p, officeIp: e.target.value }))}
                  placeholder="192.168.1.0/24" style={{ maxWidth: 200 }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
