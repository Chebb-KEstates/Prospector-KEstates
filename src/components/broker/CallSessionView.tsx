import React, { useRef, useState, useLayoutEffect, useEffect } from 'react';
import { useCallSession, CallStop } from '../../state/CallSessionContext';
import { useAuth } from '../../state/AuthContext';
import { CallCard } from './CallCard';
import { Icon } from '../common/Icon';

/** Flat preview of a neighbouring caller — the parent applies the 3D transform. */
function PreviewTile({ stop, side, done }: { stop: CallStop; side: 'left' | 'right'; done: boolean }) {
  return (
    <div className="card" style={{ height: '100%', padding: 16, display: 'flex', flexDirection: 'column', gap: 12, pointerEvents: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{stop.flag}</span>
        <span className="truncate" style={{ fontWeight: 600, fontSize: '0.9rem' }}>{stop.name}</span>
      </div>
      <div className="truncate" style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{stop.subtitle}</div>
      <div style={{ flex: 1 }} />
      <div style={{
        textAlign: 'center', padding: '8px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600,
        background: done ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--gold) 12%, transparent)',
        color: done ? 'var(--success)' : 'var(--gold-dark)',
      }}>
        {done ? '✓ Done' : side === 'left' ? 'Passed' : 'Up next'}
      </div>
    </div>
  );
}

export function CallSessionView() {
  const { session, next, prev, logged, setIndex } = useCallSession();
  const { user } = useAuth();

  const viewportRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Arrow-key navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack arrow keys while the broker is typing notes / in a field.
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  if (!session || !user) return null;
  const { stops, index } = session;
  const total = stops.length;
  const worked = session.worked;

  // The reveal is audited inside stop.reveal() — the card owns it now.
  const cardW = Math.max(300, Math.min(w * 0.82, 540));
  const offsetPx = Math.min(w * 0.32, 300);

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Session header */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{session.title}</div>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
            Caller {index + 1} of {total} · {total - index - 1} to go
          </div>
          <div style={{ marginTop: 8, height: 5, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${(worked / total) * 100}%`, height: '100%', background: 'var(--gold)', transition: 'width .3s' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{worked}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>worked</div></div>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--info)' }}>{session.reached}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>reached</div></div>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>{session.interested}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>interested</div></div>
        </div>
      </div>

      {/* Coverflow */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flex: 1, minHeight: 0 }}>
        <button className="btn btn-icon" onClick={prev} disabled={index === 0}
          style={{ alignSelf: 'center', opacity: index === 0 ? 0.35 : 1 }} aria-label="Previous caller">
          <Icon name="chevronLeft" size={22} />
        </button>

        <div ref={viewportRef} style={{ position: 'relative', flex: 1, overflow: 'hidden', perspective: 1500 }}>
          {stops.map((stop, i) => {
            const offset = i - index;
            if (Math.abs(offset) > 2) return null;
            const isActive = offset === 0;
            const transform =
              `translateX(-50%) translateX(${offset * offsetPx}px) ` +
              `rotateY(${-offset * 22}deg) scale(${1 - Math.abs(offset) * 0.16})`;
            return (
              <div key={stop.id}
                onClick={() => { if (!isActive) setIndex(i); }}
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: '50%',
                  width: cardW, transform, transformStyle: 'preserve-3d',
                  transformOrigin: offset < 0 ? 'left center' : offset > 0 ? 'right center' : 'center',
                  opacity: Math.max(0.35, 1 - Math.abs(offset) * 0.42),
                  zIndex: 10 - Math.abs(offset),
                  transition: 'transform .42s cubic-bezier(.22,.61,.36,1), opacity .42s',
                  cursor: isActive ? 'default' : 'pointer',
                  pointerEvents: Math.abs(offset) > 1 ? 'none' : 'auto',
                }}>
                {isActive
                  ? <CallCard key={stop.id} stop={stop} onComplete={(o) => logged(o)} onSkip={next} />
                  : <PreviewTile stop={stop} side={offset < 0 ? 'left' : 'right'} done={i < worked} />}
              </div>
            );
          })}
        </div>

        <button className="btn btn-icon" onClick={next} disabled={index === total - 1}
          style={{ alignSelf: 'center', opacity: index === total - 1 ? 0.35 : 1 }} aria-label="Next caller">
          <Icon name="chevronRight" size={22} />
        </button>
      </div>

      <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-tertiary)', display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
        <Icon name="chevronLeft" size={13} /> Use the arrows to move through your list <Icon name="chevronRight" size={13} />
      </div>
    </div>
  );
}
