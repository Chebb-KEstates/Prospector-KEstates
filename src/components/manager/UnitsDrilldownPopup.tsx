import React, { useEffect, useState } from 'react';
import * as api from '../../data/api';
import { Property } from '../../types/models';
import { Icon } from '../common/Icon';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { fmtInt, fmtArea } from '../../utils/format';
import { ApiError } from '../../data/apiClient';
import { PropertyPopup } from './PropertyPopup';

/** The scope a clicked number carried — passed straight to /api/dashboard/units. */
export interface DrillParams {
  metric: string;
  brokerId?: string;
  from?: string;
  to?: string;
  community?: string;
  cluster?: string;
}

/**
 * The units behind a clicked report/dashboard number. Fetches the drill-down
 * list for `params`, shows it as a quick table, and (like the Activity Log) lets
 * a row open the unit's full record. The header shows the unit count next to the
 * original figure, so a call-count metric ("8 no-answer calls") reading as fewer
 * units is self-explanatory.
 */
export function UnitsDrilldownPopup({ title, subtitle, params, units: given, onClose }: {
  title: string;
  /** e.g. "Sara · Last 30 days" or "8 no-answer calls" — the number's context. */
  subtitle?: string;
  /** Fetch the list by metric+scope… */
  params?: DrillParams;
  /** …or pass an already-loaded list (e.g. the reassign conflict units). */
  units?: Property[];
  onClose: () => void;
}) {
  const [fetched, setFetched] = useState<Property[]>([]);
  const [loading, setLoading] = useState(!!params);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const units = given ?? fetched;

  useEffect(() => {
    if (!params) return;
    let cancelled = false;
    setLoading(true); setError(null);
    void (async () => {
      try {
        const u = await api.dashboard.units(params);
        if (!cancelled) setFetched(u);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load those units.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.metric, params?.brokerId, params?.from, params?.to, params?.community, params?.cluster]);

  const ids = units.map(u => u.id);

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 960, width: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <h3 style={{ fontWeight: 600, margin: 0 }}>{title}</h3>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {loading ? 'Loading…' : `${fmtInt(units.length)} unit${units.length === 1 ? '' : 's'}`}{subtitle ? ` · ${subtitle}` : ''}
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={onClose}><Icon name="x" size={14} /> Close</button>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ overflow: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Unit</th><th>Community</th><th>Sub-community</th>
                    <th style={{ textAlign: 'right' }}>Beds</th>
                    <th style={{ textAlign: 'right' }}>Size</th>
                    <th>State</th><th>Last outcome</th><th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {error ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--error)' }}>{error}</td></tr>
                  ) : loading ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text-secondary)' }}>Loading…</td></tr>
                  ) : units.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--text-tertiary)' }}>No units to show.</td></tr>
                  ) : units.map(p => (
                    <tr key={p.id} onClick={() => setDetailId(p.id)} style={{ cursor: 'pointer' }} title="Open this unit's record">
                      <td style={{ fontWeight: 500 }}>{p.unitLabel}</td>
                      <td>{p.community || '—'}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{p.cluster || '—'}</td>
                      <td className="tabular-nums" style={{ textAlign: 'right' }}>{p.beds ?? '—'}</td>
                      <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtArea(p.sizeSqft)}</td>
                      <td><StateChip state={p.state} /></td>
                      <td>{p.lastOutcome ? <OutcomeChip outcome={p.lastOutcome} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{p.owner.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Tip: click a unit to open its full record.</div>
        </div>
      </div>

      {detailId && (
        <PropertyPopup propertyId={detailId} ids={ids}
          onNavigate={id => setDetailId(id)} onClose={() => setDetailId(null)} />
      )}
    </>
  );
}
