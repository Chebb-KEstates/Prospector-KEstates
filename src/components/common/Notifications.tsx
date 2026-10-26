import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../data/api';
import { useVault } from '../../state/VaultContext';
import { Icon } from './Icon';
import { timeAgo, fmtDateTime } from '../../utils/format';

/** How often the bell re-checks while the app is open. */
const POLL_MS = 60_000;

/**
 * The signed-in user's notifications, kept fresh: loaded on mount, every minute,
 * and whenever the vault's data changes (e.g. after logging a call).
 */
export function useNotifications() {
  const { revision } = useVault();
  const [rows, setRows] = useState<api.AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await api.notifications.list();
      if (alive.current) { setRows(r.rows); setUnread(r.unread); }
    } catch { /* keep what we have; the next poll retries */ }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, revision]);
  useEffect(() => {
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const markAllRead = useCallback(async () => {
    try {
      await api.notifications.markRead();
      if (alive.current) {
        const at = new Date().toISOString();
        setRows(prev => prev.map(n => (n.readAt ? n : { ...n, readAt: at })));
        setUnread(0);
      }
    } catch { /* still unread — shown again next time */ }
  }, []);

  return { rows, unread, refresh, markAllRead };
}

/**
 * The notifications list, as a panel over the page. Unread notices are marked
 * read when the panel is closed (so the "new" highlight is visible while it's
 * open). A notice about a unit has "Open unit", which opens its record.
 */
export function NotificationsPanel({ rows, onClose, onOpenUnit }: {
  rows: api.AppNotification[];
  onClose: () => void;
  onOpenUnit: (propertyId: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ justifyContent: 'flex-start', alignItems: 'flex-start', padding: 16 }}>
      <div className="modal-content" role="dialog" aria-label="Notifications" onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, 94vw)', maxHeight: '86vh', marginLeft: 220, display: 'flex', flexDirection: 'column', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border-light)' }}>
          <Icon name="bell" size={16} />
          <h3 style={{ fontWeight: 600, margin: 0, flex: 1 }}>Notifications</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}><Icon name="x" size={14} /> Close</button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              No notifications yet.
            </div>
          ) : rows.map(n => (
            <div key={n.id} style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border-light)',
              background: n.readAt ? undefined : 'color-mix(in srgb, var(--warning) 8%, transparent)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {!n.readAt && <span aria-label="new" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--warning)', marginTop: 6, flexShrink: 0 }} />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{n.title}</div>
                  {n.body && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.45 }}>{n.body}</div>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }} title={fmtDateTime(n.createdAt)}>{timeAgo(n.createdAt)}</span>
                    {n.propertyId && (
                      <button className="btn btn-sm" onClick={() => onOpenUnit(n.propertyId!)}>
                        Open unit <Icon name="arrowRight" size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
