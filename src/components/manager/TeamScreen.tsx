import React from 'react';
import { useVault } from '../../state/VaultContext';
import { PropertyState, CallOutcome, isInterested } from '../../types/models';
import { fmtInt, fmtAed } from '../../utils/format';
import { StatTile } from '../common/Dash';

function connected(o: CallOutcome) {
  return o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
}

export function TeamScreen() {
  const { brokers, properties, datasets, calls, callsBy, assignedTo } = useVault();

  const totalCost = datasets.reduce((s, d) => s + (d.cost ?? 0), 0);
  const callableTotal = properties.filter(p => p.callable).length;
  const workedCallable = properties.filter(p => p.callable && p.lastCalledAt).length;
  const interestedTotal = calls.filter(c => isInterested(c.outcome)).length;
  const reachedTotal = calls.filter(c => connected(c.outcome)).length;
  const costPerInterested = interestedTotal > 0 ? totalCost / interestedTotal : undefined;

  const active = brokers.filter(b => b.active);

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
              {active.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No active brokers.</td></tr>
              ) : active.map(b => {
                const bCalls = callsBy(b.id);
                const reached = bCalls.filter(c => connected(c.outcome)).length;
                const interested = bCalls.filter(c => isInterested(c.outcome)).length;
                const held = assignedTo(b.id);
                const assigned = held.filter(p => p.state === PropertyState.assigned).length;
                const portfolio = held.filter(p => p.state === PropertyState.portfolio).length;
                const answer = bCalls.length ? Math.round(reached / bCalls.length * 100) : null;
                const interest = reached ? Math.round(interested / reached * 100) : null;
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>{b.name}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{b.team || '—'}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{assigned}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{portfolio}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{bCalls.length}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{reached}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right', color: interested > 0 ? 'var(--success)' : undefined, fontWeight: interested > 0 ? 700 : undefined }}>{interested}</td>
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
          <StatTile value={fmtAed(totalCost)} label="total data spend" />
          <StatTile value={`${datasets.length}`} label="data sets" />
          <StatTile value={fmtInt(properties.length)} label="properties" color="var(--primary)" />
          <StatTile value={fmtInt(callableTotal)} label="callable" />
          <StatTile value={callableTotal ? `${Math.round(workedCallable / callableTotal * 100)}%` : '—'} label="callable worked" />
          <StatTile value={fmtInt(calls.length)} label="total calls" />
          <StatTile value={reachedTotal ? `${Math.round(interestedTotal / reachedTotal * 100)}%` : '—'} label="interest rate" color="var(--success)" />
          <StatTile value={costPerInterested != null ? fmtAed(costPerInterested) : '—'} label="cost per interested" color="var(--info)" />
        </div>
      </div>
    </div>
  );
}
