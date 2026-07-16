import React, { useState, useMemo } from 'react';
import { Property, PropertyState } from '../../types/models';
import { StateChip, OutcomeChip } from '../common/StateChip';
import { AppTable, Column } from '../common/AppTable';
import { maskedPhone, fmtDate, fmtAed, fmtArea } from '../../utils/format';
import { useVault } from '../../state/VaultContext';

interface PropertyTableProps {
  properties: Property[];
  onSelect?: (id: string) => void;
  showActions?: boolean;
  onAssign?: (properties: Property[]) => void;
  onReclaim?: (properties: Property[]) => void;
  /** Teaser mode: hide owner name + phone (unassigned pool shown to brokers). */
  teaser?: boolean;
}

export function PropertyTable({ properties, onSelect, showActions, onAssign, onReclaim, teaser }: PropertyTableProps) {
  const { userById, communities } = useVault();
  const [stateFilter, setStateFilter] = useState<PropertyState | 'all'>('all');
  const [communityFilter, setCommunityFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    return properties.filter(p => {
      if (stateFilter !== 'all' && p.state !== stateFilter) return false;
      if (communityFilter !== 'all' && p.community !== communityFilter) return false;
      return true;
    });
  }, [properties, stateFilter, communityFilter]);

  const columns: Column<Property>[] = [
    {
      key: 'owner', header: teaser ? 'Owner (hidden until assigned)' : 'Owner', sortable: !teaser,
      render: p => teaser
        ? <span style={{ color: 'var(--text-tertiary)' }}>—</span>
        : <span style={{ fontWeight: 500 }}>{p.owner.name || '—'}</span>,
    },
    {
      key: 'phone', header: 'Phone', sortable: !teaser,
      render: p => <span style={{ color: 'var(--text-secondary)', fontVariant: 'tabular-nums' }}>
        {teaser ? '—' : maskedPhone(p.owner.phone)}
      </span>,
    },
    {
      key: 'community', header: 'Community', sortable: true,
      render: p => p.community,
    },
    {
      key: 'unit', header: 'Unit',
      render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.unitLabel}</span>,
    },
    {
      key: 'beds', header: 'Beds',
      render: p => p.beds != null ? p.beds : '—',
    },
    {
      key: 'size', header: 'Size',
      render: p => <span style={{ color: 'var(--text-secondary)' }}>{p.sizeSqft != null ? fmtArea(p.sizeSqft) : '—'}</span>,
    },
    {
      key: 'lastTx', header: 'Last transaction',
      render: p => p.lastTransactionValue != null
        ? <span style={{ color: 'var(--text-secondary)' }}>{fmtAed(p.lastTransactionValue)}<span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem' }}> · {fmtDate(p.lastTransactionDate)}</span></span>
        : '—',
    },
    {
      key: 'state', header: 'State', sortable: true,
      render: p => <StateChip state={p.state} />,
    },
    {
      key: 'assignedTo', header: 'Assigned To', sortable: true,
      render: p => {
        if (!p.assignedTo) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
        return userById(p.assignedTo)?.name ?? p.assignedTo;
      },
    },
    {
      key: 'lastOutcome', header: 'Last Outcome',
      render: p => p.lastOutcome ? <OutcomeChip outcome={p.lastOutcome} /> : '—',
    },
    {
      key: 'lastCalled', header: 'Last Called',
      render: p => fmtDate(p.lastCalledAt),
    },
    {
      key: 'nextFollowUp', header: 'Follow-up',
      render: p => p.nextFollowUpAt ? fmtDate(p.nextFollowUpAt) : '—',
    },
  ];

  return (
    <div>
      {/* Filters */}
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
        <select
          className="input"
          style={{ width: 'auto', minWidth: 140 }}
          value={communityFilter}
          onChange={e => setCommunityFilter(e.target.value)}
        >
          <option value="all">All communities</option>
          {communities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <AppTable
          columns={columns}
          data={filtered}
          keyExtractor={p => p.id}
          onRowClick={p => onSelect?.(p.id)}
          searchable
          searchPlaceholder={teaser ? 'Search community or unit…' : 'Search owner name or phone…'}
          searchFilter={(p, q) => {
            const query = q.toLowerCase();
            const ownerMatch = !teaser && (
              p.owner.name.toLowerCase().includes(query) ||
              (p.owner.phone?.includes(query) ?? false));
            return ownerMatch ||
              p.community.toLowerCase().includes(query) ||
              p.unitLabel.toLowerCase().includes(query);
          }}
        />
      </div>
    </div>
  );
}
