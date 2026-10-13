import React, { useMemo, useState } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { useManagerDashboard, useTeamDashboard } from '../../data/hooks';
import { PropertyState, AuditEntry } from '../../types/models';
import { Permission } from '../../types/user';
import { fmtInt, fmtDate, greetingName, timeAgo } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatRow, SegmentBar,
  MiniBarChart, ProgressLine, Segment, Funnel, FunnelStage,
} from '../common/Dash';
import { Icon, IconName } from '../common/Icon';
import { AnalyticsTable } from '../common/AnalyticsTable';
import { brokerBoardColumns } from './brokerColumns';
import { LEADS_ENABLED } from '../../config';
import { UnitsDrilldownPopup, DrillParams } from './UnitsDrilldownPopup';

/**
 * Manager mission control — one screen, funnel-led.
 *
 * The top of the screen is a prospecting funnel (Total units → Assigned → Called
 * → Reached → Interested) with a period selector for the calling stages; below it
 * a filling grid of metric cards and the broker board. Every number arrives
 * pre-computed from /api/dashboard/manager in one round trip.
 */

const STEEL = 'var(--text-tertiary)';
/** Uniform height for the middle metric cards — content scrolls if it's longer. */
const CARD_H = 270;

type Alert = { icon: IconName; color: string; message: string; goTo: string };
type Period = 'today' | 'week' | 'month';
const PERIODS: { k: Period; label: string; short: string }[] = [
  { k: 'today', label: 'Today', short: 'today' },
  { k: 'week', label: 'This week', short: '7d' },
  { k: 'month', label: 'This month', short: '30d' },
];

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
    case 'settings': return 'settings';
    case 'user': return 'users';
    case 'delete': return 'trash';
    case 'signin': return 'user';
    default: return 'layers';
  }
}

