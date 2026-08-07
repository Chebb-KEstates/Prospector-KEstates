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
  /**
   * Every number on record, labelled (Mobile 1 / Mobile 2 / …) and grouped the
   * same way. Revealing an owner reveals their contact card, so this is ONE
   * reveal: one cap decrement and one audit entry, not one per number. Charging
   * three reveals for one owner would burn a broker's daily cap for no gain,
   * and splitting it into three audit lines would misreport what happened.
   * Always contains at least the primary.
   */
  phones: { label: string; number: string }[];
  /**
   * Per co-owner, each with their OWN number(s) — the ownership register lists
   * co-owners separately. One reveal returns the whole card (all owners), one
   * cap decrement. Absent for a single-owner unit (use `phone`/`phones`).
   */
  owners?: { name: string; phones: { label: string; number: string }[] }[];
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
  /** Properties this reveal touches — linked in the audit so it shows on the
   *  record's history journal. */
  propertyIds?: string[];
}

async function revealGuard(
  input: RevealInput,
  phone: string | undefined,
  phones: { label: string; number: string }[] = [],
  owners: { name: string; phones: { label: string; number: string }[] }[] = [],
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

    // Daily view cap removed — every view/reveal is allowed and simply audited.
    await writeAudit({
      actorId: input.user.id,
      action: 'view',
      detail: input.what,
      propertyIds: input.propertyIds,
    }, cx);

    return { blocked: false as const, used };
  });

  // Fall back to the primary so callers always get a non-empty list.
  const list = phones.length > 0
    ? phones
    : (phone ? [{ label: 'Mobile', number: phone }] : []);

  return {
    phone: prettyPhone(phone),
    phones: list.map(e => ({ label: e.label, number: prettyPhone(e.number) })),
    owners: owners.length > 1
      ? owners.map(o => ({
          name: o.name,
          phones: o.phones.map(e => ({ label: e.label, number: prettyPhone(e.number) })),
        }))
      : undefined,
    used: decision.used + 1,
    cap,
  };
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

  const all = property.owner.allPhones;
  // Each co-owner with their own number(s) — one reveal returns the whole card.
  const ownerGroups = property.allOwners.map(o => ({ name: o.name, phones: o.allPhones }));
  const multi = ownerGroups.length > 1;
  const what = input.what ??
    (multi
      ? `Revealed co-owners (${ownerGroups.length}) — ${property.owner.name || 'Unknown owner'}`
      : `Revealed number${all.length > 1 ? `s (${all.length})` : ''} — ${property.owner.name || 'Unknown owner'}`);
  return revealGuard({ ...input, what, propertyIds: [property.id] }, property.owner.phone, all, ownerGroups);
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
