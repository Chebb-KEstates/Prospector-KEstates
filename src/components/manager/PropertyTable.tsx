import React, { useState, useMemo, useEffect } from 'react';
import { Property, PropertyState, PropertyStateLabel, CallOutcomeLabel } from '../../types/models';
import { StateChip, OutcomeChip, CountdownBadge } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { useTableLayout, ColumnsDialog } from '../common/tableLayout';
import { usePropertyPage, usePropertyFacetsOrEmpty } from '../../data/hooks';
import { useVault } from '../../state/VaultContext';
import { fmtDate, fmtDateTime, fmtAed, fmtArea, fmtInt, splitOwnerNames } from '../../utils/format';

/**
 * THE data table — the platform's foundation. One spreadsheet renders the vault
 * and every broker list, with the controls around it: a full filter bar, click-
 * to-sort headers, user-controlled columns (show/hide + drag-reorder, remembered
 * per screen), a density toggle, multi-select, pagination, and security modes
 * (teaser / hideOwner). Columns adapt to the data: any unmapped upload fields
 * (`extra`) become toggleable columns.
 *
 * ── Now server-backed ──────────────────────────────────────────────────────
 * It used to take `properties: Property[]` and filter/sort/paginate that array
 * in memory. It now owns a query and asks the server, because the whole vault no
 * longer lives in the browser. Two consequences to keep in mind when editing:
 *
 *  - `total` is the count of ALL matching rows, not `rows.length`. The footer
 *    shows the former; the page shows the latter.
 *  - Select-all ticks the CURRENT PAGE only. It cannot mean "all 40,000
 *    matches" any more, because we don't have them — and silently assigning
 *    40,000 units from one checkbox would be a bad thing to make easy.
 *
 * `phone` on any row is the MASK, computed server-side. There is no real number
 * in this component, by construction.
 */

type ColKey = string; // fixed keys below, plus `extra:<header>`
const PINNED: ColKey = 'unit';

interface ColDef {
  key: ColKey;
  label: string;
  flex: number;
  ownerData?: boolean;
  numeric?: boolean;
  /** Server sort key; absent means the column isn't sortable. */
  sortable?: boolean;
  render: (p: Property) => React.ReactNode;
}

