import React from 'react';
import { fmtInt, fmtAed } from '../../utils/format';
import { StatTile } from '../common/Dash';
import { useTeamDashboard } from '../../data/hooks';

/**
 * Team & Data ROI.
 *
 * Every figure here is a fold over all calls and all properties — exactly the
 * thing that no longer lives in the browser. It arrives pre-aggregated from
 * /api/dashboard/team in one request.
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

  const { brokers, roi } = data;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 20 }}>Team &amp; Data ROI</h2>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Broker</th><th>Team</th>
                <th style={{ textAlign: 'right' }}>Assigned</th>
                <th style={{ textAlign: 'right' }}>Portfolio</th>
                <th style={{ textAlign: 'right' }}>Calls</th>
                <th style={{ textAlign: 'right' }}>Reached</th>
                <th style={{ textAlign: 'right' }}>Interested</th>
                <th style={{ textAlign: 'right' }}>Answer rate</th>
                <th style={{ textAlign: 'right' }}>Interest rate</th>
              </tr>
            </thead>
            <tbody>
              {brokers.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No active brokers.</td></tr>
              ) : brokers.map(b => {
                const answer = b.calls ? Math.round(b.reached / b.calls * 100) : null;
                const interest = b.reached ? Math.round(b.interested / b.reached * 100) : null;
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{b.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{b.team || '—'}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.assigned}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.portfolio}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.calls}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.reached}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right', color: b.interested > 0 ? 'var(--success)' : undefined, fontWeight: b.interested > 0 ? 700 : undefined }}>{b.interested}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{answer == null ? '—' : `${answer}%`}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{interest == null ? '—' : `${interest}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <h3 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 12 }}>Data ROI</h3>
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