export function HomeScreen({ onGo }: { onGo?: (tab: string) => void }) {
  const vault = useVault();
  const { user: me } = useAuth();
  const { data, loading, error, updatedAt } = useManagerDashboard(14);

  // The broker board reuses the Report's broker rows (same columns to choose
  // from), scoped to today and kept live on the same 30s cadence as the rest of
  // the dashboard. The [start-of-today, start-of-tomorrow) window is stable, so
  // the fetch doesn't churn every render; polling keeps the numbers fresh.
  const todayWindow = useMemo(() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }, []);
  const { data: teamData } = useTeamDashboard(todayWindow, 30_000);
  const [period, setPeriod] = useState<Period>('today');

  // Click a number → its units. The funnel drill window matches the funnel period.
  const [drill, setDrill] = useState<{ title: string; subtitle?: string; params: DrillParams } | null>(null);
  const funnelWin = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    if (period === 'today') return { from: start.toISOString(), to: end.toISOString() };
    const days = period === 'week' ? 7 : 30;
    return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: new Date(now.getTime() + 60_000).toISOString() };
  }, [period]);

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
  const short = PERIODS.find(p => p.k === period)!.short;
  const f = data.funnel[period];
  const assigned = data.properties.byState[PropertyState.assigned] + data.properties.byState[PropertyState.portfolio];

  // The prospecting funnel: raw data → assigned → the period's calling stages.
  // Every stage but "Total units" opens the units behind it (Assigned is a current
  // snapshot; Called/Reached/Interested follow the selected period).
  const openFunnel = (metric: string, label: string, windowed: boolean) => setDrill({
    title: label, subtitle: windowed ? short : 'current status',
    params: windowed ? { metric, from: funnelWin.from, to: funnelWin.to } : { metric },
  });
  const funnelStages: FunnelStage[] = [
    { label: 'Total units', value: data.properties.total, color: 'var(--primary)' },
    { label: 'Assigned', value: assigned, color: 'var(--info)', onClick: () => openFunnel('held', 'Assigned units', false) },
    { label: `Called (${short})`, value: f.calls, color: STEEL, onClick: () => openFunnel('called', 'Owners called', true) },
    { label: 'Reached', value: f.reached, color: 'var(--info)', onClick: () => openFunnel('reached', 'Owners reached', true) },
    { label: 'Interested', value: f.interested, color: 'var(--success)', onClick: () => openFunnel('interested', 'New interested', true) },
  ];

  const stateSegments: Segment[] = [
    { value: data.properties.byState[PropertyState.pool], color: STEEL, label: 'Pool' },
    { value: assigned, color: 'var(--info)', label: 'Assigned' },
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

  // Momentum chart — zero-fill the days the server didn't return.
  const days: Date[] = [];
  for (let i = data.rolling.days - 1; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i); days.push(d);
  }
  const byDay = new Map(data.rolling.momentum.map(m => [m.day, m.n]));
  const series = days.map(d => byDay.get(d.toISOString().slice(0, 10)) ?? 0);
  const rolled = data.rolling;
  const recent = data.recentAudit.map(a => AuditEntry.fromJson(a)).slice(0, 6);

  const openBtn = (tab: string) => (
    <button className="btn btn-ghost btn-sm" onClick={() => go(tab)}>Open</button>
  );

  // Broker board columns — the SAME set as the Report broker table (shared),
  // scoped to today (days = 1). Default view keeps the board's familiar five.
  const teamBrokerName = (id: string) => (teamData?.brokers ?? []).find(b => b.id === id)?.name ?? 'Broker';
  const boardCols = brokerBoardColumns(1, (brokerId, metric, label) => setDrill({
    title: `${label} — ${teamBrokerName(brokerId)}`,
    subtitle: 'Today',
    params: { metric, brokerId, from: todayWindow.from, to: todayWindow.to },
  }));
  const boardDefault = ['areas', 'assigned', 'attempts', 'answered', 'interested', 'lastAt'];

  // Areas (community · sub-community) for the coverage card, biggest stock first.
  const areaLabel = (a: { community: string; cluster: string }) => {
    const c = a.community || '(no community)';
    return a.cluster ? `${c} · ${a.cluster}` : c;
  };
  const areas = (teamData?.areas ?? []).slice().sort((a, b) => b.callable - a.callable);

  return (
    <div style={{ maxWidth: 1700, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(me.name)}`}
        subtitle={fmtDate(now.toISOString())}
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

      {/* The prospecting funnel — the screen's centrepiece. */}
      <DashCard title="Prospecting funnel" icon="sparkles"
        trailing={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span title={updatedAt ? `Updated ${timeAgo(new Date(updatedAt).toISOString(), now)}` : 'Live — refreshes automatically'}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--success)' }} /> Live
            </span>
            <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={period} onChange={e => setPeriod(e.target.value as Period)}>
              {PERIODS.map(p => <option key={p.k} value={p.k}>{p.label}</option>)}
            </select>
          </div>
        }>
        <Funnel stages={funnelStages} />
        <StatRow tiles={[
          { value: fmtInt(f.noAnswer), label: `not reached (${short})`, color: 'var(--warning)' },
          { value: `${data.board.length}`, label: 'active brokers', icon: 'team' },
          { value: fmtInt(data.properties.byState[PropertyState.pool]), label: 'in pool' },
          { value: fmtInt(data.properties.callable), label: 'callable' },
          { value: fmtInt(data.properties.owners), label: 'owners' },
          ...(LEADS_ENABLED ? [{ value: fmtInt(data.leads.total), label: 'buyer leads', color: data.leads.total ? 'var(--info)' : undefined }] : []),
          { value: `${data.communities.length}`, label: 'communities' },
          { value: `${data.datasets.length}`, label: 'data sets' },
        ]} />
      </DashCard>

      {/* Filling grid of metric cards — all one height; content scrolls if longer. */}
      <DashColumns>
        <DashCard title="Pipeline" icon="layers" trailing={openBtn('database')} height={CARD_H}>
          <SegmentBar segments={stateSegments} />
        </DashCard>

        <DashCard title={`Momentum · last ${rolled.days}d`} icon="sparkles" trailing={openBtn('team')} height={CARD_H}>
          <MiniBarChart values={series} labels={days.map(d => 'SMTWTFS'[d.getDay()])} height={92} />
          <div style={{ height: 6 }} />
          <ProgressLine label="Answer rate" fraction={rolled.calls ? rolled.reached / rolled.calls : 0}
            trailing={rolled.calls ? `${Math.round(rolled.reached / rolled.calls * 100)}%` : '—'} color="var(--info)" />
          <ProgressLine label="Interest rate (of owners reached)" fraction={rolled.reachedUnits ? rolled.interested / rolled.reachedUnits : 0}
            trailing={rolled.reachedUnits ? `${Math.round(rolled.interested / rolled.reachedUnits * 100)}%` : '—'} color="var(--success)" />
        </DashCard>

        <DashCard title="Needs attention" icon="alert" flush height={CARD_H}>
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

        <DashCard title="Area coverage" icon="coin" trailing={openBtn('team')} height={CARD_H}>
          {areas.length === 0
            ? <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>No areas yet.</span>
            : areas.map(a => {
              // Of the area's callable stock, how much has ever been called.
              const worked = Math.max(0, a.callable - a.untouched);
              const base = a.callable === 0 ? 1 : a.callable;
              return <ProgressLine key={a.id} label={areaLabel(a)} fraction={worked / base} trailing={`${Math.round(worked / base * 100)}%`} />;
            })}
        </DashCard>

        <DashCard title="Latest activity" icon="clock" trailing={openBtn('control')} flush height={CARD_H}>
          {recent.length === 0
            ? <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Nothing logged yet.</div>
            : recent.map((a, i) => (
              <div key={a.id} style={{ display: 'flex', gap: 10, padding: '8px 16px', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}>
                <Icon name={actionIcon(a.action)} size={16} style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: '0.8rem' }}>{a.detail}</div>
                  <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                    {vault.userById(a.actorId)?.name ?? a.actorId} · {timeAgo(a.at, now)}
                  </div>
                </div>
              </div>
            ))}
        </DashCard>
      </DashColumns>

      {/* Broker board — sortable + show/hide/reorder columns (shared table). */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Icon name="team" size={17} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 600 }}>Broker board — today</span>
          <div style={{ flex: 1 }} />
          {openBtn('team')}
        </div>
        <AnalyticsTable
          rows={teamData?.brokers ?? []} prefsKey="dash.board.v3"
          pinned={{
            label: 'Broker', sortValue: b => b.name,
            render: b => {
              // "Has units but no calls today" — the board's amber dot.
              const quiet = (b.assigned + b.portfolio) > 0 && b.calls === 0;
              return (
                <>
                  {b.name}
                  {quiet && <span style={{ marginLeft: 6, color: 'var(--warning)' }} title="Has data but no calls today">●</span>}
                </>
              );
            },
          }}
          columns={boardCols} defaultVisible={boardDefault} empty="No active brokers." />
      </div>

      {drill && (
        <UnitsDrilldownPopup title={drill.title} subtitle={drill.subtitle} params={drill.params} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
