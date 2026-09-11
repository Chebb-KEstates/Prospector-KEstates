import React, { useMemo, useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState, Property } from '../../types/models';
import { groupByOwner } from '../../logic/ownerGrouping';
import { ownerStopForProperty, stopDeps } from './callStops';
import { CallDialog } from './CallDialog';
import { UnitsDrilldownPopup, DrillParams } from '../manager/UnitsDrilldownPopup';
import { CallStop } from '../../state/callTypes';
import { fmtInt, fmtDate, greetingName } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatTile, StatRow, SegmentBar, ProgressLine,
  Segment, Funnel, FunnelStage,
} from '../common/Dash';
import { Icon } from '../common/Icon';
import { CountdownBadge } from '../common/StateChip';
import { useNow } from '../../utils/useNow';
import { useMyProperties, useBrokerDashboard } from '../../data/hooks';

/**
 * A broker's home — funnel-led, the same shape as manager mission control.
 *
 * The top is the broker's own prospecting funnel (My list → Called → Reached →
 * Interested) with a period selector for the calling stages; a StatTile row
 * carries the rest of the day's numbers. Below it a uniform grid of metric cards.
 *
 * Two data sources, split by what a broker is allowed to know:
 *  - their own assigned units (bounded — loads whole, groups locally)
 *  - team comparisons and the pool snapshot (aggregates, from the server: a
 *    broker cannot see the team's calls, so they can't compute the average).
 */

const STEEL = 'var(--text-tertiary)';
/** Uniform height for the metric cards — content scrolls if it's longer. */
const CARD_H = 270;

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

