import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';
import { PropertyTable } from '../manager/PropertyTable';
import { Icon } from '../common/Icon';

/**
 * The broker's view of the pool: a teaser (owners hidden until assigned) where
 * they tick the units they want and submit a hand-picked request. The manager
 * approves in Assignments → Requests, which grants exactly those units.
 */
export function PoolTab() {
  const { user } = useAuth();
  const vault = useVault();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return null;
  const pool = vault.properties.filter(p => p.state === PropertyState.pool);
  const mine = vault.requests.filter(r => r.brokerId === user.id);
  const pending = mine.filter(r => r.status === 'pending');

  const picks = pool.filter(p => checked.has(p.id));
  const communities = Array.from(new Set(picks.map(p => p.community)));
  const clusters = Array.from(new Set(picks.map(p => p.cluster).filter(Boolean) as string[]));

  const submit = async () => {
    if (picks.length === 0 || busy) return;
    setBusy(true);
    await vault.submitRequest(
      user.id,
      communities.length === 1 ? communities[0] : `${communities.length} communities`,
      picks.length,
      clusters.length === 1 ? clusters[0] : undefined,
      picks.map(p => p.id),
      note.trim() || undefined,
    );
    setChecked(new Set());
    setNote('');
    setBusy(false);
    setSent(true);
    setTimeout(() => setSent(false), 4000);
  };

  return (
    <div>
      {/* Request toolbar */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Icon name="layers" size={17} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.875rem' }}>
          {picks.length === 0
            ? 'Tick the units you want, then request them from your manager.'
            : <><b>{picks.length}</b> unit{picks.length === 1 ? '' : 's'} selected
              {communities.length > 0 && <span style={{ color: 'var(--text-secondary)' }}> · {communities.join(', ')}</span>}</>}
        </span>
        <div style={{ flex: 1 }} />
        {picks.length > 0 && (
          <>
            <input className="input" style={{ width: 220 }} placeholder="Note to your manager (optional)"
              value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn btn-sm btn-ghost" onClick={() => setChecked(new Set())}>Clear</button>
          </>
        )}
        <button className="btn btn-sm btn-primary" disabled={picks.length === 0 || busy} onClick={submit}
          style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013', opacity: picks.length === 0 ? 0.5 : 1 }}>
          <Icon name="assign" size={15} /> {busy ? 'Sending…' : `Request ${picks.length || ''} unit${picks.length === 1 ? '' : 's'}`.trim()}
        </button>
      </div>

      {sent && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', borderColor: 'var(--success)' }}>
          <Icon name="check" size={16} style={{ color: 'var(--success)' }} />
          <span style={{ fontSize: '0.875rem' }}>Request sent — your manager will review it.</span>
        </div>
      )}

      {pending.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 8 }}>
            Your pending requests
          </div>
          {pending.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.8125rem', padding: '3px 0' }}>
              <Icon name="clock" size={14} style={{ color: 'var(--warning)' }} />
              <span>{r.summary}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>· awaiting approval</span>
            </div>
          ))}
        </div>
      )}

      <PropertyTable
        prefsKey="broker_pool" teaser
        properties={pool}
        checkedIds={checked}
        onCheckedChanged={setChecked}
      />
    </div>
  );
}
