import React from 'react';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';

export function TeamScreen() {
  const { brokers, properties, datasets, calls, callsBy, userById } = useVault();

  const totalCost = datasets.reduce((s, d) => s + (d.cost ?? 0), 0);

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Team Performance</h2>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Broker</th>
              <th>Team</th>
              <th>Assigned</th>
              <th>Portfolio</th>
              <th>Total Calls</th>
              <th>Interested</th>
              <th>Call Rate</th>
              <th>Pool Units</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map(b => {
              const bCalls = callsBy(b.id);
              const bInterested = bCalls.filter(c =>
                c.outcome === 'interestedSell' || c.outcome === 'interestedRent'
              ).length;
              const assigned = properties.filter(p =>
                p.assignedTo === b.id && p.state === PropertyState.assigned
              ).length;
              const portfolio = properties.filter(p =>
                p.assignedTo === b.id && p.state === PropertyState.portfolio
              ).length;
              const totalAssigned = assigned + portfolio;
              const callRate = totalAssigned > 0
                ? Math.round((bCalls.length / totalAssigned) * 100)
                : 0;

              return (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.team}</td>
                  <td>{assigned}</td>
                  <td>{portfolio}</td>
                  <td style={{ fontWeight: 500 }}>{bCalls.length}</td>
                  <td style={{ color: 'var(--success)' }}>{bInterested}</td>
                  <td>{callRate}%</td>
                  <td>
                    {properties.filter(p =>
                      p.state === PropertyState.pool &&
                      datasets.some(d =>
                        properties.filter(pp => pp.datasetId === d.id).length > 0
                      )
                    ).length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 24, marginBottom: 12 }}>Data ROI</h3>
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Total data spend</div>
            <div style={{ fontWeight: 600 }}>AED {totalCost.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Data sets</div>
            <div style={{ fontWeight: 600 }}>{datasets.length}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Total properties</div>
            <div style={{ fontWeight: 600 }}>{properties.length}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Total calls</div>
            <div style={{ fontWeight: 600 }}>{calls.length}</div>
          </div>
          <div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Interest rate</div>
            <div style={{ fontWeight: 600 }}>
              {calls.length > 0
                ? Math.round((calls.filter(c =>
                    c.outcome === 'interestedSell' || c.outcome === 'interestedRent'
                  ).length / calls.length) * 100) + '%'
                : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
