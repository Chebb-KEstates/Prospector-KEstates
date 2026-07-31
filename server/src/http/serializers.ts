import { AppUser } from '../../../src/types/user';
import { Property, Lead, CallLog, BatchRequest, DataSet, AuditEntry, VaultSettings } from '../../../src/types/models';
import { maskedPhone } from '../../../src/utils/format';

/**
 * The wire format — and the last line of defence for the data rules.
 *
 * Everything the API returns goes through here. The important property of this
 * file is negative: `serializeProperty` has no way to emit a real phone number.
 * The full number leaves the server through exactly one function
 * (`revealedPhone`, used only by the reveal route), so "no bulk reveal, no
 * export" is enforced by the shape of the code rather than by remembering.
 *
 * Field names mirror the frontend's `toJson()` so the existing `fromJson`
 * constructors keep working unchanged.
 */

/** A user as the client may see them. Never includes password material. */
export function publicUser(u: AppUser) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    team: u.team,
    permissions: Array.from(u.permissions),
    viewCapOverride: u.viewCapOverride,
    createdAt: u.createdAt,
  };
}

/**
 * A property with its owner's phone masked.
 *
 * `phone` carries the mask string ("••••••1234") rather than the real number,
 * and `phonePresent` carries what the UI actually needed the number for in a
 * list: whether this record is callable. Property.callable reads
 * `!!owner.phone`, and the mask is a non-empty string for any present number,
 * so the shared model's getter still returns the right answer client-side.
 */
export function serializeProperty(p: Property) {
  const hasPhone = !!p.owner.phone && p.owner.phone.length > 0;
  return {
    id: p.id,
    orgId: p.orgId,
    datasetId: p.datasetId,
    state: p.state,
    unitKey: p.unitKey,
    community: p.community,
    cluster: p.cluster,
    building: p.building,
    unitNumber: p.unitNumber,
    plotNumber: p.plotNumber,
    propertyType: p.propertyType,
    beds: p.beds,
    sizeSqft: p.sizeSqft,
    plotSqft: p.plotSqft,
    lastTransactionDate: p.lastTransactionDate,
    lastTransactionValue: p.lastTransactionValue,
    txCount: p.txCount,
    rentStart: p.rentStart,
    rentEnd: p.rentEnd,
    rentAmount: p.rentAmount,
    owner: {
      name: p.owner.name,
      // Masked. The real number never travels on a list response.
      phone: hasPhone ? maskedPhone(p.owner.phone) : undefined,
      // An owner may hold several numbers (Mobile 1 / 2 / 3). EVERY one is
      // masked here — otherwise this list becomes a back door to exactly the
      // numbers the `phone` mask above exists to protect. The labels are safe:
      // they carry no digits, and the UI needs them to say "3 numbers on record".
      phones: p.owner.phones.map(e => ({ label: e.label, number: maskedPhone(e.number) })),
      nationality: p.owner.nationality,
    },
    // Co-owners — each with their OWN number, EVERY one masked on this list
    // response exactly like the primary. Empty for a single-owner unit.
    owners: p.owners.map(o => ({
      name: o.name,
      phone: o.phone ? maskedPhone(o.phone) : undefined,
      phones: o.phones.map(e => ({ label: e.label, number: maskedPhone(e.number) })),
      nationality: o.nationality,
    })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    assignedTo: p.assignedTo,
    assignedAt: p.assignedAt,
    assignmentNote: p.assignmentNote,
    cooldownUntil: p.cooldownUntil,
    portfolioSince: p.portfolioSince,
    lastOutcome: p.lastOutcome,
    lastCalledAt: p.lastCalledAt,
    callAttempts: p.callAttempts,
    nextFollowUpAt: p.nextFollowUpAt,
    dncAt: p.dncAt,
    assignmentExpiresAt: p.assignmentExpiresAt,
    notes: p.notes,
    extra: p.extra,
  };
}

export function serializeLead(l: Lead) {
  const hasPhone = !!l.phone && l.phone.length > 0;
  return {
    id: l.id,
    orgId: l.orgId,
    datasetId: l.datasetId,
    enquiryDate: l.enquiryDate,
    name: l.name,
    phone: hasPhone ? maskedPhone(l.phone) : undefined,
    email: l.email,
    project: l.project,
    source: l.source,
    extra: l.extra,
    createdAt: l.createdAt,
    state: l.state,
    updatedAt: l.updatedAt,
    assignedTo: l.assignedTo,
    assignedAt: l.assignedAt,
    assignmentNote: l.assignmentNote,
    cooldownUntil: l.cooldownUntil,
    portfolioSince: l.portfolioSince,
    lastOutcome: l.lastOutcome,
    lastCalledAt: l.lastCalledAt,
    callAttempts: l.callAttempts,
    nextFollowUpAt: l.nextFollowUpAt,
    dncAt: l.dncAt,
    assignmentExpiresAt: l.assignmentExpiresAt,
  };
}

/**
 * The ONLY function that emits a real phone number.
 *
 * Callers must have already passed the cap check and written the audit entry —
 * see services/revealService.ts, which is the only place this is used.
 */
export function revealedPhone(phone: string | undefined): string | undefined {
  return phone;
}

export const serializeCall = (c: CallLog) => c.toJson();
export const serializeRequest = (r: BatchRequest) => r.toJson();
export const serializeDataset = (d: DataSet) => d.toJson();
export const serializeAudit = (a: AuditEntry) => a.toJson();
export const serializeSettings = (s: VaultSettings) => s.toJson();
