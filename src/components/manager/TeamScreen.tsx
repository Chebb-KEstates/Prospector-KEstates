import React, { useMemo, useState } from 'react';
import { fmtInt, fmtAed } from '../../utils/format';
import { StatTile } from '../common/Dash';
import { Icon } from '../common/Icon';
import { AnalyticsTable, Col } from '../common/AnalyticsTable';
import { brokerBoardColumns, HoldingList } from './brokerColumns';
import { useTeamDashboard } from '../../data/hooks';
import type { TeamAreaRow } from '../../data/api';

/**
 * Team & Data — the manager Report.
 *
 * A date-range selector drives the per-broker CALL columns (attempts, answered,
 * interested and the two rates); the assignment/coverage columns are a snapshot
 * of the current book and don't move with the range, because the app keeps no
 * history of who held what on a past date. The data-set table and Data-ROI below
 * are all-time. Every figure is pre-aggregated by /api/dashboard/team; each
 * table's columns are show/hide-able and reorderable (remembered per screen).
 */

type RangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'custom' | 'all';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'custom', label: 'Custom range…' },
  { key: 'all', label: 'All time' },
];

/** 'YYYY-MM-DD' → a local Date, parsed by parts so no browser date-string quirks. */
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * The [from, to) ISO bounds for the chosen range, plus the number of days it
 * spans (for the Calls/day column). Calendar days (today/yesterday/custom) follow
 * the viewer's local calendar; the rolling windows are the last N×24h.
 */
function computeRange(key: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string; days?: number } {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (d: Date, days: number) => { const n = new Date(d); n.setDate(n.getDate() + days); return n; };
  const iso = (d: Date) => d.toISOString();
  const DAY = 86_400_000;
  switch (key) {
    case 'all': return {};
    case 'today': return { from: iso(startOfDay), to: iso(shift(startOfDay, 1)), days: 1 };
    case 'yesterday': return { from: iso(shift(startOfDay, -1)), to: iso(startOfDay), days: 1 };
    case 'last7': return { from: iso(new Date(now.getTime() - 7 * DAY)), to: iso(now), days: 7 };
    case 'last30': return { from: iso(new Date(now.getTime() - 30 * DAY)), to: iso(now), days: 30 };
    case 'custom': {
      const f = parseLocalDate(customFrom);
      const t = parseLocalDate(customTo);
      if (!f || !t || t < f) return {};
      const toExclusive = shift(t, 1);
      const days = Math.max(1, Math.round((toExclusive.getTime() - f.getTime()) / DAY));
      return { from: iso(f), to: iso(toExclusive), days };
    }
  }
  return {};
}

export function TeamScreen() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('last30');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(() => computeRange(rangeKey, customFrom, customTo), [rangeKey, customFrom, customTo]);
  const { data, loading, error } = useTeamDashboard({ from: range.from, to: range.to });

  const rangeLabel = RANGES.find(r => r.key === rangeKey)?.label ?? '';
  const days = range.days;

  // ── Broker breakdown columns ────────────────────────────────────────────────
  // Shared with the dashboard's broker board so both offer the same columns.
  // Default view = the nine below (in this order); the rest are available but
  // hidden until toggled on. Call columns follow the selected range.
  const brokerDefault = ['areas', 'assigned', 'attempts', 'noAnswer', 'answered', 'interested', 'answerRate', 'interestRate', 'lastAt'];
  const brokerCols = brokerBoardColumns(days);

  // ── Area breakdown columns ──────────────────────────────────────────────────
  // One row per area (community + sub-community), with the brokers holding units
  // there — so an area split across several data sets still reads as one row.
  const areaLabel = (a: TeamAreaRow) => {
    const community = a.community || '(no community)';
    return a.cluster ? `${community} · ${a.cluster}` : community;
  };
  const areaCols: Col<TeamAreaRow>[] = [
    { key: 'brokers', label: 'Assigned brokers', render: a => <HoldingList items={a.brokers} /> },
    { key: 'properties', label: 'Units', align: 'right', render: a => fmtInt(a.properties), sortValue: a => a.properties },
    { key: 'callable', label: 'Callable', align: 'right', render: a => fmtInt(a.callable), sortValue: a => a.callable },
    { key: 'assigned', label: 'Assigned', align: 'right', render: a => fmtInt(a.assigned), sortValue: a => a.assigned },
    { key: 'pool', label: 'In pool', align: 'right', render: a => fmtInt(a.pool), sortValue: a => a.pool },
    { key: 'untouched', label: 'Untouched', align: 'right', render: a => <span style={{ color: a.untouched > 0 ? 'var(--warning)' : undefined }}>{fmtInt(a.untouched)}</span>, sortValue: a => a.untouched },
    {
      key: 'interested', label: 'Interested', align: 'right', sortValue: a => a.interested,
      render: a => <span style={{ color: a.interested > 0 ? 'var(--success)' : undefined, fontWeight: a.interested > 0 ? 700 : undefined }}>{fmtInt(a.interested)}</span>,
    },
  ];

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Report</h2>
        <div style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <Icon name="calendar" size={15} /> Showing
          <select className="input" style={{ width: 'auto', padding: '6px 10px' }} value={rangeKey} onChange={e => setRangeKey(e.target.value as RangeKey)}>
            {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </label>
        {rangeKey === 'custom' && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input className="input" type="date" style={{ padding: '5px 8px' }} value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span style={{ color: 'var(--text-tertiary)' }}>–</span>
            <input className="input" type="date" style={{ padding: '5px 8px' }} value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {loading && !data ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : error && !data ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--error)' }}>{error}</div>
      ) : !data ? null : (
        <>
          <SectionTitle>
            Brokers
            <span style={{ fontWeight: 400, fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
              call columns: {rangeLabel.toLowerCase()} · assignment &amp; coverage: current book
            </span>
          </SectionTitle>
          <AnalyticsTable
            rows={data.brokers} prefsKey="team.brokers.v4"
            pinned={{ label: 'Broker', render: b => b.name, sortValue: b => b.name }}
            columns={brokerCols} defaultVisible={brokerDefault} empty="No active brokers." />

          <div style={{ height: 28 }} />

          <SectionTitle>
            Area breakdown
            <span style={{ fontWeight: 400, fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: 8 }}>
              community · sub-community — who holds what
            </span>
          </SectionTitle>
          <AnalyticsTable
            rows={data.areas} prefsKey="team.areas.v1"
            pinned={{ label: 'Area', render: areaLabel, sortValue: areaLabel }}
            columns={areaCols} empty="No areas yet." />

          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: '28px 0 12px' }}>Data ROI <span style={{ fontWeight: 400, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>· all time</span></h3>
          <div className="card">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 32px' }}>
              <StatTile value={fmtAed(data.roi.totalCost)} label="total data spend" />
              <StatTile value={`${data.roi.datasets}`} label="data sets" />
              <StatTile value={fmtInt(data.roi.properties)} label="properties" color="var(--primary)" />
              <StatTile value={fmtInt(data.roi.callable)} label="callable" />
              <StatTile value={data.roi.callable ? `${Math.round(data.roi.callableWorked / data.roi.callable * 100)}%` : '—'} label="callable worked" />
              <StatTile value={fmtInt(data.roi.calls)} label="total calls" />
              <StatTile value={data.roi.reached ? `${Math.round(data.roi.interested / data.roi.reached * 100)}%` : '—'} label="interest rate" color="var(--success)" />
              <StatTile value={data.roi.costPerInterested != null ? fmtAed(data.roi.costPerInterested) : '—'} label="cost per interested" color="var(--info)" />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 10 }}>{children}</h3>;
}

