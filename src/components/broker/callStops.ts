import { CallStop, CallHistoryEntry, AssetRow, CallUnit, CallSignal, UnitDetail } from '../../state/CallSessionContext';
import type { ChipTone } from '../../state/CallSessionContext';
import { Property, Lead, PropertyState, CallLog } from '../../types/models';
import { AppUser } from '../../types/user';
import { groupByOwner, ownerKeyOf } from '../../logic/ownerGrouping';
import { flagFor, fmtDate, fmtAed, fmtArea } from '../../utils/format';
import * as api from '../../data/api';

/**
 * Building the dialer's stops.
 *
 * These used to reach into the vault snapshot for call history and for the
 * owner's other units. Both are server calls now, so a stop is built from data
 * the caller already has, and the two things that need the network — the
 * history and the reveal — are closures the card awaits.
 *
 * `phone` is deliberately absent from a stop: only `phoneMasked` (display) and
 * `reveal()` (the audited round trip).
 */

type NameOf = (id?: string) => string | undefined;

function history(calls: CallLog[], nameOf: NameOf): CallHistoryEntry[] {
  return [...calls]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(c => ({ at: c.at, outcome: c.outcome, note: c.note, by: nameOf(c.brokerId), ownerName: c.ownerName }));
}

export interface StopDeps {
  nameOf: NameOf;
  logCall: (properties: Property[], outcome: any, note?: string, followUpAt?: string, ownerName?: string) => Promise<void>;
  logLeadCall: (lead: Lead, outcome: any, note?: string, followUpAt?: string) => Promise<void>;
}

/** Every call touching any of the owner's units, merged and de-duped by call id. */
async function ownerCalls(units: Property[]): Promise<CallLog[]> {
  const lists = await Promise.all(
    units.map(u => api.properties.calls(u.id).catch(() => [] as CallLog[])),
  );
  const byId = new Map<string, CallLog>();
  for (const list of lists) for (const c of list) byId.set(c.id, c);
  return Array.from(byId.values());
}

/** A rental read for one property — vacant is an opening, a lease ending soon is a nudge. */
function rentalOf(p: Property): CallUnit['rental'] {
  const status = (p.extra?.['Rental status'] ?? '').toLowerCase();
  const rented = !!p.rentEnd || /new|renew|rented|leased|tenant/.test(status);
  if (rented) {
    const amt = p.rentAmount ? ` · ${fmtAed(p.rentAmount)}/yr` : '';
    const end = p.rentEnd ? ` · ends ${fmtDate(p.rentEnd)}` : '';
    return { label: `Rented${amt}${end}`, tone: leaseSoon(p.rentEnd) ? 'warn' : 'info' };
  }
  // Only call it "Vacant" when the data actually says so — that's a real opening.
  if (/vacant|available/.test(status)) return { label: 'Vacant', tone: 'good' };
  // Otherwise there's simply no rental on record; say that plainly rather than
  // implying the unit is empty.
  return { label: 'No Rental', tone: 'neutral' };
}

/** Whole days from now until a date (negative if past); null if unparseable. */
function daysUntil(date?: string): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (isNaN(t)) return null;
  return Math.floor((t - Date.now()) / (24 * 3600 * 1000));
}

/**
 * A unit's structured breakdown for the property-view popup: labelled facts, the
 * last sale (null when there's none on record), and a rental read that carries
 * `endsInDays` so the popup can flag a lease running out.
 */
