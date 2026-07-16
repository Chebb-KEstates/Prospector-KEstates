import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { AccountSheet } from '../common/AccountSheet';
import { Watermark } from '../common/Watermark';
import { MarbleBackground } from '../common/MarbleBackground';
import { useTheme } from '../../state/ThemeContext';
import { HomeScreen } from './HomeScreen';
import { VaultScreen } from './VaultScreen';
import { ImportWizard } from './ImportWizard';
import { LeadImportWizard } from './LeadImportWizard';
import { AssignmentsScreen } from './AssignmentsScreen';
import { RequestsScreen } from './RequestsScreen';
import { TeamScreen } from './TeamScreen';
import { UsersScreen } from './UsersScreen';
import { AuditScreen } from './AuditScreen';
import { SettingsScreen } from './SettingsScreen';
import { ControlScreen } from './ControlScreen';

type Tab = 'home' | 'vault' | 'assignments' | 'team' | 'control';

export function ManagerShell() {
  const [activeTab, setActiveTab] = React.useState<Tab>('home');
  const { user } = useAuth();
  const { pendingRequests } = useVault();
  const { resolved } = useTheme();

  if (!user) return <Navigate to="/login" />;

  const tabs: { key: Tab; label: string; permission?: Permission; badge?: number }[] = [
    { key: 'home', label: 'Dashboard' },
    { key: 'vault', label: 'Data Vault', permission: Permission.manageData },
    { key: 'assignments', label: 'Assignments', permission: Permission.assignData },
    { key: 'team', label: 'Team', permission: Permission.viewReports },
    { key: 'control', label: 'Control', badge: pendingRequests.length },
  ];

  const visibleTabs = tabs.filter(t => !t.permission || user.can(t.permission));

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

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flex: 1,
      }}>
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
            {visibleTabs.map(tab => (
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
                  position: 'relative',
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
                {tab.badge != null && tab.badge > 0 && (
                  <span style={{
                    position: 'absolute', right: 8,
                    background: 'var(--error)', color: 'white',
                    borderRadius: '50%', width: 20, height: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.6875rem', fontWeight: 600,
                  }}>
                    {tab.badge}
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
          flex: 1, padding: 24, overflow: 'auto',
          maxHeight: '100vh',
        }}>
          {activeTab === 'home' && <HomeScreen onGo={(t) => setActiveTab(t as Tab)} />}
          {activeTab === 'vault' && <VaultScreen />}
          {activeTab === 'assignments' && <AssignmentsScreen />}
          {activeTab === 'team' && <TeamScreen />}
          {activeTab === 'control' && <ControlScreen />}
        </main>
      </div>
    </div>
  );
}
