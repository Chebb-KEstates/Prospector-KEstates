import React, { useState, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyState } from '../../types/models';
import { PropertyTable } from './PropertyTable';
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

      {/* The shared table — masks phones, and brings filters / columns / sort /
          pagination / multi-select. Never hand-roll a list UI. */}
      <PropertyTable
        prefsKey={tab === 'pool' ? 'mgr_pool' : 'mgr_assigned'}
        properties={currentList}
        checkedIds={selected}
        onCheckedChanged={setSelected}
      />
      </>}
    </div>
  );
}