function detailOf(p: Property): UnitDetail {
  const facts: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown) => {
    if (value != null && String(value).trim().length > 0) facts.push({ label, value: String(value) });
  };
  push('Beds', p.beds);
  push('Type', p.propertyType);
  push('Layout', p.extra?.['Layout']);
  if (p.sizeSqft != null) facts.push({ label: 'BUA', value: fmtArea(p.sizeSqft) });
  if (p.plotSqft != null) facts.push({ label: 'Plot', value: fmtArea(p.plotSqft) });
  push('View', p.extra?.['View']);
  push('Location', p.extra?.['Location']);
  push('Floor', p.extra?.['Floor']);

  const saleType = p.extra?.['Sale Type'] ?? p.extra?.['Transaction Type'] ?? p.extra?.['Sale type'];
  const sale = (p.lastTransactionValue != null || p.lastTransactionDate || saleType)
    ? {
      value: p.lastTransactionValue != null ? fmtAed(p.lastTransactionValue) : undefined,
      date: p.lastTransactionDate ? fmtDate(p.lastTransactionDate) : undefined,
      type: saleType != null && String(saleType).trim() ? String(saleType) : undefined,
    }
    : null;

  const statusRaw = (p.extra?.['Rental status'] ?? '').toLowerCase();
  const isRented = !!p.rentEnd || /new|renew|rented|leased|tenant/.test(statusRaw);
  const isVacant = /vacant|available/.test(statusRaw);
  const hasRentalData = isRented || isVacant || p.rentAmount != null || !!p.rentStart || !!p.rentEnd;
  const endsInDays = daysUntil(p.rentEnd);
  const tone: ChipTone = isRented
    ? (endsInDays != null && endsInDays >= 0 && endsInDays <= 100 ? 'warn' : 'info')
    : isVacant ? 'good' : 'neutral';
  const rental = {
    status: isRented ? 'Rented' : isVacant ? 'Vacant' : (hasRentalData ? 'Rental on file' : ''),
    tone,
    amount: p.rentAmount ? `${fmtAed(p.rentAmount)}/yr` : undefined,
    start: p.rentStart ? fmtDate(p.rentStart) : undefined,
    end: p.rentEnd ? fmtDate(p.rentEnd) : undefined,
    endsInDays,
  };

  return { facts, sale, rental, lastCalledAt: p.lastCalledAt };
}

/** Whole years since a date, floored; null if unparseable. */
function yearsOwned(date?: string): number | null {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / (365.25 * 24 * 3600 * 1000)));
}

/** A lease ending within ~4 months — a real reason to call now. */
function leaseSoon(end?: string): boolean {
  if (!end) return false;
  const t = new Date(end).getTime();
  if (isNaN(t)) return false;
  const days = (t - Date.now()) / (24 * 3600 * 1000);
  return days >= 0 && days <= 120;
}