function baseCols(soonHours: number): ColDef[] {
  return [
    {
      key: 'owner', label: 'Owner', flex: 3, ownerData: true, sortable: true,
      // A single cell can name several co-owners ("A & B") — show them, and flag
      // the count so it reads as two owners, not one long name.
      render: p => {
        const names = p.hasMultipleOwners ? p.allOwners.map(o => o.name) : splitOwnerNames(p.owner.name);
        if (names.length <= 1) return p.owner.name || '—';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0 }} title={names.join(' · ')}>
            <span className="truncate">{names.join(' · ')}</span>
            <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', fontSize: '0.65rem', padding: '1px 6px', flexShrink: 0 }}>
              {names.length} owners
            </span>
          </span>
        );
      },
    },
    {
      key: 'mobile', label: 'Mobile', flex: 2, ownerData: true, sortable: true,
      // Already masked by the server. `callable` still works because the mask is
      // a non-empty string exactly when a real number exists. The "+N" badge says
      // an owner has more numbers on record without revealing any of them.
      render: p => {
        const extras = p.owner.allPhones.length - 1;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span className="tabular-nums" style={{ color: p.callable ? 'var(--text)' : 'var(--text-tertiary)' }}>
              {p.owner.phone ?? '—'}
            </span>
            {extras > 0 && (
              <span className="chip"
                title={`${p.owner.allPhones.length} numbers on record: ${p.owner.allPhones.map(x => x.label).join(', ')}`}
                style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', fontSize: '0.65rem', padding: '1px 6px' }}>
                +{extras}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'nationality', label: 'Nationality', flex: 2, ownerData: true, sortable: true,
      render: p => p.owner.nationality
        ? <span style={{ color: 'var(--text-secondary)' }}>{p.owner.nationality}</span>
        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>,
    },
    { key: 'beds', label: 'Beds', flex: 1, numeric: true, sortable: true, render: p => p.beds ?? '—' },
    { key: 'size', label: 'Size (BUA)', flex: 2, numeric: true, sortable: true, render: p => fmtArea(p.sizeSqft) },
    { key: 'plotSize', label: 'Plot size', flex: 2, numeric: true, sortable: true, render: p => fmtArea(p.plotSqft) },
    { key: 'type', label: 'Type', flex: 2, sortable: true, render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.propertyType ?? '—'}</span> },
    {
      key: 'lastTx', label: 'Last transaction', flex: 2, sortable: true,
      render: p => p.lastTransactionValue != null
        ? <span>{fmtDate(p.lastTransactionDate)}<span style={{ color: 'var(--text-tertiary)' }}> · {fmtAed(p.lastTransactionValue)}</span></span>
        : fmtDate(p.lastTransactionDate),
    },
    {
      key: 'tenancy', label: 'Tenancy', flex: 3, sortable: true,
      render: p => (p.rentEnd == null && p.rentAmount == null)
        ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
        : <span style={{ color: 'var(--text-secondary)' }}>until {fmtDate(p.rentEnd)}{p.rentAmount != null ? ` · ${fmtAed(p.rentAmount)}/yr` : ''}</span>,
    },
    { key: 'outcome', label: 'Outcome', flex: 2, sortable: true, render: p => p.lastOutcome ? <OutcomeChip outcome={p.lastOutcome} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span> },
    { key: 'calledAt', label: 'Last call', flex: 2, sortable: true, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(p.lastCalledAt)}</span> },
    { key: 'followUp', label: 'Follow-up', flex: 2, sortable: true, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(p.nextFollowUpAt)}</span> },
    { key: 'attempts', label: 'Attempts', flex: 1, numeric: true, sortable: true, render: p => p.callAttempts || <span style={{ color: 'var(--text-tertiary)' }}>—</span> },
    { key: 'assignedAt', label: 'Assigned on', flex: 2, sortable: true, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(p.assignedAt)}</span> },
    { key: 'createdAt', label: 'Added', flex: 2, sortable: true, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(p.createdAt)}</span> },
    {
      // Broker/manager notes can name the owner, so this rides with the owner
      // columns — hidden in the teaser/hide-owner views like the rest.
      key: 'notes', label: 'Notes', flex: 3, ownerData: true,
      render: p => p.notes
        ? <span className="truncate" title={p.notes} style={{ color: 'var(--text-secondary)' }}>{p.notes}</span>
        : <span style={{ color: 'var(--text-tertiary)' }}>—</span>,
    },
    {
      key: 'state', label: 'State', flex: 2, sortable: true,
      // The assignment timer rides alongside the state so a manager scanning the
      // column sees both what a unit is and how long the broker has left on it.
      render: p => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <StateChip state={p.state} />
          <CountdownBadge deadline={p.assignmentExpiresAt} soonHours={soonHours} />
        </span>
      ),
    },
  ];
}

const DEFAULT_VISIBLE = {
  normal: ['owner', 'mobile', 'beds', 'size', 'lastTx', 'state'],
  teaser: ['beds', 'size', 'type', 'lastTx', 'state'],
  hideOwner: ['beds', 'size', 'outcome', 'calledAt', 'followUp', 'state'],
};

