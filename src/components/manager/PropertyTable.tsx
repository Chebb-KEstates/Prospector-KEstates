import React, { useState, useMemo, useEffect } from 'react';
import { Property, PropertyState, PropertyStateLabel, CallOutcomeLabel } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { useTableLayout, ColumnsDialog } from '../common/tableLayout';
import { usePropertyPage, usePropertyFacetsOrEmpty } from '../../data/hooks';
import { fmtDate, fmtDateTime, fmtAed, fmtArea, fmtInt } from '../../utils/format';

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

function baseCols(): ColDef[] {
  return [
    { key: 'owner', label: 'Owner', flex: 3, ownerData: true, sortable: true, render: p => p.owner.name || '—' },
    {
      key: 'mobile', label: 'Mobile', flex: 2, ownerData: true, sortable: true,
      // Already masked by the server. `callable` still works because the mask is
      // a non-empty string exactly when a real number exists.
      render: p => (
        <span className="tabular-nums" style={{ color: p.callable ? 'var(--text)' : 'var(--text-tertiary)' }}>
          {p.owner.phone ?? '—'}
        </span>
      ),
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
    { key: 'state', label: 'State', flex: 2, sortable: true, render: p => <StateChip state={p.state} /> },
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
  onSelect?: (id: string) => void;
  selectedId?: string;
  teaser?: boolean;
  hideOwner?: boolean;
  prefsKey?: string;
  checkedIds?: Set<string>;
  onCheckedChanged?: (ids: Set<string>) => void;
}

const PAGE_SIZE = 50;

export function PropertyTable({
  scope, assignedTo, datasetId, fixedState,
  forcedOutcome, dueOnly, interestedOnly,
  onSelect, selectedId, teaser, hideOwner, prefsKey,
  checkedIds, onCheckedChanged,
}: Props) {
  const ownerHidden = !!teaser || !!hideOwner;
  const selectable = !!checkedIds && !!onCheckedChanged;

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
  const [callableOnly, setCallableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<ColKey>(PINNED);
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [showCols, setShowCols] = useState(false);

  const facets = usePropertyFacetsOrEmpty(
    useMemo(() => ({ scope, assignedTo, datasetId, community }), [scope, assignedTo, datasetId, community]),
  );

  const query = useMemo(() => ({
    scope, assignedTo, datasetId,
    search: search.trim() || undefined,
    community: community || undefined,
    cluster: cluster || undefined,
    state: (fixedState ?? state) || undefined,
    beds: beds ? parseInt(beds, 10) : undefined,
    nationality: nationality || undefined,
    outcome: forcedOutcome ?? (outcome || undefined),
    dueOnly: dueOnly || undefined,
    interestedOnly: interestedOnly || undefined,
    txFrom: txFrom || undefined,
    txTo: txTo || undefined,
    callableOnly: callableOnly || undefined,
    sortKey: sortKey === PINNED ? undefined : sortKey,
    asc,
    page,
    pageSize: PAGE_SIZE,
  }), [scope, assignedTo, datasetId, search, community, cluster, fixedState, state,
       beds, nationality, outcome, forcedOutcome, dueOnly, interestedOnly,
       txFrom, txTo, callableOnly, sortKey, asc, page]);

  const { rows, total, loading, initialLoading, error } = usePropertyPage(query);

  // Dynamic upload columns come from the facets — they describe the whole scope,
  // so a column doesn't vanish just because this page's rows happen to lack it.
  const extraKeys = facets.extraKeys;

  const allCols = useMemo<ColDef[]>(() => {
    const cols = baseCols().filter(c => !(ownerHidden && c.ownerData));
    for (const k of extraKeys) {
      cols.push({
        key: `extra:${k}`, label: k, flex: 2, sortable: true,
        render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.extra?.[k] ?? '—'}</span>,
      });
    }
    return cols;
  }, [ownerHidden, extraKeys]);

  const unitCol: ColDef = useMemo(() => ({
    key: PINNED, label: 'Unit', flex: 3, sortable: true, render: () => null,
  }), []);
  const colByKey = useMemo(() => new Map([unitCol, ...allCols].map(c => [c.key, c])), [allCols, unitCol]);
  const available = useMemo(() => allCols.map(c => c.key), [allCols]);
  const defaultVisible = teaser ? DEFAULT_VISIBLE.teaser : hideOwner ? DEFAULT_VISIBLE.hideOwner : DEFAULT_VISIBLE.normal;

  const { order, setOrder, visible, setVisible, dense, setDense, persist, reset, visibleCols, loaded } =
    useTableLayout(available, defaultVisible, prefsKey);

  const anyFilter = search.trim() || community || cluster || state || beds || nationality || outcome || txFrom || txTo || callableOnly;
  const clearFilters = () => {
    setSearch(''); setCommunity(''); setCluster(''); setState(''); setBeds('');
    setNationality(''); setOutcome(''); setTxFrom(''); setTxTo('');
    setCallableOnly(false); setPage(0);
  };

  // Any filter change must reset to page 0 — otherwise you can be stranded on
  // page 7 of a 2-page result and see nothing. Includes the forced filters, so
  // switching a quick chip also returns to the first page.
  useEffect(() => { setPage(0); },
    [search, community, cluster, state, beds, nationality, outcome, txFrom, txTo,
     callableOnly, sortKey, asc, forcedOutcome, dueOnly, interestedOnly, scope]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
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

  if (!loaded) return null;

  const headerCell = (k: ColKey) => {
    const col = colByKey.get(k)!;
    const active = sortKey === k;
    return (
      <div key={k} onClick={() => sortOn(k)} style={{ flex: col.flex, minWidth: 0, cursor: col.sortable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 3, color: active ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none' }}>
        <span className="truncate">{col.label}</span>
        {active && <Icon name={asc ? 'chevronRight' : 'chevronLeft'} size={11} style={{ transform: asc ? 'rotate(-90deg)' : 'rotate(90deg)' }} />}
      </div>
    );
  };

  const sel = { display: 'inline-block', width: 'auto', minWidth: 130, padding: '6px 10px' } as React.CSSProperties;

  return (
    <div>
      {showCols && (
        <ColumnsDialog
          order={order} visible={visible} pinnedLabel="Unit"
          labelOf={k => colByKey.get(k)?.label ?? k}
          onChange={(o, v) => { setOrder(o); setVisible(new Set(v)); persist(o, new Set(v), dense); }}
          onReset={reset}
          onClose={() => setShowCols(false)}
        />
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" style={{ width: 240, paddingLeft: 30 }} placeholder={teaser ? 'Search community, unit…' : 'Search unit, plot, owner…'} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input" style={sel} value={community} onChange={e => { setCommunity(e.target.value); setCluster(''); }}>
          <option value="">All communities</option>{facets.communities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {facets.clusters.length > 0 && (
          <select className="input" style={sel} value={cluster} onChange={e => setCluster(e.target.value)}>
            <option value="">All sub-communities</option>{facets.clusters.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {!fixedState && facets.states.length > 1 && (
          <select className="input" style={sel} value={state} onChange={e => setState(e.target.value as PropertyState | '')}>
            <option value="">All states</option>{facets.states.map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
          </select>
        )}
        {facets.beds.length > 0 && (
          <select className="input" style={{ ...sel, minWidth: 90 }} value={beds} onChange={e => setBeds(e.target.value)}>
            <option value="">Any beds</option>{facets.beds.map(b => <option key={b} value={b}>{b} BR</option>)}
          </select>
        )}
        {!teaser && facets.nationalities.length > 0 && (
          <select className="input" style={sel} value={nationality} onChange={e => setNationality(e.target.value)}>
            <option value="">All nationalities</option>{facets.nationalities.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {!forcedOutcome && facets.outcomes.length > 0 && (
          <select className="input" style={sel} value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="">All outcomes</option><option value="none">Not called yet</option>
            {facets.outcomes.map(o => <option key={o} value={o}>{CallOutcomeLabel[o]}</option>)}
          </select>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Purchased
          <input className="input" type="date" style={{ width: 140, padding: '5px 8px' }} value={txFrom} onChange={e => setTxFrom(e.target.value)} />
          –
          <input className="input" type="date" style={{ width: 140, padding: '5px 8px' }} value={txTo} onChange={e => setTxTo(e.target.value)} />
        </label>
        <button className={`btn btn-sm ${callableOnly ? 'btn-primary' : ''}`} onClick={() => setCallableOnly(v => !v)}>Callable</button>
        <div style={{ flex: 1 }} />
        {/* A quiet spinner: the old in-memory filter was instant, so a loud
            loading state on every keystroke would read as a regression. */}
        {loading && !initialLoading && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>updating…</span>
        )}
        <button className="btn btn-sm" onClick={() => setShowCols(true)}><Icon name="columns" size={15} /> Columns</button>
        <button className="btn btn-icon btn-sm" title={dense ? 'Comfortable rows' : 'Compact rows'} onClick={() => { const d = !dense; setDense(d); persist(order, visible, d); }}>
          <Icon name="sliders" size={15} />
        </button>
        {anyFilter && <button className="btn btn-sm btn-ghost" onClick={clearFilters}><Icon name="x" size={14} /> Clear</button>}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              {selectable && (
                <input type="checkbox" checked={allChecked} onChange={() => {
                  const next = new Set(checkedIds);
                  rows.forEach(p => allChecked ? next.delete(p.id) : next.add(p.id));
                  onCheckedChanged!(next);
                }} style={{ width: 30 }} title="Select the rows on this page" />
              )}
              {headerCell(PINNED)}
              {visibleCols.map(headerCell)}
            </div>

            {error ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--error)' }}>{error}</div>
            ) : initialLoading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>Loading…</div>
            ) : rows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No properties match these filters.</div>
            ) : rows.map(p => {
              const isSel = p.id === selectedId;
              return (
                <div key={p.id} onClick={() => onSelect?.(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${dense ? 5 : 10}px 16px`, borderBottom: '1px solid var(--border-light)', cursor: onSelect ? 'pointer' : 'default', background: isSel ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}>
                  {selectable && <input type="checkbox" checked={checkedIds!.has(p.id)} onClick={e => e.stopPropagation()} onChange={() => toggleCheck(p.id)} style={{ width: 30 }} />}
                  <div style={{ flex: colByKey.get(PINNED)!.flex, minWidth: 0 }}>
                    <div className="truncate" style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{p.unitLabel}</div>
                    <div className="truncate" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{[p.community, p.cluster].filter(Boolean).join(' · ')}</div>
                  </div>
                  {visibleCols.map(k => {
                    const col = colByKey.get(k)!;
                    return <div key={k} className="truncate" style={{ flex: col.flex, minWidth: 0, fontSize: '0.8125rem', textAlign: col.numeric ? 'right' : 'left' }}>{col.render(p)}</div>;
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(total)} properties</span>
          {selectable && checkedIds!.size > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>· {fmtInt(checkedIds!.size)} selected</span>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
