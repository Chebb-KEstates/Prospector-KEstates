import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { ThemeToggle } from './ThemeToggle';

export function AccountSheet() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen(true)}
        title="Account"
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'var(--primary)',
          color: 'white',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 600, fontSize: '0.875rem',
        }}
      >
        {user.name.charAt(0).toUpperCase()}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
          }}
          onClick={() => setOpen(false)}
        >
          <div
            style={{
              position: 'absolute',
              top: 60,
              right: 16,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 20,
              minWidth: 240,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{user.name}</div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', marginBottom: 12 }}>
              {user.email}
            </div>
            <div className="chip" style={{
              background: 'var(--surface-2)', marginBottom: 16,
            }}>
              {user.role === 'manager' ? 'Manager' : 'Broker'}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 8 }}>
                Appearance
              </div>
              <ThemeToggle />
            </div>

            <button
              className="btn btn-ghost"
              onClick={signOut}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
