import React from 'react';
import { useCallSession, CallStop } from '../../state/CallSessionContext';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { CallCard } from './CallCard';
import { Icon } from '../common/Icon';

/** A faded, angled preview of a neighbouring caller in the coverflow. */
function PreviewTile({ stop, side, done }: { stop: CallStop; side: 'left' | 'right'; done: boolean }) {
  const rot = side === 'left' ? 34 : -34;
  return (
    <div style={{
      width: 190, flexShrink: 0,
      transform: `perspective(1100px) rotateY(${rot}deg) scale(0.82)`,
      transformOrigin: side === 'left' ? 'right center' : 'left center',
      opacity: 0.5, transition: 'all 0.25s ease',
    }}>
      <div className="card" style={{ padding: 14, pointerEvents: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 16 }}>{stop.flag}</span>
          <span className="truncate" style={{ fontWeight: 600, fontSize: '0.85rem' }}>{stop.name}</span>
        </div>
        <div className="truncate" style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 12 }}>{stop.subtitle}</div>
        <div style={{
          textAlign: 'center', padding: '6px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600,
          background: done ? 'color-mix(in srgb, var(--success) 15%, transparent)' : 'color-mix(in srgb, var(--gold) 12%, transparent)',
          color: done ? 'var(--success)' : 'var(--gold-dark)',
        }}>
          {done ? '✓ Done' : side === 'left' ? 'Passed' : 'Up next'}
        </div>
      </div>
    </div>
  );
}

export function CallSessionView() {
  const { session, next, prev, logged, setIndex } = useCallSession();
  const { user } = useAuth();
  const vault = useVault();

  if (!session || !user) return null;
  const { stops, index } = session;
  const stop = stops[index];
  const total = stops.length;
  const worked = session.worked;

  const onReveal = () => vault.recordView(user.id, false, `Revealed number — ${stop.name}`, false);

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
            <div style={{ width: `${(worked / total) * 100}%`, height: '100%', background: 'var(--gold)' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{worked}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>worked</div></div>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--info)' }}>{session.reached}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>reached</div></div>
          <div><div className="tabular-nums" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>{session.interested}</div><div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>interested</div></div>
        </div>
      </div>

      {/* Coverflow */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minHeight: 0 }}>
        <button className="btn btn-icon" onClick={prev} disabled={index === 0}
          style={{ alignSelf: 'center', opacity: index === 0 ? 0.35 : 1 }} aria-label="Previous caller">
          <Icon name="chevronLeft" size={22} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flex: 1, overflow: 'hidden', perspective: 1100 }}>
          {index > 0 && (
            <div onClick={() => setIndex(index - 1)} style={{ cursor: 'pointer', marginRight: -30 }}>
              <PreviewTile stop={stops[index - 1]} side="left" done={index - 1 < worked} />
            </div>
          )}
          <div style={{ flex: '0 1 520px', minWidth: 320, zIndex: 2, maxHeight: '100%' }}>
            <CallCard key={stop.id} stop={stop} onReveal={onReveal}
              onComplete={(o) => logged(o)} onSkip={next} />
          </div>
          {index < total - 1 && (
            <div onClick={() => setIndex(index + 1)} style={{ cursor: 'pointer', marginLeft: -30 }}>
              <PreviewTile stop={stops[index + 1]} side="right" done={false} />
            </div>
          )}
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