interface Props {
  /** Which slice of the vault this table shows. */
  scope?: 'all' | 'mine' | 'pool';
  assignedTo?: string;
  datasetId?: string;
  /** Lock the table to one state (e.g. the Assignments "Pool" tab). */
  fixedState?: PropertyState;
  /**
   * Filters imposed by the surrounding screen rather than the filter bar — the
   * broker's quick chips. When one is set its dropdown is hidden, so the UI
   * can't show two competing answers to the same question.
   */
  forcedOutcome?: string;
  dueOnly?: boolean;
  interestedOnly?: boolean;
  /** Held units within the "expiring soon" window — the broker's timer chip. */
  expiringSoon?: boolean;
  /** Broker's own view: also show the cooled-off / do-not-call units they hold
   *  (the "All" chip). Omitted = the actionable "To call" set. */
  includeInactive?: boolean;
  /** Row click. `orderedIds` is the current page's units in view order, so the
   *  popup can offer "Next property". */
  onSelect?: (id: string, orderedIds: string[]) => void;
  selectedId?: string;
  teaser?: boolean;
  hideOwner?: boolean;
  prefsKey?: string;
  checkedIds?: Set<string>;
  onCheckedChanged?: (ids: Set<string>) => void;
  /** Fired when the user changes a filter (not sort/paging) — lets the owner
   *  clear a stale multi-select that no longer matches what's on screen. */
  onFiltersChange?: () => void;
  /** Extra controls rendered INSIDE the sticky filter header, next to Filters —
   *  e.g. the broker's quick chips, so they stay pinned while scrolling too. */
  headerExtra?: React.ReactNode;
  /** Pixels to offset the sticky filter bar down by — the height of a sticky page
   *  header above it, so both stay pinned without overlapping. */
  stickyTop?: number;
  /** Manager view: show the "Assigned to" column and a filter-by-broker control. */
  showAssignee?: boolean;
  /**
   * Restrict the SELECTABLE columns to this allowlist of keys — the column picker
   * offers only these, and they're all shown by default. "Unit" is always shown.
   * Used to give the broker Pool a fixed, focused column set.
   */
  allowColumns?: string[];
}

const PAGE_SIZES = [10, 25, 50, 100, 250];

/** A labelled control inside the Filters popover. */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  );
}

