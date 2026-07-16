import React from 'react';
import { useVault } from '../../state/VaultContext';
import { PropertyTimeline } from './PropertyTimeline';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { fmtDate, fmtAed, fmtArea, maskedPhone } from '../../utils/format';
import { ownerRefOf, propertyRefOf } from '../../logic/ownerGrouping';

interface PropertyDetailProps {
  propertyId: string;
  onBack: () => void;
}

export function PropertyDetail({ propertyId, onBack }: PropertyDetailProps) {
  const { properties, userById } = useVault();
  const p = properties.find(pr => pr.id === propertyId);

  if (!p) {
    return (
      <div>
        <button className="btn btn-ghost" onClick={onBack}>← Back</button>
        <p style={{ marginTop: 16, color: 'var(--text-tertiary)' }}>Property not found.</p>
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back to vault
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Left: Owner info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Owner</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Name</span>
              <div style={{ fontWeight: 500 }}>{p.owner.name || '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Phone</span>
              <div style={{ fontWeight: 500, fontVariant: 'tabular-nums' }}>{maskedPhone(p.owner.phone)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Nationality</span>
              <div>{p.owner.nationality ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Owner Ref</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{ownerRefOf(p)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Property Ref</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{propertyRefOf(p)}</div>
            </div>
          </div>
        </div>

        {/* Right: Property info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Property</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Community</span>
              <div style={{ fontWeight: 500 }}>{p.community}</div>
            </div>
            {p.cluster && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Sub-community</span>
              <div>{p.cluster}</div>
            </div>}
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Unit</span>
              <div>{p.unitLabel}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Type</span>
              <div>{p.propertyType ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Beds</span>
              <div>{p.beds != null ? p.beds : '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Size</span>
              <div>{fmtArea(p.sizeSqft)}</div>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Status</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>State</span>
              <StateChip state={p.state} />
            </div>
            {p.assignedTo && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Assigned to</span>
              <div style={{ fontWeight: 500 }}>{userById(p.assignedTo)?.name ?? p.assignedTo}</div>
            </div>}
            {p.assignedAt && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Assigned</span>
              <div>{fmtDate(p.assignedAt)}</div>
            </div>}
            {p.lastOutcome && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last outcome</span>
              <OutcomeChip outcome={p.lastOutcome} />
            </div>}
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last called</span>
              <div>{fmtDate(p.lastCalledAt)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Call attempts</span>
              <div>{p.callAttempts}</div>
            </div>
          </div>
        </div>

        {/* Transaction info */}
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Transaction</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last transaction</span>
              <div>{fmtDate(p.lastTransactionDate)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Last value</span>
              <div style={{ fontWeight: 500 }}>{fmtAed(p.lastTransactionValue)}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Transaction count</span>
              <div>{p.txCount}</div>
            </div>
            {p.rentAmount && <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Annual rent</span>
              <div>{fmtAed(p.rentAmount)}</div>
            </div>}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 24 }}>
        <PropertyTimeline propertyId={p.id} />
      </div>
    </div>
  );
}
