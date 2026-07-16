import {
  DataSet, DataSetType, DataModule, Property, Lead, OwnerInfo, CallLog,
  PropertyState, CallOutcome, AuditEntry, kOrgId,
} from '../types/models';
import { vaultRepo } from './vaultRepository';

/**
 * Synthetic demo data so the app is demonstrable out of the box (his live build
 * showed all-zeros). Everything here is INVENTED — no real owner data. Seeded
 * once, on first load of an empty vault. Deterministic so it's stable per browser.
 */

// Tiny seeded PRNG (mulberry32) for stable output.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMUNITIES = ['Dubai Hills Estate', 'Downtown Dubai', 'Dubai Marina', 'Arabian Ranches'];
const CLUSTERS: Record<string, string[]> = {
  'Dubai Hills Estate': ['Maple', 'Sidra', 'Golf Place'],
  'Downtown Dubai': ['Burj Views', 'The Residences', 'Boulevard'],
  'Dubai Marina': ['Marina Gate', 'Bluewaters', 'Silverene'],
  'Arabian Ranches': ['Palma', 'Alvorada', 'Saheel'],
};
const TYPES = ['Apartment', 'Villa', 'Townhouse'];
const FIRST = ['Amir', 'Layla', 'Rohan', 'Fatima', 'James', 'Priya', 'Karim', 'Sofia', 'Wei', 'Nadia', 'Tom', 'Aisha', 'Sergei', 'Maria', 'Omar', 'Elena'];
const LAST = ['Haddad', 'Sharma', 'Okonkwo', 'Al Fahim', 'Whitfield', 'Nair', 'Rahimi', 'Rossi', 'Chen', 'Petrova', 'Bakr', 'Volkov', 'Costa', 'Yusuf'];
const NATIONS = ['India', 'UK', 'UAE', 'Egypt', 'Russia', 'Pakistan', 'China', 'Lebanon', 'France', 'Canada'];
const PROJECTS = ['Emaar Beachfront', 'Creek Harbour', 'Sobha Hartland', 'DAMAC Hills', 'Business Bay'];
const SOURCES = ['Property Finder', 'Bayut', 'Website form', 'Instagram ad', 'Walk-in'];

