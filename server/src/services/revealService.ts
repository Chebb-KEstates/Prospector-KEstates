import { transaction } from '../db/pool';
import { AppUser } from '../../../src/types/user';
import { prettyPhone } from '../../../src/utils/format';
import { findPropertyById, findByOwnerKey } from '../repositories/propertyRepo';
import { findLeadById } from '../repositories/leadRepo';
import { loadSettings } from '../repositories/settingsRepo';
import { countViewsBetween, writeAudit } from '../repositories/auditRepo';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';
import { notFound, viewCapReached } from '../http/errors';

/**
 * The sanctioned reveal.
 *
 * This is the only path by which a real phone number leaves the server, and the
 * cap check + audit write happen in ONE transaction — so "was allowed to
 * reveal" and "revealed" cannot come apart. Client-side these were two
 * independent steps a caller could simply skip.
 *
 * Deliberately single-record: reveal takes one id, never a list. There is no
 * bulk endpoint and no export, because the moment one exists the daily cap
 * stops meaning anything.
 */

export interface RevealResult {
  /** Grouped for display, e.g. "+971 50 123 4567" — matches the old UI exactly. */
  phone: string;
  /** Reveals spent today, after this one. */
  used: number;
  cap: number;
}

/** Local-day bounds for the caller, so "today" isn't silently the server's day. */
function dayBounds(nowIso: string, tzOffsetMinutes: number): { from: Date; to: Date } {
  const now = new Date(nowIso);
  const shifted = new Date(now.getTime() - tzOffsetMinutes * 60_000);
  const startShifted = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
  );
  const from = new Date(startShifted + tzOffsetMinutes * 60_000);
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { from, to };
}

interface RevealInput {
  user: AppUser;
  /** Minutes to subtract from UTC to reach the caller's local time. */
  tzOffsetMinutes: number;
  /** Whether this reveal counts against the cap. */
  enforceCap: boolean;
  what: string;
}

async function revealGuard(
  input: RevealInput,
  phone: string | undefined,
): Promise<RevealResult> {
  const settings = await loadSettings();
  const cap = input.user.viewCapOverride ?? settings.dailyViewCap;
  const nowIso = new Date().toISOString();
  const { from, to } = dayBounds(nowIso, input.tzOffsetMinutes);

  // The transaction COMMITS in both cases and reports the decision; the throw
  // happens after it returns.
  //
  // This must not be "write cap-block, then throw" inside the transaction: the
  // throw rolls the transaction back, taking the cap-block entry with it. A
  // broker hitting the cap would be blocked but leave no trace — the opposite
  // of the point. Hitting a limit is exactly the event worth recording.
  const decision = await transaction(async (cx) => {
    const used = await countViewsBetween(input.user.id, from, to, cx);

    // Managers are exempt — same rule as the client's recordView.
    const capped = input.enforceCap && !input.user.isManager;
    if (capped && used >= cap) {
      await writeAudit({
        actorId: input.user.id,
        action: 'cap-block',
        detail: `Daily view cap (${cap}) hit — ${input.what}`,
      }, cx);
      return { blocked: true as const, used };
    }

    await writeAudit({
      actorId: input.user.id,
      action: 'view',
      detail: input.what,
    }, cx);

    return { blocked: false as const, used };
  });

  if (decision.blocked) throw viewCapReached(cap);

  return { phone: prettyPhone(phone), used: decision.used + 1, cap };
}

/**
 * Reveal an owner's number.
 *
 * The dialer reveals a number for an owner, not a unit, so callers pass any one
 * of the owner's properties and we resolve the owner through the shared
 * ownerKeyOf(). Every unit of that owner carries the same number by
 * construction — that's what the key means.
 */
export async function revealOwnerPhone(
  propertyId: string,
  input: Omit<RevealInput, 'what'> & { what?: string },
): Promise<RevealResult> {
  const property = await findPropertyById(propertyId);
  if (!property) throw notFound('That unit no longer exists.');

  const what = input.what ?? `Revealed number — ${property.owner.name || 'Unknown owner'}`;
  return revealGuard({ ...input, what }, property.owner.phone);
}

export async function revealLeadPhone(
  leadId: string,
  input: Omit<RevealInput, 'what'> & { what?: string },
): Promise<RevealResult> {
  const lead = await findLeadById(leadId);
  if (!lead) throw notFound('That lead no longer exists.');

  const what = input.what ?? `Revealed number — ${lead.name || 'Unknown lead'}`;
  return revealGuard({ ...input, what }, lead.phone);
}

/**
 * A non-phone view (opening an owner's detail). Counts against the cap and is
 * audited, but returns no number — mirrors recordView() with enforceCap=true.
 */
export async function recordView(
  input: RevealInput,
): Promise<{ used: number; cap: number }> {
  const r = await revealGuard(input, undefined);
  return { used: r.used, cap: r.cap };
}

/** Every unit of the owner behind a property — the dialer's grouped card. */
export async function ownerUnitsFor(propertyId: string) {
  const p = await findPropertyById(propertyId);
  if (!p) throw notFound('That unit no longer exists.');
  const units = await findByOwnerKey(ownerKeyOf(p));
  return units.length > 0 ? units : [p];
}
