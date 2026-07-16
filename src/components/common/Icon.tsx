import React from 'react';

/**
 * Minimal inline-SVG icon set (Lucide-style stroke paths) so the app uses crisp
 * SVG icons with zero extra dependencies — never emoji. Add glyphs here as needed.
 */
export type IconName =
  | 'home' | 'table' | 'users' | 'team' | 'settings' | 'control' | 'assign'
  | 'phone' | 'phoneCall' | 'check' | 'x' | 'chevronLeft' | 'chevronRight'
  | 'copy' | 'star' | 'flame' | 'clock' | 'upload' | 'download' | 'trash'
  | 'plus' | 'search' | 'columns' | 'sliders' | 'minimize' | 'play'
  | 'arrowRight' | 'alert' | 'sparkles' | 'layers' | 'coin' | 'vault'
  | 'user' | 'calendar' | 'refresh' | 'grip' | 'ban' | 'eye';

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 5.2A3 3 0 0 1 16 11M21 20c0-2.6-1.4-4.2-3.5-4.8" /></>,
  team: <><circle cx="12" cy="7" r="3.2" /><path d="M5 20c0-3.9 3.1-6 7-6s7 2.1 7 6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
  control: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="8" cy="18" r="2" fill="currentColor" stroke="none" /></>,
  assign: <><path d="M4 5h16v11H8l-4 3z" /><path d="M8 9h8M8 12h5" /></>,
  phone: <path d="M4 5c0 9 6 15 15 15l0-4-4-1-2 2c-3-1.5-5.5-4-7-7l2-2-1-4z" />,
  phoneCall: <path d="M4 5c0 9 6 15 15 15l0-4-4-1-2 2c-3-1.5-5.5-4-7-7l2-2-1-4zM15 3a6 6 0 0 1 6 6" />,
  check: <path d="M4 12.5 9 17.5 20 6.5" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  star: <path d="m12 3 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.3l6-.8z" />,
  flame: <path d="M12 3c1 3-2 4-2 7a4 4 0 0 0 8 0c0-2-1-3-1.5-4C17 7 14 5 12 3z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  upload: <path d="M12 16V4m-5 5 5-5 5 5M5 20h14" />,
  download: <path d="M12 4v12m-5-5 5 5 5-5M5 20h14" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
  sliders: <path d="M4 8h10M18 8h2M4 16h2M10 16h10M14 6v4M6 14v4" />,
  minimize: <path d="M9 9 4 4m0 5V4h5M15 15l5 5m0-5v5h-5" />,
  play: <path d="M7 4v16l13-8z" />,
  arrowRight: <path d="M5 12h14m-6-6 6 6-6 6" />,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 9v5M12 17h.01" /></>,
  sparkles: <path d="M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8zM19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />,
  layers: <path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5" />,
  coin: <><ellipse cx="12" cy="7" rx="8" ry="3.5" /><path d="M4 7v6c0 1.9 3.6 3.5 8 3.5s8-1.6 8-3.5V7" /></>,
  vault: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5v-1M12 16.5v-1" /></>,
  user: <><circle cx="12" cy="8" r="3.4" /><path d="M5 20c0-3.6 3-6 7-6s7 2.4 7 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v4M16 3v4" /></>,
  refresh: <path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4m2 2v-4h-4" />,
  grip: <><circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" /></>,
  ban: <><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>,
};

export function Icon({ name, size = 18, style, className }: {
  name: IconName; size?: number; style?: React.CSSProperties; className?: string;
}) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }} className={className} aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
