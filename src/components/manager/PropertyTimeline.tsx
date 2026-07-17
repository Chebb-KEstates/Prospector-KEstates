import React, { useState, useEffect } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallLog, CallOutcomeLabel } from '../../types/models';
import { fmtDateTime } from '../../utils/format';
import { OutcomeChip } from '../common/StateChip';
import * as api from '../../data/api';

interface PropertyTimelineProps {
  propertyId: string;
}

/**
 * A unit's history.
 *
 * This used to merge the local audit array with the local calls array — and
 * included every audit entry with an EMPTY propertyIds list, so unrelated
 * events (settings changes, sign-ins) showed up in every unit's timeline. It
 * now shows this unit's calls, fetched by id through an indexed join.
 */
export function PropertyTimeline({ propertyId }: PropertyTimelineProps) {
  const { userById, revision } = useVault();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.properties.calls(propertyId);
        if (!cancelled) setCalls(r);
      } catch {
        if (!cancelled) setCalls([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [propertyId, revision]);

  const events = [...calls].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="card">
      <h3 style={{ fontWeight: 600, marginBottom: 16 }}>Timeline</h3>
      {loading ? (
        <p style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
      ) : events.length === 0 ? (
        <p style={{ color: 'var(--text-tertiary)' }}>No events recorded.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {events.slice(0, 50).map(c => (
            <div key={c.id} style={{
              display: 'flex', gap: 12, paddingBottom: 12,
              borderBottom: '1px solid var(--border-light)',
              fontSize: '0.8125rem',
            }}>
              <div style={{
                minWidth: 120, color: 'var(--text-secondary)',
                fontVariant: 'tabular-nums', fontSize: '0.75rem',
              }}>
                {fmtDateTime(c.at)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{userById(c.brokerId)?.name ?? c.brokerId}</span>
                  <OutcomeChip outcome={c.outcome} />
                </div>
                {c.note && (
                  <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>{c.note}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
