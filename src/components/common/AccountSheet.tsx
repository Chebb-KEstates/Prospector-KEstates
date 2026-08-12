import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';

export function AccountSheet() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    // Relative + centered so the profile icon sits in the MIDDLE of the side tab
    // and the menu can anchor directly ABOVE it.
    <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen(o => !o)}
        title="Account"
        style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'var(--primary)',
          color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 600, fontSize: '0.95rem',
        }}
      >
        {user.name.charAt(0).toUpperCase()}
      </button>

      {open && (
        <>
          {/* Transparent backdrop for click-outside dismissal. */}
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setOpen(false)} />
          {/* The menu, anchored ABOVE the profile icon (centred on it). */}
          <div
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 10px)',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 1000,
              width: 232,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{user.name}</div>
            <div className="truncate" style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: 12 }}>
              {user.email}
            </div>
            <div className="chip" style={{ background: 'var(--surface-2)', marginBottom: 16 }}>
              {user.role === 'manager' ? 'Manager' : 'Broker'}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <button
                className="btn btn-ghost"
                onClick={signOut}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
