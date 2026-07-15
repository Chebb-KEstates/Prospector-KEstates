import React from 'react';
import { useVault } from '../../state/VaultContext';
import { fmtDateTime } from '../../utils/format';
import { OutcomeChip } from '../common/StateChip';

interface PropertyTimelineProps {
  propertyId: string;
}

export function PropertyTimeline({ propertyId }: PropertyTimelineProps) {
  const { audit, calls, userById } = useVault();

  const relatedAudit = audit.filter(a =>
    a.propertyIds.includes(propertyId) || a.propertyIds.length === 0
  );
  const relatedCalls = calls.filter(c => c.propertyIds.includes(propertyId));

  const events: { at: string; type: string; detail: string; actor: string; outcome?: string }[] = [];

  for (const a of relatedAudit) {
    events.push({
      at: a.at,
      type: 'audit',
      detail: a.detail,
      actor: userById(a.actorId)?.name ?? a.actorId,
      outcome: a.action,
    });
  }

  for (const c of relatedCalls) {
    events.push({
      at: c.at,
      type: 'call',
      detail: c.note ?? '',
      actor: userById(c.brokerId)?.name ?? c.brokerId,
      outcome: c.outcome,
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div className="card">
      <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Timeline</h3>
      {events.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)' }}>No events recorded.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.slice(0, 50).map((e, i) => (
            <div key={i} style={{
              display: 'flex', gap: 12, paddingBottom: 12,
              borderBottom: '1px solid var(--border-light)',
              fontSize: '0.8125rem',
            }}>
              <div style={{
                minWidth: 120, color: 'var(--text-secondary)',
                fontVariant: 'tabular-nums', fontSize: '0.75rem',
              }}>
                {fmtDateTime(e.at)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{e.actor}</div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                  {e.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
