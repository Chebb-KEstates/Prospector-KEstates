import {
  applyOutcome, sweepCooldowns, isPortfolioStale, daysBetween,
  addHours, assignmentDeadlineOnAssign,
} from './dispositions';
import { PropertyState, CallOutcome, VaultSettings, Property, OwnerInfo, kOrgId } from '../types/models';

const NOW = '2026-07-17T10:00:00.000Z';
const daysAgo = (n: number) => {
  const d = new Date(NOW); d.setDate(d.getDate() - n); return d.toISOString();
};
/** Mirrors the implementation's addDays, so expectations match exactly. */
const daysFromNow = (n: number) => {
  const d = new Date(NOW); d.setDate(d.getDate() + n); return d.toISOString();
};

function prop(state = PropertyState.assigned): Property {
  const p = new Property(
    'p1', kOrgId, 'ds', state, 'uk1', 'Dubai Hills', undefined, 'T1', '101',
    undefined, 'Apartment', 2, 1200, undefined, undefined, undefined, 0,
    undefined, undefined, undefined, new OwnerInfo('Test Owner', '+971501234567', 'UAE'), NOW,
  );
  p.state = state;
  p.assignedTo = 'u-sara';
  p.assignedAt = NOW;
  return p;
}

describe('disposition state machine', () => {
  it('interested moves the record into the portfolio and starts the renewal window', () => {
    const p = prop();
    applyOutcome(p, CallOutcome.interestedSell, NOW);
    expect(p.state).toBe(PropertyState.portfolio);
    expect(p.portfolioSince).toBe(NOW);
    expect(p.callAttempts).toBe(0);
    // 7-day portfolio window, renewable by working the unit.
    expect(p.assignmentExpiresAt).toBe(daysFromNow(7));
  });

  it('not-interested puts the record into cooling and drops the assignment timer', () => {
    const p = prop();
    const settings = new VaultSettings(30);
    applyOutcome(p, CallOutcome.notInterested, NOW, undefined, settings);
    expect(p.state).toBe(PropertyState.cooling);
    expect(daysBetween(NOW, p.cooldownUntil!)).toBe(30);
    expect(p.assignmentExpiresAt).toBeUndefined();
  });

  it('DNC is terminal, stamped, and carries no timer', () => {
    const p = prop();
    applyOutcome(p, CallOutcome.dnc, NOW);
    expect(p.state).toBe(PropertyState.dnc);
    expect(p.dncAt).toBe(NOW);
    expect(p.assignmentExpiresAt).toBeUndefined();
  });

  it('a no-answer RESETS the timer to a rolling window instead of recycling the unit', () => {
    const p = prop();
    applyOutcome(p, CallOutcome.noAnswer, NOW);
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.callAttempts).toBe(1);
    expect(p.assignmentExpiresAt).toBe(addHours(NOW, 24));
  });

  it('keeps the unit assigned however many times the owner does not answer', () => {
    const p = prop();
    for (let i = 0; i < 5; i++) applyOutcome(p, CallOutcome.noAnswer, NOW);
    // The old rule recycled after `maxNoAnswerAttempts`; now only the deadline
    // decides, so trying repeatedly keeps the unit alive.
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.callAttempts).toBe(5);
    expect(p.assignmentExpiresAt).toBe(addHours(NOW, 24));
  });

  it('never lets no-answer extensions push past the hard hold cap', () => {
    const p = prop();
    p.assignedAt = daysAgo(20); // already beyond the 14-day cap
    applyOutcome(p, CallOutcome.noAnswer, NOW);
    // Clamped to assignedAt + 14 days, which is in the past — so the next sweep
    // takes it back rather than granting another 24 hours.
    expect(new Date(p.assignmentExpiresAt!).getTime())
      .toBeLessThan(new Date(NOW).getTime());
    expect(sweepCooldowns([p], NOW)).toHaveLength(1);
    expect(p.state).toBe(PropertyState.pool);
  });

  it('callback-later keeps the record assigned and records the follow-up', () => {
    const p = prop();
    const fu = '2026-07-24T10:00:00.000Z';
    applyOutcome(p, CallOutcome.callbackLater, NOW, fu);
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.nextFollowUpAt).toBe(fu);
    expect(p.assignmentExpiresAt).toBeDefined();
  });

  it('renews the portfolio window when a portfolio unit is worked again', () => {
    const p = prop(PropertyState.portfolio);
    p.assignmentExpiresAt = addHours(NOW, 2); // nearly up
    applyOutcome(p, CallOutcome.noAnswer, NOW);
    expect(p.state).toBe(PropertyState.portfolio);
    expect(p.assignmentExpiresAt).toBe(daysFromNow(7));
  });
});

