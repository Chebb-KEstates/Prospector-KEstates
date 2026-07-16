import React, { useState, useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { useCallSession } from '../../state/CallSessionContext';
import { Property, PropertyState, CallOutcome, isInterested } from '../../types/models';
import { PropertyTable } from '../manager/PropertyTable';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { maskedPhone, fmtDate } from '../../utils/format';
import { ownerCallStops, leadCallStops } from './callStops';

type Quick = 'all' | 'due' | 'fresh' | 'noAnswer' | 'interested';
const QUICKS: { key: Quick; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'due', label: 'Due follow-up' },
  { key: 'fresh', label: 'Never called' },
  { key: 'noAnswer', label: 'No answer' },
  { key: 'interested', label: 'Interested' },
];

export function TodayTab() {
  const { user } = useAuth();
  const vault = useVault();
  const { start } = useCallSession();
  const [buyers, setBuyers] = useState(false);
  const [quick, setQuick] = useState<Quick>('all');

  const ownerProps = user ? vault.assignedTo(user.id) : [];
  const filtered = useMemo(() => {
    const now = new Date();
    const match = (p: Property): boolean => {
      switch (quick) {
        case 'due': return !!p.nextFollowUpAt && new Date(p.nextFollowUpAt) <= now;
        case 'fresh': return !p.lastCalledAt;
        case 'noAnswer': return p.lastOutcome === CallOutcome.noAnswer;
        case 'interested': return !!p.lastOutcome && isInterested(p.lastOutcome);
        default: return true;
      }
    };
    return ownerProps.filter(match);
  }, [ownerProps, quick]);

  if (!user) return null;

  const leads = vault.leadsOf(user.id).filter(l => l.state === PropertyState.assigned || l.state === PropertyState.portfolio);
  const startOwners = () => start(ownerCallStops(vault, user.id), 'Calling owners');
  const startLeads = () => start(leadCallStops(vault, user.id), 'Calling buyer leads');
  const ownerCallable = ownerProps.filter(p => p.callable);
  const leadCallable = leads.filter(l => l.callable);

  return (
    <div>
      {/* Owners | Buyers switch + Start calling */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button className="btn" style={{ borderRadius: 0, border: 'none', background: !buyers ? 'var(--primary)' : 'transparent', color: !buyers ? '#fff' : 'var(--text-secondary)' }} onClick={() => setBuyers(false)}>
            Property owners
          </button>
          <button className="btn" style={{ borderRadius: 0, border: 'none', background: buyers ? 'var(--primary)' : 'transparent', color: buyers ? '#fff' : 'var(--text-secondary)' }} onClick={() => setBuyers(true)}>
            Buyer leads
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {!buyers ? (
          <button className="btn btn-primary" onClick={startOwners} disabled={ownerCallable.length === 0}
            style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013' }}>
            <Icon name="phoneCall" size={16} /> Start calling ({new Set(ownerCallable.map(p => p.owner.phone)).size})
          </button>
        ) : (
          <button className="btn btn-primary" onClick={startLeads} disabled={leadCallable.length === 0}
            style={{ background: 'var(--gold)', borderColor: 'var(--gold)', color: '#2A2013' }}>
            <Icon name="phoneCall" size={16} /> Start calling ({leadCallable.length})
          </button>
        )}
      </div>

      {!buyers ? (
        <>
          {/* Quick filter chips */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {QUICKS.map(q => (
              <button key={q.key} className={`btn btn-sm ${quick === q.key ? 'btn-primary' : ''}`} onClick={() => setQuick(q.key)}>
                {q.label}
              </button>
            ))}
          </div>
          <PropertyTable properties={filtered} onSelect={(id) => vault.recordView(user.id, false, `Viewed owner of ${id}`)} />
        </>
      ) : (
        <BuyerTable />
      )}
    </div>
  );
}

function BuyerTable() {
  const { user } = useAuth();
  const vault = useVault();
  if (!user) return null;
  const leads = vault.leadsOf(user.id).filter(l => l.state === PropertyState.assigned || l.state === PropertyState.portfolio);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Project</th><th>Source</th><th>State</th><th>Last outcome</th><th>Enquired</th></tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No buyer leads assigned to you.</td></tr>
            ) : leads.map(l => (
              <tr key={l.id}>
                <td style={{ fontWeight: 500 }}>{l.name || '—'}</td>
                <td className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{maskedPhone(l.phone)}</td>
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
