import React, { useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { ownerRefOf, groupByOwner } from '../../logic/ownerGrouping';
import { fmtDate } from '../../utils/format';
import { useMyProperties, useBrokerDashboard } from '../../data/hooks';

/**
 * A broker's owner-grouped list.
 *
 * Their own set is bounded, so it still loads whole and groups in memory with
 * the shared groupByOwner — the grouping logic is untouched. What changed is
 * where the rows come from, and that phone numbers arrive already masked.
 */

interface HomeTabProps {
  filterPortfolio?: boolean;
}

export function HomeTab({ filterPortfolio }: HomeTabProps) {
  const { user } = useAuth();
  const { rows: myProperties, loading } = useMyProperties();
  const { data: dash } = useBrokerDashboard();

  const scoped = useMemo(
    () => (filterPortfolio
      ? myProperties.filter(p => p.state === PropertyState.portfolio)
      : myProperties),
    [myProperties, filterPortfolio],
  );

  const groups = useMemo(() => groupByOwner(scoped), [scoped]);

  const dueFollowUps = useMemo(
    () => groups.filter(g => g.dueFollowUp && new Date(g.dueFollowUp) <= new Date()),
    [groups],
  );

  const portfolioCount = useMemo(
    () => myProperties.filter(p => p.state === PropertyState.portfolio).length,
    [myProperties],
  );

  if (!user) return null;

  if (filterPortfolio) {
    return (
      <div>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>
          Portfolio
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 8 }}>
            {groups.length} owners
          </span>
        </h2>
        <OwnerGroupList groups={groups} loading={loading} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Welcome, {user.name}</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {dash?.myCallsToday ?? 0} calls today
          </p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Assigned</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{myProperties.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Due follow-ups</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--warning)' }}>{dueFollowUps.length}</div>
        </div>
        <div className="card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Portfolio</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>{portfolioCount}</div>
        </div>
      </div>

      {dueFollowUps.length > 0 && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--warning)' }}>
          <h3 style={{ fontWeight: 600, marginBottom: 12, color: 'var(--warning)' }}>
            Due Follow-ups
          </h3>
          <OwnerGroupList groups={dueFollowUps} loading={false} />
        </div>
      )}

      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: 12 }}>
        Your Properties ({groups.length} owners)
      </h3>
      <OwnerGroupList groups={groups} loading={loading} />
    </div>
  );
}

function OwnerGroupList({ groups, loading }: {
  groups: ReturnType<typeof groupByOwner>;
  loading: boolean;
}) {
  const { recordView } = useVault();
  const [activeGroup, setActiveGroup] = React.useState<string | null>(null);

  /**
   * Opening an owner is an audited, cap-counted view. It used to be a local
   * function call that always "succeeded"; now it's a server round trip that can
   * refuse. Failure is swallowed here on purpose — expanding a row is not worth
   * an error dialog, and the server has already recorded the cap-block.
   */
  const open = (group: ReturnType<typeof groupByOwner>[number]) => {
    setActiveGroup(activeGroup === group.key ? null : group.key);
    void recordView(group.properties[0].id, `Viewed owner ${group.key}`).catch(() => {});
  };

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
          {loading ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>Loading…</td></tr>
          ) : groups.length === 0 ? (
            <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>Nothing assigned to you yet.</td></tr>
          ) : groups.map(g => (
            <tr key={g.key} style={{ cursor: 'pointer' }} onClick={() => open(g)}>
              <td style={{ fontWeight: 500 }}>{g.owner.name || '—'}</td>
              {/* Masked server-side. */}
              <td style={{ fontVariant: 'tabular-nums', color: 'var(--text-secondary)' }}>
                {g.owner.phone ?? '—'}
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
