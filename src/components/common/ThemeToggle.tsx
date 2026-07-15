import React from 'react';
import { useTheme } from '../../state/ThemeContext';

export function ThemeToggle() {
  const { mode, setMode } = useTheme();

  const optionStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    fontSize: '0.75rem',
    fontWeight: 500,
    border: 'none',
    background: active ? 'var(--primary)' : 'transparent',
    color: active ? 'white' : 'var(--text-secondary)',
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div style={{
      display: 'inline-flex',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      {(['system', 'light', 'dark'] as const).map(m => (
        <button
          key={m}
          style={optionStyle(mode === m)}
          onClick={() => setMode(m)}
        >
          {m.charAt(0).toUpperCase() + m.slice(1)}
        </button>
      ))}
    </div>
  );
}
