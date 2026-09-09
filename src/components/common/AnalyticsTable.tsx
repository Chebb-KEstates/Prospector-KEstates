import React, { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { useTableLayout, ColumnsDialog } from './tableLayout';

/**
 * A small breakdown table with:
 *  - a pinned identity column,
 *  - show/hide + drag-reorder on the rest (shared tableLayout, remembered per screen),
 *  - click-to-sort headers (client-side — these tables are small in-memory arrays).
 *
 * Used by the manager Report (broker + data-set breakdowns) and the dashboard's
 * broker board. Give a column a `sortValue` accessor to make its header sortable;
 * right-aligned (numeric) columns sort DESC on first click, others ASC.
 */

export interface Col<T> {
  key: string;
  label: string;
  align?: 'right';
  render: (row: T) => React.ReactNode;
  /** Present ⇒ the header is clickable to sort by this value. Nullish sorts last. */
  sortValue?: (row: T) => number | string | null | undefined;
}

const PINNED_KEY = '__pinned';

function compare(a: number | string | null | undefined, b: number | string | null | undefined): number {
  const an = a == null || a === '';
  const bn = b == null || b === '';
  if (an && bn) return 0;
  if (an) return 1;   // nullish/empty always last
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

export function AnalyticsTable<T extends { id: string }>({
  rows, pinned, columns, prefsKey, empty, defaultVisible,
}: {
  rows: T[];
  pinned: { label: string; render: (row: T) => React.ReactNode; sortValue?: (row: T) => number | string | null | undefined };
  columns: Col<T>[];
  prefsKey: string;
  empty: string;
  /** Which columns show before the user customises (defaults to all). */
  defaultVisible?: string[];
}) {
  const available = columns.map(c => c.key);
  const layout = useTableLayout(available, defaultVisible ?? available, prefsKey);
  const [showCols, setShowCols] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [asc, setAsc] = useState(true);

  const byKey = useMemo(() => new Map(columns.map(c => [c.key, c])), [columns]);
  const visible = layout.visibleCols.map(k => byKey.get(k)).filter((c): c is Col<T> => !!c);

  const accessorFor = (key: string): ((row: T) => number | string | null | undefined) | undefined =>
    key === PINNED_KEY ? pinned.sortValue : byKey.get(key)?.sortValue;

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const acc = sortKey === PINNED_KEY ? pinned.sortValue : byKey.get(sortKey)?.sortValue;
    if (!acc) return rows;
    const dir = asc ? 1 : -1;
    return [...rows].sort((ra, rb) => {
      const c = compare(acc(ra), acc(rb));
      return c === 0 ? 0 : c * dir;
    });
  }, [rows, sortKey, asc, byKey, pinned]);

  const onSort = (key: string, rightAligned: boolean) => {
    if (!accessorFor(key)) return;
    if (sortKey === key) setAsc(a => !a);
    else { setSortKey(key); setAsc(!rightAligned); } // numeric columns → biggest first
  };

  const headerCell = (key: string, label: string, rightAligned: boolean, sortable: boolean) => {
    const active = sortKey === key;
    return (
      <th
        key={key}
        onClick={sortable ? () => onSort(key, rightAligned) : undefined}
        style={{
          textAlign: rightAligned ? 'right' : undefined,
          cursor: sortable ? 'pointer' : undefined,
          whiteSpace: 'nowrap',
          color: active ? 'var(--primary)' : undefined,
        }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}>
          {label}
          {active && <Icon name="chevronRight" size={11} style={{ transform: asc ? 'rotate(-90deg)' : 'rotate(90deg)' }} />}
        </span>
      </th>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn btn-sm" onClick={() => setShowCols(true)}>
          <Icon name="columns" size={15} /> Columns
        </button>
      </div>

      {showCols && (
        <ColumnsDialog
          order={layout.order}
          visible={layout.visible}
          labelOf={k => byKey.get(k)?.label ?? k}
          pinnedLabel={pinned.label}
          onChange={(o, v) => { layout.setOrder(o); layout.setVisible(new Set(v)); layout.persist(o, new Set(v)); }}
          onReset={layout.reset}
          onClose={() => setShowCols(false)}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                {headerCell(PINNED_KEY, pinned.label, false, !!pinned.sortValue)}
                {visible.map(c => headerCell(c.key, c.label, c.align === 'right', !!c.sortValue))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr><td colSpan={visible.length + 1} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>{empty}</td></tr>
              ) : sortedRows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 500 }}>{pinned.render(r)}</td>
                  {visible.map(c => (
                    <td key={c.key} className={c.align === 'right' ? 'tabular-nums' : undefined}
                      style={{ textAlign: c.align === 'right' ? 'right' : undefined }}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
