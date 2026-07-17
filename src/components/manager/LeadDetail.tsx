import React, { useState, useEffect } from 'react';
import { useVault } from '../../state/VaultContext';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { fmtDate } from '../../utils/format';
import { Lead } from '../../types/models';
import * as api from '../../data/api';

interface LeadDetailProps {
  leadId: string;
  onBack: () => void;
}

export function LeadDetail({ leadId, onBack }: LeadDetailProps) {
  const { userById, revision } = useVault();
  const [l, setL] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetched by id — there's no local leads array to search any more.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const lead = await api.leads.byId(leadId);
        if (!cancelled) setL(lead);
      } catch {
        if (!cancelled) setL(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leadId, revision]);

  if (loading) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <p style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>Loading…</p>
      </div>
    );
  }

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
              {/* Masked server-side; the reveal lives in the call dialog. */}
              <div style={{ fontVariant: 'tabular-nums' }}>{l.phone ?? '—'}</div>
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
