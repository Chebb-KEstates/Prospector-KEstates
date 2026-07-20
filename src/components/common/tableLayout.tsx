import React, { useState, useEffect } from 'react';
import { Icon } from './Icon';

/**
 * The shared column-layout platform behind every data table: which columns are
 * shown, in what order, at what density — remembered per screen. Extracted so the
 * owner table and the lead table share ONE implementation (one table language).
 */
export function useTableLayout(available: string[], defaultVisible: string[], prefsKey?: string) {
  // v3: added the "Assigned to" column + page-size control — bump so the new
  // default columns show instead of an older persisted set hiding them.
  const storageKey = prefsKey ? `prospector.table.${prefsKey}.v3` : null;
  const [order, setOrder] = useState<string[]>(available);
  const [visible, setVisible] = useState<Set<string>>(() => new Set(defaultVisible.filter(k => available.includes(k))));
  const [dense, setDense] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load the persisted layout once.
  useEffect(() => {
    if (!storageKey) { setLoaded(true); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const j = JSON.parse(raw);
        const stored = (j.order as string[] ?? []).filter(k => available.includes(k));
        if (stored.length) setOrder([...stored, ...available.filter(k => !stored.includes(k))]);
        const vis = (j.visible as string[] ?? []).filter(k => available.includes(k));
        if (vis.length) setVisible(new Set(vis));
        if (typeof j.dense === 'boolean') setDense(j.dense);
      }
    } catch { /* corrupt prefs → defaults win */ }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Keep in sync when the available columns change (e.g. new `extra` columns appear).
  useEffect(() => {
    setOrder(prev => {
      const kept = prev.filter(k => available.includes(k));
      return [...kept, ...available.filter(k => !kept.includes(k))];
    });
    setVisible(prev => new Set(Array.from(prev).filter(k => available.includes(k))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available.join('|')]);

  const persist = (o: string[], v: Set<string>, d: boolean) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ order: o, visible: Array.from(v), dense: d })); } catch { /* ignore */ }
  };

  const reset = () => {
    const o = [...available];
    const v = new Set(defaultVisible.filter(k => available.includes(k)));
    setOrder(o); setVisible(v); persist(o, v, dense);
  };

  const visibleCols = order.filter(k => visible.has(k));
  return { order, setOrder, visible, setVisible, dense, setDense, persist, reset, visibleCols, loaded };
}

/** Tick to show · drag to reorder. Shared by every table. */
export function ColumnsDialog({ order, visible, labelOf, pinnedLabel, onChange, onReset, onClose }: {
  order: string[];
  visible: Set<string>;
  labelOf: (key: string) => string;
  pinnedLabel?: string;
  onChange: (order: string[], visible: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const toggle = (k: string) => {
    const v = new Set(visible); v.has(k) ? v.delete(k) : v.add(k); onChange(order, Array.from(v));
  };
  const move = (from: number, to: number) => {
    if (from === to) return;
    const o = [...order]; const [c] = o.splice(from, 1); o.splice(to, 0, c);
    onChange(o, Array.from(visible));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ width: 400 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 6 }}>Table columns</h3>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
          Tick to show · drag to reorder.{pinnedLabel ? ` ${pinnedLabel} stays first.` : ''}
        </p>
        <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {order.map((k, i) => (
            <div key={k} draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragIdx != null) move(dragIdx, i); setDragIdx(null); }}
              onDragEnd={() => setDragIdx(null)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 6, background: dragIdx === i ? 'var(--surface-2)' : 'transparent', cursor: 'grab' }}>
              <Icon name="grip" size={15} style={{ color: 'var(--text-tertiary)' }} />
              <input type="checkbox" checked={visible.has(k)} onChange={() => toggle(k)} />
              <span style={{ fontSize: '0.875rem' }}>{labelOf(k)}</span>
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
