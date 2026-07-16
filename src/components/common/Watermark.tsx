import React from 'react';

export function Watermark() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      pointerEvents: 'none',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transform: 'rotate(-30deg)',
      fontSize: '3rem',
      fontWeight: 700,
      color: 'var(--text)',
      opacity: 0.02,
      userSelect: 'none',
      whiteSpace: 'pre',
    }}>
      PROSPECTOR · INTERNAL
    </div>
  );
}
