import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { AccountSheet } from '../common/AccountSheet';
import { Watermark } from '../common/Watermark';
import { MarbleBackground } from '../common/MarbleBackground';
import { useTheme } from '../../state/ThemeContext';
import { HomeTab } from './HomeTab';
import { LeadsTab } from './LeadsTab';
import { CallSessionScreen } from './CallSessionScreen';
import { PropertyState } from '../../types/models';

type Tab = 'today' | 'pool' | 'portfolio' | 'leads' | 'calls';

export function BrokerShell() {
  const [activeTab, setActiveTab] = React.useState<Tab>('today');
  const { user } = useAuth();
  const { properties, assignedTo, leadsOf } = useVault();
  const { resolved } = useTheme();

  if (!user) return <Navigate to="/login" />;

  const userProps = assignedTo(user.id);
  const userLeads = leadsOf(user.id);
  const todayCount = userProps.filter(p =>
    p.lastCalledAt && new Date(p.lastCalledAt).toDateString() === new Date().toDateString()
  ).length + userLeads.filter(l =>
    l.lastCalledAt && new Date(l.lastCalledAt).toDateString() === new Date().toDateString()
  ).length;

  const tabs: { key: Tab; label: string; icon?: string }[] = [
    { key: 'today', label: 'Home' },
    { key: 'pool', label: 'Pool' },
    { key: 'portfolio', label: 'Portfolio' },
    { key: 'leads', label: 'Leads' },
    { key: 'calls', label: 'Active Call' },
  ];

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: resolved === 'dark' ? 'transparent' : 'var(--bg)',
      position: 'relative',
    }}>
      {resolved === 'dark' && <MarbleBackground />}
      <Watermark />

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flex: 1 }}>
        {/* Sidebar */}
        <nav style={{
          width: 220,
          borderRight: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex', flexDirection: 'column',
          padding: 16,
        }}>
          <div style={{
            fontSize: '1.25rem', fontWeight: 700,
            color: 'var(--gold)', marginBottom: 24, padding: '8px 12px',
          }}>
            Prospector
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {tabs.map(tab => (
              <button
                key={tab.key}
                className="btn btn-ghost"
                style={{
                  justifyContent: 'flex-start',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: activeTab === tab.key ? 'var(--surface-2)' : 'transparent',
                  color: activeTab === tab.key ? 'var(--text)' : 'var(--text-secondary)',
                  fontWeight: activeTab === tab.key ? 600 : 400,
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.key === 'today' && todayCount > 0 && (
                  <span style={{
                    marginLeft: 8,
                    background: 'var(--primary)',
                    color: 'white',
                    borderRadius: 999, padding: '1px 7px',
                    fontSize: '0.6875rem', fontWeight: 600,
                  }}>
                    {todayCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div style={{ padding: '8px 12px' }}>
            <AccountSheet />
          </div>
        </nav>

        {/* Content */}
        <main style={{
          flex: 1, padding: 24, overflow: 'auto', maxHeight: '100vh',
        }}>
          {activeTab === 'today' && <HomeTab />}
          {activeTab === 'pool' && <HomeTab filterPool />}
          {activeTab === 'portfolio' && <HomeTab filterPortfolio />}
          {activeTab === 'leads' && <LeadsTab />}
          {activeTab === 'calls' && <CallSessionScreen />}
        </main>
      </div>
    </div>
  );
}
