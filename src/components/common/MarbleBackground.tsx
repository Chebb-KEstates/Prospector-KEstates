import React from 'react';

export function MarbleBackground() {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 0,
      opacity: 0.15,
      background: `
        radial-gradient(ellipse at 20% 50%, #C8A96E 0%, transparent 50%),
        radial-gradient(ellipse at 80% 20%, #8B7355 0%, transparent 40%),
        radial-gradient(ellipse at 50% 80%, #6B573F 0%, transparent 45%),
        radial-gradient(ellipse at 30% 30%, #A0846A 0%, transparent 30%),
        radial-gradient(ellipse at 70% 70%, #5A4A3A 0%, transparent 35%)
      `,
    }} />
  );
}
