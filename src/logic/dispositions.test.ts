import { applyOutcome, sweepCooldowns, isPortfolioStale, daysBetween } from './dispositions';
import { PropertyState, CallOutcome, VaultSettings, Property, OwnerInfo, kOrgId } from '../types/models';

const NOW = '2026-07-17T10:00:00.000Z';
const daysAgo = (n: number) => {
  const d = new Date(NOW); d.setDate(d.getDate() - n); return d.toISOString();
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
  it('interested moves the record into the portfolio and stamps portfolioSince', () => {
    const p = prop();
    applyOutcome(p, CallOutcome.interestedSell, NOW);
    expect(p.state).toBe(PropertyState.portfolio);
    expect(p.portfolioSince).toBe(NOW);
    expect(p.callAttempts).toBe(0);
  });

  it('not-interested puts the record into cooling for the configured window', () => {
    const p = prop();
    const settings = new VaultSettings(30);
    applyOutcome(p, CallOutcome.notInterested, NOW, undefined, settings);
    expect(p.state).toBe(PropertyState.cooling);
    expect(daysBetween(NOW, p.cooldownUntil!)).toBe(30);
  });

  it('DNC is terminal and stamped', () => {
    const p = prop();
    applyOutcome(p, CallOutcome.dnc, NOW);
    expect(p.state).toBe(PropertyState.dnc);
    expect(p.dncAt).toBe(NOW);
  });

  it('returns an assigned record to the pool after max no-answer attempts', () => {
    const p = prop();
    const settings = new VaultSettings(30, 30, 3);
    applyOutcome(p, CallOutcome.noAnswer, NOW, undefined, settings);
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.callAttempts).toBe(1);
    applyOutcome(p, CallOutcome.noAnswer, NOW, undefined, settings);
    applyOutcome(p, CallOutcome.noAnswer, NOW, undefined, settings);
    expect(p.state).toBe(PropertyState.pool);
    expect(p.assignedAt).toBeUndefined();
    expect(p.callAttempts).toBe(0);
  });

  it('callback-later keeps the record assigned and records the follow-up', () => {
    const p = prop();
    const fu = '2026-07-24T10:00:00.000Z';
    applyOutcome(p, CallOutcome.callbackLater, NOW, fu);
    expect(p.state).toBe(PropertyState.assigned);
    expect(p.nextFollowUpAt).toBe(fu);
  });
});

describe('cooldown sweep', () => {
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

  it('auto-returns an assigned record that was never called past the expiry', () => {
    const p = prop();
    p.assignedAt = daysAgo(20);
    p.lastCalledAt = undefined;
    const changed = sweepCooldowns([p], NOW, new VaultSettings(30, 30, 3, 14));
    expect(changed).toHaveLength(1);
    expect(p.state).toBe(PropertyState.pool);
  });

  it('does not auto-return an assigned record that HAS been called', () => {
    const p = prop();
    p.assignedAt = daysAgo(20);
    p.lastCalledAt = daysAgo(2);
    expect(sweepCooldowns([p], NOW, new VaultSettings(30, 30, 3, 14))).toHaveLength(0);
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
