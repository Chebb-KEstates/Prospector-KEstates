import React, { useState } from 'react';
import { fmtInt, fmtAed, fmtDate, timeAgo } from '../../utils/format';
import { DataModuleLabel } from '../../types/models';
import { StatTile } from '../common/Dash';
import { Icon } from '../common/Icon';
import { useTableLayout, ColumnsDialog } from '../common/tableLayout';
import { useTeamDashboard } from '../../data/hooks';
import type { TeamBrokerRow, TeamDatasetRow } from '../../data/api';

/**
 * Team & Data.
 *
 * Two editable breakdown tables — one per broker, one per data set — plus the
 * data-ROI tiles. Every figure is a fold over all calls and all properties,
 * pre-aggregated by /api/dashboard/team in one request. Each table's columns are
 * show/hide-able and reorderable (remembered per screen via useTableLayout).
 */
export function TeamScreen() {
  const { data, loading, error } = useTeamDashboard();

  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>;
  }
  if (error && !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--error)' }}>{error}</div>;
  }
  if (!data) return null;

  const { brokers, datasetStats, roi } = data;

  const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '—');

  // ── Broker breakdown columns ────────────────────────────────────────────────
  const brokerCols: Col<TeamBrokerRow>[] = [
    { key: 'team', label: 'Team', render: b => b.team || '—' },
    { key: 'assigned', label: 'Assigned', align: 'right', render: b => fmtInt(b.assigned) },
    { key: 'portfolio', label: 'Portfolio', align: 'right', render: b => fmtInt(b.portfolio) },
    { key: 'calls', label: 'Calls', align: 'right', render: b => fmtInt(b.calls) },
    { key: 'calls7d', label: 'Calls 7d', align: 'right', render: b => fmtInt(b.calls7d) },
    { key: 'calls24h', label: 'Calls 24h', align: 'right', render: b => fmtInt(b.calls24h) },
    { key: 'noAnswer', label: 'No answer', align: 'right', render: b => fmtInt(b.noAnswer) },
    { key: 'reached', label: 'Reached', align: 'right', render: b => fmtInt(b.reached) },
    {
      key: 'interested', label: 'Interested', align: 'right',
      render: b => <span style={{ color: b.interested > 0 ? 'var(--success)' : undefined, fontWeight: b.interested > 0 ? 700 : undefined }}>{fmtInt(b.interested)}</span>,
    },
    { key: 'answer', label: 'Answer rate', align: 'right', render: b => pct(b.reached, b.calls) },
    { key: 'interest', label: 'Interest rate', align: 'right', render: b => pct(b.interested, b.reached) },
    { key: 'lastAt', label: 'Last call', align: 'right', render: b => (b.lastAt ? timeAgo(b.lastAt) : '—') },
  ];

  // ── Data-set breakdown columns ──────────────────────────────────────────────
  const datasetCols: Col<TeamDatasetRow>[] = [
    { key: 'module', label: 'Module', render: d => DataModuleLabel[d.module] },
    { key: 'properties', label: 'Properties', align: 'right', render: d => fmtInt(d.properties) },
    { key: 'callable', label: 'Callable', align: 'right', render: d => fmtInt(d.callable) },
    { key: 'numbers', label: 'Numbers', align: 'right', render: d => fmtInt(d.numbers) },
    { key: 'agents', label: 'Agents', align: 'right', render: d => fmtInt(d.agents) },
    { key: 'assigned', label: 'Assigned', align: 'right', render: d => fmtInt(d.assigned) },
    { key: 'untouched', label: 'Untouched', align: 'right', render: d => <span style={{ color: d.untouched > 0 ? 'var(--warning)' : undefined }}>{fmtInt(d.untouched)}</span> },
    { key: 'calls', label: 'Calls', align: 'right', render: d => fmtInt(d.calls) },
    { key: 'noAnswer', label: 'No answer', align: 'right', render: d => fmtInt(d.noAnswer) },
    {
      key: 'interested', label: 'Interested', align: 'right',
      render: d => <span style={{ color: d.interested > 0 ? 'var(--success)' : undefined, fontWeight: d.interested > 0 ? 700 : undefined }}>{fmtInt(d.interested)}</span>,
    },
    { key: 'cost', label: 'Cost', align: 'right', render: d => (d.cost != null && d.cost > 0 ? fmtAed(d.cost) : '—') },
    { key: 'imported', label: 'Imported', render: d => <span style={{ fontSize: '0.75rem' }}>{fmtDate(d.importedAt)}</span> },
    { key: 'updated', label: 'Updated', render: d => <span style={{ fontSize: '0.75rem', color: d.lastUpdatedAt ? 'var(--text)' : 'var(--text-tertiary)' }}>{d.lastUpdatedAt ? fmtDate(d.lastUpdatedAt) : '—'}</span> },
  ];

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 20 }}>Team &amp; Data</h2>

      <SectionTitle>Brokers</SectionTitle>
      <AnalyticsTable
        rows={brokers} prefsKey="team.brokers"
        pinned={{ label: 'Broker', render: b => b.name }}
        columns={brokerCols} empty="No active brokers." />

      <div style={{ height: 28 }} />

      <SectionTitle>Data sets</SectionTitle>
      <AnalyticsTable
        rows={datasetStats} prefsKey="team.datasets"
        pinned={{ label: 'Name', render: d => d.name }}
        columns={datasetCols} empty="No data sets yet." />

      <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '28px 0 12px' }}>Data ROI</h3>
      <div className="card">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 32px' }}>
          <StatTile value={fmtAed(roi.totalCost)} label="total data spend" />
          <StatTile value={`${roi.datasets}`} label="data sets" />
          <StatTile value={fmtInt(roi.properties)} label="properties" color="var(--primary)" />
          <StatTile value={fmtInt(roi.callable)} label="callable" />
          <StatTile value={roi.callable ? `${Math.round(roi.callableWorked / roi.callable * 100)}%` : '—'} label="callable worked" />
          <StatTile value={fmtInt(roi.calls)} label="total calls" />
          <StatTile value={roi.reached ? `${Math.round(roi.interested / roi.reached * 100)}%` : '—'} label="interest rate" color="var(--success)" />
          <StatTile value={roi.costPerInterested != null ? fmtAed(roi.costPerInterested) : '—'} label="cost per interested" color="var(--info)" />
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 10 }}>{children}</h3>;
}

