import React, { useState, useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState, RequestStatus, Property } from '../../types/models';
import { PropertyTable } from '../manager/PropertyTable';
import { Icon } from '../common/Icon';
import { ApiError } from '../../data/apiClient';
import * as api from '../../data/api';

/**
 * Columns a broker may show on the Pool (besides the always-present Unit):
 * Beds, BUA (size), Plot, Type, Last transaction, Tenancy, Last call, Outcome,
 * State, Floor (a mapped upload field, shown when present).
 */
const POOL_COLUMNS = [
  'beds', 'size', 'plotSize', 'type', 'lastTx', 'tenancy', 'calledAt', 'outcome', 'state', 'extra:Floor',
];

/**
 * The broker's view of the pool: a teaser (owners hidden until assigned) where
 * they tick the units they want and submit a hand-picked request. The manager
 * approves in Assignments → Requests, which grants exactly those units.
 *
 * The teaser is enforced server-side now: /api/properties?scope=pool strips
 * owner identity for a broker and refuses owner-derived filters, so ticking
 * boxes here can't be turned into a way to read the owner data behind them.
 */
export function PoolTab() {
  const { user } = useAuth();
  const vault = useVault();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The ticked units, resolved so we can name their communities. */
  const [picked, setPicked] = useState<Property[]>([]);

  const pending = useMemo(
    () => vault.requests.filter(r => r.brokerId === user?.id && r.status === RequestStatus.pending),
    [vault.requests, user?.id],
  );

  const communities = useMemo(
    () => Array.from(new Set(picked.map(p => p.community))),
    [picked],
  );
  const clusters = useMemo(
    () => Array.from(new Set(picked.map(p => p.cluster).filter(Boolean) as string[])),
    [picked],
  );

  /**
   * Selection is by id, but the request needs the community/cluster of what was
   * picked — and with pagination those rows may not be on screen any more. Keep
   * a resolved copy alongside the id set as the user ticks.
   */
  const onCheckedChanged = async (ids: Set<string>) => {
    setChecked(ids);
    setPicked(prev => {
      const known = new Map(prev.map(p => [p.id, p]));
      return Array.from(ids).map(id => known.get(id)).filter((p): p is Property => !!p);
    });
    // Resolve anything newly ticked that we don't already hold.
    const missing = Array.from(ids).filter(id => !picked.some(p => p.id === id));
    if (missing.length === 0) return;
    try {
      const fetched = await Promise.all(missing.map(id => api.properties.byId(id)));
      setPicked(prev => {
        const byId = new Map(prev.map(p => [p.id, p]));
        for (const p of fetched) byId.set(p.id, p);
        return Array.from(ids).map(id => byId.get(id)).filter((p): p is Property => !!p);
      });
    } catch {
      // A pool unit we can't resolve just won't contribute its community label.
    }
  };

  const submit = async () => {
    if (checked.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await vault.submitRequest({
        community: communities.length === 1 ? communities[0] : `${communities.length} communities`,
        count: checked.size,
        cluster: clusters.length === 1 ? clusters[0] : undefined,
        unitIds: Array.from(checked),
        note: note.trim() || undefined,
      });
      setChecked(new Set());
      setPicked([]);
      setNote('');
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div>
      {/* Request toolbar */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <Icon name="layers" size={17} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '0.875rem' }}>
          {checked.size === 0
            ? 'Tick the units you want, then request them from your manager.'
            : <><b>{checked.size}</b> unit{checked.size === 1 ? '' : 's'} selected
              {communities.length > 0 && <span style={{ color: 'var(--text-secondary)' }}> · {communities.join(', ')}</span>}</>}
        </span>
        <div style={{ flex: 1 }} />
        {checked.size > 0 && (
          <>
            <input className="input" style={{ width: 220 }} placeholder="Note to your manager (optional)"
              value={note} onChange={e => setNote(e.target.value)} />
            <button className="btn btn-sm btn-ghost" onClick={() => { setChecked(new Set()); setPicked([]); }}>Clear</button>
          </>
        )}
        <button className="btn btn-sm btn-primary" disabled={checked.size === 0 || busy} onClick={submit}
          style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013', opacity: checked.size === 0 ? 0.5 : 1 }}>
          <Icon name="assign" size={15} /> {busy ? 'Sending…' : `Request ${checked.size || ''} unit${checked.size === 1 ? '' : 's'}`.trim()}
        </button>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', borderColor: 'var(--error)' }}>
          <Icon name="alert" size={16} style={{ color: 'var(--error)' }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{error}</span>
        </div>
      )}

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
        scope="pool"
        fixedState={PropertyState.pool}
        checkedIds={checked}
        onCheckedChanged={onCheckedChanged}
        // The columns a broker may show on the pool: Unit (always) + these.
        allowColumns={POOL_COLUMNS}
      />
    </div>
  );
}