export function BrokerHome({ onGo }: { onGo?: (tab: string) => void }) {
  const { user } = useAuth();
  const vault = useVault();
  const { rows: mine } = useMyProperties();
  const { data: dash } = useBrokerDashboard();
  const [callStop, setCallStop] = useState<CallStop | null>(null);
  const [period, setPeriod] = useState<Period>('today');
  const nowMs = useNow(60_000);

  const groups = useMemo(() => groupByOwner(mine), [mine]);
  const callable = useMemo(() => mine.filter(p => p.callable), [mine]);
  const deps = useMemo(
    () => stopDeps(vault.users, vault.logCall, vault.logLeadCall),
    [vault.users, vault.logCall, vault.logLeadCall],
  );

  const now = new Date();
  const dueNext = useMemo(
    () => groups.filter(g => g.dueFollowUp && new Date(g.dueFollowUp) <= new Date()),
    [groups],
  );
  const freshOwners = useMemo(() => groups.filter(g => g.neverCalled).length, [groups]);

  // Held units whose clock is nearly up — the "running out of time" list. Sorted
  // soonest-first so the unit about to slip is at the top. Ticks with `nowMs`.
  const expiringSoon = useMemo(() => {
    // 0 = the "expiring soon" warning is off.
    if (vault.settings.expiringSoonHours <= 0) return [];
    const soonMs = vault.settings.expiringSoonHours * 3_600_000;
    return mine
      .filter(p => (p.state === PropertyState.assigned || p.state === PropertyState.portfolio) && p.assignmentExpiresAt)
      .map(p => ({ p, ms: new Date(p.assignmentExpiresAt as string).getTime() - nowMs }))
      .filter(x => x.ms <= soonMs)
      .sort((a, b) => a.ms - b.ms);
  }, [mine, vault.settings.expiringSoonHours, nowMs]);

  // Click a funnel number → my units behind it (server pins the scope to me).
  const [drill, setDrill] = useState<{ title: string; subtitle?: string; params: DrillParams } | null>(null);
  const funnelWin = useMemo(() => {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);
    if (period === 'today') return { from: start.toISOString(), to: end.toISOString() };
    const days = period === 'week' ? 7 : 30;
    return { from: new Date(d.getTime() - days * 86_400_000).toISOString(), to: new Date(d.getTime() + 60_000).toISOString() };
  }, [period]);

  if (!user) return null;

  const short = PERIODS.find(p => p.k === period)!.short;
  const f = dash?.funnel?.[period] ?? { calls: 0, reached: 0, interested: 0, noAnswer: 0 };

  const callsToday = dash?.myCallsToday ?? 0;
  const reachedToday = dash?.myReachedToday ?? 0;
  const interestedTotal = dash?.myInterested ?? 0;
  const myCallsTotal = dash?.myCalls ?? 0;

  // The broker's own funnel: their list → the period's calling stages. Each stage
  // opens the units behind it (My list is a snapshot; the rest follow the period).
  const openFunnel = (metric: string, label: string, windowed: boolean) => setDrill({
    title: label, subtitle: windowed ? short : 'current status',
    params: windowed ? { metric, from: funnelWin.from, to: funnelWin.to } : { metric },
  });
  const funnelStages: FunnelStage[] = [
    { label: 'My list', value: mine.length, color: 'var(--primary)', onClick: () => openFunnel('held', 'My list', false) },
    { label: `Called (${short})`, value: f.calls, color: STEEL, onClick: () => openFunnel('called', 'Owners I called', true) },
    { label: 'Reached', value: f.reached, color: 'var(--info)', onClick: () => openFunnel('reached', 'Owners I reached', true) },
    { label: 'Interested', value: f.interested, color: 'var(--success)', onClick: () => openFunnel('interested', 'New interested', true) },
  ];

  const mineIn = (s: PropertyState) => mine.filter(p => p.state === s).length;
  const pipeline: Segment[] = [
    // Portfolio folds into "To work" — kept units read as assigned for now.
    { value: mineIn(PropertyState.assigned) + mineIn(PropertyState.portfolio), color: 'var(--info)', label: 'To work' },
    { value: mineIn(PropertyState.cooling), color: 'var(--warning)', label: 'Cooling' },
    { value: mineIn(PropertyState.dnc), color: 'var(--error)', label: 'DNC' },
  ];

  // Me vs team. The comparison is against the team average the server computed:
  // a broker has no business seeing their colleagues' individual numbers.
  const teamAvg = dash?.teamAverageCalls ?? 0;
  const teamMax = Math.max(1, interestedTotal, teamAvg);

  // Coach's corner — rule-based tips, unchanged.
  const tips: string[] = [];
  const callableOwners = new Set(callable.map(p => p.owner.phone)).size;
  if (callable.length > 0 && callsToday === 0) {
    tips.push(`You have ${callableOwners} callable owners and no calls yet today — open your Database and start working the list.`);
  }
  if (dueNext.length > 0) {
    tips.push(`${dueNext.length} follow-up${dueNext.length === 1 ? '' : 's'} are due now — these are your warmest contacts.`);
  }
  if (freshOwners > 0) {
    tips.push(`${freshOwners} owner${freshOwners === 1 ? '' : 's'} have never been called — fresh data converts best.`);
  }
  const reachedUnitsToday = dash?.myReachedUnitsToday ?? 0;
  if (callsToday > 0 && reachedUnitsToday > 0 && (dash?.myInterestedToday ?? 0) / reachedUnitsToday < 0.15) {
    tips.push('Your interest rate is low — try leading with the recent transaction on their unit.');
  }
  if (tips.length === 0) tips.push('You are on top of your list. Keep the momentum going.');

  const openCall = async (p: Property) => {
    if (!p.callable) return;
    setCallStop(await ownerStopForProperty(p, deps));
  };

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {callStop && <CallDialog stop={callStop} onClose={() => setCallStop(null)} />}
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(user.name)}`}
        subtitle={fmtDate(now.toISOString())}
        actions={
          <>
            <SlabAction icon="table" label="Open database" onClick={() => onGo?.('today')} />
            <SlabAction icon="layers" label="Browse pool" onClick={() => onGo?.('pool')} />
          </>
        }
      />

      {/* The broker's own prospecting funnel — the screen's centrepiece. */}
      <DashCard title="My prospecting funnel" icon="sparkles"
        trailing={
          <select className="input" style={{ width: 'auto', padding: '4px 8px' }} value={period} onChange={e => setPeriod(e.target.value as Period)}>
            {PERIODS.map(p => <option key={p.k} value={p.k}>{p.label}</option>)}
          </select>
        }>
        <Funnel stages={funnelStages} />
        <StatRow tiles={[
          { value: fmtInt(f.noAnswer), label: `not reached (${short})`, color: f.noAnswer ? 'var(--warning)' : undefined },
          { value: fmtInt(callable.length), label: 'callable' },
          { value: `${groups.length}`, label: 'owners', icon: 'user' },
          { value: `${dueNext.length}`, label: 'due follow-ups', color: dueNext.length ? 'var(--info)' : undefined },
          { value: `${expiringSoon.length}`, label: 'expiring soon', color: expiringSoon.length ? 'var(--error)' : undefined },
          { value: fmtInt(dash?.poolAvailable ?? 0), label: 'in pool' },
          { value: `${dash?.myPendingRequests ?? 0}`, label: 'pending requests' },
          { value: fmtInt(interestedTotal), label: 'interested (all-time)', color: interestedTotal ? 'var(--success)' : undefined },
        ]} />
      </DashCard>

      {/* Uniform grid of metric cards — all one height; content scrolls if longer. */}
      <DashColumns>
        <DashCard title="Running out of time" icon="clock" flush height={CARD_H}
          trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('today')}>Work list</button>}>
          {expiringSoon.length === 0 ? (
            <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Nothing slipping — everything on your list has time on the clock.
            </div>
          ) : (
            <>
              {expiringSoon.map(({ p }, i) => (
                <div key={p.id} onClick={() => openCall(p)} title={p.callable ? 'Call this owner now' : undefined}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '9px 16px',
                    borderTop: i > 0 ? '1px solid var(--border-light)' : undefined,
                    cursor: p.callable ? 'pointer' : 'default',
                  }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{p.owner.name || 'Unknown owner'}</div>
                    <div className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                      {p.unitLabel}
                    </div>
                  </div>
                  <CountdownBadge deadline={p.assignmentExpiresAt} soonHours={vault.settings.expiringSoonHours} />
                </div>
              ))}
            </>
          )}
        </DashCard>

        <DashCard title="Your pipeline" icon="layers" height={CARD_H}
          trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('today')}>Open</button>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', marginBottom: 14 }}>
            <StatTile value={fmtInt(mine.length)} label="assigned" color="var(--primary)" />
            <StatTile value={`${groups.length}`} label="owners" />
            <StatTile value={fmtInt(callable.length)} label="callable" />
          </div>
          <SegmentBar segments={pipeline} />
        </DashCard>

        <DashCard title="You vs the team" icon="team" height={CARD_H}>
          <ProgressLine label="Your interested" fraction={interestedTotal / teamMax} trailing={`${interestedTotal}`} color="var(--success)" />
          <ProgressLine label="Team average (calls)" fraction={teamAvg / Math.max(1, myCallsTotal, teamAvg)} trailing={`${teamAvg}`} color={STEEL} />
          <ProgressLine label="Your answer rate (today)" fraction={callsToday ? reachedToday / callsToday : 0}
            trailing={callsToday ? `${Math.round(reachedToday / callsToday * 100)}%` : '—'} color="var(--info)" />
        </DashCard>

        <DashCard title="Due next" icon="clock" flush height={CARD_H}
          trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('today')}>Open</button>}>
          {dueNext.length === 0 ? (
            <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Nothing due right now.</div>
          ) : dueNext.map((g, i) => (
            <div key={g.key} style={{ display: 'flex', gap: 10, padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}>
              <Icon name="user" size={16} style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{g.owner.name || 'Unknown'}</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{g.properties.length} unit(s) · due {fmtDate(g.dueFollowUp)}</div>
              </div>
            </div>
          ))}
        </DashCard>

        <DashCard title="Pool snapshot" icon="layers" height={CARD_H}
          trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('pool')}>Open</button>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' }}>
            <StatTile value={fmtInt(dash?.poolAvailable ?? 0)} label="units in pool" />
            <StatTile value={`${dash?.myPendingRequests ?? 0}`} label="pending requests" />
          </div>
          <div style={{ marginTop: 10, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Request more data from the pool when your list runs low.
          </div>
        </DashCard>

        <DashCard title="Coach's corner" icon="sparkles" height={CARD_H}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tips.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: '0.8125rem' }}>
                <Icon name="sparkles" size={15} style={{ color: 'var(--gold)', marginTop: 2, flexShrink: 0 }} />
                <span>{t}</span>
              </div>
            ))}
          </div>
        </DashCard>
      </DashColumns>

      {drill && (
        <UnitsDrilldownPopup title={drill.title} subtitle={drill.subtitle} params={drill.params} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