/** One stop for an owner and all of their units. */
export function buildOwnerStop(
  units: Property[],
  calls: CallLog[],
  deps: StopDeps,
): CallStop {
  const g0 = units[0];
  const owner = g0.owner;

  // Rich per-property lines: beds/type/size + imported extras (layout, floor)
  // and a rental read.
  const richUnits: CallUnit[] = units.map((p: Property) => {
    const facts: string[] = [];
    if (p.beds != null) facts.push(`${p.beds} bed`);
    if (p.propertyType) facts.push(p.propertyType);
    // Both areas, each labelled — a plot size matters as much as the built-up.
    if (p.sizeSqft != null) facts.push(`BUA ${fmtArea(p.sizeSqft)}`);
    if (p.plotSqft != null) facts.push(`Plot ${fmtArea(p.plotSqft)}`);
    // The plot's position within the community (e.g. "S.Row, B.Park") — a real
    // selling signal; imported as the "Location" column.
    const locationType = p.extra?.['Location'];
    if (locationType) facts.push(locationType);
    const layout = p.extra?.['Layout'];
    if (layout) facts.push(layout);
    const floor = p.extra?.['Floor'];
    if (floor) facts.push(`Floor ${floor}`);
    return {
      id: p.id,
      label: p.unitLabel,
      location: [p.community, p.cluster].filter(Boolean).join(' · '),
      facts,
      rental: rentalOf(p),
      // Each property's OWN last transaction, not the owner's first unit.
      lastSale: p.lastTransactionValue != null
        ? `${fmtAed(p.lastTransactionValue)}${p.lastTransactionDate ? ` · ${fmtDate(p.lastTransactionDate)}` : ''}`
        : undefined,
      detail: detailOf(p),
      state: p.state,
      // This unit's slice of the owner's call history.
      history: history(calls.filter(c => c.propertyIds.includes(p.id)), deps.nameOf),
      notes: p.notes,
      expiresAt: p.assignmentExpiresAt,
    };
  });

  // Seller signals — the "why call now" at a glance.
  const signals: CallSignal[] = [];
  if (units.length > 1) signals.push({ label: `${units.length} properties`, tone: 'good' });
  const years = yearsOwned(g0.lastTransactionDate);
  if (years != null) {
    signals.push(years < 1
      ? { label: 'Bought < 1 yr ago', tone: 'neutral' }
      : { label: `Owned ${years} yr${years === 1 ? '' : 's'}`, tone: years >= 4 ? 'good' : 'info' });
  }
  const vacant = richUnits.filter(u => u.rental?.tone === 'good').length;
  const rented = richUnits.filter(u => u.rental && u.rental.tone !== 'good').length;
  if (vacant > 0) signals.push({ label: units.length > 1 ? `${vacant} vacant` : 'Vacant', tone: 'good' });
  else if (rented > 0) signals.push({ label: units.length > 1 ? `${rented} rented` : 'Rented', tone: 'info' });
  const soon = units.map(u => u.rentEnd).filter((e): e is string => !!e && leaseSoon(e)).sort()[0];
  if (soon) signals.push({ label: `Lease ends ${fmtDate(soon)}`, tone: 'warn' });

  const lastSale = g0.lastTransactionValue != null
    ? `${fmtAed(g0.lastTransactionValue)}${g0.lastTransactionDate ? ` · ${fmtDate(g0.lastTransactionDate)}` : ''}`
    : undefined;

  // `assets` stays as the buyer-lead / fallback shape.
  const assets: AssetRow[] = units.map((p: Property) => ({
    label: p.unitLabel,
    value: [p.community, p.beds != null ? `${p.beds} bed` : null, p.propertyType].filter(Boolean).join(' · '),
  }));
  if (lastSale) assets.push({ label: 'Last sale', value: lastSale });
  if (g0?.sizeSqft != null) assets.push({ label: 'Size', value: fmtArea(g0.sizeSqft) });

  return {
    id: ownerKeyOf(g0),
    name: owner.name || 'Unknown owner',
    flag: flagFor(owner.nationality),
    buyer: false,
    // Already masked by the server.
    phoneMasked: owner.phone,
    // Every number the primary owner has, still masked — lets the card show
    // "N numbers on file" up front and reveal all of them at once.
    phonesMasked: owner.allPhones,
    // enforceCap:false — opening the session already counted as the view, the
    // same rule the client's recordView(…, false) applied at this point. One
    // reveal returns the whole card, including each co-owner's own number.
    reveal: async () => {
      const r = await api.properties.reveal(g0.id, false);
      return { phones: r.phones, owners: r.owners ?? [] };
    },
    // Co-owners of the unit being called (masked) — drives the owner switcher.
    // Each carries their OWN full (masked) number list, so the switcher can show
    // per-owner counts and reveal all of that owner's numbers.
    owners: g0.allOwners.length > 1
      ? g0.allOwners.map(o => ({
          name: o.name, nationality: o.nationality,
          phoneMasked: o.phone, phonesMasked: o.allPhones,
        }))
      : undefined,
    subtitle: `${units.length} unit${units.length === 1 ? '' : 's'} · ${g0.community}`,
    assetsTitle: `Portfolio (${units.length})`,
    assets,
    nationality: owner.nationality || undefined,
    signals,
    units: richUnits,
    state: g0?.state ?? PropertyState.assigned,
    note: units.map(p => p.assignmentNote).find(Boolean),
    history: history(calls, deps.nameOf),
    log: (outcome, note, followUpAt, ownerName) => deps.logCall(units, outcome, note, followUpAt, ownerName),
    // Multi-unit owners only: log a result for one property at a time.
    logUnit: units.length > 1
      ? (unitId, outcome, note, followUpAt, ownerName) => {
          const p = units.find(u => u.id === unitId);
          return deps.logCall(p ? [p] : [], outcome, note, followUpAt, ownerName);
        }
      : undefined,
    saveNote: (unitId, notes) => api.properties.saveNotes(unitId, notes).then(() => undefined),
  };
}

