import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useTheme } from '../../state/ThemeContext';
import { useMyProperties, useMyLeads } from '../../data/hooks';
import { AccountSheet } from '../common/AccountSheet';
import { MarbleBackground } from '../common/MarbleBackground';
import { Icon, IconName } from '../common/Icon';
import { BrokerHome } from './BrokerHome';
import { TodayTab } from './TodayTab';
import { PoolTab } from './PoolTab';
import { MasterSearchScreen } from '../common/MasterSearchScreen';
import { useNotifications, NotificationsPanel } from '../common/Notifications';
import { PropertyPopup } from '../manager/PropertyPopup';
import { useVault } from '../../state/VaultContext';

type Tab = 'home' | 'today' | 'pool' | 'search';

const NAV: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'today', label: 'Database', icon: 'phone' },
  { key: 'search', label: 'Master Search', icon: 'search' },
  // The Pool page is still there (Home's "Browse pool" opens it) — it just isn't
  // in the sidebar any more.
];

export function BrokerShell() {
  const [activeTab, setActiveTab] = React.useState<Tab>('home');
  const { user } = useAuth();
  const { resolved } = useTheme();
  const { recordView } = useVault();
  // A broker's own set is bounded, so it loads whole — the badge still counts
  // in the browser's local day, exactly as it did before.
  const { rows: myProperties } = useMyProperties();
  const { rows: myLeads } = useMyLeads();

  const now = new Date().toDateString();
  const todayCount =
    myProperties.filter(p => p.lastCalledAt && new Date(p.lastCalledAt).toDateString() === now).length +
    myLeads.filter(l => l.lastCalledAt && new Date(l.lastCalledAt).toDateString() === now).length;

  // Notifications panel + the unit a notice opens (an audited view, like a row click).
  const notes = useNotifications();
  const [showNotes, setShowNotes] = React.useState(false);
  const [unitId, setUnitId] = React.useState<string | null>(null);
  const closeNotes = React.useCallback(() => {
    setShowNotes(false);
    if (notes.unread > 0) void notes.markAllRead();
  }, [notes]);
  const openUnit = async (id: string) => {
    closeNotes();
    try { await recordView(id, `Viewed owner detail ${id}`); } catch { /* the popup still opens */ }
    setUnitId(id);
  };

  if (!user) return <Navigate to="/login" />;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      background: resolved === 'dark' ? 'transparent' : 'var(--bg)', position: 'relative',
    }}>
      {resolved === 'dark' && <MarbleBackground />}

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <nav style={{
          width: 220, borderRight: '1px solid var(--border)', background: 'var(--surface)',
          display: 'flex', flexDirection: 'column', padding: 16,
        }}>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 24, padding: '8px 12px' }}>
            Prospector
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {NAV.map(tab => (
              <button key={tab.key} className="btn btn-ghost" style={{
                justifyContent: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8,
                background: activeTab === tab.key ? 'var(--surface-2)' : 'transparent',
                color: activeTab === tab.key ? 'var(--text)' : 'var(--text-secondary)',
                fontWeight: activeTab === tab.key ? 600 : 400,
              }} onClick={() => setActiveTab(tab.key)}>
                <Icon name={tab.icon} size={17} />
                {tab.label}
                {tab.key === 'today' && todayCount > 0 && (
                  <span style={{ marginLeft: 'auto', background: 'var(--primary)', color: 'white', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 600 }}>
                    {todayCount}
                  </span>
                )}
              </button>
            ))}
            {/* Notifications — e.g. "this unit goes back to the pool in 24 hours". */}
            <button className="btn btn-ghost" style={{
              justifyContent: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 8,
              background: showNotes ? 'var(--surface-2)' : 'transparent',
              color: showNotes ? 'var(--text)' : 'var(--text-secondary)',
              fontWeight: showNotes || notes.unread > 0 ? 600 : 400,
            }} onClick={() => setShowNotes(true)}>
              <Icon name="bell" size={17} />
              Notifications
              {notes.unread > 0 && (
                <span aria-label={`${notes.unread} unread`} style={{ marginLeft: 'auto', background: 'var(--error)', color: 'white', borderRadius: 999, padding: '1px 7px', fontSize: '0.6875rem', fontWeight: 600 }}>
                  {notes.unread}
                </span>
              )}
            </button>
          </div>
          <div style={{ padding: '8px 12px' }}><AccountSheet /></div>
        </nav>

        {/* Content — straight to the page, like the manager shell (no top bar). */}
        <main style={{ flex: 1, overflow: 'auto', maxHeight: '100vh', padding: 24 }}>
          {activeTab === 'home' && <BrokerHome onGo={(t) => setActiveTab(t as Tab)} />}
          {activeTab === 'today' && <TodayTab />}
          {activeTab === 'pool' && <PoolTab />}
          {activeTab === 'search' && <MasterSearchScreen />}
        </main>
      </div>

      {showNotes && (
        <NotificationsPanel rows={notes.rows} onClose={closeNotes} onOpenUnit={id => void openUnit(id)} />
      )}
      {unitId && (
        <PropertyPopup propertyId={unitId} onClose={() => setUnitId(null)} />
      )}
    </div>
  );
}
