import { PropertyState, CallOutcome, VaultSettings } from '../types/models';
import type { ProspectFields } from '../types/models';

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

  switch (outcome) {
    case CallOutcome.noAnswer:
    case CallOutcome.unreachable:
      p.callAttempts += 1;
      if (p.callAttempts >= settings.maxNoAnswerAttempts && p.state === PropertyState.assigned) {
        p.state = PropertyState.pool;
        p.assignedAt = undefined;
        p.assignmentNote = undefined;
        p.nextFollowUpAt = undefined;
        p.callAttempts = 0;
      }
      break;
    case CallOutcome.callbackLater:
      p.callAttempts = 0;
      break;
    case CallOutcome.interestedSell:
    case CallOutcome.interestedRent:
      p.callAttempts = 0;
      p.state = PropertyState.portfolio;
      p.portfolioSince ??= now;
      break;
    case CallOutcome.notInterested:
      p.callAttempts = 0;
      p.state = PropertyState.cooling;
      p.cooldownUntil = addDays(now, settings.notInterestedCooldownDays);
      p.portfolioSince = undefined;
      break;
    case CallOutcome.alreadyListed:
      p.callAttempts = 0;
      p.state = PropertyState.cooling;
      p.cooldownUntil = addDays(now, settings.listedCooldownDays);
      p.portfolioSince = undefined;
      break;
    case CallOutcome.dnc:
      p.state = PropertyState.dnc;
      p.dncAt = now;
      p.portfolioSince = undefined;
      break;
  }
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

export function sweepCooldowns<T extends ProspectFields>(
  items: T[],
  now: string,
  settings: VaultSettings = new VaultSettings(),
): T[] {
  const changed: T[] = [];
  for (const p of items) {
    const cooled = p.state === PropertyState.cooling &&
      p.cooldownUntil != null && new Date(p.cooldownUntil) < new Date(now);
    const expired = p.state === PropertyState.assigned &&
      p.lastCalledAt == null &&
      p.assignedAt != null &&
      daysBetween(p.assignedAt, now) >= settings.assignmentExpiryDays;
    if (cooled || expired) {
      p.state = PropertyState.pool;
      p.cooldownUntil = undefined;
      p.assignedAt = undefined;
      p.assignmentNote = undefined;
      p.nextFollowUpAt = undefined;
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
