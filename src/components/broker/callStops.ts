import { useVault } from '../../state/VaultContext';
import { CallStop, CallHistoryEntry, AssetRow } from '../../state/CallSessionContext';
import { Property, Lead, PropertyState } from '../../types/models';
import { groupByOwner, ownerKeyOf } from '../../logic/ownerGrouping';
import { flagFor, fmtDate, fmtAed, fmtArea } from '../../utils/format';

type Vault = ReturnType<typeof useVault>;

function history(vault: Vault, calls: { at: string; outcome: any; note?: string; brokerId: string }[]): CallHistoryEntry[] {
  return [...calls]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(c => ({ at: c.at, outcome: c.outcome, note: c.note, by: vault.userById(c.brokerId)?.name }));
}

/** Build one call stop for an owner and all of their units. */
export function buildOwnerStop(vault: Vault, units: Property[], actorId: string): CallStop {
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
    phone: owner.phone,
    subtitle: `${units.length} unit${units.length === 1 ? '' : 's'} · ${g0.community}`,
    assetsTitle: `Assets (${units.length})`,
    assets,
    state: g0?.state ?? PropertyState.assigned,
    note: units.map(p => p.assignmentNote).find(Boolean),
    history: history(vault, vault.callsFor(units.map(p => p.id))),
    log: (outcome, note, followUpAt) => vault.logCall(units, actorId, outcome, note, followUpAt),
  };
}

/** Build one call stop for a single buyer lead. */
export function buildLeadStop(vault: Vault, l: Lead, actorId: string): CallStop {
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
    phone: l.phone,
    subtitle: `Buyer lead · ${l.project ?? l.source ?? 'enquiry'}`,
    assetsTitle: 'Enquiry',
    assets,
    state: l.state,
    note: l.assignmentNote,
    history: history(vault, vault.callsForLead(l.id)),
    log: (outcome, note, followUpAt) => vault.logLeadCall(l, actorId, outcome, note, followUpAt),
  };
}

/** One stop per owner (grouping all their assigned units) — callable only. */
export function ownerCallStops(vault: Vault, brokerId: string): CallStop[] {
  const mine = vault.assignedTo(brokerId).filter(p => p.callable);
  return groupByOwner(mine).map(g => buildOwnerStop(vault, g.properties, brokerId));
}

/** One stop per callable buyer lead. */
export function leadCallStops(vault: Vault, brokerId: string): CallStop[] {
  const mine = vault.leadsOf(brokerId).filter(l => l.callable &&
    (l.state === PropertyState.assigned || l.state === PropertyState.portfolio));
  return mine.map(l => buildLeadStop(vault, l, brokerId));
}

/** Single-call stop for a property's owner (all their units across the vault). */
export function ownerStopForProperty(vault: Vault, p: Property, actorId: string): CallStop {
  const key = ownerKeyOf(p);
  const units = vault.properties.filter(x => ownerKeyOf(x) === key);
  return buildOwnerStop(vault, units.length ? units : [p], actorId);
}