function phone(r: () => number): string {
  const prefix = ['50', '52', '54', '55', '56'][Math.floor(r() * 5)];
  let n = '';
  for (let i = 0; i < 7; i++) n += Math.floor(r() * 10);
  return `+971${prefix}${n}`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export async function seedDemoData(): Promise<void> {
  const r = rng(20260716);
  const now = new Date().toISOString();

  // ── Owners dataset ──
  const properties: Property[] = [];
  const calls: CallLog[] = [];
  let unitSeq = 100;

  const OWNERS = 16;
  for (let o = 0; o < OWNERS; o++) {
    const name = `${FIRST[o % FIRST.length]} ${LAST[o % LAST.length]}`;
    const noPhone = o % 6 === 5;            // ~3 owners with no phone → non-callable
    const owner = new OwnerInfo(name, noPhone ? undefined : phone(r), NATIONS[Math.floor(r() * NATIONS.length)]);
    const community = COMMUNITIES[Math.floor(r() * COMMUNITIES.length)];
    const cluster = CLUSTERS[community][Math.floor(r() * CLUSTERS[community].length)];
    const units = 1 + Math.floor(r() * 3);   // 1–3 units per owner

    // Decide this owner's disposition
    const roll = r();
    let state = PropertyState.pool;
    let assignedTo: string | undefined;
    let lastOutcome: CallOutcome | undefined;
    let lastCalledAt: string | undefined;
    let portfolioSince: string | undefined;
    let nextFollowUpAt: string | undefined;

    if (!noPhone) {
      if (roll < 0.34) { state = PropertyState.assigned; assignedTo = o % 2 === 0 ? 'u-sara' : 'u-omar'; }
      else if (roll < 0.5) { state = PropertyState.portfolio; assignedTo = o % 2 === 0 ? 'u-sara' : 'u-omar'; lastOutcome = r() < 0.5 ? CallOutcome.interestedSell : CallOutcome.interestedRent; lastCalledAt = isoDaysAgo(Math.floor(r() * 12)); portfolioSince = lastCalledAt; }
      else if (roll < 0.6) { state = PropertyState.cooling; lastOutcome = CallOutcome.notInterested; lastCalledAt = isoDaysAgo(Math.floor(r() * 10)); }
      else if (roll < 0.66) { state = PropertyState.dnc; lastOutcome = CallOutcome.dnc; lastCalledAt = isoDaysAgo(Math.floor(r() * 20)); }
    }

    // A few assigned owners have a pending follow-up
    if (state === PropertyState.assigned && r() < 0.4) {
      lastOutcome = CallOutcome.callbackLater;
      lastCalledAt = isoDaysAgo(1 + Math.floor(r() * 4));
      nextFollowUpAt = isoDaysAgo(-1 - Math.floor(r() * 3)); // due soon / overdue
    }

    const groupIds: string[] = [];
    for (let u = 0; u < units; u++) {
      const id = `demo-p-${o}-${u}`;
      groupIds.push(id);
      const p = new Property(
        id, kOrgId, 'demo-ds-owners', state,
        `uk-${unitSeq}`, community, cluster,
        `${cluster} Tower ${1 + (o % 4)}`, `${unitSeq}`, undefined,
        TYPES[Math.floor(r() * TYPES.length)],
        1 + Math.floor(r() * 4),                    // beds
        700 + Math.floor(r() * 2500),               // sizeSqft
        undefined,
        isoDaysAgo(90 + Math.floor(r() * 900)),     // lastTransactionDate
        1_200_000 + Math.floor(r() * 6_000_000),    // lastTransactionValue
        1 + Math.floor(r() * 3),
        undefined, undefined, undefined,
        owner, now,
      );
      p.state = state;
      p.assignedTo = assignedTo;
      p.assignedAt = assignedTo ? isoDaysAgo(2 + Math.floor(r() * 8)) : undefined;
      p.lastOutcome = lastOutcome;
      p.lastCalledAt = lastCalledAt;
      p.portfolioSince = portfolioSince;
      p.nextFollowUpAt = nextFollowUpAt;
      unitSeq++;
      properties.push(p);
    }

    // A matching call-history entry for worked owners
    if (lastCalledAt && lastOutcome) {
      calls.push(new CallLog(`demo-c-${o}`, kOrgId, groupIds, [], assignedTo ?? 'u-sara', lastCalledAt, lastOutcome,
        lastOutcome === CallOutcome.callbackLater ? 'Asked to call back next week.' : undefined, nextFollowUpAt));
    }
  }

  const callable = properties.filter(p => p.callable).length;
  const ownersDs = new DataSet(
    'demo-ds-owners', 'Dubai Hills & Marina register (demo)', 'Demo vendor',
    DataSetType.register, DataModule.owners, 'demo_owners.xlsx',
    'Multiple communities', now, 18000, properties.length, callable, 0,
  );

  // ── Leads dataset ──
  const leads: Lead[] = [];
  for (let i = 0; i < 12; i++) {
    const name = `${FIRST[(i + 3) % FIRST.length]} ${LAST[(i + 5) % LAST.length]}`;
    const assigned = i < 6;
    const l = new Lead(
      `demo-l-${i}`, kOrgId, 'demo-ds-leads',
      isoDaysAgo(Math.floor(r() * 20)), name, phone(r),
      `${name.split(' ')[0].toLowerCase()}@example.com`,
      PROJECTS[Math.floor(r() * PROJECTS.length)],
      SOURCES[Math.floor(r() * SOURCES.length)],
      { Budget: `AED ${(1 + Math.floor(r() * 5))}M`, Bedrooms: `${1 + Math.floor(r() * 3)}` },
      now, assigned ? PropertyState.assigned : PropertyState.pool,
    );
    if (assigned) { l.assignedTo = i % 2 === 0 ? 'u-sara' : 'u-omar'; l.assignedAt = isoDaysAgo(1 + Math.floor(r() * 5)); }
    leads.push(l);
  }
  const leadsDs = new DataSet(
    'demo-ds-leads', 'Portal enquiries — March (demo)', 'Demo portals',
    DataSetType.register, DataModule.leads, 'demo_leads.xlsx',
    'Buyer leads', now, 4000, leads.length, leads.filter(l => l.callable).length, 0,
  );

  // ── Extra momentum: scatter no-answer calls across the last 14 days ──
  for (let d = 0; d < 20; d++) {
    const day = Math.floor(r() * 14);
    const broker = r() < 0.5 ? 'u-sara' : 'u-omar';
    const outcome = r() < 0.6 ? CallOutcome.noAnswer : r() < 0.8 ? CallOutcome.notInterested : CallOutcome.interestedSell;
    calls.push(new CallLog(`demo-mc-${d}`, kOrgId, [`demo-p-${d % OWNERS}-0`], [], broker, isoDaysAgo(day), outcome));
  }

  // ── Persist ──
  await vaultRepo.commitImport(ownersDs, properties);
  await vaultRepo.commitLeadImport(leadsDs, leads);
  for (const c of calls) await vaultRepo.saveCall(c);
  await vaultRepo.saveAudit(new AuditEntry('demo-a-0', kOrgId, now, 'u-director', 'import', 'Imported "Dubai Hills & Marina register (demo)"'));
}