interface Col<T> {
  key: string;
  label: string;
  align?: 'right';
  render: (row: T) => React.ReactNode;
}

/**
 * A breakdown table with a pinned identity column and show/hide + reorder on the
 * rest — reusing the shared table-layout platform so it behaves like every other
 * table in the app and remembers the layout per screen.
 */
function AnalyticsTable<T extends { id: string }>({ rows, pinned, columns, prefsKey, empty }: {
  rows: T[];
  pinned: { label: string; render: (row: T) => React.ReactNode };
  columns: Col<T>[];
  prefsKey: string;
  empty: string;
}) {
  const available = columns.map(c => c.key);
  const layout = useTableLayout(available, available, prefsKey);
  const [showCols, setShowCols] = useState(false);
  const byKey = new Map(columns.map(c => [c.key, c]));
  const visible = layout.visibleCols.map(k => byKey.get(k)).filter((c): c is Col<T> => !!c);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={() => setShowCols(true)}>
          <Icon name="columns" size={15} /> Columns
        </button>
      </div>

      {showCols && (
        <ColumnsDialog
          order={layout.order}
          visible={layout.visible}
          labelOf={k => byKey.get(k)?.label ?? k}
          pinnedLabel={pinned.label}
          onChange={(o, v) => { layout.setOrder(o); layout.setVisible(new Set(v)); layout.persist(o, new Set(v)); }}
          onReset={layout.reset}
          onClose={() => setShowCols(false)}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{pinned.label}</th>
                {visible.map(c => (
                  <th key={c.key} style={{ textAlign: c.align === 'right' ? 'right' : undefined }}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={visible.length + 1} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>{empty}</td></tr>
              ) : rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{pinned.render(r)}</td>
                  {visible.map(c => (
                    <td key={c.key} className={c.align === 'right' ? 'tabular-nums' : undefined}
                      style={{ textAlign: c.align === 'right' ? 'right' : undefined }}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
