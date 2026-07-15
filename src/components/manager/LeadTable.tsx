import React, { useState, useMemo } from 'react';
import { Lead, PropertyState } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { AppTable, Column } from '../common/AppTable';
import { maskedPhone, fmtDate } from '../../utils/format';
import { useVault } from '../../state/VaultContext';

interface LeadTableProps {
  leads: Lead[];
  onSelect?: (id: string) => void;
  showActions?: boolean;
  onAssign?: (leads: Lead[]) => void;
}

export function LeadTable({ leads, onSelect }: LeadTableProps) {
  const { userById } = useVault();
  const [stateFilter, setStateFilter] = useState<PropertyState | 'all'>('all');

  const filtered = useMemo(() => {
    if (stateFilter === 'all') return leads;
    return leads.filter(l => l.state === stateFilter);
  }, [leads, stateFilter]);

  const columns: Column<Lead>[] = [
    {
      key: 'name', header: 'Name', sortable: true,
      render: l => <span style={{ fontWeight: 500 }}>{l.name || '—'}</span>,
    },
    {
      key: 'phone', header: 'Phone', sortable: true,
      render: l => <span style={{ color: 'var(--text-secondary)', fontVariant: 'tabular-nums' }}>
        {maskedPhone(l.phone)}
      </span>,
    },
    {
      key: 'email', header: 'Email',
      render: l => l.email ?? '—',
    },
    {
      key: 'project', header: 'Project', sortable: true,
      render: l => l.project ?? '—',
    },
    {
      key: 'source', header: 'Source', sortable: true,
      render: l => l.source ?? '—',
    },
    {
      key: 'state', header: 'State', sortable: true,
      render: l => <StateChip state={l.state} />,
    },
    {
      key: 'assignedTo', header: 'Assigned To',
      render: l => {
        if (!l.assignedTo) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
        return userById(l.assignedTo)?.name ?? l.assignedTo;
      },
    },
    {
      key: 'lastOutcome', header: 'Last Outcome',
      render: l => l.lastOutcome ? <OutcomeChip outcome={l.lastOutcome} buyer /> : '—',
    },
    {
      key: 'enquiryDate', header: 'Enquiry Date',
      render: l => fmtDate(l.enquiryDate),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {[{ key: 'all', label: 'All' } as const, ...Object.values(PropertyState).map(s => ({
          key: s, label: PropertyState[s] as string,
        }))].map(f => (
          <button
            key={f.key}
            className={`btn btn-sm ${stateFilter === f.key ? 'btn-primary' : ''}`}
            onClick={() => setStateFilter(f.key as PropertyState | 'all')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <AppTable
          columns={columns}
          data={filtered}
          keyExtractor={l => l.id}
          onRowClick={l => onSelect?.(l.id)}
          searchable
          searchPlaceholder="Search name, phone or email…"
          searchFilter={(l, q) => {
            const query = q.toLowerCase();
            return l.name.toLowerCase().includes(query) ||
              (l.phone?.includes(query) ?? false) ||
              (l.email?.toLowerCase().includes(query) ?? false) ||
              (l.project?.toLowerCase().includes(query) ?? false);
          }}
        />
      </div>
    </div>
  );
}
