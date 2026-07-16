import React from 'react';

interface CallFlowProps {
  phoneNumber: string;
  ownerName: string;
  callDuration: number;
  onEndCall: () => void;
  minimized?: boolean;
  onMinimize?: () => void;
}

export function CallFlow({ phoneNumber, ownerName, callDuration, onEndCall, minimized, onMinimize }: CallFlowProps) {
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (minimized) {
    return (
      <div style={{
        position: 'fixed', bottom: 16, right: 16,
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '8px 16px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        display: 'flex', alignItems: 'center', gap: 12, zIndex: 100,
        cursor: 'pointer',
      }} onClick={onMinimize}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)' }} />
        <span style={{ fontWeight: 500, fontSize: '0.8125rem' }}>{ownerName}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontVariant: 'tabular-nums' }}>
          {formatTime(callDuration)}
        </span>
      </div>
    );
  }

  return (
    <div className="card" style={{
      textAlign: 'center', padding: 32,
      maxWidth: 400, margin: '0 auto',
    }}>
      <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
        Calling
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 4 }}>
        {ownerName}
      </div>
      <div style={{
        fontSize: '1.75rem', fontWeight: 700, fontVariant: 'tabular-nums',
        color: 'var(--primary)', marginBottom: 24, letterSpacing: 2,
      }}>
        {phoneNumber}
      </div>
      <div style={{
        fontSize: '2rem', fontWeight: 700, fontVariant: 'tabular-nums',
        marginBottom: 24, color: 'var(--text)',
      }}>
        {formatTime(callDuration)}
      </div>
      <button
        className="btn btn-danger"
        onClick={onEndCall}
        style={{ padding: '12px 40px', fontSize: '1rem', borderRadius: 999 }}
      >
        End call
      </button>
    </div>
  );
}
