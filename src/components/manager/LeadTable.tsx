import React, { useState, useMemo } from 'react';
import { Lead, PropertyState, PropertyStateLabel, CallOutcome, CallOutcomeBuyerLabel } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { useTableLayout, ColumnsDialog } from '../common/tableLayout';
import { maskedPhone, fmtDate, fmtInt } from '../../utils/format';
import { useVault } from '../../state/VaultContext';

/**
 * The buyer-leads table — same platform as the owner table: filter bar, click-to-
 * sort headers, Columns dialog (show/hide + drag-reorder), density, pagination,
 * multi-select, per-screen persistence. Columns adapt to the data: every unmapped
 * upload field (`extra`) becomes its own toggleable column.
 */

const PINNED = 'name';

interface ColDef {
  key: string; label: string; flex: number; numeric?: boolean;
  render: (l: Lead) => React.ReactNode;
  sortVal: (l: Lead) => string | number;
}

const DEFAULT_VISIBLE = ['phone', 'project', 'source', 'state', 'outcome', 'enquiryDate'];

interface Props {
  leads: Lead[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  prefsKey?: string;
  checkedIds?: Set<string>;
  onCheckedChanged?: (ids: Set<string>) => void;
}

const PAGE_SIZE = 50;

export function LeadTable({ leads, onSelect, selectedId, prefsKey = 'leads', checkedIds, onCheckedChanged }: Props) {
  const { userById } = useVault();
  const selectable = !!checkedIds && !!onCheckedChanged;

  const extraKeys = useMemo(() => {
    const s = new Set<string>();
    for (const l of leads) for (const k of Object.keys(l.extra ?? {})) s.add(k);
    return Array.from(s).sort();
  }, [leads]);

  const str = (v?: string | null) => (v ?? '').toLowerCase();

  const nameCol: ColDef = useMemo(() => ({
    key: PINNED, label: 'Name', flex: 3,
    render: () => null,
    sortVal: l => str(l.name),
  }), []);

  const allCols = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [
      { key: 'phone', label: 'Phone', flex: 2, render: l => <span className="tabular-nums" style={{ color: l.callable ? 'var(--text)' : 'var(--text-tertiary)' }}>{maskedPhone(l.phone)}</span>, sortVal: l => str(l.phone) },
      { key: 'email', label: 'Email', flex: 3, render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.email ?? '—'}</span>, sortVal: l => str(l.email) },
      { key: 'project', label: 'Project', flex: 2, render: l => l.project ?? '—', sortVal: l => str(l.project) },
      { key: 'source', label: 'Source', flex: 2, render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.source ?? '—'}</span>, sortVal: l => str(l.source) },
      { key: 'state', label: 'State', flex: 2, render: l => <StateChip state={l.state} />, sortVal: l => Object.values(PropertyState).indexOf(l.state) },
      { key: 'assignedTo', label: 'Assigned to', flex: 2, render: l => l.assignedTo ? (userById(l.assignedTo)?.name ?? l.assignedTo) : <span style={{ color: 'var(--text-tertiary)' }}>—</span>, sortVal: l => str(userById(l.assignedTo)?.name) },
      { key: 'outcome', label: 'Outcome', flex: 2, render: l => l.lastOutcome ? <OutcomeChip outcome={l.lastOutcome} buyer /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>, sortVal: l => l.lastOutcome ? CallOutcomeBuyerLabel[l.lastOutcome] : '~' },
      { key: 'enquiryDate', label: 'Enquired', flex: 2, render: l => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(l.enquiryDate)}</span>, sortVal: l => l.enquiryDate ? new Date(l.enquiryDate).getTime() : 0 },
      { key: 'followUp', label: 'Follow-up', flex: 2, render: l => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(l.nextFollowUpAt)}</span>, sortVal: l => l.nextFollowUpAt ? new Date(l.nextFollowUpAt).getTime() : 0 },
    ];
    for (const k of extraKeys) {
      cols.push({ key: `extra:${k}`, label: k, flex: 2, render: l => <span style={{ color: 'var(--text-secondary)' }}>{l.extra?.[k] ?? '—'}</span>, sortVal: l => (l.extra?.[k] ?? '').toLowerCase() });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKeys.join('|'), userById]);

  const colByKey = useMemo(() => new Map([nameCol, ...allCols].map(c => [c.key, c])), [allCols, nameCol]);
  const available = useMemo(() => allCols.map(c => c.key), [allCols]);
  const { order, setOrder, visible, setVisible, dense, setDense, persist, reset, visibleCols, loaded } =
    useTableLayout(available, DEFAULT_VISIBLE, prefsKey);

  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [project, setProject] = useState('');
  const [source, setSource] = useState('');
  const [callableOnly, setCallableOnly] = useState(false);
  const [sortKey, setSortKey] = useState<string>(PINNED);
  const [asc, setAsc] = useState(true);
  const [page, setPage] = useState(0);
  const [showCols, setShowCols] = useState(false);

  const projects = useMemo(() => Array.from(new Set(leads.map(l => l.project).filter(Boolean) as string[])).sort(), [leads]);
  const sources = useMemo(() => Array.from(new Set(leads.map(l => l.source).filter(Boolean) as string[])).sort(), [leads]);
  const states = useMemo(() => Array.from(new Set(leads.map(l => l.state))), [leads]);

  const anyFilter = search.trim() || state || project || source || callableOnly;
  const clearFilters = () => { setSearch(''); setState(''); setProject(''); setSource(''); setCallableOnly(false); setPage(0); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortDef = colByKey.get(sortKey);
    const rows = leads.filter(l => {
      if (state && l.state !== state) return false;
      if (project && l.project !== project) return false;
      if (source && l.source !== source) return false;
      if (callableOnly && !l.callable) return false;
      if (q) {
        const hay = `${l.name} ${l.phone ?? ''} ${l.email ?? ''} ${l.project ?? ''} ${l.source ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      const va = sortDef ? sortDef.sortVal(a) : a.name;
      const vb = sortDef ? sortDef.sortVal(b) : b.name;
      let r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
      if (r === 0) r = a.name.localeCompare(b.name);
      return asc ? r : -r;
    });
    return rows;
  }, [leads, search, state, project, source, callableOnly, sortKey, asc, colByKey]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const slice = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);
  const allChecked = selectable && slice.length > 0 && slice.every(l => checkedIds!.has(l.id));

  const sortOn = (k: string) => { if (sortKey === k) setAsc(a => !a); else { setSortKey(k); setAsc(true); } };
  if (!loaded) return null;

  const headerCell = (k: string) => {
    const col = colByKey.get(k)!;
    const active = sortKey === k;
    return (
      <div key={k} onClick={() => sortOn(k)} style={{ flex: col.flex, minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, color: active ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', userSelect: 'none' }}>
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
          onChange={(o, v) => { setOrder(o); setVisible(new Set(v)); persist(o, new Set(v), dense); }}
          onReset={reset} onClose={() => setShowCols(false)} />
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" style={{ width: 240, paddingLeft: 30 }} placeholder="Search name, phone, email…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        {states.length > 1 && (
          <select className="input" style={sel} value={state} onChange={e => { setState(e.target.value); setPage(0); }}>
            <option value="">All states</option>{states.map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
          </select>
        )}
        {projects.length > 0 && (
          <select className="input" style={sel} value={project} onChange={e => { setProject(e.target.value); setPage(0); }}>
            <option value="">All projects</option>{projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        {sources.length > 0 && (
          <select className="input" style={sel} value={source} onChange={e => { setSource(e.target.value); setPage(0); }}>
            <option value="">All sources</option>{sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button className={`btn btn-sm ${callableOnly ? 'btn-primary' : ''}`} onClick={() => { setCallableOnly(v => !v); setPage(0); }}>Callable</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm" onClick={() => setShowCols(true)}><Icon name="columns" size={15} /> Columns</button>
        <button className="btn btn-icon btn-sm" title={dense ? 'Comfortable rows' : 'Compact rows'} onClick={() => { const d = !dense; setDense(d); persist(order, visible, d); }}>
          <Icon name="sliders" size={15} />
        </button>
        {anyFilter && <button className="btn btn-sm btn-ghost" onClick={clearFilters}><Icon name="x" size={14} /> Clear</button>}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 720 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              {selectable && (
                <input type="checkbox" checked={allChecked} onChange={() => { const next = new Set(checkedIds); slice.forEach(l => allChecked ? next.delete(l.id) : next.add(l.id)); onCheckedChanged!(next); }} style={{ width: 30 }} />
              )}
              {headerCell(PINNED)}
              {visibleCols.map(headerCell)}
            </div>
            {slice.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No leads match these filters.</div>
            ) : slice.map(l => (
              <div key={l.id} onClick={() => onSelect?.(l.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: `${dense ? 5 : 10}px 16px`, borderBottom: '1px solid var(--border-light)', cursor: onSelect ? 'pointer' : 'default', background: l.id === selectedId ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}>
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
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(filtered.length)} leads</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
