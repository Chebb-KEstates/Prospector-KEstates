import React from 'react';
import { fmtInt, timeAgo } from '../../utils/format';
import type { TeamBrokerRow, Holding } from '../../data/api';
import { Col } from '../common/AnalyticsTable';

/**
 * The one broker-breakdown column set, shared by the manager Report table and the
 * dashboard's broker board so both offer exactly the same columns to choose from.
 * Call columns (attempts, answered, interested, rates) reflect whatever window the
 * caller's rows were fetched for; assignment/coverage/follow-ups are a snapshot.
 *
 * `days` is the number of days the fetched window spans, used only by the
 * Calls/day column (undefined ⇒ Calls/day shows —).
 */
export function brokerBoardColumns(days?: number): Col<TeamBrokerRow>[] {
  const pct = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '—');
  const ts = (iso?: string) => (iso ? new Date(iso).getTime() : undefined);
  const idleDays = (lastAt?: string) => {
    if (!lastAt) return '—';
    const d = Math.floor((Date.now() - new Date(lastAt).getTime()) / 86_400_000);
    return d <= 0 ? 'today' : `${d}d`;
  };
  return [
    { key: 'areas', label: 'Areas held', render: b => <HoldingList items={b.areas} /> },
    { key: 'sets', label: 'Data assigned', render: b => <HoldingList items={b.datasets} /> },
    // Portfolio is hidden for now — kept units fold into the Assigned figure.
    { key: 'assigned', label: 'Assigned', align: 'right', render: b => fmtInt(b.assigned + b.portfolio), sortValue: b => b.assigned + b.portfolio },
    { key: 'attempts', label: 'Total call attempts', align: 'right', render: b => fmtInt(b.calls), sortValue: b => b.calls },
    { key: 'noAnswer', label: 'No answer', align: 'right', render: b => fmtInt(b.noAnswer), sortValue: b => b.noAnswer },
    { key: 'answered', label: 'Answered', align: 'right', render: b => fmtInt(b.reached), sortValue: b => b.reached },
    {
      key: 'interested', label: 'New interested', align: 'right', sortValue: b => b.interested,
      render: b => <span title="Units that newly became interested in the selected period" style={{ color: b.interested > 0 ? 'var(--success)' : undefined, fontWeight: b.interested > 0 ? 700 : undefined }}>{fmtInt(b.interested)}</span>,
    },
    { key: 'answerRate', label: 'Answer rate', align: 'right', render: b => pct(b.reached, b.calls), sortValue: b => (b.calls ? b.reached / b.calls : undefined) },
    { key: 'interestRate', label: 'Interested rate', align: 'right', render: b => pct(b.interested, b.reached), sortValue: b => (b.reached ? b.interested / b.reached : undefined) },
    { key: 'lastAt', label: 'Last call', align: 'right', render: b => (b.lastAt ? timeAgo(b.lastAt) : '—'), sortValue: b => ts(b.lastAt) },
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
}

/**
 * A stacked list of holdings for one table cell — each name on its own line with
 * a unit-count pill, biggest first. Used both ways: a broker's data sets and a
 * data set's brokers. A dash when nothing is held.
 */
export function HoldingList({ items }: { items: Holding[] }) {
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
