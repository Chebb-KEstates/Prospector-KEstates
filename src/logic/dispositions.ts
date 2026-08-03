import { PropertyState, CallOutcome, VaultSettings } from '../types/models';
import type { ProspectFields } from '../types/models';

/**
 * The disposition state machine — shared by the client and the backend
 * `callService`, so a call logged anywhere moves a record the same way.
 *
 * Assignment timer (the countdown shown in the tables):
 *  - assigning a unit gives it `assignmentSlaHours` to make contact;
 *  - a no-answer / unreachable RESETS the deadline to `noAnswerExtensionHours`
 *    from the attempt (rewarding active calling), but never past a hard cap of
 *    `noAnswerMaxHoldDays` from the original assignment (so it can't be hoarded);
 *  - going interested moves the unit into the portfolio with a renewable
 *    `portfolioRenewDays` window — any further work renews it;
 *  - when the deadline lapses, `sweepCooldowns` returns the unit to the pool.
 *
 * A timer setting of 0 REMOVES that limit: `assignmentSlaHours = 0` gives
 * assigned units no deadline (they never auto-return), `portfolioRenewDays = 0`
 * lets a portfolio unit sit forever, `noAnswerMaxHoldDays = 0` drops the cap,
 * and `noAnswerExtensionHours = 0` means a no-answer leaves the clock untouched.
 * A unit with no `assignmentExpiresAt` is simply never swept.
 */

/** A deadline `hours` out, or undefined when the limit is 0 (removed). */
function deadlineHours(dateStr: string, hours: number): string | undefined {
  return hours > 0 ? addHours(dateStr, hours) : undefined;
}
/** A deadline `days` out, or undefined when the limit is 0 (removed). */
function deadlineDays(dateStr: string, days: number): string | undefined {
  return days > 0 ? addDays(dateStr, days) : undefined;
}

export function applyOutcome(
  p: ProspectFields,
  outcome: CallOutcome,
  now: string,
  followUpAt?: string,
  settings: VaultSettings = new VaultSettings(),
): void {
  p.lastOutcome = outcome;
  p.lastCalledAt = now;
  p.updatedAt = now;
  p.nextFollowUpAt = followUpAt;

  // A unit already in the portfolio is "kept" by continuing to work it: any
  // non-terminal call renews the 7-day window rather than the shorter SLA clock.
  const wasPortfolio = p.state === PropertyState.portfolio;

  switch (outcome) {
    case CallOutcome.noAnswer:
    case CallOutcome.unreachable:
      p.callAttempts += 1;
      if (wasPortfolio) {
        p.assignmentExpiresAt = deadlineDays(now, settings.portfolioRenewDays);
      } else if (settings.assignmentSlaHours <= 0) {
        p.assignmentExpiresAt = undefined; // assignment timer removed
      } else {
        // Reset to the extension window — or, when no extension is configured,
        // leave the current deadline in place — never past the hard cap.
        const base = settings.noAnswerExtensionHours > 0
          ? addHours(now, settings.noAnswerExtensionHours)
          : p.assignmentExpiresAt;
        p.assignmentExpiresAt = cappedDeadline(base, p, settings, now);
      }
      break;
    case CallOutcome.callbackLater:
      p.callAttempts = 0;
      if (wasPortfolio) {
        p.assignmentExpiresAt = deadlineDays(now, settings.portfolioRenewDays);
      } else if (settings.assignmentSlaHours <= 0) {
        p.assignmentExpiresAt = undefined; // assignment timer removed
      } else {
        const base = followUpAt
          ? (settings.noAnswerExtensionHours > 0 ? addHours(followUpAt, settings.noAnswerExtensionHours) : followUpAt)
          : addHours(now, settings.assignmentSlaHours);
        p.assignmentExpiresAt = cappedDeadline(base, p, settings, now);
      }
      break;
    case CallOutcome.interestedSell:
    case CallOutcome.interestedRent:
      p.callAttempts = 0;
      p.state = PropertyState.portfolio;
      p.portfolioSince ??= now;
      p.assignmentExpiresAt = deadlineDays(now, settings.portfolioRenewDays);
      break;
    case CallOutcome.notInterested:
      p.callAttempts = 0;
      p.state = PropertyState.cooling;
      p.cooldownUntil = addDays(now, settings.notInterestedCooldownDays);
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = undefined;
      break;
    case CallOutcome.alreadyListed:
      p.callAttempts = 0;
      p.state = PropertyState.cooling;
      p.cooldownUntil = addDays(now, settings.listedCooldownDays);
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = undefined;
      break;
    case CallOutcome.dnc:
      p.state = PropertyState.dnc;
      p.dncAt = now;
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = undefined;
      break;
  }
}

