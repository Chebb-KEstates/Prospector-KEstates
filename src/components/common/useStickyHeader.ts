import { useEffect, useRef, useState } from 'react';

/**
 * A sticky page header that reports its own height, so a SECOND sticky bar below
 * it (a data table's filter row) can be offset by that height and both stay
 * pinned without overlapping. The height re-measures when the header wraps.
 */
export function useStickyHeader<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, height };
}

/**
 * The shared sticky page-header band — the TOP of a cohesive toolbar panel:
 * opaque, rounded top corners, a full border, and comfortable padding so nothing
 * sits flush against the edge. The table's filter bar (below, offset by this
 * header's height) forms the bottom of the same panel.
 */
export const stickyHeaderStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 32, background: 'var(--surface)',
  border: '1px solid var(--border)', borderRadius: '12px 12px 0 0',
  padding: '12px 18px',
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
};
