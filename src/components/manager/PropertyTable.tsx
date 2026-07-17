import React, { useState, useMemo, useEffect } from 'react';
import { Property, PropertyState, PropertyStateLabel, CallOutcome, CallOutcomeLabel } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { Icon } from '../common/Icon';
import { maskedPhone, fmtDate, fmtDateTime, fmtAed, fmtArea, fmtInt } from '../../utils/format';

/**
 * THE data table — the platform's foundation. One spreadsheet renders the vault
 * and every broker list, with the controls around it: a full filter bar, click-
 * to-sort headers, user-controlled columns (show/hide + drag-reorder, remembered
 * per screen), a density toggle, multi-select, pagination, and security modes
 * (teaser / hideOwner). Columns adapt to the data: any unmapped upload fields
 * (`extra`) become toggleable columns. Ported from the Flutter PropertyTableView.
 */

type ColKey = string; // fixed keys below, plus `extra:<header>`
const PINNED: ColKey = 'unit';

interface ColDef {
  key: ColKey;
  label: string;
  flex: number;
  ownerData?: boolean;
  numeric?: boolean;
  render: (p: Property) => React.ReactNode;
  sortVal: (p: Property) => string | number;
}

function baseCols(): ColDef[] {
  const s = (v?: string | null) => (v ?? '').toLowerCase();
  const d = (v?: string) => (v ? new Date(v).getTime() : 0);
  return [
    { key: 'owner', label: 'Owner', flex: 3, ownerData: true, render: p => p.owner.name || '—', sortVal: p => s(p.owner.name) },
    { key: 'mobile', label: 'Mobile', flex: 2, ownerData: true, render: p => <span className="tabular-nums" style={{ color: p.callable ? 'var(--text)' : 'var(--text-tertiary)' }}>{maskedPhone(p.owner.phone)}</span>, sortVal: p => s(p.owner.phone) },
    { key: 'beds', label: 'Beds', flex: 1, numeric: true, render: p => p.beds ?? '—', sortVal: p => p.beds ?? -1 },
    { key: 'size', label: 'Size (BUA)', flex: 2, numeric: true, render: p => fmtArea(p.sizeSqft), sortVal: p => p.sizeSqft ?? -1 },
    { key: 'plotSize', label: 'Plot size', flex: 2, numeric: true, render: p => fmtArea(p.plotSqft), sortVal: p => p.plotSqft ?? -1 },
    { key: 'type', label: 'Type', flex: 2, render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.propertyType ?? '—'}</span>, sortVal: p => s(p.propertyType) },
    { key: 'lastTx', label: 'Last transaction', flex: 2, render: p => p.lastTransactionValue != null ? <span>{fmtDate(p.lastTransactionDate)}<span style={{ color: 'var(--text-tertiary)' }}> · {fmtAed(p.lastTransactionValue)}</span></span> : fmtDate(p.lastTransactionDate), sortVal: p => d(p.lastTransactionDate) },
    { key: 'tenancy', label: 'Tenancy', flex: 3, render: p => (p.rentEnd == null && p.rentAmount == null) ? <span style={{ color: 'var(--text-tertiary)' }}>—</span> : <span style={{ color: 'var(--text-secondary)' }}>until {fmtDate(p.rentEnd)}{p.rentAmount != null ? ` · ${fmtAed(p.rentAmount)}/yr` : ''}</span>, sortVal: p => d(p.rentEnd) },
    { key: 'outcome', label: 'Outcome', flex: 2, render: p => p.lastOutcome ? <OutcomeChip outcome={p.lastOutcome} /> : <span style={{ color: 'var(--text-tertiary)' }}>—</span>, sortVal: p => p.lastOutcome ? CallOutcomeLabel[p.lastOutcome] : '~' },
    { key: 'calledAt', label: 'Last call', flex: 2, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDateTime(p.lastCalledAt)}</span>, sortVal: p => d(p.lastCalledAt) },
    { key: 'followUp', label: 'Follow-up', flex: 2, render: p => <span style={{ color: 'var(--text-secondary)' }}>{fmtDate(p.nextFollowUpAt)}</span>, sortVal: p => d(p.nextFollowUpAt) },
    { key: 'state', label: 'State', flex: 2, render: p => <StateChip state={p.state} />, sortVal: p => Object.values(PropertyState).indexOf(p.state) },
  ];
}

