import React, { useEffect, useState } from 'react';
import * as api from '../../data/api';
import { Property } from '../../types/models';
import { Icon } from '../common/Icon';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { AnalyticsTable, Col } from '../common/AnalyticsTable';
import { useClientPropertyFilters } from '../common/propertyFilters';
import { fmtInt, fmtArea, timeAgo } from '../../utils/format';
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
 * The units behind a clicked report/dashboard number (or a supplied list). Shows
 * them in a quick table with the main tables' feel — sortable headers, show/hide
 * columns (remembered), and the SAME full "Filters" button the data tables carry
 * (search + state inline, everything else behind one button), applied to the
 * loaded list. A row opens the unit's full record, layered above this popup.
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
  const all = given ?? fetched;

  // The full filter set (same as the data tables), applied to the loaded list.
  const { rows, bar, filtered } = useClientPropertyFilters(all);

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

  // Escape closes this popup — but only when no unit record is layered on top
  // (that record popup handles Escape itself, so one press closes it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !detailId) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailId, onClose]);

  const columns: Col<Property>[] = [
    { key: 'community', label: 'Community', render: p => p.community || '—', sortValue: p => p.community },
    { key: 'cluster', label: 'Sub-community', render: p => p.cluster || '—', sortValue: p => p.cluster },
    { key: 'beds', label: 'Beds', align: 'right', render: p => p.beds ?? '—', sortValue: p => p.beds },
    { key: 'size', label: 'Size', align: 'right', render: p => fmtArea(p.sizeSqft), sortValue: p => p.sizeSqft },
    { key: 'state', label: 'State', render: p => <StateChip state={p.state} />, sortValue: p => p.state },
    { key: 'outcome', label: 'Last outcome', render: p => p.lastOutcome ? <OutcomeChip outcome={p.lastOutcome} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>, sortValue: p => p.lastOutcome ?? '' },
    { key: 'owner', label: 'Owner', render: p => p.owner.name || '—', sortValue: p => p.owner.name },
    { key: 'lastCall', label: 'Last call', align: 'right', render: p => p.lastCalledAt ? timeAgo(p.lastCalledAt) : '—', sortValue: p => (p.lastCalledAt ? new Date(p.lastCalledAt).getTime() : undefined) },
  ];
  const defaultVisible = ['community', 'cluster', 'beds', 'size', 'state', 'outcome', 'owner'];

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        {/* overflow visible so the Filters popover can extend over the table
            without the modal's own scrollbox clipping it; the inner list has its
            own scroll region below. */}
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 1040, width: '94vw', maxHeight: '88vh', overflow: 'visible', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 style={{ fontWeight: 600, margin: 0 }}>{title}</h3>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {loading ? 'Loading…' : filtered ? `${fmtInt(rows.length)} of ${fmtInt(all.length)} units` : `${fmtInt(all.length)} unit${all.length === 1 ? '' : 's'}`}{subtitle ? ` · ${subtitle}` : ''}
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-sm btn-ghost" onClick={onClose}><Icon name="x" size={14} /> Close</button>
          </div>

          {/* The full filter bar — identical to the data-table pages. */}
          <div style={{ marginBottom: 10 }}>{bar}</div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {error ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--error)' }}>{error}</div>
            ) : loading ? (
              <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
            ) : (
              <AnalyticsTable
                rows={rows} prefsKey="units.popup.v1"
                pinned={{ label: 'Unit', render: p => p.unitLabel, sortValue: p => p.unitLabel }}
                columns={columns} defaultVisible={defaultVisible}
                onRowClick={p => setDetailId(p.id)}
                empty={all.length === 0 ? 'No units to show.' : 'No units match the filter.'} />
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 8 }}>Tip: click a unit to open its full record.</div>
        </div>
      </div>

      {detailId && (
        <PropertyPopup propertyId={detailId} ids={rows.map(p => p.id)}
          onNavigate={id => setDetailId(id)} onClose={() => setDetailId(null)} />
      )}
    </>
  );
}