/** The deadline set when a unit is freshly assigned to a broker.
 *  Undefined when `assignmentSlaHours` is 0 — the assignment timer is removed. */
export function assignmentDeadlineOnAssign(
  now: string,
  settings: VaultSettings = new VaultSettings(),
): string | undefined {
  return deadlineHours(now, settings.assignmentSlaHours);
}

/**
 * A rolling deadline clamped to the hard cap: no-answer extensions can push the
 * clock forward, but never past `noAnswerMaxHoldDays` from when the unit was
 * assigned. Past the cap the returned time is in the past, so the next sweep
 * recycles the unit.
 *
 * `noAnswerMaxHoldDays = 0` removes the cap (returns the base unchanged). A
 * missing `base` (e.g. no extension configured and nothing on the clock) yields
 * just the cap, or undefined when there's no cap either.
 */
function cappedDeadline(
  base: string | undefined,
  p: ProspectFields,
  settings: VaultSettings,
  now: string,
): string | undefined {
  const cap = settings.noAnswerMaxHoldDays > 0
    ? addDays(p.assignedAt ?? now, settings.noAnswerMaxHoldDays)
    : undefined;
  if (base == null) return cap;
  if (cap == null) return base;
  return new Date(base) < new Date(cap) ? base : cap;
}

export function addHours(dateStr: string, hours: number): string {
  const d = new Date(dateStr);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d.toISOString();
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.floor((db.getTime() - da.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Recycle lapsed holds back to the pool. Two triggers:
 *  - a cooled record whose cooldown window has passed;
 *  - an assigned/portfolio record whose assignment deadline has passed.
 *
 * A recycled unit is FULLY released — including `assignedTo` — so a pooled unit
 * never shows a stale broker in the "Assigned to" column, and the same data
 * becomes reachable to the rest of the team.
 */
export function sweepCooldowns<T extends ProspectFields>(
  items: T[],
  now: string,
  settings: VaultSettings = new VaultSettings(),
): T[] {
  const nowDate = new Date(now);
  const changed: T[] = [];
  for (const p of items) {
    const cooled = p.state === PropertyState.cooling &&
      p.cooldownUntil != null && new Date(p.cooldownUntil) < nowDate;
    const lapsed = (p.state === PropertyState.assigned || p.state === PropertyState.portfolio) &&
      p.assignmentExpiresAt != null && new Date(p.assignmentExpiresAt) < nowDate;
    if (cooled || lapsed) {
      p.state = PropertyState.pool;
      p.cooldownUntil = undefined;
      p.assignedTo = undefined;
      p.assignedAt = undefined;
      p.assignmentNote = undefined;
      p.nextFollowUpAt = undefined;
      p.portfolioSince = undefined;
      p.assignmentExpiresAt = undefined;
      p.callAttempts = 0;
      p.updatedAt = now;
      changed.push(p);
    }
  }
  return changed;
}

export function isPortfolioStale(
  p: ProspectFields,
  now: string,
  settings: VaultSettings = new VaultSettings(),
): boolean {
  return p.state === PropertyState.portfolio &&
    (p.lastCalledAt == null ||
      daysBetween(p.lastCalledAt, now) >= settings.portfolioStaleDays);
}
