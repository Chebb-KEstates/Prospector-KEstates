import React, { useMemo, useState } from 'react';
import { Property, PropertyState, PropertyStateLabel, CallOutcome, CallOutcomeLabel } from '../../types/models';
import { Icon } from './Icon';
import { useVault } from '../../state/VaultContext';

/**
 * Shared filter building-blocks for the property tables.
 *
 * The main data table (`PropertyTable`) uses these primitives to drive a SERVER
 * query. The drill-down popup (`UnitsDrilldownPopup`) uses `useClientPropertyFilters`
 * to run the SAME filter set over an already-loaded list in memory — so a manager
 * gets the identical "Filters" button everywhere, on the pop-up lists too.
 */

/** A labelled control inside the Filters popover. */
export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  );
}

/** A min–max pair of number inputs — the price / size / plot bands. */
export function NumberRange({ from, to, setFrom, setTo }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const box = { flex: 1, minWidth: 0, padding: '5px 8px' } as React.CSSProperties;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input className="input" type="number" min={0} placeholder="Min" style={box} value={from} onChange={e => setFrom(e.target.value)} />
      <span style={{ color: 'var(--text-tertiary)' }}>–</span>
      <input className="input" type="number" min={0} placeholder="Max" style={box} value={to} onChange={e => setTo(e.target.value)} />
    </div>
  );
}

export type CalledPeriod = '' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';
export const CALLED_PERIODS: { key: CalledPeriod; label: string }[] = [
  { key: '', label: 'Called: any time' },
  { key: 'today', label: 'Called today' },
  { key: 'yesterday', label: 'Called yesterday' },
  { key: 'thisWeek', label: 'Called this week' },
  { key: 'lastWeek', label: 'Called last week' },
  { key: 'thisMonth', label: 'Called this month' },
  { key: 'lastMonth', label: 'Called last month' },
];

/**
 * The [from, to) UTC bounds for a "called within" period, computed from the
 * caller's LOCAL calendar (week starts Monday, Dubai's work week) so the edges
 * follow the broker's day/week/month rather than the server's. `last_called_at`
 * is stored UTC, so the ISO bounds compare directly.
 */
export function calledRange(period: CalledPeriod): { from?: string; to?: string } {
  if (!period) return {};
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (startOfDay.getDay() + 6) % 7; // Mon=0 … Sun=6
  const shift = (d: Date, days: number) => { const n = new Date(d); n.setDate(n.getDate() + days); return n; };
  const iso = (d: Date) => d.toISOString();
  switch (period) {
    case 'today':     return { from: iso(startOfDay), to: iso(shift(startOfDay, 1)) };
    case 'yesterday': return { from: iso(shift(startOfDay, -1)), to: iso(startOfDay) };
    case 'thisWeek': {
      const from = shift(startOfDay, -dow);
      return { from: iso(from), to: iso(shift(from, 7)) };
    }
    case 'lastWeek': {
      const thisWeek = shift(startOfDay, -dow);
      return { from: iso(shift(thisWeek, -7)), to: iso(thisWeek) };
    }
    case 'thisMonth':
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
               to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 1)) };
    case 'lastMonth':
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
               to: iso(new Date(now.getFullYear(), now.getMonth(), 1)) };
  }
  return {};
}

/**
 * The full filter set, applied CLIENT-SIDE to an already-loaded `Property[]`.
 *
 * This mirrors the server's `buildWhere` (see server/src/repositories/propertyRepo.ts)
 * field-for-field so a pop-up list filters exactly like the main tables — the same
 * Search + State inline, the same "Filters" popover behind one button, the same
 * meaning for tenancy / called-within / follow-up / bands. The dropdowns only
 * offer values that are actually present in the loaded list (its own facets), and
 * a field with nothing to choose is hidden. Returns the filtered `rows`, the
 * ready-to-render `bar`, and whether anything is currently narrowing the list.
 */
