import React from 'react';
import { useVault } from '../../state/VaultContext';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { fmtDate, maskedPhone } from '../../utils/format';

interface LeadDetailProps {
  leadId: string;
  onBack: () => void;
}

export function LeadDetail({ leadId, onBack }: LeadDetailProps) {
  const { leads, userById } = useVault();
  const l = leads.find(ld => ld.id === leadId);

  if (!l) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <p style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>Lead not found.</p>
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back to vault
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Lead Details</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Name</span>
              <div style={{ fontWeight: 500 }}>{l.name || '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Phone</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{maskedPhone(l.phone)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Email</span>
              <div>{l.email ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Project</span>
              <div>{l.project ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Source</span>
              <div>{l.source ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Enquiry date</span>
              <div>{fmtDate(l.enquiryDate)}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>State</span>
              <StateChip state={l.state} />
            </div>
            {l.assignedTo && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Assigned to</span>
              <div style={{ fontWeight: 500 }}>{userById(l.assignedTo)?.name ?? l.assignedTo}</div>
            </div>}
            {l.lastOutcome && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last outcome</span>
              <OutcomeChip outcome={l.lastOutcome} buyer />
            </div>}
          </div>
        </div>

        {Object.keys(l.extra).length > 0 && (
          <div className="card">
            <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Extra Fields</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Object.entries(l.extra).map(([key, val]) => (
                <div key={key}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>{key}</span>
                  <div>{val}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
