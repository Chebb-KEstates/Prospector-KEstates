import React from 'react';
import { useVault } from '../../state/VaultContext';
import { Property } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { ownerRefOf, propertyRefOf } from '../../logic/ownerGrouping';
import { maskedPhone, fmtDate, fmtAed, fmtArea } from '../../utils/format';
import { PropertyTimeline } from '../manager/PropertyTimeline';

interface OwnerScreenProps {
  properties: Property[];
  ownerName: string;
  onBack: () => void;
  onCall: (property: Property) => void;
  phoneVisible?: boolean;
}

export function OwnerScreen({ properties, ownerName, onBack, onCall, phoneVisible }: OwnerScreenProps) {
  const { recordView, userById } = useVault();

  const owner = properties[0].owner;
  const first = properties[0];

  return (
    <div>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        ← Back
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>{ownerName || 'Unknown Owner'}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Phone</span>
              <div style={{
                fontWeight: 500, fontVariant: 'tabular-nums', fontSize: '1.125rem',
                color: phoneVisible ? 'var(--text)' : undefined,
              }}>
                {phoneVisible ? (owner.phone ?? '—') : maskedPhone(owner.phone)}
              </div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Nationality</span>
              <div>{owner.nationality ?? '—'}</div>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem' }}>Owner Ref</span>
              <div style={{ fontVariant: 'tabular-nums' }}>{ownerRefOf(first)}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Properties ({properties.length})</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {properties.map(p => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8,
              }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{p.unitLabel}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                    {p.community}{p.cluster ? ` · ${p.cluster}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StateChip state={p.state} />
                  <button className="btn btn-sm btn-primary" onClick={() => onCall(p)}>
                    Call
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <PropertyTimeline propertyId={first.id} />
    </div>
  );
}
