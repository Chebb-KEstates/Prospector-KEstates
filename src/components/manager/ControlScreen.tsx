import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { ImportWizard } from './ImportWizard';
import { LeadImportWizard } from './LeadImportWizard';
import { UsersScreen } from './UsersScreen';
import { AuditScreen } from './AuditScreen';
import { SettingsScreen } from './SettingsScreen';
import { RequestsScreen } from './RequestsScreen';

export function ControlScreen() {
  const [activeTab, setActiveTab] = useState('import');
  const { user } = useAuth();

  if (!user) return null;

  const tabs: { key: string; label: string; permission?: Permission }[] = [
    { key: 'import', label: 'Import Properties', permission: Permission.manageData },
    { key: 'leads-import', label: 'Import Leads', permission: Permission.manageData },
    { key: 'requests', label: 'Requests' },
    { key: 'users', label: 'Users', permission: Permission.manageUsers },
    { key: 'audit', label: 'Audit Log' },
    { key: 'settings', label: 'Settings', permission: Permission.editSettings },
  ];

  return (
    <div>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 24 }}>Control Panel</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {tabs.filter(t => !t.permission || user.can(t.permission)).map(tab => (
          <button
            key={tab.key}
            className={`btn ${activeTab === tab.key ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'import' && <ImportWizard />}
      {activeTab === 'leads-import' && <LeadImportWizard />}
      {activeTab === 'requests' && <RequestsScreen />}
      {activeTab === 'users' && <UsersScreen />}
      {activeTab === 'audit' && <AuditScreen />}
      {activeTab === 'settings' && <SettingsScreen />}
    </div>
  );
}
