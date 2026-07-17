import React, { useMemo } from 'react';
import { useAuth } from '../../state/AuthContext';

/**
 * Faint diagonal identity watermark over every screen (Security Playbook §2.6):
 * a leaked screenshot becomes traceable to the signed-in account. Rendered ONCE
 * (in App.tsx) — never stack instances or the opacity doubles.
 *
 * Faithful to the Flutter painter: the signed-in identity repeated on an even
 * grid, rotated ~24° up-slope, at ~4.5% opacity — subtle enough never to fight
 * the content, present enough to survive a photo. Implemented as an SVG <pattern>
 * so the tiling is perfectly even and GPU-cheap.
 */
export function Watermark() {
  const { user } = useAuth();

  const label = useMemo(() => {
    if (!user) return null;
    const date = new Date().toISOString().slice(0, 10);
    return `${user.name} · ${user.email} · ${date}`;
  }, [user]);

  if (!label) return null;

  // Tile width tracks the label length so labels repeat evenly without clipping
  // (mirrors the Flutter painter's dx=300 / dy=130 regular grid).
  const tileW = Math.round(label.length * 7.1 + 46);
  const tileH = 132;

  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      <svg width="100%" height="100%" style={{ display: 'block', color: 'var(--text)' }}>
        <defs>
          <pattern id="wm-identity" width={tileW} height={tileH} patternUnits="userSpaceOnUse" patternTransform="rotate(-24)">
            <text x="0" y={tileH / 2} fill="currentColor" fillOpacity={0.05}
              style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '1.4px' }}>
              {label}
            </text>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#wm-identity)" />
      </svg>
    </div>
  );
}
