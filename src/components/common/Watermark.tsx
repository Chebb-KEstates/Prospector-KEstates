import React, { useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';

/**
 * Faint diagonal identity watermark over every data screen (Security Playbook §2.6):
 * a leaked screenshot becomes traceable to the signed-in account. It tiles the user's
 * name + email + the current date across the whole viewport at a low-but-photographable
 * opacity — subtle enough never to fight the content, present enough to survive a photo.
 *
 * Screenshots cannot be blocked in a browser (the OS owns that key); this watermark IS
 * the deterrent. It must carry identity — a fixed label would defeat its only purpose.
 */
export function Watermark() {
  const { user } = useAuth();

  const label = useMemo(() => {
    if (!user) return null;
    const date = new Date().toISOString().slice(0, 10);
    return `${user.name} · ${user.email} · ${date}`;
  }, [user]);

  if (!label) return null;

  // A tiled grid of the label on a rotated plane that over-covers the viewport.
  const cols = 4;
  const rows = 9;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(
        <span
          key={`${r}-${c}`}
          style={{
            whiteSpace: 'nowrap',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '1.2px',
            color: 'var(--text)',
          }}
        >
          {label}
        </span>,
      );
    }
  }

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
        overflow: 'hidden',
        opacity: 0.05,
        userSelect: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '-25%',
          left: '-25%',
          width: '150%',
          height: '150%',
          transform: 'rotate(-24deg)',
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: '96px',
          alignItems: 'center',
          justifyItems: 'center',
          columnGap: '40px',
        }}
      >
        {cells}
      </div>
    </div>
  );
}
