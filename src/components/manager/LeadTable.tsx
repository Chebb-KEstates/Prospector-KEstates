import React, { useState, useMemo, useEffect } from 'react';
import { Lead, PropertyState, PropertyStateLabel } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { useTableLayout, ColumnsDialog } from '../common/tableLayout';
import { fmtDate, fmtInt } from '../../utils/format';
import { useVault } from '../../state/VaultContext';
import { useLeadPage, useLeadFacetsOrEmpty } from '../../data/hooks';

/**
 * The buyer-leads table — same platform as the owner table: filter bar,
 * click-to-sort headers, Columns dialog (show/hide + drag-reorder), density,
 * pagination, multi-select, per-screen persistence. Columns adapt to the data:
 * every unmapped upload field (`extra`) becomes its own toggleable column.
 *
 * Server-backed now, mirroring PropertyTable. Kept deliberately parallel to it:
 * two tables, one table language. If you change the paging or filter behaviour
 * in one, change it in both.
 */

const PINNED = 'name';

interface ColDef {
  key: string; label: string; flex: number; numeric?: boolean;
  sortable?: boolean;
  render: (l: Lead) => React.ReactNode;
}

const DEFAULT_VISIBLE = ['phone', 'project', 'source', 'state', 'outcome', 'enquiryDate'];

interface Props {
  scope?: 'all' | 'mine' | 'pool';
  assignedTo?: string;
  datasetId?: string;
  fixedState?: PropertyState;
  onSelect?: (id: string) => void;
  selectedId?: string;
  prefsKey?: string;
  checkedIds?: Set<string>;
  onCheckedChanged?: (ids: Set<string>) => void;
  /** Offset the sticky filter bar below a sticky page header. */
  stickyTop?: number;
}

const PAGE_SIZE = 50;

