import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';
import { PropertyTable } from './PropertyTable';
import { RequestsScreen } from './RequestsScreen';
import { ApiError } from '../../data/apiClient';
import { Icon } from '../common/Icon';

/**
 * Assignments.
 *
 * Note the counts on the Pool / Assigned tabs are gone: with pagination the
 * screen no longer holds every row, and a count that only reflected the loaded
 * page would be a lie. The table's footer carries the real total for whichever
 * tab is open.
 */
export function AssignmentsScreen() {
  const { brokers, assign, reclaim, pendingRequests } = useVault();
  const [tab, setTab] = useState<'pool' | 'assigned' | 'requests'>('pool');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignBroker, setAssignBroker] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const handleAssign = async () => {
    if (!assignBroker || selected.size === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await assign(Array.from(selected), assignBroker);
      setSelected(new Set());
      // Surface the owner-linked expansion: assigning 1 unit can assign 4, and
      // silently doing so is how a manager loses track of who has what.
      setMessage({
        kind: 'ok',
        text: r.ownerLinkedExtra > 0
          ? `Assigned ${r.assigned} units — including ${r.ownerLinkedExtra} extra held by the same owners.`
          : `Assigned ${r.assigned} unit${r.assigned === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not assign those units.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReclaim = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const n = await reclaim(Array.from(selected));
      setSelected(new Set());
      setMessage({ kind: 'ok', text: `Reclaimed ${n} unit${n === 1 ? '' : 's'} to the pool.` });
    } catch (err) {
      setMessage({
        kind: 'error',
        text: err instanceof ApiError ? err.message : 'Could not reclaim those units.',
      });
    } finally {
      setBusy(false);
    }
  };

  const switchTab = (t: 'pool' | 'assigned' | 'requests') => {
    setTab(t);
    setSelected(new Set());
    setMessage(null);
  };

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Assignments</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${tab === 'pool' ? 'btn-primary' : ''}`} onClick={() => switchTab('pool')}>
          Pool
        </button>
        <button className={`btn ${tab === 'assigned' ? 'btn-primary' : ''}`} onClick={() => switchTab('assigned')}>
          Assigned
        </button>
        <button className={`btn ${tab === 'requests' ? 'btn-primary' : ''}`} onClick={() => switchTab('requests')}
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
                {brokers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={selected.size === 0 || !assignBroker || busy}
                onClick={handleAssign}>
                {busy ? 'Assigning…' : 'Assign'}
              </button>
            </>
          )}
          {tab === 'assigned' && (
            <button className="btn btn-sm" disabled={selected.size === 0 || busy} onClick={handleReclaim}>
              {busy ? 'Reclaiming…' : 'Reclaim to pool'}
            </button>
          )}
          {message && (
            <span style={{
              fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6,
              color: message.kind === 'ok' ? 'var(--success)' : 'var(--error)',
            }}>
              <Icon name={message.kind === 'ok' ? 'check' : 'alert'} size={14} />
              {message.text}
            </span>
          )}
        </div>

        {/* The shared table — masks phones, and brings filters / columns / sort /
            pagination / multi-select. Never hand-roll a list UI: the screen that
            did once leaked unmasked owner numbers. */}
        <PropertyTable
          key={tab}
          prefsKey={tab === 'pool' ? 'mgr_pool' : 'mgr_assigned'}
          scope="all"
          fixedState={tab === 'pool' ? PropertyState.pool : PropertyState.assigned}
          checkedIds={selected}
          onCheckedChanged={setSelected}
        />
      </>}
    </div>
  );
}
