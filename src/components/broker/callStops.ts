import { useVault } from '../../state/VaultContext';
import { CallStop, CallHistoryEntry, AssetRow } from '../../state/CallSessionContext';
import { Property, Lead, PropertyState } from '../../types/models';
import { groupByOwner } from '../../logic/ownerGrouping';
import { flagFor, fmtDate, fmtAed, fmtArea } from '../../utils/format';

type Vault = ReturnType<typeof useVault>;

function history(vault: Vault, calls: { at: string; outcome: any; note?: string; brokerId: string }[]): CallHistoryEntry[] {
  return [...calls]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(c => ({ at: c.at, outcome: c.outcome, note: c.note, by: vault.userById(c.brokerId)?.name }));
}

/** One stop per owner (grouping all their assigned units) — callable only. */
export function ownerCallStops(vault: Vault, brokerId: string): CallStop[] {
  const mine = vault.assignedTo(brokerId).filter(p => p.callable);
  const groups = groupByOwner(mine);
  return groups.map(g => {
    const units = g.properties;
    const assets: AssetRow[] = units.map((p: Property) => ({
      label: p.unitLabel,
      value: [p.community, p.beds != null ? `${p.beds} bed` : null, p.propertyType].filter(Boolean).join(' · '),
    }));
    const first = units[0];
    if (first?.lastTransactionValue != null) {
      assets.push({ label: 'Last sale', value: `${fmtAed(first.lastTransactionValue)} · ${fmtDate(first.lastTransactionDate)}` });
    }
    if (first?.sizeSqft != null) {
      assets.push({ label: 'Size', value: fmtArea(first.sizeSqft) });
    }
    return {
      id: g.key,
      name: g.owner.name || 'Unknown owner',
      flag: flagFor(g.owner.nationality),
      buyer: false,
      phone: g.owner.phone,
      subtitle: `${units.length} unit${units.length === 1 ? '' : 's'} · ${g.areaSummary}`,
      assetsTitle: `Assets (${units.length})`,
      assets,
      state: first?.state ?? PropertyState.assigned,
      note: units.map(p => p.assignmentNote).find(Boolean),
      history: history(vault, vault.callsFor(g.propertyIds)),
      log: (outcome, note, followUpAt) => vault.logCall(units, brokerId, outcome, note, followUpAt),
    } as CallStop;
  });
}

/** One stop per callable buyer lead. */
export function leadCallStops(vault: Vault, brokerId: string): CallStop[] {
  const mine = vault.leadsOf(brokerId).filter(l => l.callable &&
    (l.state === PropertyState.assigned || l.state === PropertyState.portfolio));
  return mine.map((l: Lead) => {
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
      log: (outcome, note, followUpAt) => vault.logLeadCall(l, brokerId, outcome, note, followUpAt),
    } as CallStop;
  });
}
