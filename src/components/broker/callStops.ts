import { CallStop, CallHistoryEntry, AssetRow } from '../../state/CallSessionContext';
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
    .map(c => ({ at: c.at, outcome: c.outcome, note: c.note, by: nameOf(c.brokerId) }));
}

export interface StopDeps {
  nameOf: NameOf;
  logCall: (properties: Property[], outcome: any, note?: string, followUpAt?: string) => Promise<void>;
  logLeadCall: (lead: Lead, outcome: any, note?: string, followUpAt?: string) => Promise<void>;
}

/** One stop for an owner and all of their units. */
export function buildOwnerStop(
  units: Property[],
  calls: CallLog[],
  deps: StopDeps,
): CallStop {
  const g0 = units[0];
  const owner = g0.owner;
  const assets: AssetRow[] = units.map((p: Property) => ({
    label: p.unitLabel,
    value: [p.community, p.beds != null ? `${p.beds} bed` : null, p.propertyType].filter(Boolean).join(' · '),
  }));
  if (g0?.lastTransactionValue != null) {
    assets.push({ label: 'Last sale', value: `${fmtAed(g0.lastTransactionValue)} · ${fmtDate(g0.lastTransactionDate)}` });
  }
  if (g0?.sizeSqft != null) assets.push({ label: 'Size', value: fmtArea(g0.sizeSqft) });

  return {
    id: ownerKeyOf(g0),
    name: owner.name || 'Unknown owner',
    flag: flagFor(owner.nationality),
    buyer: false,
    // Already masked by the server.
    phoneMasked: owner.phone,
    // enforceCap:false — opening the session already counted as the view, the
    // same rule the client's recordView(…, false) applied at this point.
    reveal: async () => (await api.properties.reveal(g0.id, false)).phone,
    subtitle: `${units.length} unit${units.length === 1 ? '' : 's'} · ${g0.community}`,
    assetsTitle: `Assets (${units.length})`,
    assets,
    state: g0?.state ?? PropertyState.assigned,
    note: units.map(p => p.assignmentNote).find(Boolean),
    history: history(calls, deps.nameOf),
    log: (outcome, note, followUpAt) => deps.logCall(units, outcome, note, followUpAt),
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
    reveal: async () => (await api.leads.reveal(l.id, false)).phone,
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
      calls = await api.properties.calls(g.properties[0].id);
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
    calls = await api.properties.calls(p.id);
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
