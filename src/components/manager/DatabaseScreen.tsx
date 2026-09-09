import React, { useState, useCallback } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { DataModule, DataModuleLabel, CallOutcome } from '../../types/models';
import { Permission } from '../../types/user';
import { PropertyTable } from './PropertyTable';
import { LeadTable } from './LeadTable';
import { PropertyPopup } from './PropertyPopup';
import { LeadDetail } from './LeadDetail';
import { RequestsScreen } from './RequestsScreen';
import { ApiError } from '../../data/apiClient';
import { Icon } from '../common/Icon';
import { useStickyHeader, stickyHeaderStyle } from '../common/useStickyHeader';

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

/**
 * Quick filter chips for the owners table — the same shortcuts the broker
 * Database carries, next to the Filters button. "To call"/"All" are broker-only
 * (a personal working-list concept); for the manager, who sees every state via
 * the State filter, "All" simply means "no quick filter". Each chip maps onto the
 * same server filters the broker chips use.
 */
type Quick = 'all' | 'expiring' | 'due' | 'fresh' | 'noAnswer' | 'callback' | 'interested';
const QUICKS: { key: Quick; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'expiring', label: '⏰ Expiring soon' },
  { key: 'due', label: 'Due follow-up' },
  { key: 'fresh', label: 'Never called' },
  { key: 'noAnswer', label: 'No answer' },
  { key: 'callback', label: 'Call back later' },
  { key: 'interested', label: 'Interested' },
];
function quickToQuery(quick: Quick): {
  forcedOutcome?: string; dueOnly?: boolean; interestedOnly?: boolean; expiringSoon?: boolean;
} {
  switch (quick) {
    case 'fresh': return { forcedOutcome: 'none' };
    case 'noAnswer': return { forcedOutcome: CallOutcome.noAnswer };
    case 'callback': return { forcedOutcome: CallOutcome.callbackLater };
    case 'due': return { dueOnly: true };
    case 'interested': return { interestedOnly: true };
    case 'expiring': return { expiringSoon: true };
    default: return {};
  }
}

export function DatabaseScreen() {
  const { recordView, brokers, assign, reclaim, pendingRequests } = useVault();
  const { user } = useAuth();
  const canAssign = !!user?.can(Permission.assignData);

  const [view, setView] = useState<View>('owners');
  const [quick, setQuick] = useState<Quick>('all');
  const [detailProperty, setDetailProperty] = useState<string | null>(null);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [detailLead, setDetailLead] = useState<string | null>(null);
  const [capError, setCapError] = useState<string | null>(null);

  // Assign / reclaim (owners view)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignBroker, setAssignBroker] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirmAssign, setConfirmAssign] = useState(false);
  // Stable so it can sit in PropertyTable's effect deps without re-firing.
  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const { ref: headerRef, height: headerH } = useStickyHeader();

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

  const doAssign = async () => {
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
    <button className={`btn btn-sm ${view === key ? 'btn-primary' : ''}`} style={{ position: 'relative' }}
      onClick={() => { setView(key); setMessage(null); }}>
      {label}
      {badge != null && badge > 0 && (
        <span style={{ marginLeft: 6, background: 'var(--error)', color: '#fff', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 700 }}>{badge}</span>
      )}
    </button>
  );

  return (
    <div>
      {/* Sticky page header: title + module toggle, and (owners view) the
          assign / reclaim controls — all pinned above the table's filter bar. */}
      <div ref={headerRef} style={stickyHeaderStyle}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Database</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tab('owners', DataModuleLabel[DataModule.owners])}
          {tab('leads', DataModuleLabel[DataModule.leads])}
          {canAssign && tab('requests', 'Requests', pendingRequests.length)}
        </div>
        {view === 'owners' && canAssign && (
          <>
            <div style={{ flex: 1, minWidth: 12 }} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{selected.size} selected</span>
            <select className="input" value={assignBroker} onChange={e => setAssignBroker(e.target.value)} style={{ width: 'auto', minWidth: 150, padding: '5px 8px' }}>
              <option value="">Select broker…</option>
              {brokers.filter(b => b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <button className="btn btn-primary btn-sm" disabled={selected.size === 0 || !assignBroker || busy} onClick={() => setConfirmAssign(true)}>
              {busy ? 'Assigning…' : 'Assign'}
            </button>
            <button className="btn btn-sm" disabled={selected.size === 0 || busy} onClick={handleReclaim}>
              {busy ? 'Reclaiming…' : 'Reclaim'}
            </button>
          </>
        )}
      </div>

      {(capError || message) && (
        <div style={{ margin: '10px 0 0', display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.8125rem',
          color: capError ? 'var(--error)' : message!.kind === 'ok' ? 'var(--success)' : 'var(--error)' }}>
          <Icon name={capError ? 'ban' : message!.kind === 'ok' ? 'check' : 'alert'} size={15} />
          <span>{capError ?? message!.text}</span>
        </div>
      )}

      {view === 'requests' ? (
        <RequestsScreen />
      ) : view === 'leads' ? (
        <LeadTable prefsKey="mgr_database_leads" scope="all" stickyTop={headerH} onSelect={id => setDetailLead(id)} />
      ) : (
        <PropertyTable
          prefsKey="mgr_database"
          scope="all"
          showAssignee
          stickyTop={headerH}
          {...quickToQuery(quick)}
          checkedIds={canAssign ? selected : undefined}
          onCheckedChanged={canAssign ? setSelected : undefined}
          onFiltersChange={canAssign ? clearSelection : undefined}
          onSelect={(id, orderedIds) => void openProperty(id, orderedIds)}
          headerExtra={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {QUICKS.map(q => (
                <button key={q.key} className={`btn btn-sm ${quick === q.key ? 'btn-primary' : ''}`}
                  onClick={() => { setQuick(q.key); clearSelection(); }}>
                  {q.label}
                </button>
              ))}
            </div>
          }
        />
      )}

      {detailProperty && (
        <PropertyPopup propertyId={detailProperty} ids={pageIds}
          onNavigate={(id) => void openProperty(id)} onClose={() => setDetailProperty(null)} />
      )}

      {confirmAssign && (
        <div className="modal-overlay" onClick={() => setConfirmAssign(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Assign to {brokers.find(b => b.id === assignBroker)?.name ?? 'broker'}?</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              {selected.size} selected unit{selected.size === 1 ? '' : 's'} will be assigned.
              Each owner's units in that area move <b>together</b> — if any selected unit
              is held by another broker, that owner's whole area group is <b>reassigned</b>
              to {brokers.find(b => b.id === assignBroker)?.name ?? 'this broker'}.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setConfirmAssign(false)}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={busy}
                onClick={() => { setConfirmAssign(false); void doAssign(); }}>
                {busy ? 'Assigning…' : 'Assign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