const DEFAULT_VISIBLE = {
  normal: ['owner', 'mobile', 'beds', 'size', 'lastTx', 'state'],
  teaser: ['beds', 'size', 'type', 'lastTx', 'state'],
  hideOwner: ['beds', 'size', 'outcome', 'calledAt', 'followUp', 'state'],
};

interface Props {
  properties: Property[];
  onSelect?: (id: string) => void;
  selectedId?: string;
  teaser?: boolean;
  hideOwner?: boolean;
  prefsKey?: string;
  checkedIds?: Set<string>;
  onCheckedChanged?: (ids: Set<string>) => void;
}

const PAGE_SIZE = 50;

export function PropertyTable({ properties, onSelect, selectedId, teaser, hideOwner, prefsKey, checkedIds, onCheckedChanged }: Props) {
  const ownerHidden = !!teaser || !!hideOwner;
  const selectable = !!checkedIds && !!onCheckedChanged;

  // Dynamic extra columns from the data (flexible to any upload).
  const extraKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of properties) for (const k of Object.keys(p.extra ?? {})) set.add(k);
    return Array.from(set).sort();
  }, [properties]);

  const allCols = useMemo<ColDef[]>(() => {
    const cols = baseCols().filter(c => !(ownerHidden && c.ownerData));
    for (const k of extraKeys) {
      cols.push({ key: `extra:${k}`, label: k, flex: 2, render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.extra?.[k] ?? '—'}</span>, sortVal: p => (p.extra?.[k] ?? '').toLowerCase() });
    }
    return cols;
  }, [ownerHidden, extraKeys]);
  // The pinned Unit column — always first, rendered specially, but needs a def
  // in the registry for its label/flex (header + row look it up).
  const unitCol: ColDef = useMemo(() => ({
    key: PINNED, label: 'Unit', flex: 3,
    render: () => null,
    sortVal: p => `${p.community}|${p.cluster ?? ''}|${p.building ?? ''}|${p.unitNumber ?? p.plotNumber ?? ''}`.toLowerCase(),
  }), []);
  const colByKey = useMemo(() => new Map([unitCol, ...allCols].map(c => [c.key, c])), [allCols, unitCol]);
  const available = useMemo(() => allCols.map(c => c.key), [allCols]);
  const defaultVisible = teaser ? DEFAULT_VISIBLE.teaser : hideOwner ? DEFAULT_VISIBLE.hideOwner : DEFAULT_VISIBLE.normal;

  const storageKey = prefsKey ? `prospector.table.${prefsKey}.v2` : null;

  const [order, setOrder] = useState<ColKey[]>(available);
  const [visible, setVisible] = useState<Set<ColKey>>(new Set(defaultVisible.filter(k => available.includes(k))));
  const [dense, setDense] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load persisted layout once.
  useEffect(() => {
    if (!storageKey) { setLoaded(true); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const j = JSON.parse(raw);
        const storedOrder = (j.order as string[] ?? []).filter(k => available.includes(k));
        setOrder([...storedOrder, ...available.filter(k => !storedOrder.includes(k))]);
        const vis = (j.visible as string[] ?? []).filter(k => available.includes(k));
        if (vis.length) setVisible(new Set(vis));
        if (typeof j.dense === 'boolean') setDense(j.dense);
      }
    } catch { /* defaults win */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Keep order/visible in sync when the available columns change (e.g. new extra columns).
  useEffect(() => {
    setOrder(prev => {
      const kept = prev.filter(k => available.includes(k));
      return [...kept, ...available.filter(k => !kept.includes(k))];
    });
    setVisible(prev => new Set(Array.from(prev).filter(k => available.includes(k))));
  }, [available]);

  const persist = (o: ColKey[], v: Set<ColKey>, d: boolean) => {
    if (storageKey) try { localStorage.setItem(storageKey, JSON.stringify({ order: o, visible: Array.from(v), dense: d })); } catch { /* ignore */ }
  };

  const visibleCols = order.filter(k => visible.has(k));

  // ── Filters ──
  const [search, setSearch] = useState('');
  const [community, setCommunity] = useState('');
  const [cluster, setCluster] = useState('');
  const [state, setState] = useState('');
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

  const anyFilter = search.trim() || community || cluster || state || beds || nationality || outcome || txFrom || txTo || callableOnly;
  const clearFilters = () => { setSearch(''); setCommunity(''); setCluster(''); setState(''); setBeds(''); setNationality(''); setOutcome(''); setTxFrom(''); setTxTo(''); setCallableOnly(false); setPage(0); };

  // Filter option sources.
  const communities = useMemo(() => Array.from(new Set(properties.map(p => p.community))).sort(), [properties]);
  const clusters = useMemo(() => Array.from(new Set(properties.filter(p => !community || p.community === community).map(p => p.cluster).filter(Boolean) as string[])).sort(), [properties, community]);
  const states = useMemo(() => Array.from(new Set(properties.map(p => p.state))), [properties]);
  const bedsOpts = useMemo(() => Array.from(new Set(properties.map(p => p.beds).filter(b => b != null) as number[])).sort((a, b) => a - b), [properties]);
  const nationalities = useMemo(() => Array.from(new Set(properties.map(p => p.owner.nationality).filter(Boolean) as string[])).sort(), [properties]);
  const outcomesPresent = useMemo(() => Array.from(new Set(properties.map(p => p.lastOutcome).filter(Boolean) as CallOutcome[])), [properties]);

  const unitSort = (p: Property) => `${p.community}|${p.cluster ?? ''}|${p.building ?? ''}|${p.unitNumber ?? p.plotNumber ?? ''}`.toLowerCase();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const from = txFrom ? new Date(txFrom).getTime() : null;
    const to = txTo ? new Date(txTo).getTime() : null;
    const sortDef = sortKey === PINNED ? null : colByKey.get(sortKey);
    const rows = properties.filter(p => {
      if (community && p.community !== community) return false;
      if (cluster && p.cluster !== cluster) return false;
      if (state && p.state !== state) return false;
      if (beds && p.beds !== parseInt(beds)) return false;
      if (nationality && p.owner.nationality !== nationality) return false;
      if (outcome) { if (outcome === 'none' ? p.lastOutcome != null : p.lastOutcome !== outcome) return false; }
      if (callableOnly && !p.callable) return false;
      const tx = p.lastTransactionDate ? new Date(p.lastTransactionDate).getTime() : null;
      if (from != null && (tx == null || tx < from)) return false;
      if (to != null && (tx == null || tx > to)) return false;
      if (q) {
        const hay = `${p.community} ${p.cluster ?? ''} ${p.building ?? ''} ${p.unitNumber ?? ''} ${p.plotNumber ?? ''} ${ownerHidden ? '' : p.owner.name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    rows.sort((a, b) => {
      let r: number;
      if (!sortDef) { r = unitSort(a) < unitSort(b) ? -1 : unitSort(a) > unitSort(b) ? 1 : 0; }
      else {
        const va = sortDef.sortVal(a), vb = sortDef.sortVal(b);
        r = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
        if (r === 0) r = unitSort(a) < unitSort(b) ? -1 : 1;
      }
      return asc ? r : -r;
    });
    return rows;
  }, [properties, search, community, cluster, state, beds, nationality, outcome, callableOnly, txFrom, txTo, sortKey, asc, colByKey, ownerHidden]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const slice = filtered.slice(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE);

  const sortOn = (k: ColKey) => { if (sortKey === k) setAsc(a => !a); else { setSortKey(k); setAsc(true); } };

  const toggleCheck = (id: string) => {
    const next = new Set(checkedIds); next.has(id) ? next.delete(id) : next.add(id); onCheckedChanged!(next);
  };
  const allChecked = selectable && slice.length > 0 && slice.every(p => checkedIds!.has(p.id));

  if (!loaded) return null;

  const headerCell = (k: ColKey) => {
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
        <ColumnsDialog
          order={order} visible={visible} colByKey={colByKey}
          onChange={(o, v) => { setOrder(o); setVisible(new Set(v)); persist(o, new Set(v), dense); }}
          onReset={() => { const o = [...available]; const v = new Set(defaultVisible.filter(k => available.includes(k))); setOrder(o); setVisible(v); persist(o, v, dense); }}
          onClose={() => setShowCols(false)}
        />
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input className="input" style={{ width: 240, paddingLeft: 30 }} placeholder={teaser ? 'Search community, unit…' : 'Search unit, plot, owner…'} value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <select className="input" style={sel} value={community} onChange={e => { setCommunity(e.target.value); setCluster(''); setPage(0); }}>
          <option value="">All communities</option>{communities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {clusters.length > 0 && (
          <select className="input" style={sel} value={cluster} onChange={e => { setCluster(e.target.value); setPage(0); }}>
            <option value="">All sub-communities</option>{clusters.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        {states.length > 1 && (
          <select className="input" style={sel} value={state} onChange={e => { setState(e.target.value); setPage(0); }}>
            <option value="">All states</option>{states.map(s => <option key={s} value={s}>{PropertyStateLabel[s]}</option>)}
          </select>
        )}
        {bedsOpts.length > 0 && (
          <select className="input" style={{ ...sel, minWidth: 90 }} value={beds} onChange={e => { setBeds(e.target.value); setPage(0); }}>
            <option value="">Any beds</option>{bedsOpts.map(b => <option key={b} value={b}>{b} BR</option>)}
          </select>
        )}
        {!teaser && nationalities.length > 0 && (
          <select className="input" style={sel} value={nationality} onChange={e => { setNationality(e.target.value); setPage(0); }}>
            <option value="">All nationalities</option>{nationalities.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        )}
        {outcomesPresent.length > 0 && (
          <select className="input" style={sel} value={outcome} onChange={e => { setOutcome(e.target.value); setPage(0); }}>
            <option value="">All outcomes</option><option value="none">Not called yet</option>
            {outcomesPresent.map(o => <option key={o} value={o}>{CallOutcomeLabel[o]}</option>)}
          </select>
        )}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          Purchased
          <input className="input" type="date" style={{ width: 140, padding: '5px 8px' }} value={txFrom} onChange={e => { setTxFrom(e.target.value); setPage(0); }} />
          –
          <input className="input" type="date" style={{ width: 140, padding: '5px 8px' }} value={txTo} onChange={e => { setTxTo(e.target.value); setPage(0); }} />
        </label>
        <button className={`btn btn-sm ${callableOnly ? 'btn-primary' : ''}`} onClick={() => { setCallableOnly(v => !v); setPage(0); }}>Callable</button>
        <div style={{ flex: 1 }} />
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
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
              {selectable && (
                <input type="checkbox" checked={allChecked} onChange={() => { const next = new Set(checkedIds); slice.forEach(p => allChecked ? next.delete(p.id) : next.add(p.id)); onCheckedChanged!(next); }} style={{ width: 30 }} />
              )}
              {headerCell(PINNED)}
              {visibleCols.map(headerCell)}
            </div>
            {/* Rows */}
            {slice.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>No properties match these filters.</div>
            ) : slice.map(p => {
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
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(filtered.length)} properties</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}

// ── Columns dialog (show/hide + drag-reorder) ──────────────────────────────
function ColumnsDialog({ order, visible, colByKey, onChange, onReset, onClose }: {
  order: ColKey[]; visible: Set<ColKey>; colByKey: Map<ColKey, ColDef>;
  onChange: (order: ColKey[], visible: ColKey[]) => void; onReset: () => void; onClose: () => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const toggle = (k: ColKey) => { const v = new Set(visible); v.has(k) ? v.delete(k) : v.add(k); onChange(order, Array.from(v)); };
  const move = (from: number, to: number) => { if (from === to) return; const o = [...order]; const [c] = o.splice(from, 1); o.splice(to, 0, c); onChange(o, Array.from(visible)); };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 400 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 6 }}>Table columns</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>Tick to show · drag to reorder. Unit stays first.</p>
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {order.map((k, i) => (
            <div key={k} draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={() => { if (dragIdx != null) move(dragIdx, i); setDragIdx(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, background: dragIdx === i ? 'var(--surface-2)' : 'transparent', cursor: 'grab' }}>
              <Icon name="grip" size={15} style={{ color: 'var(--text-tertiary)' }} />
              <input type="checkbox" checked={visible.has(k)} onChange={() => toggle(k)} />
              <span style={{ fontSize: '0.875rem' }}>{colByKey.get(k)?.label ?? k}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button className="btn btn-sm btn-ghost" onClick={onReset}><Icon name="refresh" size={14} /> Reset to default</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-sm btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