export function useClientPropertyFilters(all: Property[]): {
  rows: Property[]; bar: React.ReactNode; filtered: boolean;
} {
  const { userById } = useVault();

  const [search, setSearch] = useState('');
  const [state, setState] = useState<PropertyState | ''>('');
  const [community, setCommunity] = useState('');
  const [cluster, setCluster] = useState('');
  const [beds, setBeds] = useState('');
  const [nationality, setNationality] = useState('');
  const [outcome, setOutcome] = useState('');
  const [propertyType, setPropertyType] = useState('');
  const [contact, setContact] = useState<'' | 'has' | 'none'>('');
  const [tenancy, setTenancy] = useState<'' | 'vacant' | 'rented' | 'leaseSoon'>('');
  const [calledPeriod, setCalledPeriod] = useState<CalledPeriod>('');
  const [followUp, setFollowUp] = useState<'' | 'scheduled' | 'due'>('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  const [valueFrom, setValueFrom] = useState('');
  const [valueTo, setValueTo] = useState('');
  const [sizeFrom, setSizeFrom] = useState('');
  const [sizeTo, setSizeTo] = useState('');
  const [plotFrom, setPlotFrom] = useState('');
  const [plotTo, setPlotTo] = useState('');
  const [hasNotes, setHasNotes] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Facets from the loaded list — only offer values that are actually present.
  const facets = useMemo(() => {
    const uniq = (vals: (string | undefined | null)[]) =>
      Array.from(new Set(vals.filter((v): v is string => !!v && v !== ''))).sort();
    const clusterPool = all.filter(p => !community || p.community === community);
    return {
      states: Array.from(new Set(all.map(p => p.state))).sort() as PropertyState[],
      communities: uniq(all.map(p => p.community)),
      clusters: uniq(clusterPool.map(p => p.cluster)),
      beds: Array.from(new Set(all.map(p => p.beds).filter((b): b is number => b != null))).sort((a, b) => a - b),
      types: uniq(all.map(p => p.propertyType)),
      nationalities: uniq(all.map(p => p.owner.nationality)),
      outcomes: Array.from(new Set(all.map(p => p.lastOutcome).filter((o): o is CallOutcome => !!o))).sort() as CallOutcome[],
      assignees: Array.from(new Set(all.map(p => p.assignedTo).filter((a): a is string => !!a))),
    };
  }, [all, community]);

  const num = (s: string) => { const n = parseFloat(s); return s.trim() && !isNaN(n) ? n : undefined; };
  const called = calledRange(calledPeriod);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const vFrom = num(valueFrom), vTo = num(valueTo);
    const sFrom = num(sizeFrom), sTo = num(sizeTo);
    const pFrom = num(plotFrom), pTo = num(plotTo);
    const now = Date.now();
    const calledFrom = called.from ? new Date(called.from).getTime() : undefined;
    const calledTo = called.to ? new Date(called.to).getTime() : undefined;
    const txFromT = txFrom ? new Date(txFrom).getTime() : undefined;
    // Exclusive next-day upper bound, matching the server's "on or before this date".
    const txToT = txTo ? new Date(txTo).getTime() + 24 * 3600_000 : undefined;

    // Tenancy mirrors the server: rent_end / rent_amount, plus the imported
    // "Rental status" text, decide rented vs vacant; leaseSoon = lease ends ≤ 90d.
    const matchTenancy = (p: Property): boolean => {
      if (!tenancy) return true;
      const status = (p.extra?.['Rental status'] ?? '').toLowerCase();
      const rented = p.rentEnd != null || p.rentAmount != null || /new|renew|rented|leased|tenant/.test(status);
      if (tenancy === 'vacant') return /no rental|vacant/.test(status) || !rented;
      if (tenancy === 'rented') return rented;
      // leaseSoon
      if (!p.rentEnd) return false;
      const t = new Date(p.rentEnd).getTime();
      return t >= now && t <= now + 90 * 86400_000;
    };

    return all.filter(p => {
      if (state && p.state !== state) return false;
      if (community && p.community !== community) return false;
      if (cluster && (p.cluster ?? '') !== cluster) return false;
      if (beds && p.beds !== parseInt(beds, 10)) return false;
      if (nationality && p.owner.nationality !== nationality) return false;
      if (propertyType && p.propertyType !== propertyType) return false;
      if (outcome) {
        if (outcome === 'none') { if (p.lastOutcome != null) return false; }
        else if (p.lastOutcome !== outcome) return false;
      }
      if (assigneeFilter && p.assignedTo !== assigneeFilter) return false;
      if (contact === 'has' && !p.callable) return false;
      if (contact === 'none' && p.callable) return false;
      if (!matchTenancy(p)) return false;
      if (followUp === 'scheduled' && !p.nextFollowUpAt) return false;
      if (followUp === 'due' && !(p.nextFollowUpAt && new Date(p.nextFollowUpAt).getTime() <= now)) return false;
      if (hasNotes && !(p.notes && p.notes.trim() !== '')) return false;

      if (calledFrom != null || calledTo != null) {
        if (!p.lastCalledAt) return false;
        const t = new Date(p.lastCalledAt).getTime();
        if (calledFrom != null && t < calledFrom) return false;
        if (calledTo != null && t >= calledTo) return false;
      }
      if (txFromT != null || txToT != null) {
        if (!p.lastTransactionDate) return false;
        const t = new Date(p.lastTransactionDate).getTime();
        if (txFromT != null && t < txFromT) return false;
        if (txToT != null && t >= txToT) return false;
      }
      // Bands — a NULL value never matches a set bound, exactly like the SQL.
      if (vFrom != null && !(p.lastTransactionValue != null && p.lastTransactionValue >= vFrom)) return false;
      if (vTo != null && !(p.lastTransactionValue != null && p.lastTransactionValue <= vTo)) return false;
      if (sFrom != null && !(p.sizeSqft != null && p.sizeSqft >= sFrom)) return false;
      if (sTo != null && !(p.sizeSqft != null && p.sizeSqft <= sTo)) return false;
      if (pFrom != null && !(p.plotSqft != null && p.plotSqft >= pFrom)) return false;
      if (pTo != null && !(p.plotSqft != null && p.plotSqft <= pTo)) return false;

      if (q) {
        const hay = [p.community, p.cluster, p.building, p.unitNumber, p.plotNumber, p.owner.name]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, search, state, community, cluster, beds, nationality, propertyType, outcome,
      assigneeFilter, contact, tenancy, followUp, hasNotes,
      called.from, called.to, txFrom, txTo, valueFrom, valueTo, sizeFrom, sizeTo, plotFrom, plotTo]);

  // How many of the "secondary" filters (everything behind the Filters button)
  // are active — shown as a count so a hidden filter is never forgotten.
  const secondaryCount =
    (community ? 1 : 0) + (cluster ? 1 : 0) + (beds ? 1 : 0) + (nationality ? 1 : 0) +
    (outcome ? 1 : 0) + (assigneeFilter ? 1 : 0) + (tenancy ? 1 : 0) + (calledPeriod ? 1 : 0) +
    ((txFrom || txTo) ? 1 : 0) + (contact ? 1 : 0) + (propertyType ? 1 : 0) +
    ((valueFrom || valueTo) ? 1 : 0) + ((sizeFrom || sizeTo) ? 1 : 0) + ((plotFrom || plotTo) ? 1 : 0) +
    (followUp ? 1 : 0) + (hasNotes ? 1 : 0);
  const anyFilter = !!(search.trim() || state || secondaryCount > 0);

  const clearAll = () => {
    setSearch(''); setState(''); setCommunity(''); setCluster(''); setBeds('');
    setNationality(''); setOutcome(''); setPropertyType(''); setContact(''); setTenancy('');
    setCalledPeriod(''); setFollowUp(''); setAssigneeFilter('');
    setTxFrom(''); setTxTo(''); setValueFrom(''); setValueTo(''); setSizeFrom(''); setSizeTo('');
    setPlotFrom(''); setPlotTo(''); setHasNotes(false);
  };

  const sel = { display: 'inline-block', width: 'auto', minWidth: 130, padding: '6px 10px' } as React.CSSProperties;
  const selFull = { width: '100%', padding: '6px 10px' } as React.CSSProperties;

  const bar = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
        <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
        <input className="input" style={{ width: '100%', paddingLeft: 30 }} placeholder="Search unit, plot, owner…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      {facets.states.length > 1 && (
        <select className="input" style={sel} value={state} onChange={e => setState(e.target.value as PropertyState | '')}>
          {/* Portfolio is hidden for now — those units read as "Assigned". */}
          <option value="">All states</option>
          {facets.states.filter(s => s !== PropertyState.portfolio).map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
        </select>
      )}
      <div style={{ position: 'relative' }}>
        <button className={`btn btn-sm ${secondaryCount > 0 ? 'btn-primary' : ''}`} onClick={() => setShowFilters(s => !s)}>
          <Icon name="sliders" size={14} /> Filters{secondaryCount > 0 ? ` · ${secondaryCount}` : ''}
        </button>
        {showFilters && (
          <>
            <div onClick={() => setShowFilters(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
            {/* Anchored to the button's RIGHT edge (it sits on the right of the
                pop-up's bar, after the flexible search box) so the panel opens
                leftward and stays inside the modal instead of overflowing off-screen. */}
            <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 61, width: 'min(300px, 86vw)',
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
              padding: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', gap: 10,
              maxHeight: 'min(60vh, 520px)', overflowY: 'auto',
            }}>
              {facets.communities.length > 0 && (
                <FilterField label="Community">
                  <select className="input" style={selFull} value={community} onChange={e => { setCommunity(e.target.value); setCluster(''); }}>
                    <option value="">All communities</option>{facets.communities.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FilterField>
              )}
              {facets.clusters.length > 0 && (
                <FilterField label="Sub-community">
                  <select className="input" style={selFull} value={cluster} onChange={e => setCluster(e.target.value)}>
                    <option value="">All sub-communities</option>{facets.clusters.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </FilterField>
              )}
              {facets.beds.length > 0 && (
                <FilterField label="Bedrooms">
                  <select className="input" style={selFull} value={beds} onChange={e => setBeds(e.target.value)}>
                    <option value="">Any beds</option>{facets.beds.map(b => <option key={b} value={b}>{b} BR</option>)}
                  </select>
                </FilterField>
              )}
              {facets.types.length > 0 && (
                <FilterField label="Property type">
                  <select className="input" style={selFull} value={propertyType} onChange={e => setPropertyType(e.target.value)}>
                    <option value="">Any type</option>{facets.types.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FilterField>
              )}
              <FilterField label="Size (BUA, sqft)">
                <NumberRange from={sizeFrom} to={sizeTo} setFrom={setSizeFrom} setTo={setSizeTo} />
              </FilterField>
              <FilterField label="Plot size (sqft)">
                <NumberRange from={plotFrom} to={plotTo} setFrom={setPlotFrom} setTo={setPlotTo} />
              </FilterField>
              {facets.nationalities.length > 0 && (
                <FilterField label="Nationality">
                  <select className="input" style={selFull} value={nationality} onChange={e => setNationality(e.target.value)}>
                    <option value="">All nationalities</option>{facets.nationalities.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </FilterField>
              )}
              {facets.outcomes.length > 0 && (
                <FilterField label="Last outcome">
                  <select className="input" style={selFull} value={outcome} onChange={e => setOutcome(e.target.value)}>
                    <option value="">All outcomes</option><option value="none">Not called yet</option>
                    {facets.outcomes.map(o => <option key={o} value={o}>{CallOutcomeLabel[o]}</option>)}
                  </select>
                </FilterField>
              )}
              {facets.assignees.length > 1 && (
                <FilterField label="Assigned to">
                  <select className="input" style={selFull} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
                    <option value="">All brokers</option>{facets.assignees.map(id => <option key={id} value={id}>{userById(id)?.name ?? '—'}</option>)}
                  </select>
                </FilterField>
              )}
              <FilterField label="Tenancy">
                <select className="input" style={selFull} value={tenancy} onChange={e => setTenancy(e.target.value as typeof tenancy)}>
                  <option value="">Any tenancy</option>
                  <option value="vacant">Vacant</option>
                  <option value="rented">Rented</option>
                  <option value="leaseSoon">Lease ending ≤ 90d</option>
                </select>
              </FilterField>
              <FilterField label="Last call">
                <select className="input" style={selFull} value={calledPeriod} onChange={e => setCalledPeriod(e.target.value as CalledPeriod)}>
                  {CALLED_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </FilterField>
              <FilterField label="Follow-up">
                <select className="input" style={selFull} value={followUp} onChange={e => setFollowUp(e.target.value as typeof followUp)}>
                  <option value="">Any follow-up</option>
                  <option value="scheduled">Has a follow-up scheduled</option>
                  <option value="due">Follow-up due now</option>
                </select>
              </FilterField>
              <FilterField label="Purchased between">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input className="input" type="date" style={{ flex: 1, minWidth: 0, padding: '5px 8px' }} value={txFrom} onChange={e => setTxFrom(e.target.value)} />
                  <span style={{ color: 'var(--text-tertiary)' }}>–</span>
                  <input className="input" type="date" style={{ flex: 1, minWidth: 0, padding: '5px 8px' }} value={txTo} onChange={e => setTxTo(e.target.value)} />
                </div>
              </FilterField>
              <FilterField label="Last-sale price (AED)">
                <NumberRange from={valueFrom} to={valueTo} setFrom={setValueFrom} setTo={setValueTo} />
              </FilterField>
              <FilterField label="Contact info">
                <select className="input" style={selFull} value={contact} onChange={e => setContact(e.target.value as typeof contact)}>
                  <option value="">Any</option>
                  <option value="has">Has a number</option>
                  <option value="none">No number</option>
                </select>
              </FilterField>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8125rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={hasNotes} onChange={() => setHasNotes(v => !v)} />
                Has a note
              </label>
              {anyFilter && (
                <button className="btn btn-sm btn-ghost" onClick={() => { clearAll(); setShowFilters(false); }} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Icon name="x" size={13} /> Clear all filters
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {anyFilter && <button className="btn btn-sm btn-ghost" onClick={clearAll}><Icon name="x" size={14} /> Clear</button>}
    </div>
  );

  return { rows, bar, filtered: rows.length !== all.length };
}
