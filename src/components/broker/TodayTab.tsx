import React, { useState, useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState, CallOutcome } from '../../types/models';
import { PropertyTable } from '../manager/PropertyTable';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { fmtDate } from '../../utils/format';
import { leadStopFor, stopDeps } from './callStops';
import { CallDialog } from './CallDialog';
import { CallStop } from '../../state/callTypes';
import { PropertyPopup } from '../manager/PropertyPopup';
import { ApiError } from '../../data/apiClient';
import { useMyLeads } from '../../data/hooks';
import { useStickyHeader, stickyHeaderStyle } from '../common/useStickyHeader';

/**
 * Database — the broker's working list.
 *
 * Owners are worked straight from the paginated table: click a unit to open the
 * record popup (reveal · call · outcome · notes · history) and page through units
 * with ← / → from there. Buyer leads use a simple table + single-call dialog.
 */

type Quick = 'toCall' | 'all' | 'due' | 'fresh' | 'noAnswer' | 'callback' | 'interested' | 'expiring';
const QUICKS: { key: Quick; label: string }[] = [
  // "To call" is the actionable working list (assigned + portfolio). "All" also
  // shows the units the broker still holds but that dropped off — cooled-off and
  // do-not-call — so nothing silently disappears after it's dispositioned.
  { key: 'toCall', label: 'To call' },
  { key: 'all', label: 'All' },
  { key: 'expiring', label: '⏰ Expiring soon' },
  { key: 'due', label: 'Due follow-up' },
  { key: 'fresh', label: 'Never called' },
  { key: 'noAnswer', label: 'No answer' },
  { key: 'callback', label: 'Call back later' },
  { key: 'interested', label: 'Interested' },
];

/**
 * Maps a quick chip onto server filters. `dueOnly` and `interestedOnly` are
 * dedicated API filters (a date comparison / a two-value set) the plain `outcome`
 * filter can't express. `includeInactive` widens the broker's own set to every
 * state they hold (the "All" chip); every other chip stays on the actionable set.
 */
function quickToQuery(quick: Quick): {
  forcedOutcome?: string; dueOnly?: boolean; interestedOnly?: boolean;
  expiringSoon?: boolean; includeInactive?: boolean;
} {
  switch (quick) {
    case 'all': return { includeInactive: true };
    case 'fresh': return { forcedOutcome: 'none' };
    case 'noAnswer': return { forcedOutcome: CallOutcome.noAnswer };
    case 'callback': return { forcedOutcome: CallOutcome.callbackLater };
    case 'due': return { dueOnly: true };
    case 'interested': return { interestedOnly: true };
    case 'expiring': return { expiringSoon: true };
    default: return {};
  }
}

export function TodayTab() {
  const { user } = useAuth();
  const vault = useVault();
  const [buyers, setBuyers] = useState(false);
  const [quick, setQuick] = useState<Quick>('toCall');
  // Row click opens the record popup (an audited owner view).
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pageIds, setPageIds] = useState<string[]>([]);
  const [capError, setCapError] = useState<string | null>(null);
  const { ref: headerRef, height: headerH } = useStickyHeader();

  if (!user) return null;

  // Opening a unit is an audited owner view — same as the manager Vault. The
  // record popup (with its own reveal) opens once the view is recorded.
  const openDetail = async (id: string, orderedIds: string[]) => {
    setCapError(null);
    try {
      await vault.recordView(id, `Viewed owner detail ${id}`);
      setPageIds(orderedIds);
      setDetailId(id);
    } catch (e) {
      setCapError(e instanceof ApiError ? e.message : 'Could not open that record.');
    }
  };

  return (
    <div>
      {detailId && (
        <PropertyPopup propertyId={detailId} ids={pageIds}
          onNavigate={(id) => void openDetail(id, pageIds)}
          onClose={() => setDetailId(null)} />
      )}
      {/* Sticky page header: title + Owners | Buyer leads switch. */}
      <div ref={headerRef} style={stickyHeaderStyle}>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>Database</h2>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn btn-sm ${!buyers ? 'btn-primary' : ''}`} onClick={() => setBuyers(false)}>Property owners</button>
          <button className={`btn btn-sm ${buyers ? 'btn-primary' : ''}`} onClick={() => setBuyers(true)}>Buyer leads</button>
        </div>
      </div>

      {capError && (
        <div style={{ margin: '10px 0 0', display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.8125rem', color: 'var(--error)' }}>
          <Icon name="ban" size={15} />
          <span>{capError}</span>
        </div>
      )}

      <div style={{ height: 12 }} />

      {!buyers ? (
        <PropertyTable
          prefsKey="broker_today"
          hideOwner
          scope="mine"
          stickyTop={headerH}
          onSelect={openDetail}
          {...quickToQuery(quick)}
          headerExtra={
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {QUICKS.map(q => (
                <button key={q.key} className={`btn btn-sm ${quick === q.key ? 'btn-primary' : ''}`} onClick={() => setQuick(q.key)}>
                  {q.label}
                </button>
              ))}
            </div>
          }
        />
      ) : (
        <BuyerTable />
      )}
    </div>
  );
}

function BuyerTable() {
  const { user } = useAuth();
  const vault = useVault();
  const { rows: myLeads, loading } = useMyLeads();
  const [callStop, setCallStop] = useState<CallStop | null>(null);

  const deps = useMemo(
    () => stopDeps(vault.users, vault.logCall, vault.logLeadCall),
    [vault.users, vault.logCall, vault.logLeadCall],
  );

  const leads = useMemo(
    () => myLeads.filter(l => l.state === PropertyState.assigned || l.state === PropertyState.portfolio),
    [myLeads],
  );

  if (!user) return null;

  const open = async (leadId: string) => {
    const l = leads.find(x => x.id === leadId);
    if (!l || !l.callable) return;
    setCallStop(await leadStopFor(l, deps));
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      {callStop && <CallDialog stop={callStop} onClose={() => setCallStop(null)} />}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Project</th><th>Source</th><th>State</th><th>Last outcome</th><th>Enquired</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>Loading…</td></tr>
            ) : leads.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No buyer leads assigned to you.</td></tr>
            ) : leads.map(l => (
              <tr key={l.id} style={{ cursor: l.callable ? 'pointer' : 'default' }} onClick={() => open(l.id)}>
                <td style={{ fontWeight: 500 }}>{l.name || '—'}</td>
                {/* Already masked server-side. */}
                <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{l.phone ?? '—'}</td>
                <td>{l.project ?? '—'}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{l.source ?? '—'}</td>
                <td><StateChip state={l.state} /></td>
                <td>{l.lastOutcome ? <OutcomeChip outcome={l.lastOutcome} buyer /> : '—'}</td>
                <td style={{ fontSize: '0.75rem' }}>{fmtDate(l.enquiryDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
