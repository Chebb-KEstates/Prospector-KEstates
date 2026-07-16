import React from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { PropertyState, CallOutcome, CallOutcomeLabel, isInterested } from '../../types/models';
import { Permission } from '../../types/user';
import { ownerKeyOf } from '../../logic/ownerGrouping';
import { fmtInt, fmtDate, greetingName, timeAgo, sameDay } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatTile, SegmentBar,
  MiniBarChart, ProgressLine, Segment,
} from '../common/Dash';
import { Icon, IconName } from '../common/Icon';

const STEEL = 'var(--text-tertiary)';

/** Section jump — the shell maps these keys onto its active tab. */
type Alert = { icon: IconName; color: string; message: string; goTo: string };

function connected(o: CallOutcome) {
  return o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
}

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
    default: return 'layers';
  }
}

export function HomeScreen({ onGo }: { onGo?: (tab: string) => void }) {
  const vault = useVault();
  const { user: me } = useAuth();
  if (vault.loading || !me) return null;

  const now = new Date();
  const brokers = vault.brokers.filter(b => b.active);
  const go = (t: string) => onGo?.(t);

  // ── Today's pulse ──
  const callsToday = vault.calls.filter(c => sameDay(new Date(c.at), now));
  const reachedToday = callsToday.filter(c => connected(c.outcome)).length;
  const interestedToday = callsToday.filter(c => isInterested(c.outcome)).length;

  // ── 14-day momentum ──
  const days: Date[] = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(d); }
  const series = days.map(d => vault.calls.filter(c => sameDay(new Date(c.at), d)).length);
  const calls14 = vault.calls.filter(c => (now.getTime() - new Date(c.at).getTime()) / 86400000 < 14);
  const reached14 = calls14.filter(c => connected(c.outcome)).length;
  const interested14 = calls14.filter(c => isInterested(c.outcome)).length;

  // ── Vault composition ──
  const owners = new Set(vault.properties.map(ownerKeyOf)).size;
  const stateSegments: Segment[] = [
    { value: vault.countIn(PropertyState.pool), color: STEEL, label: 'Pool' },
    { value: vault.countIn(PropertyState.assigned), color: 'var(--info)', label: 'Assigned' },
    { value: vault.countIn(PropertyState.portfolio), color: 'var(--primary)', label: 'Portfolio' },
    { value: vault.countIn(PropertyState.cooling), color: 'var(--warning)', label: 'Cooling' },
    { value: vault.countIn(PropertyState.dnc), color: 'var(--error)', label: 'DNC' },
  ];

  // ── Alerts ──
  const idle = brokers
    .filter(b => vault.assignedTo(b.id).length > 0 && !callsToday.some(c => c.brokerId === b.id))
    .map(b => b.name);
  const staleDays = vault.settings.portfolioStaleDays;
  const staleCount = vault.properties.filter(p => {
    if (p.state !== PropertyState.portfolio) return false;
    const ref = p.lastCalledAt ?? p.portfolioSince;
    if (!ref) return false;
    return (now.getTime() - new Date(ref).getTime()) / 86400000 >= staleDays;
  }).length;
  const agingAssignments = vault.properties.filter(p => {
    if (p.state !== PropertyState.assigned || p.lastCalledAt || !p.assignedAt) return false;
    const ageDays = (now.getTime() - new Date(p.assignedAt).getTime()) / 86400000;
    return ageDays >= vault.settings.assignmentExpiryDays - 3;
  }).length;
  const pending = vault.pendingRequests.length;

  const alerts: Alert[] = [];
  if (pending > 0) alerts.push({ icon: 'user', color: 'var(--info)', message: `${pending} request${pending === 1 ? '' : 's'} awaiting approval`, goTo: 'assignments' });
  if (idle.length > 0) alerts.push({ icon: 'alert', color: 'var(--warning)', message: `${idle.length} broker${idle.length === 1 ? '' : 's'} with data but no calls today — ${idle.slice(0, 3).join(', ')}${idle.length > 3 ? '…' : ''}`, goTo: 'team' });
  if (staleCount > 0) alerts.push({ icon: 'clock', color: 'var(--warning)', message: `${staleCount} interested owner${staleCount === 1 ? '' : 's'} going stale in portfolios`, goTo: 'team' });
  if (agingAssignments > 0) alerts.push({ icon: 'clock', color: STEEL, message: `${agingAssignments} assigned unit${agingAssignments === 1 ? '' : 's'} never called, nearing auto-return`, goTo: 'assignments' });

  // ── Today's outcomes ──
  const outcomeColor = (o: CallOutcome): string => {
    if (o === CallOutcome.interestedSell || o === CallOutcome.interestedRent) return 'var(--success)';
    if (o === CallOutcome.callbackLater) return 'var(--info)';
    if (o === CallOutcome.noAnswer) return STEEL;
    if (o === CallOutcome.notInterested || o === CallOutcome.alreadyListed) return 'var(--warning)';
    return 'var(--error)';
  };
  const outcomeSegments: Segment[] = (Object.values(CallOutcome) as CallOutcome[])
    .map(o => ({ o, n: callsToday.filter(c => c.outcome === o).length }))
    .filter(x => x.n > 0)
    .map(x => ({ value: x.n, color: outcomeColor(x.o), label: CallOutcomeLabel[x.o] }));

  // ── Latest activity ──
  const recent = [...vault.audit].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);

  const openBtn = (tab: string) => (
    <button className="btn btn-ghost btn-sm" onClick={() => go(tab)}>Open</button>
  );

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto' }}>
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(me.name)}`}
        subtitle={fmtDate(now.toISOString())}
        stats={[
          { value: `${callsToday.length}`, label: 'calls today' },
          { value: `${reachedToday}`, label: 'reached' },
          { value: `${interestedToday}`, label: 'interested' },
          { value: `${brokers.length}`, label: 'active brokers' },
          { value: fmtInt(vault.countIn(PropertyState.pool)), label: 'units in pool' },
        ]}
        actions={
          <>
            {me.can(Permission.manageData) && <SlabAction icon="upload" label="Import data" onClick={() => go('control')} />}
            {me.can(Permission.assignData) && <SlabAction icon="assign" label="Assign data" onClick={() => go('assignments')} />}
            {me.can(Permission.assignData) && <SlabAction icon="user" label="Requests" badge={pending} primary={pending > 0} onClick={() => go('assignments')} />}
            {me.can(Permission.manageUsers) && <SlabAction icon="users" label="Register user" onClick={() => go('control')} />}
            <SlabAction icon="vault" label="Open vault" onClick={() => go('vault')} />
          </>
        }
      />

      <div style={{ height: 16 }} />

      <DashColumns>
        {/* What's ON the system */}
        <DashCard title="The vault" icon="vault" trailing={openBtn('vault')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', marginBottom: 14 }}>
            <StatTile value={fmtInt(vault.properties.length)} label="units" color="var(--primary)" />
            <StatTile value={fmtInt(vault.callable)} label="callable" />
            <StatTile value={fmtInt(owners)} label="owners" />
            <StatTile value={fmtInt(vault.leads.length)} label="buyer leads" color={vault.leads.length ? 'var(--info)' : undefined} />
            <StatTile value={`${vault.communities.length}`} label="communities" />
            <StatTile value={`${vault.datasets.length}`} label="data sets" />
          </div>
          <SegmentBar segments={stateSegments} />
        </DashCard>

        {/* Momentum */}
        <DashCard title="Team momentum — last 14 days" icon="sparkles" trailing={openBtn('team')}>
          <MiniBarChart values={series} labels={days.map(d => 'SMTWTFS'[d.getDay()])} />
          <div style={{ height: 8 }} />
          <ProgressLine label="Answer rate" fraction={calls14.length ? reached14 / calls14.length : 0}
            trailing={calls14.length ? `${Math.round(reached14 / calls14.length * 100)}%` : '—'} color="var(--info)" />
          <ProgressLine label="Interest rate (of reached)" fraction={reached14 ? interested14 / reached14 : 0}
            trailing={reached14 ? `${Math.round(interested14 / reached14 * 100)}%` : '—'} color="var(--success)" />
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
          {vault.datasets.length === 0
            ? <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No data sets uploaded yet.</span>
            : vault.datasets.slice(0, 6).map(d => {
              const props = vault.properties.filter(p => p.datasetId === d.id);
              const worked = props.filter(p => p.lastCalledAt).length;
              const base = d.callableUnits === 0 ? 1 : d.callableUnits;
              return <ProgressLine key={d.id} label={d.name} fraction={worked / base} trailing={`${Math.round(worked / base * 100)}%`} />;
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
              {brokers.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No active brokers.</td></tr>
              ) : brokers.map(b => {
                const mine = callsToday.filter(c => c.brokerId === b.id);
                const reached = mine.filter(c => connected(c.outcome)).length;
                const interested = mine.filter(c => isInterested(c.outcome)).length;
                const onList = vault.assignedTo(b.id).length;
                const all = vault.callsBy(b.id);
                const lastCall = all.length ? all.map(c => c.at).reduce((a, x) => (a > x ? a : x)) : null;
                const quiet = onList > 0 && mine.length === 0;
                return (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>
                      {b.name}
                      {quiet && <span style={{ marginLeft: 6, color: 'var(--warning)' }}>●</span>}
                    </td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(onList)}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{mine.length}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{reached}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right', color: interested > 0 ? 'var(--primary)' : undefined, fontWeight: interested > 0 ? 700 : undefined }}>{interested}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{lastCall ? timeAgo(lastCall, now) : 'never'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  );
}