export function LeadTable({
  scope, assignedTo, datasetId, fixedState,
  onSelect, selectedId, prefsKey = 'leads', checkedIds, onCheckedChanged, stickyTop = 0,
}: Props) {
  const { userById } = useVault();
  const selectable = !!checkedIds && !!onCheckedChanged;

  const [search, setSearch] = useState('');
  const [state, setState] = useState<PropertyState | ''>('');
  const [project, setProject] = useState('');
  const [source, setSource] = useState('');
  const [callableOnly, setCallableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>(PINNED);
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [showCols, setShowCols] = useState(false);

  const facets = useLeadFacetsOrEmpty(
    useMemo(() => ({ scope, assignedTo, datasetId }), [scope, assignedTo, datasetId]),
  );

  const query = useMemo(() => ({
    scope, assignedTo, datasetId,
    search: search.trim() || undefined,
    state: (fixedState ?? state) || undefined,
    project: project || undefined,
    source: source || undefined,
    callableOnly: callableOnly || undefined,
    sortKey: sortKey === PINNED ? undefined : sortKey,
    asc,
    page,
    pageSize: PAGE_SIZE,
  }), [scope, assignedTo, datasetId, search, fixedState, state, project, source,
       callableOnly, sortKey, asc, page]);

  const { rows, total, loading, initialLoading, error } = useLeadPage(query);

  const extraKeys = facets.extraKeys;

  const nameCol: ColDef = useMemo(() => ({
    key: PINNED, label: 'Name', flex: 3, sortable: true, render: () => null,
  }), []);

  const allCols = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      // Masked server-side; `callable` still reads correctly because the mask is
      // non-empty exactly when a real number exists.
      { key: 'phone', label: 'Phone', flex: 2, sortable: true, render: l => <span className="tabular-nums" style={{ color: l.callable ? 'var(--text)' : 'var(--text-tertiary)' }}>{l.phone ?? '—'}</span> },
      { key: 'email', label: 'Email', flex: 3, sortable: true, render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.email ?? '—'}</span> },
      { key: 'project', label: 'Project', flex: 2, sortable: true, render: l => l.project ?? '—' },
      { key: 'source', label: 'Source', flex: 2, sortable: true, render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.source ?? '—'}</span> },
      { key: 'state', label: 'State', flex: 2, sortable: true, render: l => <StateChip state={l.state} /> },
      { key: 'assignedTo', label: 'Assigned to', flex: 2, render: l => l.assignedTo ? (userById(l.assignedTo)?.name ?? l.assignedTo) : <span style={{ color: 'var(--text-tertiary)' }}>—</span> },
      { key: 'outcome', label: 'Outcome', flex: 2, sortable: true, render: l => l.lastOutcome ? <OutcomeChip outcome={l.lastOutcome} buyer /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span> },
      { key: 'enquiry', label: 'Enquired', flex: 2, sortable: true, render: l => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(l.enquiryDate)}</span> },
      { key: 'followUp', label: 'Follow-up', flex: 2, sortable: true, render: l => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(l.nextFollowUpAt)}</span> },
    ];
    for (const k of extraKeys) {
      cols.push({
        key: `extra:${k}`, label: k, flex: 2, sortable: true,
        render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.extra?.[k] ?? '—'}</span>,
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKeys.join('|'), userById]);

  const colByKey = useMemo(() => new Map([nameCol, ...allCols].map(c => [c.key, c])), [allCols, nameCol]);
  const available = useMemo(() => allCols.map(c => c.key), [allCols]);
  const { order, setOrder, visible, setVisible, persist, reset, visibleCols, loaded } =
    useTableLayout(available, DEFAULT_VISIBLE, prefsKey);

  const anyFilter = search.trim() || state || project || source || callableOnly;
  const clearFilters = () => {
    setSearch(''); setState(''); setProject(''); setSource(''); setCallableOnly(false); setPage(0);
  };

  useEffect(() => { setPage(0); },
    [search, state, project, source, callableOnly, sortKey, asc, scope, fixedState]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const allChecked = selectable && rows.length > 0 && rows.every(l => checkedIds!.has(l.id));

  const sortOn = (k: string) => {
    const col = colByKey.get(k);
    if (!col?.sortable) return;
    if (sortKey === k) setAsc(a => !a);
    else { setSortKey(k); setAsc(true); }
  };

  if (!loaded) return null;

  const headerCell = (k: string) => {
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
        <ColumnsDialog order={order} visible={visible} pinnedLabel="Name"
          labelOf={k => colByKey.get(k)?.label ?? k}
          onChange={(o, v) => { setOrder(o); setVisible(new Set(v)); persist(o, new Set(v)); }}
          onReset={reset} onClose={() => setShowCols(false)} />
      )}

      {/* Sticky filter header — stays pinned while the rows scroll. */}
      <div style={{
        position: 'sticky', top: stickyTop, zIndex: 30, background: 'var(--surface)',
        borderBottom: '1px solid var(--border)', marginBottom: 12, padding: '10px 0',
        display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" style={{ width: 220, paddingLeft: 30 }} placeholder="Search name, email, project…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {!fixedState && facets.states.length > 1 && (
          <select className="input" style={sel} value={state} onChange={e => setState(e.target.value as PropertyState | '')}>
            <option value="">All states</option>{facets.states.map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
          </select>
        )}
        {facets.projects.length > 0 && (
          <select className="input" style={sel} value={project} onChange={e => setProject(e.target.value)}>
            <option value="">All projects</option>{facets.projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {facets.sources.length > 0 && (
          <select className="input" style={sel} value={source} onChange={e => setSource(e.target.value)}>
            <option value="">All sources</option>{facets.sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button className={`btn btn-sm ${callableOnly ? 'btn-primary' : ''}`} onClick={() => setCallableOnly(v => !v)}>Callable</button>
        <div style={{ flex: 1 }} />
        {loading && !initialLoading && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>updating…</span>
        )}
        <button className="btn btn-sm" onClick={() => setShowCols(true)}><Icon name="columns" size={15} /> Columns</button>
        {anyFilter && <button className="btn btn-sm btn-ghost" onClick={clearFilters}><Icon name="x" size={14} /> Clear</button>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              {selectable && (
                <input type="checkbox" checked={allChecked} onChange={() => {
                  const next = new Set(checkedIds);
                  rows.forEach(l => allChecked ? next.delete(l.id) : next.add(l.id));
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
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No leads match these filters.</div>
            ) : rows.map(l => (
              <div key={l.id} onClick={() => onSelect?.(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 16px', borderBottom: '1px solid var(--border-light)', cursor: onSelect ? 'pointer' : 'default', background: l.id === selectedId ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}>
                {selectable && <input type="checkbox" checked={checkedIds!.has(l.id)} onClick={e => e.stopPropagation()} onChange={() => { const next = new Set(checkedIds); next.has(l.id) ? next.delete(l.id) : next.add(l.id); onCheckedChanged!(next); }} style={{ width: 30 }} />}
                <div style={{ flex: nameCol.flex, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{l.name || '—'}</div>
                  <div className="truncate" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{[l.project, l.source].filter(Boolean).join(' · ') || 'Buyer lead'}</div>
                </div>
                {visibleCols.map(k => {
                  const col = colByKey.get(k)!;
                  return <div key={k} className="truncate" style={{ flex: col.flex, minWidth: 0, fontSize: '0.8125rem', textAlign: col.numeric ? 'right' : 'left' }}>{col.render(l)}</div>;
                })}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(total)} leads</span>
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
