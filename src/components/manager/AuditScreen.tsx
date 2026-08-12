import React, { useState, useEffect, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { CallOutcome, CallOutcomeLabel } from '../../types/models';
import { fmtDateTime, fmtInt } from '../../utils/format';
import { Icon } from '../common/Icon';
import { saveBlob } from '../../logic/downloadFile';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/**
 * The activity log — a complete, readable history of everything on the app.
 *
 * Server-side: the feed merges the audit trail with the call records, resolves
 * unit IDs to owner + unit labels, and MASKS every phone number. It is paginated
 * (the trail grows forever), filterable (action, broker, date range, free-text),
 * sortable, and exportable to Excel (still masked — numbers never leave in a file).
 */

// Raw actions, for the action filter. 'view' covers both plain views and reveals
// (a reveal shows as its own row label). No 'cap-block' — that feature is gone.
const ACTIONS = [
  'call', 'view', 'update', 'assign', 'reclaim', 'request', 'approve', 'deny',
  'import', 'export', 'edit', 'delete', 'settings', 'user', 'dnc-undo',
  'signin', 'password',
];

const PAGE_SIZE = 100;

function chipColor(action: string): { bg: string; fg: string } {
  switch (action) {
    case 'import': return { bg: 'var(--info)20', fg: 'var(--info)' };
    case 'assign': return { bg: 'var(--success)20', fg: 'var(--success)' };
    case 'call': return { bg: 'var(--primary)20', fg: 'var(--primary)' };
    case 'update': return { bg: 'var(--info)20', fg: 'var(--info)' };
    case 'reveal': return { bg: 'var(--warning)20', fg: 'var(--warning)' };
    case 'delete': return { bg: 'var(--error)20', fg: 'var(--error)' };
    case 'dnc-undo': return { bg: 'var(--error)20', fg: 'var(--error)' };
    default: return { bg: 'var(--surface-2)', fg: 'var(--text)' };
  }
}

/** The right-hand "Details" cell — result, note, masked number, or raw detail. */
function Details({ r }: { r: api.ActivityRow }) {
  const parts: React.ReactNode[] = [];
  if (r.outcome) {
    parts.push(
      <span key="o" className="chip" style={{ background: 'var(--surface-2)', fontWeight: 600, marginRight: 6 }}>
        {CallOutcomeLabel[r.outcome as CallOutcome] ?? r.outcome}
      </span>,
    );
  }
  if (r.numberMasked) {
    parts.push(<span key="n" style={{ fontVariant: 'tabular-nums', color: 'var(--text-secondary)', marginRight: 6 }}>number {r.numberMasked}</span>);
  }
  const text = r.note ?? (r.outcome || r.numberMasked ? '' : r.detail);
  if (text) parts.push(<span key="t">{text}</span>);
  return <>{parts.length ? parts : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</>;
}

export function AuditScreen() {
  const { userById, users, revision } = useVault();
  const [actionFilter, setActionFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'at' | 'actor' | 'action'>('at');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const [rows, setRows] = useState<api.ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounce the search box so we don't query on every keystroke.
  useEffect(() => {
    const h = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(h);
  }, [searchInput]);

  // Any filter change resets to the first page.
  useEffect(() => { setPage(0); }, [actionFilter, actorFilter, from, to, search, sort, dir]);

  const filter = useMemo<api.AuditFilter>(() => ({
    action: actionFilter === 'all' ? undefined : actionFilter,
    actorId: actorFilter || undefined,
    from: from || undefined,
    to: to || undefined,
    search: search || undefined,
    sort, dir,
  }), [actionFilter, actorFilter, from, to, search, sort, dir]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.audit.list({ ...filter, page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setRows(r.rows); setTotal(r.total); setError(null);
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError && err.isAuth)) {
          setError(err instanceof Error ? err.message : 'Could not load the activity log.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [filter, page, revision]);

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await api.audit.exportBlob(filter);
      saveBlob(`Prospector activity ${new Date().toISOString().slice(0, 10)}.xlsx`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export the activity log.');
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setActionFilter('all'); setActorFilter(''); setFrom(''); setTo('');
    setSearchInput(''); setSearch(''); setSort('at'); setDir('desc');
  };

  const toggleSort = (col: 'at' | 'actor' | 'action') => {
    if (sort === col) setDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(col); setDir('desc'); }
  };
  const sortIcon = (col: string) => (sort === col ? (dir === 'desc' ? ' ↓' : ' ↑') : '');

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const filtersActive = actionFilter !== 'all' || actorFilter || from || to || search;

  const th = (label: string, col?: 'at' | 'actor' | 'action') => (
    <th
      onClick={col ? () => toggleSort(col) : undefined}
      style={col ? { cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' } : undefined}
    >
      {label}{col ? sortIcon(col) : ''}
    </th>
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Activity Log</h2>
        <button className="btn btn-sm" onClick={() => void doExport()} disabled={exporting}>
          <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" placeholder="Search owner, unit or note…" value={searchInput}
          onChange={e => setSearchInput(e.target.value)} style={{ maxWidth: 260 }} />
        <select className="input" value={actorFilter} onChange={e => setActorFilter(e.target.value)} style={{ maxWidth: 200 }}>
          <option value="">All people</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          From <input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 150 }} />
        </label>
        <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          To <input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 150 }} />
        </label>
        {filtersActive && (
          <button className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear filters</button>
        )}
      </div>

      {/* Action chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${actionFilter === 'all' ? 'btn-primary' : ''}`}
          onClick={() => setActionFilter('all')}>All</button>
        {ACTIONS.map(a => (
          <button key={a} className={`btn btn-sm ${actionFilter === a ? 'btn-primary' : ''}`}
            onClick={() => setActionFilter(a)}>{a}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {th('Time', 'at')}
                {th('Person', 'actor')}
                {th('Action', 'action')}
                {th('Owner')}
                {th('Unit')}
                {th('Details')}
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--error)' }}>{error}</td></tr>
              ) : loading && rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No activity matches these filters.</td></tr>
              ) : rows.map(a => {
                const c = chipColor(a.displayAction);
                return (
                  <tr key={a.id}>
                    <td><span style={{ fontSize: '0.75rem', fontVariant: 'tabular-nums', whiteSpace: 'nowrap' }}>{fmtDateTime(a.at)}</span></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{userById(a.actorId ?? '')?.name ?? a.actorId ?? '—'}</td>
                    <td><span className="chip" style={{ background: c.bg, color: c.fg }}>{a.displayAction}</span></td>
                    <td>{a.ownerName ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</td>
                    <td><span style={{ fontSize: '0.8125rem' }}>{a.unitLabel ?? <span style={{ color: 'var(--text-tertiary)' }}>—</span>}</span></td>
                    <td><Details r={a} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(total)} events</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
