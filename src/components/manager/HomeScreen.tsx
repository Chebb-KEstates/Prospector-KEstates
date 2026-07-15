import React from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyState } from '../../types/models';

export function HomeScreen() {
  const { properties, datasets, brokers, calls, callable, countIn, callsBy, audit } = useVault();
  const { user } = useAuth();

  const poolCount = countIn(PropertyState.pool);
  const assignedCount = countIn(PropertyState.assigned);
  const portfolioCount = countIn(PropertyState.portfolio);
  const coolingCount = countIn(PropertyState.cooling);
  const dncCount = countIn(PropertyState.dnc);

  const todayStr = new Date().toDateString();
  const todayCalls = calls.filter(c => new Date(c.at).toDateString() === todayStr).length;
  const todayViews = audit.filter(a =>
    a.action === 'view' && new Date(a.at).toDateString() === todayStr
  ).length;

  const totalCost = datasets.reduce((s, d) => s + (d.cost ?? 0), 0);
  const roiProperties = properties.filter(p => p.lastOutcome === 'interestedSell' || p.lastOutcome === 'interestedRent').length;

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>
        Dashboard
      </h2>

      {/* Hero stats */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 16, marginBottom: 24,
      }}>
        {[
          { label: 'Total Units', value: properties.length },
          { label: 'Callable', value: callable, color: 'var(--success)' },
          { label: 'Total Calls', value: calls.length },
          { label: 'Calls Today', value: todayCalls, color: 'var(--info)' },
          { label: 'Views Today', value: todayViews, color: 'var(--warning)' },
          { label: 'Data Sets', value: datasets.length },
          { label: 'Brokers', value: brokers.length },
          { label: 'Interested (ROI)', value: roiProperties, color: 'var(--success)' },
          { label: 'Data Spent', value: `AED ${(totalCost / 1000).toFixed(0)}k` },
        ].map(stat => (
          <div key={stat.label} className="card">
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
              {stat.label}
            </div>
            <div style={{
              fontSize: '1.75rem', fontWeight: 700,
              color: stat.color ?? 'var(--text)',
            }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* State breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { state: 'In Pool', count: poolCount, color: '#6B6560' },
          { state: 'Assigned', count: assignedCount, color: '#1565C0' },
          { state: 'Portfolio', count: portfolioCount, color: '#2E7D32' },
          { state: 'Cooling', count: coolingCount, color: '#E65100' },
          { state: 'DNC', count: dncCount, color: '#C62828' },
        ].map(item => (
          <div key={item.state} style={{
            padding: 12, borderRadius: 8,
            background: `${item.color}10`,
            border: `1px solid ${item.color}20`,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: item.color }}>{item.count}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.state}</div>
          </div>
        ))}
      </div>

      {/* Broker performance */}
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 12 }}>Broker Activity</h3>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Broker</th>
              <th>Team</th>
              <th>Assigned</th>
              <th>Portfolio</th>
              <th>Calls</th>
              <th>Interested</th>
            </tr>
          </thead>
          <tbody>
            {brokers.map(b => {
              const bCalls = callsBy(b.id);
              const bInterested = bCalls.filter(c =>
                c.outcome === 'interestedSell' || c.outcome === 'interestedRent'
              ).length;
              const assigned = properties.filter(p => p.assignedTo === b.id && p.state === PropertyState.assigned).length;
              const portfolio = properties.filter(p => p.assignedTo === b.id && p.state === PropertyState.portfolio).length;
              return (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>{b.name}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.team}</td>
                  <td>{assigned}</td>
                  <td>{portfolio}</td>
                  <td>{bCalls.length}</td>
                  <td style={{ color: 'var(--success)' }}>{bInterested}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Recent imports */}
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginTop: 24, marginBottom: 12 }}>Recent Data Sets</h3>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Source</th>
              <th>Community</th>
              <th>Units</th>
              <th>Callable</th>
              <th>Updated</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {datasets.slice(0, 10).map(d => (
              <tr key={d.id}>
                <td style={{ fontWeight: 500 }}>{d.name}</td>
                <td>{d.source}</td>
                <td>{d.communityLabel}</td>
                <td>{d.totalUnits}</td>
                <td>{d.callableUnits}</td>
                <td>{d.updatedUnits}</td>
                <td>{d.cost ? `AED ${d.cost.toLocaleString()}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
