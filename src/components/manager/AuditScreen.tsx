import React, { useState, useMemo } from 'react';
import { useVault } from '../../state/VaultContext';
import { AppTable, Column } from '../common/AppTable';
import { AuditEntry } from '../../types/models';
import { fmtDateTime } from '../../utils/format';

export function AuditScreen() {
  const { audit, userById } = useVault();
  const [actionFilter, setActionFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    if (actionFilter === 'all') return audit;
    return audit.filter(a => a.action === actionFilter);
  }, [audit, actionFilter]);

  const actions = useMemo(() => {
    return Array.from(new Set(audit.map(a => a.action))).sort();
  }, [audit]);

  const columns: Column<AuditEntry>[] = [
    {
      key: 'at', header: 'Time', sortable: true,
      render: a => <span style={{ fontSize: '0.75rem', fontVariant: 'tabular-nums' }}>{fmtDateTime(a.at)}</span>,
    },
    {
      key: 'actor', header: 'Actor', sortable: true,
      render: a => userById(a.actorId)?.name ?? a.actorId,
    },
    {
      key: 'action', header: 'Action', sortable: true,
      render: a => (
        <span className="chip" style={{
          background: a.action === 'import' ? 'var(--info)20' :
            a.action === 'assign' ? 'var(--success)20' :
            a.action === 'call' ? 'var(--primary)20' :
            a.action === 'cap-block' ? 'var(--error)20' : 'var(--surface-2)',
          color: a.action === 'import' ? 'var(--info)' :
            a.action === 'assign' ? 'var(--success)' :
            a.action === 'call' ? 'var(--primary)' :
            a.action === 'cap-block' ? 'var(--error)' : 'var(--text)',
        }}>
          {a.action}
        </span>
      ),
    },
    {
      key: 'detail', header: 'Detail',
      render: a => a.detail,
    },
  ];

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Audit Trail</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn btn-sm ${actionFilter === 'all' ? 'btn-primary' : ''}`}
          onClick={() => setActionFilter('all')}>All</button>
        {actions.map(a => (
          <button key={a} className={`btn btn-sm ${actionFilter === a ? 'btn-primary' : ''}`}
            onClick={() => setActionFilter(a)}>
            {a}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <AppTable
          columns={columns}
          data={filtered}
          keyExtractor={a => a.id}
          pageSize={100}
          emptyMessage="No audit entries."
        />
      </div>
    </div>
  );
}
