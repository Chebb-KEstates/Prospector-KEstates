import React, { useMemo, useState } from 'react';
import { fmtInt, fmtAed, fmtDate, timeAgo } from '../../utils/format';
import { DataModuleLabel } from '../../types/models';
import { StatTile } from '../common/Dash';
import { Icon } from '../common/Icon';
import { AnalyticsTable, Col } from '../common/AnalyticsTable';
import { useTeamDashboard } from '../../data/hooks';
import type { TeamBrokerRow, TeamDatasetRow, Holding } from '../../data/api';

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

  const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '—');
  const idleDays = (lastAt?: string) => {
    if (!lastAt) return '—';
    const d = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);
    return d <= 0 ? 'today' : `${d}d`;
  };

  // ── Broker breakdown columns ────────────────────────────────────────────────
  // Default view = the nine below (in this order); the rest are available but
  // hidden until toggled on. Call columns follow the selected range.
  const brokerDefault = ['sets', 'assigned', 'attempts', 'noAnswer', 'answered', 'interested', 'answerRate', 'interestRate', 'lastAt'];
  const ts = (iso?: string) => (iso ? new Date(iso).getTime() : undefined);
  const brokerCols: Col<TeamBrokerRow>[] = [
    { key: 'sets', label: 'Data assigned', render: b => <HoldingList items={b.datasets} /> },
    // Portfolio is hidden for now — kept units fold into the Assigned figure.
    { key: 'assigned', label: 'Assigned', align: 'right', render: b => fmtInt(b.assigned + b.portfolio), sortValue: b => b.assigned + b.portfolio },
    { key: 'attempts', label: 'Total call attempts', align: 'right', render: b => fmtInt(b.calls), sortValue: b => b.calls },
    { key: 'noAnswer', label: 'No answer', align: 'right', render: b => fmtInt(b.noAnswer), sortValue: b => b.noAnswer },
    { key: 'answered', label: 'Answered', align: 'right', render: b => fmtInt(b.reached), sortValue: b => b.reached },
    {
      key: 'interested', label: 'Interested', align: 'right', sortValue: b => b.interested,
      render: b => <span style={{ color: b.interested > 0 ? 'var(--success)' : undefined, fontWeight: b.interested > 0 ? 700 : undefined }}>{fmtInt(b.interested)}</span>,
    },
    { key: 'answerRate', label: 'Answer rate', align: 'right', render: b => pct(b.reached, b.calls), sortValue: b => (b.calls ? b.reached / b.calls : undefined) },
    { key: 'interestRate', label: 'Interested rate', align: 'right', render: b => pct(b.interested, b.reached), sortValue: b => (b.reached ? b.interested / b.reached : undefined) },
    { key: 'lastAt', label: 'Last call', align: 'right', render: b => (b.lastAt ? timeAgo(b.lastAt) : '—'), sortValue: b => ts(b.lastAt) },
    // ── Available but hidden by default ──
    { key: 'team', label: 'Team', render: b => b.team || '—', sortValue: b => b.team },
    {
      key: 'coverage', label: 'Coverage %', align: 'right', sortValue: b => (b.callableAssigned ? b.callableWorked / b.callableAssigned : undefined),
      render: b => <span title={`${b.callableWorked} of ${b.callableAssigned} callable units worked`}>{pct(b.callableWorked, b.callableAssigned)}</span>,
    },
    {
      key: 'followUps', label: 'Follow-ups due', align: 'right', sortValue: b => b.followUpsDue,
      render: b => <span style={{ color: b.followUpsDue > 0 ? 'var(--info)' : undefined, fontWeight: b.followUpsDue > 0 ? 700 : undefined }}>{fmtInt(b.followUpsDue)}</span>,
    },
    { key: 'idle', label: 'Days since last call', align: 'right', render: b => idleDays(b.lastAt), sortValue: b => (b.lastAt ? Date.now() - new Date(b.lastAt).getTime() : undefined) },
    {
      key: 'perDay', label: 'Calls/day', align: 'right', sortValue: b => (days ? b.calls / days : undefined),
      render: b => (days ? (b.calls / days).toFixed(1) : '—'),
    },
  ];

  // ── Data-set breakdown columns (all-time) ───────────────────────────────────
  const datasetCols: Col<TeamDatasetRow>[] = [
    { key: 'brokers', label: 'Assigned brokers', render: d => <HoldingList items={d.brokers} /> },
    { key: 'module', label: 'Module', render: d => DataModuleLabel[d.module], sortValue: d => DataModuleLabel[d.module] },
    { key: 'properties', label: 'Properties', align: 'right', render: d => fmtInt(d.properties), sortValue: d => d.properties },
    { key: 'callable', label: 'Callable', align: 'right', render: d => fmtInt(d.callable), sortValue: d => d.callable },
    { key: 'numbers', label: 'Numbers', align: 'right', render: d => fmtInt(d.numbers), sortValue: d => d.numbers },
    { key: 'agents', label: 'Agents', align: 'right', render: d => fmtInt(d.agents), sortValue: d => d.agents },
    { key: 'assigned', label: 'Assigned', align: 'right', render: d => fmtInt(d.assigned), sortValue: d => d.assigned },
    { key: 'untouched', label: 'Untouched', align: 'right', render: d => <span style={{ color: d.untouched > 0 ? 'var(--warning)' : undefined }}>{fmtInt(d.untouched)}</span>, sortValue: d => d.untouched },
    { key: 'calls', label: 'Calls', align: 'right', render: d => fmtInt(d.calls), sortValue: d => d.calls },
    { key: 'noAnswer', label: 'No answer', align: 'right', render: d => fmtInt(d.noAnswer), sortValue: d => d.noAnswer },
    {
      key: 'interested', label: 'Interested', align: 'right', sortValue: d => d.interested,
      render: d => <span style={{ color: d.interested > 0 ? 'var(--success)' : undefined, fontWeight: d.interested > 0 ? 700 : undefined }}>{fmtInt(d.interested)}</span>,
    },
    { key: 'cost', label: 'Cost', align: 'right', render: d => (d.cost != null && d.cost > 0 ? fmtAed(d.cost) : '—'), sortValue: d => d.cost ?? undefined },
    { key: 'imported', label: 'Imported', render: d => <span style={{ fontSize: '0.75rem' }}>{fmtDate(d.importedAt)}</span>, sortValue: d => (d.importedAt ? new Date(d.importedAt).getTime() : undefined) },
    { key: 'updated', label: 'Updated', render: d => <span style={{ fontSize: '0.75rem', color: d.lastUpdatedAt ? 'var(--text)' : 'var(--text-tertiary)' }}>{d.lastUpdatedAt ? fmtDate(d.lastUpdatedAt) : '—'}</span>, sortValue: d => (d.lastUpdatedAt ? new Date(d.lastUpdatedAt).getTime() : undefined) },
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
            rows={data.brokers} prefsKey="team.brokers.v3"
            pinned={{ label: 'Broker', render: b => b.name, sortValue: b => b.name }}
            columns={brokerCols} defaultVisible={brokerDefault} empty="No active brokers." />

          <div style={{ height: 28 }} />

          <SectionTitle>
            Data sets
            <span style={{ fontWeight: 400, fontSize: '0.8125rem', color: 'var(--text-secondary)', marginLeft: 8 }}>all time</span>
          </SectionTitle>
          <AnalyticsTable
            rows={data.datasetStats} prefsKey="team.datasets.v2"
            pinned={{ label: 'Name', render: d => d.name, sortValue: d => d.name }}
            columns={datasetCols} empty="No data sets yet." />

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

/**
 * A stacked list of holdings for one table cell — each name on its own line with
 * a unit-count pill, biggest first. Used both ways: a broker's data sets and a
 * data set's brokers. A dash when nothing is held.
 */
function HoldingList({ items }: { items: Holding[] }) {
  if (!items.length) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 190 }}>
      {items.map((h, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</span>
          <span className="tabular-nums" style={{
            fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-secondary)',
            background: 'var(--surface-2)', borderRadius: 10, padding: '1px 7px', flexShrink: 0,
          }}>{fmtInt(h.units)}</span>
        </div>
      ))}
    </div>
  );
}

