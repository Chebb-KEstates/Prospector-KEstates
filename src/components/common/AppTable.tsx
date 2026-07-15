import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render: (item: T) => React.ReactNode;
  width?: string;
}

interface AppTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectedIds?: Set<string>;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchFilter?: (item: T, query: string) => boolean;
  pageSize?: number;
  emptyMessage?: string;
}

export function AppTable<T>({
  columns, data, keyExtractor, onRowClick, selectedIds,
  searchable, searchPlaceholder = 'Search…', searchFilter,
  pageSize = 50, emptyMessage = 'No records',
}: AppTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!query || !searchFilter) return data;
    return data.filter(item => searchFilter(item, query));
  }, [data, query, searchFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const col = columns.find(c => c.key === sortKey);
      if (!col) return 0;
      const aVal = col.render(a)?.toString() ?? '';
      const bVal = col.render(b)?.toString() ?? '';
      const cmp = aVal.localeCompare(bVal);
      return sortAsc ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortAsc, columns]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  return (
    <div>
      {searchable && (
        <div style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder={searchPlaceholder}
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(0); }}
            style={{ maxWidth: 320 }}
          />
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={col.sortable ? 'sortable' : ''}
                  onClick={() => col.sortable && handleSort(col.key)}
                  style={{ width: col.width }}
                >
                  {col.header}
                  {sortKey === col.key && (
                    <span style={{ marginLeft: 4 }}>{sortAsc ? '▲' : '▼'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{
                  textAlign: 'center', padding: 32, color: 'var(--text-tertiary)',
                }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageData.map(item => {
                const id = keyExtractor(item);
                return (
                  <tr
                    key={id}
                    className={selectedIds?.has(id) ? 'selected' : ''}
                    onClick={() => onRowClick?.(item)}
                    style={onRowClick ? { cursor: 'pointer' } : undefined}
                  >
                    {columns.map(col => (
                      <td key={col.key}>{col.render(item)}</td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, marginTop: 12, fontSize: '0.8125rem',
        }}>
          <button
            className="btn btn-sm btn-ghost"
            disabled={page === 0}
            onClick={() => setPage(p => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span style={{ color: 'var(--text-secondary)' }}>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="btn btn-sm btn-ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
