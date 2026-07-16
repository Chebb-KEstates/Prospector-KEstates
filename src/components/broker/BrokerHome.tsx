import React from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { useCallSession } from '../../state/CallSessionContext';
import { PropertyState, CallOutcome, isInterested } from '../../types/models';
import { groupByOwner } from '../../logic/ownerGrouping';
import { ownerCallStops } from './callStops';
import { fmtInt, fmtDate, greetingName, sameDay } from '../../utils/format';
import {
  HeroSlab, SlabAction, DashColumns, DashCard, StatTile, SegmentBar, ProgressLine, Segment,
} from '../common/Dash';
import { Icon } from '../common/Icon';

const STEEL = 'var(--text-tertiary)';

function connected(o: CallOutcome) {
  return o !== CallOutcome.noAnswer && o !== CallOutcome.unreachable;
}
function partOfDay(now: Date) {
  const h = now.getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

export function BrokerHome({ onGo }: { onGo?: (tab: string) => void }) {
  const { user } = useAuth();
  const vault = useVault();
  const { start } = useCallSession();
  if (!user) return null;

  const now = new Date();
  const mine = vault.assignedTo(user.id);
  const groups = groupByOwner(mine);
  const myCalls = vault.callsBy(user.id);
  const callsToday = myCalls.filter(c => sameDay(new Date(c.at), now));
  const interestedTotal = myCalls.filter(c => isInterested(c.outcome)).length;
  const reachedTotal = myCalls.filter(c => connected(c.outcome)).length;
  const portfolio = mine.filter(p => p.state === PropertyState.portfolio).length;
  const dueNext = groups.filter(g => g.dueFollowUp && new Date(g.dueFollowUp) <= now);
  const callable = mine.filter(p => p.callable);
  const freshOwners = groups.filter(g => g.neverCalled).length;

  // Pipeline of my assigned records
  const mineIn = (s: PropertyState) => mine.filter(p => p.state === s).length;
  const pipeline: Segment[] = [
    { value: mineIn(PropertyState.assigned), color: 'var(--info)', label: 'To work' },
    { value: mineIn(PropertyState.portfolio), color: 'var(--primary)', label: 'Portfolio' },
    { value: mineIn(PropertyState.cooling), color: 'var(--warning)', label: 'Cooling' },
    { value: mineIn(PropertyState.dnc), color: 'var(--error)', label: 'DNC' },
  ];

  // Me vs team (interested per broker)
  const brokers = vault.brokers.filter(b => b.active);
  const teamInterested = brokers.map(b => vault.callsBy(b.id).filter(c => isInterested(c.outcome)).length);
  const teamAvg = teamInterested.length ? teamInterested.reduce((s, x) => s + x, 0) / teamInterested.length : 0;
  const teamMax = Math.max(1, ...teamInterested);

  // Coach's corner — rule-based tips
  const tips: string[] = [];
  if (callable.length > 0 && callsToday.length === 0) tips.push(`You have ${new Set(callable.map(p => p.owner.phone)).size} callable owners and no calls yet today — start a session.`);
  if (dueNext.length > 0) tips.push(`${dueNext.length} follow-up${dueNext.length === 1 ? '' : 's'} are due now — these are your warmest contacts.`);
  if (freshOwners > 0) tips.push(`${freshOwners} owner${freshOwners === 1 ? '' : 's'} have never been called — fresh data converts best.`);
  if (reachedTotal > 0 && interestedTotal / reachedTotal < 0.15) tips.push('Your interest rate is low — try leading with the recent transaction on their unit.');
  if (tips.length === 0) tips.push('You are on top of your list. Keep the momentum going.');

  const startCalling = () => start(ownerCallStops(vault, user.id), 'Calling owners');

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <HeroSlab
        title={`Good ${partOfDay(now)}, ${greetingName(user.name)}`}
        subtitle={fmtDate(now.toISOString())}
        stats={[
          { value: `${callsToday.length}`, label: 'calls today' },
          { value: fmtInt(mine.length), label: 'on your list' },
          { value: `${dueNext.length}`, label: 'due follow-ups' },
          { value: fmtInt(portfolio), label: 'in portfolio' },
        ]}
        actions={
          <>
            <SlabAction icon="layers" label="Browse pool" onClick={() => onGo?.('pool')} />
            <SlabAction icon="star" label="My portfolio" onClick={() => onGo?.('portfolio')} />
          </>
        }
        side={
          <button className="slab-action primary" onClick={startCalling} disabled={callable.length === 0}
            style={{ padding: '14px 22px', fontSize: '0.95rem' }}>
            <Icon name="phoneCall" size={18} /> Start calling ({new Set(callable.map(p => p.owner.phone)).size})
          </button>
        }
      />

      <div style={{ height: 16 }} />

      <DashColumns>
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
          <ProgressLine label="Team average" fraction={teamAvg / teamMax} trailing={teamAvg.toFixed(1)} color={STEEL} />
          <ProgressLine label="Your answer rate" fraction={myCalls.length ? reachedTotal / myCalls.length : 0}
            trailing={myCalls.length ? `${Math.round(reachedTotal / myCalls.length * 100)}%` : '—'} color="var(--info)" />
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
            <StatTile value={fmtInt(vault.countIn(PropertyState.pool))} label="units in pool" />
            <StatTile value={`${vault.communities.length}`} label="communities" />
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