/** One stop for a single buyer lead. */
export function buildLeadStop(l: Lead, calls: CallLog[], deps: StopDeps): CallStop {
  const assets: AssetRow[] = [];
  if (l.enquiryDate) assets.push({ label: 'Enquired', value: fmtDate(l.enquiryDate) });
  if (l.project) assets.push({ label: 'Project', value: l.project });
  if (l.source) assets.push({ label: 'Source', value: l.source });
  if (l.email) assets.push({ label: 'Email', value: l.email });
  for (const [k, v] of Object.entries(l.extra)) assets.push({ label: k, value: v });

  return {
    id: l.id,
    name: l.name || 'Unknown lead',
    flag: '🌐',
    buyer: true,
    phoneMasked: l.phone,
    // A lead has a single number and no co-owners.
    reveal: async () => ({ phones: (await api.leads.reveal(l.id, false)).phones, owners: [] }),
    subtitle: `Buyer lead · ${l.project ?? l.source ?? 'enquiry'}`,
    assetsTitle: 'Enquiry',
    assets,
    state: l.state,
    note: l.assignmentNote,
    history: history(calls, deps.nameOf),
    log: (outcome, note, followUpAt) => deps.logLeadCall(l, outcome, note, followUpAt),
  };
}

/**
 * One stop per owner across a broker's assigned units — callable only.
 *
 * Call history is fetched per owner, in parallel. A failed history fetch yields
 * an empty timeline rather than blocking the session: not being able to show
 * what was said last time is no reason to stop someone calling.
 */
export async function ownerCallStops(mine: Property[], deps: StopDeps): Promise<CallStop[]> {
  const callable = mine.filter(p => p.callable);
  const groups = groupByOwner(callable);

  return Promise.all(groups.map(async (g) => {
    let calls: CallLog[] = [];
    try {
      calls = await ownerCalls(g.properties);
    } catch { /* timeline is best-effort */ }
    return buildOwnerStop(g.properties, calls, deps);
  }));
}

/** One stop per callable buyer lead the broker holds. */
export async function leadCallStops(mine: Lead[], deps: StopDeps): Promise<CallStop[]> {
  const callable = mine.filter(l =>
    l.callable && (l.state === PropertyState.assigned || l.state === PropertyState.portfolio));

  return Promise.all(callable.map(async (l) => {
    let calls: CallLog[] = [];
    try {
      calls = await api.leads.calls(l.id);
    } catch { /* timeline is best-effort */ }
    return buildLeadStop(l, calls, deps);
  }));
}

/**
 * A single-call stop for one property's owner, pulling in that owner's other
 * units. The server resolves the owner (via the shared ownerKeyOf) and applies
 * the caller's scope, so a broker only ever gets back units that are theirs.
 */
export async function ownerStopForProperty(
  p: Property,
  deps: StopDeps,
): Promise<CallStop> {
  let units: Property[] = [p];
  try {
    const owned = await api.properties.ownerUnits(p.id);
    if (owned.length > 0) units = owned;
  } catch { /* fall back to the single unit we were handed */ }

  let calls: CallLog[] = [];
  try {
    calls = await ownerCalls(units);
  } catch { /* timeline is best-effort */ }

  return buildOwnerStop(units, calls, deps);
}

/** A single-call stop for one lead. */
export async function leadStopFor(l: Lead, deps: StopDeps): Promise<CallStop> {
  let calls: CallLog[] = [];
  try {
    calls = await api.leads.calls(l.id);
  } catch { /* timeline is best-effort */ }
  return buildLeadStop(l, calls, deps);
}

/** Convenience for building `deps` from the vault + users list. */
export function stopDeps(
  users: AppUser[],
  logCall: StopDeps['logCall'],
  logLeadCall: StopDeps['logLeadCall'],
): StopDeps {
  return {
    nameOf: (id?: string) => (id ? users.find(u => u.id === id)?.name : undefined),
    logCall,
    logLeadCall,
  };
}
