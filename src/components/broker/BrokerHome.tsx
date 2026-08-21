import React, { useMemo, useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { PropertyState, Property } from '../../types/models';
import { groupByOwner } from '../../logic/ownerGrouping';
import { ownerStopForProperty, stopDeps } from './callStops';
import { CallDialog } from './CallDialog';
import { CallStop } from '../../state/callTypes';
import { fmtInt, fmtDate, greetingName } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatTile, SegmentBar, ProgressLine, Segment,
} from '../common/Dash';
import { Icon } from '../common/Icon';
import { CountdownBadge } from '../common/StateChip';
import { useNow } from '../../utils/useNow';
import { useMyProperties, useBrokerDashboard } from '../../data/hooks';

/**
 * A broker's home.
 *
 * Two data sources, split by what they need to know:
 *  - their own assigned units (bounded — loads whole, groups locally)
 *  - team comparisons and the pool snapshot (aggregates, from the server: a
 *    broker cannot see the team's calls, so they can't compute the average).
 */

const STEEL = 'var(--text-tertiary)';

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
  const portfolio = useMemo(
    () => mine.filter(p => p.state === PropertyState.portfolio).length,
    [mine],
  );

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

  if (!user) return null;

  const callsToday = dash?.myCallsToday ?? 0;
  const interestedTotal = dash?.myInterested ?? 0;
  const myCallsTotal = dash?.myCalls ?? 0;
  // The server gives lifetime calls and interested; the answer rate needs
  // "reached", which is only meaningful over the same window — today's is what
  // the broker can act on.
  const reachedToday = dash?.myReachedToday ?? 0;

  const mineIn = (s: PropertyState) => mine.filter(p => p.state === s).length;
  const pipeline: Segment[] = [
    { value: mineIn(PropertyState.assigned), color: 'var(--info)', label: 'To work' },
    { value: mineIn(PropertyState.portfolio), color: 'var(--primary)', label: 'Portfolio' },
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
  if (callsToday > 0 && reachedToday > 0 && (dash?.myInterestedToday ?? 0) / reachedToday < 0.15) {
    tips.push('Your interest rate is low — try leading with the recent transaction on their unit.');
  }
  if (tips.length === 0) tips.push('You are on top of your list. Keep the momentum going.');

  const openCall = async (p: Property) => {
    if (!p.callable) return;
    setCallStop(await ownerStopForProperty(p, deps));
  };

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      {callStop && <CallDialog stop={callStop} onClose={() => setCallStop(null)} />}
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(user.name)}`}
        subtitle={fmtDate(now.toISOString())}
        stats={[
          { value: `${callsToday}`, label: 'calls today' },
          { value: fmtInt(mine.length), label: 'on your list' },
          { value: `${expiringSoon.length}`, label: 'expiring soon' },
          { value: `${dueNext.length}`, label: 'due follow-ups' },
          { value: fmtInt(portfolio), label: 'in portfolio' },
        ]}
        actions={
          <>
            <SlabAction icon="table" label="Open database" onClick={() => onGo?.('today')} />
            <SlabAction icon="layers" label="Browse pool" onClick={() => onGo?.('pool')} />
          </>
        }
      />

      <div style={{ height: 16 }} />

      <DashColumns>
        <DashCard title="Running out of time" icon="clock" flush
          trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('today')}>Work list</button>}>
          {expiringSoon.length === 0 ? (
            <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Nothing slipping — everything on your list has time on the clock.
            </div>
          ) : (
            <>
              {expiringSoon.slice(0, 6).map(({ p }, i) => (
                <div key={p.id} onClick={() => openCall(p)} title={p.callable ? 'Call this owner now' : undefined}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', padding: '9px 16px',
                    borderTop: i > 0 ? '1px solid var(--border-light)' : undefined,
                    cursor: p.callable ? 'pointer' : 'default',
                  }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{p.owner.name || 'Unknown owner'}</div>
                    <div className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>
                      {p.unitLabel}{p.state === PropertyState.portfolio ? ' · portfolio' : ''}
                    </div>
                  </div>
                  <CountdownBadge deadline={p.assignmentExpiresAt} soonHours={vault.settings.expiringSoonHours} />
                </div>
              ))}
              {expiringSoon.length > 6 && (
                <div style={{ padding: '8px 16px', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                  +{expiringSoon.length - 6} more — call them before they return to the pool.
                </div>
              )}
            </>
          )}
        </DashCard>

        <DashCard title="Your pipeline" icon="layers" trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('today')}>Open</button>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px', marginBottom: 14 }}>
            <StatTile value={fmtInt(mine.length)} label="assigned" color="var(--primary)" />
            <StatTile value={`${groups.length}`} label="owners" />
            <StatTile value={fmtInt(callable.length)} label="callable" />
            <StatTile value={fmtInt(portfolio)} label="portfolio" color="var(--success)" />
          </div>
          <SegmentBar segments={pipeline} />
        </DashCard>

        <DashCard title="You vs the team" icon="team">
          <ProgressLine label="Your interested" fraction={interestedTotal / teamMax} trailing={`${interestedTotal}`} color="var(--success)" />
          <ProgressLine label="Team average (calls)" fraction={teamAvg / Math.max(1, myCallsTotal, teamAvg)} trailing={`${teamAvg}`} color={STEEL} />
          <ProgressLine label="Your answer rate (today)" fraction={callsToday ? reachedToday / callsToday : 0}
            trailing={callsToday ? `${Math.round(reachedToday / callsToday * 100)}%` : '—'} color="var(--info)" />
        </DashCard>

        <DashCard title="Due next" icon="clock" flush>
          {dueNext.length === 0 ? (
            <div style={{ padding: '4px 16px 12px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Nothing due right now.</div>
          ) : dueNext.slice(0, 6).map((g, i) => (
            <div key={g.key} style={{ display: 'flex', gap: 10, padding: '9px 16px', borderTop: i > 0 ? '1px solid var(--border-light)' : undefined }}>
              <Icon name="user" size={16} style={{ color: 'var(--text-secondary)', marginTop: 2 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{g.owner.name || 'Unknown'}</div>
                <div style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>{g.properties.length} unit(s) · due {fmtDate(g.dueFollowUp)}</div>
              </div>
            </div>
          ))}
        </DashCard>

        <DashCard title="Pool snapshot" icon="layers" trailing={<button className="btn btn-ghost btn-sm" onClick={() => onGo?.('pool')}>Open</button>}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 24px' }}>
            <StatTile value={fmtInt(dash?.poolAvailable ?? 0)} label="units in pool" />
            <StatTile value={`${dash?.myPendingRequests ?? 0}`} label="pending requests" />
          </div>
          <div style={{ marginTop: 10, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Request more data from the pool when your list runs low.
          </div>
        </DashCard>

        <DashCard title="Coach's corner" icon="sparkles">
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
    </div>
  );
}
