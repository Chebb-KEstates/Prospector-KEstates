import React, { useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { ownerRefOf, groupByOwner } from '../../logic/ownerGrouping';
import { maskedPhone, fmtDate } from '../../utils/format';

interface HomeTabProps {
  filterPool?: boolean;
  filterPortfolio?: boolean;
}

export function HomeTab({ filterPool, filterPortfolio }: HomeTabProps) {
  const { user } = useAuth();
  const { properties, assignedTo, callsBy } = useVault();

  if (!user) return null;

  let userProps = assignedTo(user.id);

  if (filterPool) {
    userProps = properties.filter(p => p.state === PropertyState.pool);
  } else if (filterPortfolio) {
    userProps = properties.filter(p => p.assignedTo === user.id && p.state === PropertyState.portfolio);
  }

  const groups = groupByOwner(userProps);

  const todayStr = new Date().toDateString();
  const todayCalls = callsBy(user.id).filter(c => new Date(c.at).toDateString() === todayStr).length;

  const dueFollowUps = groups.filter(g => g.dueFollowUp && new Date(g.dueFollowUp) <= new Date());

  if (filterPool || filterPortfolio) {
    return (
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>
          {filterPool ? 'Pool' : 'Portfolio'}
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>
            {groups.length} owners
          </span>
        </h2>
        <OwnerGroupList groups={groups} user={user} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Welcome, {user.name}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {todayCalls} calls today
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Assigned</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{userProps.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Due follow-ups</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--warning)' }}>{dueFollowUps.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Portfolio</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            {properties.filter(p => p.assignedTo === user.id && p.state === PropertyState.portfolio).length}
          </div>
        </div>
      </div>

      {dueFollowUps.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--warning)' }}>
          <h3 style={{ fontWeight: 600, marginBottom: 12, color: 'var(--warning)' }}>
            Due Follow-ups
          </h3>
          <OwnerGroupList groups={dueFollowUps} user={user} />
        </div>
      )}

      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 12 }}>
        Your Properties ({groups.length} owners)
      </h3>
      <OwnerGroupList groups={groups} user={user} />
    </div>
  );
}

function OwnerGroupList({ groups, user }: { groups: ReturnType<typeof groupByOwner>; user: import('../../types/user').AppUser }) {
  const { recordView } = useVault();
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Owner</th>
            <th>Phone</th>
            <th>Units</th>
            <th>Area</th>
            <th>State</th>
            <th>Last Outcome</th>
            <th>Last Called</th>
            <th>Follow-up</th>
            <th>Ref</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => (
            <tr key={g.key} style={{ cursor: 'pointer' }}
              onClick={() => {
                setActiveGroup(activeGroup === g.key ? null : g.key);
                recordView(user.id, user.isManager, `Viewed owner ${g.key}`);
              }}>
              <td style={{ fontWeight: 500 }}>{g.owner.name || '—'}</td>
              <td style={{ fontVariant: 'tabular-nums', color: 'var(--text-secondary)' }}>
                {maskedPhone(g.owner.phone)}
              </td>
              <td>{g.properties.length}</td>
              <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{g.areaSummary}</td>
              <td>
                {g.properties.length === 1
                  ? <StateChip state={g.properties[0].state} />
                  : <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Mixed</span>
                }
              </td>
              <td>{g.lastOutcome ? <OutcomeChip outcome={g.lastOutcome} /> : '—'}</td>
              <td style={{ fontSize: '0.75rem' }}>{fmtDate(g.lastCalledAt)}</td>
              <td style={{ fontSize: '0.75rem' }}>{fmtDate(g.dueFollowUp)}</td>
              <td style={{ fontVariant: 'tabular-nums', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                {ownerRefOf(g.properties[0])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