describe('assignment deadline', () => {
  it('gives a freshly assigned unit the contact SLA', () => {
    expect(assignmentDeadlineOnAssign(NOW)).toBe(addHours(NOW, 48));
  });

  it('honours a custom SLA from settings', () => {
    const s = new VaultSettings();
    s.assignmentSlaHours = 12;
    expect(assignmentDeadlineOnAssign(NOW, s)).toBe(addHours(NOW, 12));
  });
});

describe('cooldown / expiry sweep', () => {
  it('releases a cooled record back to the pool once its window lapses', () => {
    const p = prop(PropertyState.cooling);
    p.cooldownUntil = daysAgo(1);
    const changed = sweepCooldowns([p], NOW);
    expect(changed).toHaveLength(1);
    expect(p.state).toBe(PropertyState.pool);
    expect(p.cooldownUntil).toBeUndefined();
  });

  it('leaves a record whose cooldown has not lapsed alone', () => {
    const p = prop(PropertyState.cooling);
    p.cooldownUntil = daysAgo(-5); // 5 days in the future
    expect(sweepCooldowns([p], NOW)).toHaveLength(0);
    expect(p.state).toBe(PropertyState.cooling);
  });

  it('recycles an assigned unit whose timer ran out and FULLY releases it', () => {
    const p = prop();
    p.assignmentExpiresAt = addHours(NOW, -1);
    const changed = sweepCooldowns([p], NOW);
    expect(changed).toHaveLength(1);
    expect(p.state).toBe(PropertyState.pool);
    // The broker must lose access — a pooled unit with an assignee would still
    // look owned in the "Assigned to" column.
    expect(p.assignedTo).toBeUndefined();
    expect(p.assignedAt).toBeUndefined();
    expect(p.assignmentExpiresAt).toBeUndefined();
    expect(p.callAttempts).toBe(0);
  });

  it('recycles a portfolio unit that was never renewed', () => {
    const p = prop(PropertyState.portfolio);
    p.portfolioSince = daysAgo(30);
    p.assignmentExpiresAt = daysAgo(1);
    expect(sweepCooldowns([p], NOW)).toHaveLength(1);
    expect(p.state).toBe(PropertyState.pool);
    expect(p.portfolioSince).toBeUndefined();
  });

  it('leaves a held unit with time still on the clock alone', () => {
    const p = prop();
    p.assignmentExpiresAt = addHours(NOW, 5);
    expect(sweepCooldowns([p], NOW)).toHaveLength(0);
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.assignedTo).toBe('u-sara');
  });

  it('ignores a held unit that has no deadline at all', () => {
    const p = prop();
    p.assignmentExpiresAt = undefined;
    expect(sweepCooldowns([p], NOW)).toHaveLength(0);
    expect(p.state).toBe(PropertyState.assigned);
  });
});

describe('portfolio staleness', () => {
  it('flags a portfolio record untouched beyond the stale window', () => {
    const p = prop(PropertyState.portfolio);
    p.lastCalledAt = daysAgo(30);
    expect(isPortfolioStale(p, NOW, new VaultSettings(30, 30, 3, 14, 21))).toBe(true);
  });

  it('does not flag a freshly-worked portfolio record', () => {
    const p = prop(PropertyState.portfolio);
    p.lastCalledAt = daysAgo(2);
    expect(isPortfolioStale(p, NOW, new VaultSettings(30, 30, 3, 14, 21))).toBe(false);
  });
});
