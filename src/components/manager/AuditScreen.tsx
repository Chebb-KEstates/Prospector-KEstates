import React, { useState, useEffect } from 'react';
import { useVault } from '../../state/VaultContext';
import { AuditEntry } from '../../types/models';
import { fmtDateTime, fmtInt } from '../../utils/format';
import { Icon } from '../common/Icon';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/**
 * The audit trail.
 *
 * Paginated server-side: the trail is append-only and grows forever, so it's the
 * one collection that was never safe to load whole even before this migration.
 *
 * The action filter is a fixed list rather than "whatever's in the loaded rows".
 * Deriving it from the page would mean the filter offers fewer options the
 * further back you page — the filters would depend on what you'd already
 * filtered to.
 */

const ACTIONS = [
  'import', 'assign', 'reclaim', 'request', 'approve', 'deny', 'call',
  'view', 'cap-block', 'settings', 'user', 'dnc-undo', 'delete',
  'signin', 'password',
];

const PAGE_SIZE = 100;

function chipColor(action: string): { bg: string; fg: string } {
  switch (action) {
    case 'import': return { bg: 'var(--info)20', fg: 'var(--info)' };
    case 'assign': return { bg: 'var(--success)20', fg: 'var(--success)' };
    case 'call': return { bg: 'var(--primary)20', fg: 'var(--primary)' };
    case 'cap-block': return { bg: 'var(--error)20', fg: 'var(--error)' };
    case 'delete': return { bg: 'var(--error)20', fg: 'var(--error)' };
    default: return { bg: 'var(--surface-2)', fg: 'var(--text)' };
  }
}

export function AuditScreen() {
  const { userById, revision } = useVault();
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPage(0); }, [actionFilter]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const r = await api.audit.list({
          action: actionFilter === 'all' ? undefined : actionFilter,
          page,
          pageSize: PAGE_SIZE,
        });
        if (cancelled) return;
        setRows(r.rows);
        setTotal(r.total);
        setError(null);
      } catch (err) {
        if (!cancelled && !(err instanceof ApiError && err.isAuth)) {
          setError(err instanceof Error ? err.message : 'Could not load the audit trail.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [actionFilter, page, revision]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Audit Trail</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${actionFilter === 'all' ? 'btn-primary' : ''}`}
          onClick={() => setActionFilter('all')}>All</button>
        {ACTIONS.map(a => (
          <button key={a} className={`btn btn-sm ${actionFilter === a ? 'btn-primary' : ''}`}
            onClick={() => setActionFilter(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {error ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--error)' }}>{error}</td></tr>
              ) : loading && rows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 32, color: 'var(--text-tertiary)' }}>No audit entries.</td></tr>
              ) : rows.map(a => {
                const c = chipColor(a.action);
                return (
                  <tr key={a.id}>
                    <td><span style={{ fontSize: '0.75rem', fontVariant: 'tabular-nums' }}>{fmtDateTime(a.at)}</span></td>
                    <td>{userById(a.actorId)?.name ?? a.actorId ?? '—'}</td>
                    <td><span className="chip" style={{ background: c.bg, color: c.fg }}>{a.action}</span></td>
                    <td>{a.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{fmtInt(total)} entries</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-icon btn-sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}><Icon name="chevronLeft" size={16} /></button>
          <span style={{ fontSize: '0.75rem' }}>Page {pg + 1} of {pages}</span>
          <button className="btn btn-icon btn-sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}><Icon name="chevronRight" size={16} /></button>
        </div>
      </div>
    </div>
  );
}
