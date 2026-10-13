import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useTheme } from '../../state/ThemeContext';
import { useMyProperties, useMyLeads, useBrokerDashboard } from '../../data/hooks';
import { OPEN_ACCESS } from '../../config';
import { AccountSheet } from '../common/AccountSheet';
import { MarbleBackground } from '../common/MarbleBackground';
import { Icon, IconName } from '../common/Icon';
import { BrokerHome } from './BrokerHome';
import { TodayTab } from './TodayTab';
import { PoolTab } from './PoolTab';

type Tab = 'home' | 'today' | 'pool';

const NAV: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'today', label: 'Database', icon: 'phone' },
  // Open access: every unit is already in the Database — no pool to request from.
  ...(OPEN_ACCESS ? [] : [{ key: 'pool' as Tab, label: 'Pool', icon: 'layers' as IconName }]),
];

export function BrokerShell() {
  const [activeTab, setActiveTab] = React.useState<Tab>('home');
  const { user } = useAuth();
  const { resolved } = useTheme();
  // A broker's own set is bounded, so it loads whole — the badge still counts
  // in the browser's local day, exactly as it did before.
  const { rows: myProperties } = useMyProperties();
  const { rows: myLeads } = useMyLeads();
  const { data: dash } = useBrokerDashboard();

  const now = new Date().toDateString();
  // Open access: there is no "my list" — the badge is simply my calls today.
  const todayCount = OPEN_ACCESS ? (dash?.myCallsToday ?? 0) :
    myProperties.filter(p => p.lastCalledAt && new Date(p.lastCalledAt).toDateString() === now).length +
    myLeads.filter(l => l.lastCalledAt && new Date(l.lastCalledAt).toDateString() === now).length;

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
          </div>
          <div style={{ padding: '8px 12px' }}><AccountSheet /></div>
        </nav>

        {/* Content — straight to the page, like the manager shell (no top bar). */}
        <main style={{ flex: 1, overflow: 'auto', maxHeight: '100vh', padding: 24 }}>
          {activeTab === 'home' && <BrokerHome onGo={(t) => setActiveTab(t as Tab)} />}
          {activeTab === 'today' && <TodayTab />}
          {activeTab === 'pool' && !OPEN_ACCESS && <PoolTab />}
        </main>
      </div>
    </div>
  );
}
