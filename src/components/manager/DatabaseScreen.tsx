import React, { useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { DataModule, DataModuleLabel } from '../../types/models';
import { Permission } from '../../types/user';
import { PropertyTable } from './PropertyTable';
import { LeadTable } from './LeadTable';
import { PropertyPopup } from './PropertyPopup';
import { LeadDetail } from './LeadDetail';
import { RequestsScreen } from './RequestsScreen';
import { ApiError } from '../../data/apiClient';
import { Icon } from '../common/Icon';

/**
 * Database — the manager's single data surface.
 *
 * Merges the old **Data Vault** (browse every owner / lead, open a record) with
 * **Assignments** (select units, assign / reclaim) and the pending **Requests**
 * queue. One owner table carries the full filter bar — so filtering by *State*
 * gives you just the pool or just the assigned units, replacing the old Pool /
 * Assigned tabs — plus multi-select and the assign / reclaim actions. Both jobs,
 * one place.
 */
type View = 'owners' | 'leads' | 'requests';

export function DatabaseScreen() {
  const { recordView, brokers, assign, reclaim, pendingRequests } = useVault();
  const { user } = useAuth();
  const canAssign = !!user?.can(Permission.assignData);

  const [view, setView] = useState<View>('owners');
  const [detailProperty, setDetailProperty] = useState<string | null>(null);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  // Assign / reclaim (owners view)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignBroker, setAssignBroker] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Opening a record is an audited view — same round trip the Vault made.
  const openProperty = async (id: string, orderedIds?: string[]) => {
    setCapError(null);
    try {
      await recordView(id, `Viewed owner detail ${id}`);
      if (orderedIds) setPageIds(orderedIds);
      setDetailProperty(id);
    } catch (err) {
      setCapError(err instanceof ApiError ? err.message : 'Could not open that record.');
    }
  };

  const handleAssign = async () => {
    if (!assignBroker || selected.size === 0 || busy) return;
    setBusy(true); setMessage(null);
    try {
      const r = await assign(Array.from(selected), assignBroker);
      setSelected(new Set());
      // Surface the owner-group expansion — assigning one unit can move a whole
      // owner, and silently doing so is how a manager loses track of who has what.
      setMessage({ kind: 'ok', text: r.ownerLinkedExtra > 0
        ? `Assigned ${r.assigned} units — including ${r.ownerLinkedExtra} more held by the same owners.`
        : `Assigned ${r.assigned} unit${r.assigned === 1 ? '' : 's'}.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not assign those units.' });
    } finally { setBusy(false); }
  };

  const handleReclaim = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true); setMessage(null);
    try {
      const n = await reclaim(Array.from(selected));
      setSelected(new Set());
      setMessage({ kind: 'ok', text: `Reclaimed ${n} unit${n === 1 ? '' : 's'} to the pool.` });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not reclaim those units.' });
    } finally { setBusy(false); }
  };

  if (detailLead) {
    return <LeadDetail leadId={detailLead} onBack={() => setDetailLead(null)} />;
  }

  const tab = (key: View, label: string, badge?: number) => (
    <button className={`btn ${view === key ? 'btn-primary' : ''}`} style={{ position: 'relative' }}
      onClick={() => { setView(key); setMessage(null); }}>
      {label}
      {badge != null && badge > 0 && (
        <span style={{ marginLeft: 6, background: 'var(--error)', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 700 }}>{badge}</span>
      )}
    </button>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Database</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tab('owners', DataModuleLabel[DataModule.owners])}
          {tab('leads', DataModuleLabel[DataModule.leads])}
          {canAssign && tab('requests', 'Requests', pendingRequests.length)}
        </div>
      </div>

      {capError && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', borderColor: 'var(--error)' }}>
          <Icon name="ban" size={16} style={{ color: 'var(--error)' }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{capError}</span>
        </div>
      )}

      {view === 'requests' ? (
        <RequestsScreen />
      ) : view === 'leads' ? (
        <LeadTable prefsKey="mgr_database_leads" scope="all" onSelect={id => setDetailLead(id)} />
      ) : (
        <>
          {canAssign && (
            <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{selected.size} selected</span>
              <select className="input" value={assignBroker} onChange={e => setAssignBroker(e.target.value)} style={{ width: 'auto', minWidth: 160 }}>
                <option value="">Select broker…</option>
                {brokers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
              <button className="btn btn-primary btn-sm" disabled={selected.size === 0 || !assignBroker || busy} onClick={handleAssign}>
                {busy ? 'Assigning…' : 'Assign'}
              </button>
              <button className="btn btn-sm" disabled={selected.size === 0 || busy} onClick={handleReclaim}>
                {busy ? 'Reclaiming…' : 'Reclaim to pool'}
              </button>
              {message && (
                <span style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: 6, color: message.kind === 'ok' ? 'var(--success)' : 'var(--error)' }}>
                  <Icon name={message.kind === 'ok' ? 'check' : 'alert'} size={14} />
                  {message.text}
                </span>
              )}
            </div>
          )}
          <PropertyTable
            prefsKey="mgr_database"
            scope="all"
            showAssignee
            checkedIds={canAssign ? selected : undefined}
            onCheckedChanged={canAssign ? setSelected : undefined}
            onSelect={(id, orderedIds) => void openProperty(id, orderedIds)}
          />
        </>
      )}

      {detailProperty && (
        <PropertyPopup propertyId={detailProperty} ids={pageIds}
          onNavigate={(id) => void openProperty(id)} onClose={() => setDetailProperty(null)} />
      )}
    </div>
  );
}
