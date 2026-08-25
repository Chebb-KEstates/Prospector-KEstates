import React from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { useManagerDashboard } from '../../data/hooks';
import { PropertyState, CallOutcome, CallOutcomeLabel, AuditEntry } from '../../types/models';
import { Permission } from '../../types/user';
import { fmtInt, fmtDate, greetingName, timeAgo } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatTile, SegmentBar,
  MiniBarChart, ProgressLine, Segment,
} from '../common/Dash';
import { Icon, IconName } from '../common/Icon';

/**
 * Manager mission control.
 *
 * Every number here used to be folded out of the in-memory vault on each render
 * — distinct owners, state counts, the 14-day series, per-broker totals, stale
 * portfolios. They now arrive pre-computed from /api/dashboard/manager in one
 * round trip, summed in SQL where the data lives.
 *
 * The screen is unchanged. What changed is that it no longer needs the whole
 * vault in the browser to draw itself.
 */

const STEEL = 'var(--text-tertiary)';

type Alert = { icon: IconName; color: string; message: string; goTo: string };

function partOfDay(now: Date) {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function actionIcon(action: string): IconName {
  switch (action) {
    case 'import': return 'upload';
    case 'assign': return 'assign';
    case 'reclaim': return 'refresh';
    case 'request': return 'user';
    case 'approve': return 'check';
    case 'deny': return 'x';
    case 'call': return 'phone';
    case 'view': return 'eye';
    case 'cap-block': return 'ban';
    case 'settings': return 'settings';
    case 'user': return 'users';
    case 'dnc-undo': return 'refresh';
    case 'delete': return 'trash';
    case 'signin': return 'user';
    case 'password': return 'settings';
    default: return 'layers';
  }
}

function outcomeColor(o: CallOutcome): string {
  if (o === CallOutcome.interestedSell || o === CallOutcome.interestedRent) return 'var(--success)';
  if (o === CallOutcome.callbackLater) return 'var(--info)';
  if (o === CallOutcome.noAnswer) return STEEL;
  if (o === CallOutcome.notInterested || o === CallOutcome.alreadyListed) return 'var(--warning)';
  return 'var(--error)';
}

export function HomeScreen({ onGo }: { onGo?: (tab: string) => void }) {
  const vault = useVault();
  const { user: me } = useAuth();
  const { data, loading, error } = useManagerDashboard(14);

  if (!me) return null;
  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Loading…</div>;
  }
  if (error && !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--error)' }}>{error}</div>;
  }
  if (!data) return null;

  const now = new Date();
  const go = (t: string) => onGo?.(t);

  const stateSegments: Segment[] = [
    { value: data.properties.byState[PropertyState.pool], color: STEEL, label: 'Pool' },
    // Portfolio folds into Assigned — kept units read as assigned for now.
    { value: data.properties.byState[PropertyState.assigned] + data.properties.byState[PropertyState.portfolio], color: 'var(--info)', label: 'Assigned' },
    { value: data.properties.byState[PropertyState.cooling], color: 'var(--warning)', label: 'Cooling' },
    { value: data.properties.byState[PropertyState.dnc], color: 'var(--error)', label: 'DNC' },
  ];

  // ── Alerts ──
  const { pendingRequests: pending, idleBrokers, staleCount, expiringSoon } = data.alerts;
  const alerts: Alert[] = [];
  if (pending > 0) {
    alerts.push({ icon: 'user', color: 'var(--info)', message: `${pending} request${pending === 1 ? '' : 's'} awaiting approval`, goTo: 'database' });
  }
  if (idleBrokers.length > 0) {
    alerts.push({
      icon: 'alert', color: 'var(--warning)',
      message: `${idleBrokers.length} broker${idleBrokers.length === 1 ? '' : 's'} with data but no calls today — ${idleBrokers.slice(0, 3).join(', ')}${idleBrokers.length > 3 ? '…' : ''}`,
      goTo: 'team',
    });
  }
  if (staleCount > 0) {
    alerts.push({ icon: 'clock', color: 'var(--warning)', message: `${staleCount} interested owner${staleCount === 1 ? '' : 's'} going stale — not called recently`, goTo: 'team' });
  }
  if (expiringSoon > 0) {
    alerts.push({
      icon: 'clock', color: 'var(--error)',
      message: `${expiringSoon} held unit${expiringSoon === 1 ? '' : 's'} running out of time — returning to the pool soon`,
      goTo: 'database',
    });
  }

  const outcomeSegments: Segment[] = (Object.values(CallOutcome) as CallOutcome[])
    .map(o => ({ o, n: data.today.outcomes[o] ?? 0 }))
    .filter(x => x.n > 0)
    .map(x => ({ value: x.n, color: outcomeColor(x.o), label: CallOutcomeLabel[x.o] }));

  // The momentum chart wants one bar per day, including the days with no calls —
  // the server only returns days that have some, so zero-fill the gaps.
  const days: Date[] = [];
  for (let i = data.rolling.days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  const byDay = new Map(data.rolling.momentum.map(m => [m.day, m.n]));
  const series = days.map(d => byDay.get(d.toISOString().slice(0, 10)) ?? 0);

  const rolled = data.rolling;
  const recent = data.recentAudit.map(a => AuditEntry.fromJson(a));

  const openBtn = (tab: string) => (
    <button className="btn btn-ghost btn-sm" onClick={() => go(tab)}>Open</button>
  );

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(me.name)}`}
        subtitle={fmtDate(now.toISOString())}
        stats={[
          { value: `${data.today.calls}`, label: 'calls today' },
          { value: `${data.today.reached}`, label: 'reached' },
          { value: `${data.today.interested}`, label: 'interested' },
          { value: `${data.board.length}`, label: 'active brokers' },
          { value: fmtInt(data.properties.byState[PropertyState.pool]), label: 'units in pool' },
        ]}
        actions={
          <>
            {me.can(Permission.manageData) && <SlabAction icon="upload" label="Import data" onClick={() => go('control')} />}
            {me.can(Permission.assignData) && <SlabAction icon="assign" label="Assign data" onClick={() => go('database')} />}
            {me.can(Permission.assignData) && <SlabAction icon="user" label="Requests" badge={pending} primary={pending > 0} onClick={() => go('database')} />}
            {me.can(Permission.manageUsers) && <SlabAction icon="users" label="Register user" onClick={() => go('control')} />}
            <SlabAction icon="vault" label="Open database" onClick={() => go('database')} />
          </>
        }
      />

      <div style={{ height: 16 }} />

      <DashColumns>
        {/* What's ON the system */}
        <DashCard title="The database" icon="vault" trailing={openBtn('database')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', marginBottom: 14 }}>
            <StatTile value={fmtInt(data.properties.total)} label="units" color="var(--primary)" />
            <StatTile value={fmtInt(data.properties.callable)} label="callable" />
            <StatTile value={fmtInt(data.properties.owners)} label="owners" />
            <StatTile value={fmtInt(data.leads.total)} label="buyer leads" color={data.leads.total ? 'var(--info)' : undefined} />
            <StatTile value={`${data.communities.length}`} label="communities" />
            <StatTile value={`${data.datasets.length}`} label="data sets" />
          </div>
          <SegmentBar segments={stateSegments} />
        </DashCard>

        {/* Momentum */}
        <DashCard title={`Team momentum — last ${rolled.days} days`} icon="sparkles" trailing={openBtn('team')}>
          <MiniBarChart values={series} labels={days.map(d => 'SMTWTFS'[d.getDay()])} />
          <div style={{ height: 8 }} />
          <ProgressLine label="Answer rate" fraction={rolled.calls ? rolled.reached / rolled.calls : 0}
            trailing={rolled.calls ? `${Math.round(rolled.reached / rolled.calls * 100)}%` : '—'} color="var(--info)" />
          <ProgressLine label="Interest rate (of reached)" fraction={rolled.reached ? rolled.interested / rolled.reached : 0}
            trailing={rolled.reached ? `${Math.round(rolled.interested / rolled.reached * 100)}%` : '—'} color="var(--success)" />
        </DashCard>

        {/* Needs attention */}
        <DashCard title="Needs attention" icon="alert" flush>
          {alerts.length === 0 ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 16px 12px' }}>
              <Icon name="check" style={{ color: 'var(--success)' }} />
              <span style={{ fontSize: '0.875rem' }}>All clear — nothing needs you right now.</span>
            </div>
          ) : alerts.map((a, i) => (
            <div key={i} onClick={() => go(a.goTo)} style={{
              display: 'flex', gap: 10, alignItems: 'center', padding: '10px 16px',
              borderTop: i > 0 ? '1px solid var(--border-light)' : undefined, cursor: 'pointer',
            }}>
              <Icon name={a.icon} style={{ color: a.color }} />
              <span style={{ flex: 1, fontSize: '0.875rem' }}>{a.message}</span>
              <Icon name="chevronRight" size={16} style={{ color: 'var(--text-tertiary)' }} />
            </div>
          ))}
        </DashCard>

        {/* Today's outcome mix */}
        <DashCard title="Today's outcomes" icon="layers">
          {outcomeSegments.length === 0
            ? <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No calls logged yet today.</span>
            : <SegmentBar segments={outcomeSegments} />}
        </DashCard>

        {/* Data coverage */}
        <DashCard title="Data coverage — worked vs callable" icon="coin" trailing={openBtn('team')}>
          {data.datasets.length === 0
            ? <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No data sets uploaded yet.</span>
            : data.datasets.slice(0, 6).map(d => {
              const base = d.callableUnits === 0 ? 1 : d.callableUnits;
              return <ProgressLine key={d.id} label={d.name} fraction={d.worked / base} trailing={`${Math.round(d.worked / base * 100)}%`} />;
            })}
        </DashCard>

        {/* Latest activity */}
        <DashCard title="Latest activity" icon="clock" trailing={openBtn('control')} flush>
          {recent.length === 0
            ? <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Nothing logged yet.</div>
            : recent.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}>
                <Icon name={actionIcon(a.action)} size={17} style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: '0.8125rem' }}>{a.detail}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                    {vault.userById(a.actorId)?.name ?? a.actorId} · {timeAgo(a.at, now)}
                  </div>
                </div>
              </div>
            ))}
        </DashCard>
      </DashColumns>

      <div style={{ height: 16 }} />

      {/* Broker board */}
      <DashCard title="Broker board — today" icon="team" trailing={openBtn('team')} flush>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Broker</th>
                <th style={{ textAlign: 'right' }}>On list</th>
                <th style={{ textAlign: 'right' }}>Calls</th>
                <th style={{ textAlign: 'right' }}>Reached</th>
                <th style={{ textAlign: 'right' }}>Interested</th>
                <th>Last call</th>
              </tr>
            </thead>
            <tbody>
              {data.board.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No active brokers.</td></tr>
              ) : data.board.map(b => (
                <tr key={b.id}>
                  <td style={{ fontWeight: 500 }}>
                    {b.name}
                    {b.quiet && <span style={{ marginLeft: 6, color: 'var(--warning)' }}>●</span>}
                  </td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(b.onList)}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.callsToday}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{b.reachedToday}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right', color: b.interestedToday > 0 ? 'var(--primary)' : undefined, fontWeight: b.interestedToday > 0 ? 700 : undefined }}>{b.interestedToday}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{b.lastAt ? timeAgo(b.lastAt, now) : 'never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  );
}