/** A min–max pair of number inputs — the price / size / plot bands. */
function NumberRange({ from, to, setFrom, setTo }: {
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

type CalledPeriod = '' | 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth';
const CALLED_PERIODS: { key: CalledPeriod; label: string }[] = [
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
function calledRange(period: CalledPeriod): { from?: string; to?: string } {
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

export function PropertyTable({
  scope, assignedTo, datasetId, fixedState,
  forcedOutcome, dueOnly, interestedOnly, expiringSoon, includeInactive,
  onSelect, selectedId, teaser, hideOwner, prefsKey,
  checkedIds, onCheckedChanged, onFiltersChange, headerExtra, stickyTop = 0, showAssignee, allowColumns,
}: Props) {
  const ownerHidden = !!teaser || !!hideOwner;
  const selectable = !!checkedIds && !!onCheckedChanged;
  const { brokers, userById, settings } = useVault();

  // ── Filters ──
  const [search, setSearch] = useState('');
  const [community, setCommunity] = useState('');
  const [cluster, setCluster] = useState('');
  const [state, setState] = useState<PropertyState | ''>('');
  const [beds, setBeds] = useState('');
  const [nationality, setNationality] = useState('');
  const [outcome, setOutcome] = useState('');
  const [txFrom, setTxFrom] = useState('');
  const [txTo, setTxTo] = useState('');
  // Contact-info filter: '' any · 'has' has a number (callable) · 'none' no number.
  const [contact, setContact] = useState<'' | 'has' | 'none'>('');
  const [tenancy, setTenancy] = useState<'' | 'vacant' | 'rented' | 'leaseSoon'>('');
  const [calledPeriod, setCalledPeriod] = useState<CalledPeriod>('');
  const [propertyType, setPropertyType] = useState('');
  const [valueFrom, setValueFrom] = useState('');
  const [valueTo, setValueTo] = useState('');
  const [sizeFrom, setSizeFrom] = useState('');
  const [sizeTo, setSizeTo] = useState('');
  const [plotFrom, setPlotFrom] = useState('');
  const [plotTo, setPlotTo] = useState('');
  const [followUp, setFollowUp] = useState<'' | 'scheduled' | 'due'>('');
  const [hasNotes, setHasNotes] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [sortKey, setSortKey] = useState<ColKey>(PINNED);
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [showCols, setShowCols] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  const facets = usePropertyFacetsOrEmpty(
    useMemo(() => ({ scope, assignedTo, datasetId, community }), [scope, assignedTo, datasetId, community]),
  );

  const called = calledRange(calledPeriod);
  // Blank / non-numeric text → undefined, so an empty band end drops out of the query.
  const num = (s: string) => { const n = parseFloat(s); return s.trim() && !isNaN(n) ? n : undefined; };
  const query = useMemo(() => ({
    scope,
    // A fixed `assignedTo` (broker views) wins; otherwise the manager's
    // filter-by-broker control drives it.
    assignedTo: assignedTo || assigneeFilter || undefined,
    datasetId,
    search: search.trim() || undefined,
    community: community || undefined,
    cluster: cluster || undefined,
    state: (fixedState ?? state) || undefined,
    beds: beds ? parseInt(beds, 10) : undefined,
    nationality: nationality || undefined,
    outcome: forcedOutcome ?? (outcome || undefined),
    dueOnly: dueOnly || undefined,
    interestedOnly: interestedOnly || undefined,
    expiringSoon: expiringSoon || undefined,
    includeInactive: includeInactive || undefined,
    txFrom: txFrom || undefined,
    txTo: txTo || undefined,
    callableOnly: contact === 'has' || undefined,
    noContactOnly: contact === 'none' || undefined,
    tenancy: tenancy || undefined,
    calledFrom: called.from,
    calledTo: called.to,
    propertyType: propertyType || undefined,
    valueFrom: num(valueFrom),
    valueTo: num(valueTo),
    sizeFrom: num(sizeFrom),
    sizeTo: num(sizeTo),
    plotFrom: num(plotFrom),
    plotTo: num(plotTo),
    followUp: followUp || undefined,
    hasNotes: hasNotes || undefined,
    sortKey: sortKey === PINNED ? undefined : sortKey,
    asc,
    page,
    pageSize,
  }), [scope, assignedTo, assigneeFilter, datasetId, search, community, cluster, fixedState, state,
       beds, nationality, outcome, forcedOutcome, dueOnly, interestedOnly, expiringSoon, includeInactive,
       txFrom, txTo, contact, tenancy, called.from, called.to,
       propertyType, valueFrom, valueTo, sizeFrom, sizeTo, plotFrom, plotTo, followUp, hasNotes,
       sortKey, asc, page, pageSize]);

  const { rows, total, loading, initialLoading, error } = usePropertyPage(query);

  // Dynamic upload columns come from the facets — they describe the whole scope,
  // so a column doesn't vanish just because this page's rows happen to lack it.
  const extraKeys = facets.extraKeys;

  /**
   * Labels of the ADDITIONAL numbers (Mobile 2, Mobile 3 …) — one toggleable,
   * masked column each, so every number an owner has is reachable in the table.
   *
   * Derived from the page rather than the facets, unlike `extraKeys` above:
   * these labels come from the upload's phone headers, so they're uniform across
   * a dataset rather than free-form per row. If that ever stops holding, add
   * phoneLabels to the facets endpoint and read it here instead.
   */
  const phoneLabels = useMemo(() => {
    const s = new Set<string>();
    for (const p of rows) {
      const list = p.owner.allPhones;
      for (let i = 1; i < list.length; i++) s.add(list[i].label);
    }
    return Array.from(s).sort();
  }, [rows]);

  const allCols = useMemo<ColDef[]>(() => {
    const cols = baseCols(settings.expiringSoonHours).filter(c => !(ownerHidden && c.ownerData));
    if (!ownerHidden) {
      for (const label of phoneLabels) {
        cols.push({
          key: `phone:${label}`, label, flex: 2, ownerData: true,
          // Masked server-side, like every other number in this table.
          render: p => {
            const e = p.owner.allPhones.find(x => x.label === label);
            return <span className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{e?.number ?? '—'}</span>;
          },
        });
      }
    }
    if (showAssignee) {
      cols.push({
        key: 'assignee', label: 'Assigned to', flex: 2,
        render: p => p.assignedTo
          ? <span>{userById(p.assignedTo)?.name ?? '—'}</span>
          : <span style={{ color: 'var(--text-tertiary)' }}>Unassigned</span>,
      });
    }
    for (const k of extraKeys) {
      cols.push({
        key: `extra:${k}`, label: k, flex: 2, sortable: true,
        render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.extra?.[k] ?? '—'}</span>,
      });
    }
    // A caller can pin the selectable set to a fixed allowlist (the broker Pool).
    return allowColumns ? cols.filter(c => allowColumns.includes(c.key)) : cols;
  }, [ownerHidden, extraKeys, phoneLabels, showAssignee, userById, settings.expiringSoonHours, allowColumns]);

  const unitCol: ColDef = useMemo(() => ({
    key: PINNED, label: 'Unit', flex: 3, sortable: true, render: () => null,
  }), []);
  const colByKey = useMemo(() => new Map([unitCol, ...allCols].map(c => [c.key, c])), [allCols, unitCol]);
  const available = useMemo(() => allCols.map(c => c.key), [allCols]);
  const defaultVisible = allowColumns ? available
    : teaser ? DEFAULT_VISIBLE.teaser
    : hideOwner ? DEFAULT_VISIBLE.hideOwner
    : showAssignee ? [...DEFAULT_VISIBLE.normal, 'assignee']
    : DEFAULT_VISIBLE.normal;

  const { order, setOrder, visible, setVisible, persist, reset, visibleCols, loaded } =
    useTableLayout(available, defaultVisible, prefsKey);

  const anyFilter = search.trim() || community || cluster || state || beds || nationality || outcome || txFrom || txTo || contact || tenancy || calledPeriod || assigneeFilter
    || propertyType || valueFrom || valueTo || sizeFrom || sizeTo || plotFrom || plotTo || followUp || hasNotes;
  const clearFilters = () => {
    setSearch(''); setCommunity(''); setCluster(''); setState(''); setBeds('');
    setNationality(''); setOutcome(''); setTxFrom(''); setTxTo('');
    setContact(''); setTenancy(''); setCalledPeriod(''); setAssigneeFilter('');
    setPropertyType(''); setValueFrom(''); setValueTo(''); setSizeFrom(''); setSizeTo('');
    setPlotFrom(''); setPlotTo(''); setFollowUp(''); setHasNotes(false); setPage(0);
  };

  // Any filter change must reset to page 0 — otherwise you can be stranded on
  // page 7 of a 2-page result and see nothing. Includes the forced filters, so
  // switching a quick chip also returns to the first page.
  useEffect(() => { setPage(0); },
    [search, community, cluster, state, beds, nationality, outcome, txFrom, txTo,
     contact, tenancy, calledPeriod, assigneeFilter,
     propertyType, valueFrom, valueTo, sizeFrom, sizeTo, plotFrom, plotTo, followUp, hasNotes,
     pageSize, sortKey, asc, forcedOutcome, dueOnly, interestedOnly, scope]);

  // Notify the owner on FILTER changes (not sort / page size) so a stale
  // multi-select can be cleared when the visible set changes.
  useEffect(() => { onFiltersChange?.(); },
    [search, community, cluster, state, beds, nationality, outcome, txFrom, txTo,
     contact, tenancy, calledPeriod, assigneeFilter,
     propertyType, valueFrom, valueTo, sizeFrom, sizeTo, plotFrom, plotTo, followUp, hasNotes,
     onFiltersChange]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pg = Math.min(page, pages - 1);

  const sortOn = (k: ColKey) => {
    const col = colByKey.get(k);
    if (!col?.sortable) return;
    if (sortKey === k) setAsc(a => !a);
    else { setSortKey(k); setAsc(true); }
  };

  const toggleCheck = (id: string) => {
    const next = new Set(checkedIds); next.has(id) ? next.delete(id) : next.add(id);
    onCheckedChanged!(next);
  };
  const allChecked = selectable && rows.length > 0 && rows.every(p => checkedIds!.has(p.id));
  // Checkbox (if any) + the pinned Unit column + every visible column.
  const colSpan = (selectable ? 1 : 0) + 1 + visibleCols.length;

  if (!loaded) return null;

  const headerCell = (k: ColKey) => {
    const col = colByKey.get(k)!;
    const active = sortKey === k;
    const cls = [col.sortable ? 'sortable' : '', active ? 'active' : '', col.numeric ? 'num' : '']
      .filter(Boolean).join(' ');
    return (
      <th key={k} onClick={() => sortOn(k)} className={cls || undefined}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
          {col.label}
          {active && <Icon name={asc ? 'chevronRight' : 'chevronLeft'} size={11} style={{ transform: asc ? 'rotate(-90deg)' : 'rotate(90deg)' }} />}
        </span>
      </th>
    );
  };

  const sel = { display: 'inline-block', width: 'auto', minWidth: 130, padding: '6px 10px' } as React.CSSProperties;
  const selFull = { width: '100%', padding: '6px 10px' } as React.CSSProperties;
  // How many of the "secondary" filters (everything behind the Filters button)
  // are active — shown as a count so a hidden filter is never forgotten.
  const secondaryCount =
    (community ? 1 : 0) + (cluster ? 1 : 0) + (beds ? 1 : 0) + (nationality ? 1 : 0) +
    (outcome ? 1 : 0) + (assigneeFilter ? 1 : 0) + (tenancy ? 1 : 0) + (calledPeriod ? 1 : 0) +
    ((txFrom || txTo) ? 1 : 0) + (contact ? 1 : 0) + (propertyType ? 1 : 0) +
    ((valueFrom || valueTo) ? 1 : 0) + ((sizeFrom || sizeTo) ? 1 : 0) + ((plotFrom || plotTo) ? 1 : 0) +
    (followUp ? 1 : 0) + (hasNotes ? 1 : 0);

  return (
    <div>
      {showCols && (
        <ColumnsDialog
          order={order} visible={visible} pinnedLabel="Unit"
          labelOf={k => colByKey.get(k)?.label ?? k}
          onChange={(o, v) => { setOrder(o); setVisible(new Set(v)); persist(o, new Set(v)); }}
          onReset={reset}
          onClose={() => setShowCols(false)}
        />
      )}

      {/* Sticky filter header — Search + State stay inline; everything else folds
          into one "Filters" popover so the bar stays thin and pinned while the
          rows scroll underneath. */}
      <div style={{
        position: 'sticky', top: stickyTop, zIndex: 30, background: 'var(--surface)',
        borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)', borderTop: stickyTop ? 'none' : '1px solid var(--border)',
        borderRadius: stickyTop ? '0 0 12px 12px' : 12,
        boxShadow: '0 10px 18px -14px rgba(0,0,0,0.22)',
        marginBottom: 14, padding: '10px 18px',
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" style={{ width: 220, paddingLeft: 30 }} placeholder={teaser ? 'Search community, unit…' : 'Search unit, plot, owner…'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {!fixedState && facets.states.length > 1 && (
          <select className="input" style={sel} value={state} onChange={e => setState(e.target.value as PropertyState | '')}>
            {/* Portfolio is hidden for now — those units read as "Assigned". */}
            <option value="">All states</option>{facets.states.filter(s => s !== PropertyState.portfolio).map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
          </select>
        )}
        <div style={{ position: 'relative' }}>
          <button className={`btn btn-sm ${secondaryCount > 0 ? 'btn-primary' : ''}`} onClick={() => setShowFilters(s => !s)}>
            <Icon name="sliders" size={14} /> Filters{secondaryCount > 0 ? ` · ${secondaryCount}` : ''}
          </button>
          {showFilters && (
            <>
              <div onClick={() => setShowFilters(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{
                position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 41, width: 300,
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
                padding: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
                display: 'flex', flexDirection: 'column', gap: 10,
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
                {facets.propertyTypes.length > 0 && (
                  <FilterField label="Property type">
                    <select className="input" style={selFull} value={propertyType} onChange={e => setPropertyType(e.target.value)}>
                      <option value="">Any type</option>{facets.propertyTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </FilterField>
                )}
                <FilterField label="Size (BUA, sqft)">
                  <NumberRange from={sizeFrom} to={sizeTo} setFrom={setSizeFrom} setTo={setSizeTo} />
                </FilterField>
                <FilterField label="Plot size (sqft)">
                  <NumberRange from={plotFrom} to={plotTo} setFrom={setPlotFrom} setTo={setPlotTo} />
                </FilterField>
                {!teaser && facets.nationalities.length > 0 && (
                  <FilterField label="Nationality">
                    <select className="input" style={selFull} value={nationality} onChange={e => setNationality(e.target.value)}>
                      <option value="">All nationalities</option>{facets.nationalities.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </FilterField>
                )}
                {!forcedOutcome && facets.outcomes.length > 0 && (
                  <FilterField label="Last outcome">
                    <select className="input" style={selFull} value={outcome} onChange={e => setOutcome(e.target.value)}>
                      <option value="">All outcomes</option><option value="none">Not called yet</option>
                      {facets.outcomes.map(o => <option key={o} value={o}>{CallOutcomeLabel[o]}</option>)}
                    </select>
                  </FilterField>
                )}
                {showAssignee && brokers.length > 0 && (
                  <FilterField label="Assigned to">
                    <select className="input" style={selFull} value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}>
                      <option value="">All brokers</option>{brokers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                  <button className="btn btn-sm btn-ghost" onClick={() => { clearFilters(); setShowFilters(false); }} style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                    <Icon name="x" size={13} /> Clear all filters
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        {headerExtra}
        <div style={{ flex: 1 }} />
        {/* A quiet spinner: the old in-memory filter was instant, so a loud
            loading state on every keystroke would read as a regression. */}
        {loading && !initialLoading && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>updating…</span>
        )}
        <button className="btn btn-sm" onClick={() => setShowCols(true)}><Icon name="columns" size={15} /> Columns</button>
        {anyFilter && <button className="btn btn-sm btn-ghost" onClick={clearFilters}><Icon name="x" size={14} /> Clear</button>}
      </div>

      {/* Table — a real <table> so columns auto-size to content and align. */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="vault-table dense">
            <thead>
              <tr>
                {selectable && (
                  <th className="checkcol">
                    <input type="checkbox" checked={allChecked} onChange={() => {
                      const next = new Set(checkedIds);
                      rows.forEach(p => allChecked ? next.delete(p.id) : next.add(p.id));
                      onCheckedChanged!(next);
                    }} title="Select the rows on this page" />
                  </th>
                )}
                {headerCell(PINNED)}
                {visibleCols.map(headerCell)}
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 40, color: 'var(--error)' }}>{error}</td></tr>
              ) : initialLoading ? (
                <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={colSpan} style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No properties match these filters.</td></tr>
              ) : rows.map(p => {
                const isSel = p.id === selectedId;
                const cls = [onSelect ? 'clickable' : '', isSel ? 'selected' : ''].filter(Boolean).join(' ');
                return (
                  <tr key={p.id} onClick={() => onSelect?.(p.id, rows.map(r => r.id))} className={cls || undefined}>
                    {selectable && (
                      <td className="checkcol" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={checkedIds!.has(p.id)} onChange={() => toggleCheck(p.id)} />
                      </td>
                    )}
                    <td className="unitcol">
                      <div className="truncate unit-main">{p.unitLabel}</div>
                      <div className="truncate unit-sub">{[p.community, p.cluster].filter(Boolean).join(' · ')}</div>
                    </td>
                    {visibleCols.map(k => {
                      const col = colByKey.get(k)!;
                      return <td key={k} className={col.numeric ? 'num' : undefined}>{col.render(p)}</td>;
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(total)} properties</span>
          {selectable && checkedIds!.size > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>· {fmtInt(checkedIds!.size)} selected</span>
          )}
          <div style={{ flex: 1 }} />
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 4 }}>
            View
            <select className="input" style={{ padding: '4px 6px', width: 'auto' }} value={pageSize}
              onChange={e => setPageSize(parseInt(e.target.value, 10))}>
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            per page
          </label>
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
