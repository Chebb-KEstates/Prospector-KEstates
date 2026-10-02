import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useTableLayout, ColumnsDialog } from './tableLayout';
import { downloadAoaXlsx } from '../../logic/exportSheet';

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
  /** The footer "total" cell for this column (e.g. a sum), computed over ALL
   *  rows. Only shown when the table is asked for totals; absent ⇒ blank cell. */
  total?: (rows: T[]) => React.ReactNode;
  /** Plain value for the Excel export (the `render` output is JSX, not a value).
   *  Falls back to `sortValue` when omitted — give it explicitly for cells whose
   *  sort key isn't the readable value (rates, "days since", list columns). */
  exportValue?: (row: T) => string | number | null | undefined;
}

/** Opt-in row checkboxes (e.g. the request popup's approve/deny selection). */
export interface RowSelection<T> {
  selected: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  /** Rows that can't be picked show a disabled box. Defaults to every row. */
  canSelect?: (row: T) => boolean;
  /** Freeze every box (e.g. while a decision is being saved). */
  disabled?: boolean;
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
  rows, pinned, columns, prefsKey, empty, defaultVisible, onRowClick, toolbarLeft, showTotals, maxHeight,
  exportFilename, exportTitle, selection,
}: {
  rows: T[];
  pinned: { label: string; render: (row: T) => React.ReactNode; sortValue?: (row: T) => number | string | null | undefined; total?: (rows: T[]) => React.ReactNode; exportValue?: (row: T) => string | number | null | undefined };
  columns: Col<T>[];
  prefsKey: string;
  empty: string;
  /** Which columns show before the user customises (defaults to all). */
  defaultVisible?: string[];
  /** When set, each row is clickable (e.g. to open the record). */
  onRowClick?: (row: T) => void;
  /** Extra controls rendered on the LEFT of the toolbar, in line with the
   *  Columns button (e.g. the drill-down popup's search + filter bar). */
  toolbarLeft?: React.ReactNode;
  /** Show a totals row pinned to the bottom (uses each column's `total`). */
  showTotals?: boolean;
  /** Cap the body height (px, or any CSS length like '50vh'): the header stays
   *  pinned at the top, the totals row at the bottom, and rows scroll between. */
  maxHeight?: number | string;
  /** When set, an "Export" button appears next to Columns and downloads the
   *  CURRENTLY visible columns (in order) × current rows as this .xlsx file. */
  exportFilename?: string;
  /** Optional first line written above the header row in the exported sheet
   *  (e.g. the active date range), so the file says what it's a snapshot of. */
  exportTitle?: string;
  /** When set, a checkbox column leads the table. The header box selects /
   *  clears the rows currently shown (after filters), never hidden ones. */
  selection?: RowSelection<T>;
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

  // Selection: the header box acts on the rows SHOWN (after filters) that can be
  // picked — selecting all never reaches rows a filter is hiding.
  const canSelect = (row: T) => !!selection && (selection.canSelect?.(row) ?? true);
  const pickable = selection ? sortedRows.filter(canSelect) : [];
  const shownPicked = selection ? pickable.filter(r => selection.selected.has(r.id)).length : 0;
  const allShownPicked = pickable.length > 0 && shownPicked === pickable.length;
  const headBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headBox.current) headBox.current.indeterminate = shownPicked > 0 && !allShownPicked;
  }, [shownPicked, allShownPicked]);

  const toggleAllShown = () => {
    if (!selection || selection.disabled) return;
    const next = new Set(selection.selected);
    for (const r of pickable) {
      if (allShownPicked) next.delete(r.id); else next.add(r.id);
    }
    selection.onChange(next);
  };
  const toggleRow = (row: T) => {
    if (!selection || selection.disabled || !canSelect(row)) return;
    const next = new Set(selection.selected);
    if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
    selection.onChange(next);
  };
  const checkCell: React.CSSProperties = { width: 36, textAlign: 'center', padding: '0 8px' };
  const colCount = visible.length + 1 + (selection ? 1 : 0);

  const onSort = (key: string, rightAligned: boolean) => {
    if (!accessorFor(key)) return;
    if (sortKey === key) setAsc(a => !a);
    else { setSortKey(key); setAsc(!rightAligned); } // numeric columns → biggest first
  };

  // Excel export — the visible columns, in their current order, over the rows as
  // currently sorted. Values come from each column's `exportValue` (or its
  // `sortValue` as a fallback); JSX `render` output is never touched.
  const exportNow = () => {
    if (!exportFilename) return;
    const cell = (
      row: T,
      acc?: (row: T) => string | number | null | undefined,
      fallback?: (row: T) => number | string | null | undefined,
    ): string | number => {
      const v = acc ? acc(row) : fallback ? fallback(row) : undefined;
      return v == null ? '' : v;
    };
    const header = [pinned.label, ...visible.map(c => c.label)];
    const body = sortedRows.map(r => [
      cell(r, pinned.exportValue, pinned.sortValue),
      ...visible.map(c => cell(r, c.exportValue, c.sortValue)),
    ]);
    const aoa = [...(exportTitle ? [[exportTitle], []] : []), header, ...body];
    downloadAoaXlsx(`${exportFilename}.xlsx`, exportFilename, aoa);
  };

  // When the body is height-capped, the header sticks to the top of the scroll
  // box. An opaque background + an inset bottom line keep it readable and keep
  // the divider visible while rows scroll underneath (border-collapse drops the
  // real border on a sticky cell).
  const stickyHead: React.CSSProperties = maxHeight
    ? { position: 'sticky', top: 0, zIndex: 3, background: 'var(--surface)', boxShadow: 'inset 0 -1px 0 var(--border)' }
    : {};
  // The totals row: bold, a distinct tinted "bar", with a top divider that
  // survives border-collapse (via an inset shadow). Pinned to the bottom when
  // the body is height-capped.
  const footerTd: React.CSSProperties = {
    fontWeight: 700, background: 'var(--surface-2)', color: 'var(--text)',
    boxShadow: 'inset 0 2px 0 -1px var(--border)',
  };
  const stickyFoot: React.CSSProperties = maxHeight ? { position: 'sticky', bottom: 0, zIndex: 3 } : {};

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
          ...stickyHead,
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        {toolbarLeft && <div style={{ flex: '1 1 auto', minWidth: 0 }}>{toolbarLeft}</div>}
        {exportFilename && (
          <button className="btn btn-sm" onClick={exportNow} disabled={rows.length === 0}
            title="Download this table (current columns) as an Excel file"
            style={{ marginLeft: toolbarLeft ? undefined : 'auto', flexShrink: 0 }}>
            <Icon name="download" size={15} /> Export
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setShowCols(true)} style={{ marginLeft: exportFilename || toolbarLeft ? undefined : 'auto', flexShrink: 0 }}>
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
        <div style={{ overflowX: 'auto', ...(maxHeight ? { overflowY: 'auto', maxHeight } : {}) }}>
          <table className="data-table">
            <thead>
              <tr>
                {selection && (
                  <th style={{ ...checkCell, ...stickyHead }}>
                    <input ref={headBox} type="checkbox" aria-label="Select all shown"
                      checked={allShownPicked}
                      disabled={selection.disabled || pickable.length === 0}
                      onChange={toggleAllShown}
                      title={allShownPicked ? 'Clear the rows shown' : 'Select the rows shown'} />
                  </th>
                )}
                {headerCell(PINNED_KEY, pinned.label, false, !!pinned.sortValue)}
                {visible.map(c => headerCell(c.key, c.label, c.align === 'right', !!c.sortValue))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr><td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>{empty}</td></tr>
              ) : sortedRows.map(r => (
                <tr key={r.id}
                  className={selection?.selected.has(r.id) ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}>
                  {selection && (
                    // The whole cell toggles (a bigger target than the box) and
                    // never bubbles to the row's click, which opens the record.
                    <td style={{ ...checkCell, cursor: canSelect(r) && !selection.disabled ? 'pointer' : undefined }}
                      onClick={e => { e.stopPropagation(); if (e.target === e.currentTarget) toggleRow(r); }}>
                      <input type="checkbox" aria-label="Select row"
                        checked={selection.selected.has(r.id)}
                        disabled={selection.disabled || !canSelect(r)}
                        onChange={() => toggleRow(r)} />
                    </td>
                  )}
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
            {showTotals && sortedRows.length > 0 && (
              // The total bar. Stays pinned to the bottom of the scroll box when
              // the body is height-capped; totals are computed over ALL rows.
              <tfoot>
                <tr>
                  {selection && <td style={{ ...footerTd, ...stickyFoot }} />}
                  <td style={{ ...footerTd, ...stickyFoot }}>{pinned.total ? pinned.total(rows) : 'Total'}</td>
                  {visible.map(c => (
                    <td key={c.key} className={c.align === 'right' ? 'tabular-nums' : undefined}
                      style={{ ...footerTd, ...stickyFoot, textAlign: c.align === 'right' ? 'right' : undefined }}>
                      {c.total ? c.total(rows) : null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
