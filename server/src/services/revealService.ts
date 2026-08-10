import { transaction } from '../db/pool';
import { AppUser } from '../../../src/types/user';
import { prettyPhone } from '../../../src/utils/format';
import { findPropertyById, findByOwnerKey } from '../repositories/propertyRepo';
import { findLeadById } from '../repositories/leadRepo';
import { writeAudit } from '../repositories/auditRepo';
import { ownerKeyOf } from '../../../src/logic/ownerGrouping';
import { notFound } from '../http/errors';

/**
 * The sanctioned reveal.
 *
 * This is the only path by which a real phone number leaves the server, and the
 * reveal + the audit write happen in ONE transaction — so "revealed" can never
 * come apart from "left a trace". Client-side these were two independent steps a
 * caller could simply skip.
 *
 * Deliberately single-record: reveal takes one id, never a list. There is no
 * bulk endpoint and no export — the audit trail is only meaningful if a number
 * can only leave one record at a time.
 */

export interface RevealResult {
  /** Grouped for display, e.g. "+971 50 123 4567" — matches the old UI exactly. */
  phone: string;
  /**
   * Every number on record, labelled (Mobile 1 / Mobile 2 / …) and grouped the
   * same way. Revealing an owner reveals their whole contact card, so this is ONE
   * reveal and ONE audit entry, not one per number. Always contains at least the
   * primary.
   */
  phones: { label: string; number: string }[];
  /**
   * Per co-owner, each with their OWN number(s) — the ownership register lists
   * co-owners separately. One reveal returns the whole card (all owners), one
   * audit entry. Absent for a single-owner unit (use `phone`/`phones`).
   */
  owners?: { name: string; phones: { label: string; number: string }[] }[];
}

interface RevealInput {
  user: AppUser;
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
  // Every reveal/view is allowed and audited — the audit IS the control (there is
  // no daily cap). Reveal and audit share one transaction, so a revealed number
  // always leaves a trace even if the request fails afterwards.
  await transaction(async (cx) => {
    await writeAudit({
      actorId: input.user.id,
      action: 'view',
      detail: input.what,
      propertyIds: input.propertyIds,
    }, cx);
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
 * A non-phone view (opening an owner's detail). Audited, but returns no number.
 */
export async function recordView(input: RevealInput): Promise<{ ok: true }> {
  await revealGuard(input, undefined);
  return { ok: true };
}

/** Every unit of the owner behind a property — the dialer's grouped card. */
export async function ownerUnitsFor(propertyId: string) {
  const p = await findPropertyById(propertyId);
  if (!p) throw notFound('That unit no longer exists.');
  const units = await findByOwnerKey(ownerKeyOf(p));
  return units.length > 0 ? units : [p];
}
