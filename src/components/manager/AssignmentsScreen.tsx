import React, { useState, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyState } from '../../types/models';
import { StateChip } from '../common/StateChip';
import { RequestsScreen } from './RequestsScreen';

export function AssignmentsScreen() {
  const { properties, brokers, assign, reclaim, userById, pendingRequests } = useVault();
  const { user } = useAuth();
  const [tab, setTab] = useState<'pool' | 'assigned' | 'requests'>('pool');

  const pool = useMemo(() => properties.filter(p => p.state === PropertyState.pool), [properties]);
  const assigned = useMemo(() => properties.filter(p => p.state === PropertyState.assigned), [properties]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignBroker, setAssignBroker] = useState('');

  const currentList = tab === 'pool' ? pool : assigned;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAssign = async () => {
    if (!user || !assignBroker) return;
    const batch = currentList.filter(p => selected.has(p.id));
    if (batch.length === 0) return;
    await assign(batch, assignBroker, user.id);
    setSelected(new Set());
  };

  const handleReclaim = async () => {
    if (!user) return;
    const batch = currentList.filter(p => selected.has(p.id));
    if (batch.length === 0) return;
    await reclaim(batch, user.id);
    setSelected(new Set());
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Assignments</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'pool' ? 'btn-primary' : ''}`} onClick={() => { setTab('pool'); setSelected(new Set()); }}>
          Pool ({pool.length})
        </button>
        <button className={`btn ${tab === 'assigned' ? 'btn-primary' : ''}`} onClick={() => { setTab('assigned'); setSelected(new Set()); }}>
          Assigned ({assigned.length})
        </button>
        <button className={`btn ${tab === 'requests' ? 'btn-primary' : ''}`} onClick={() => { setTab('requests'); setSelected(new Set()); }}
          style={{ position: 'relative' }}>
          Requests
          {pendingRequests.length > 0 && (
            <span style={{ marginLeft: 6, background: 'var(--error)', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 700 }}>
              {pendingRequests.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'requests' ? <RequestsScreen /> : <>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          {selected.size} selected
        </span>
        {tab === 'pool' && (
          <>
            <select className="input" value={assignBroker} onChange={e => setAssignBroker(e.target.value)}
              style={{ width: 'auto', minWidth: 160 }}>
              <option value="">Select broker…</option>
              {brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={selected.size === 0 || !assignBroker}
              onClick={handleAssign}>
              Assign
            </button>
          </>
        )}
        {tab === 'assigned' && (
          <button className="btn btn-sm" disabled={selected.size === 0} onClick={handleReclaim}>
            Reclaim to pool
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input type="checkbox" onChange={e => {
                  if (e.target.checked) setSelected(new Set(currentList.map(p => p.id)));
                  else setSelected(new Set());
                }} checked={selected.size === currentList.length && currentList.length > 0} />
              </th>
              <th>Owner</th>
              <th>Phone</th>
              <th>Community</th>
              <th>Unit</th>
              <th>State</th>
              <th>Assigned to</th>
              <th>Last called</th>
              <th>Attempts</th>
            </tr>
          </thead>
          <tbody>
            {currentList.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>
                No{' '}{tab}{' '}properties.
              </td></tr>
            ) : (
              currentList.map(p => (
                <tr key={p.id} className={selected.has(p.id) ? 'selected' : ''}
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleSelect(p.id)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td style={{ fontWeight: 500 }}>{p.owner.name || '—'}</td>
                  <td style={{ fontVariant: 'tabular-nums', color: 'var(--text-secondary)' }}>
                    {p.owner.phone ?? '—'}
                  </td>
                  <td>{p.community}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{p.unitLabel}</td>
                  <td><StateChip state={p.state} /></td>
                  <td>{p.assignedTo ? (userById(p.assignedTo)?.name ?? p.assignedTo) : '—'}</td>
                  <td style={{ fontSize: '0.75rem' }}>{p.lastCalledAt ? new Date(p.lastCalledAt).toLocaleDateString() : '—'}</td>
                  <td>{p.callAttempts}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
