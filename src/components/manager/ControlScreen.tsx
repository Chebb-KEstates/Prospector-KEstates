import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { DataModule, DataModuleLabel } from '../../types/models';
import { ImportWizard } from './ImportWizard';
import { LeadImportWizard } from './LeadImportWizard';
import { UsersScreen } from './UsersScreen';
import { AuditScreen } from './AuditScreen';
import { SettingsScreen } from './SettingsScreen';
import { fmtDate, fmtInt } from '../../utils/format';

/** Import + the data-set manager, combined (the Flutter "Import & Files" section). */
function ImportAndFiles() {
  const { user } = useAuth();
  const { datasets, deleteDataset } = useVault();
  const [module, setModule] = useState<DataModule>(DataModule.owners);
  if (!user) return null;

  return (
    <div>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
        {[DataModule.owners, DataModule.leads].map(m => (
          <button key={m} className="btn" style={{
            borderRadius: 0, border: 'none',
            background: module === m ? 'var(--primary)' : 'transparent',
            color: module === m ? '#fff' : 'var(--text-secondary)',
          }} onClick={() => setModule(m)}>{DataModuleLabel[m]}</button>
        ))}
      </div>

      {module === DataModule.owners ? <ImportWizard /> : <LeadImportWizard />}

      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '28px 0 12px' }}>Data sets</h3>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Module</th><th>Source</th><th>Community</th>
                <th style={{ textAlign: 'right' }}>Records</th><th style={{ textAlign: 'right' }}>Callable</th>
                <th>Imported</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
              {datasets.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No data sets yet.</td></tr>
              ) : datasets.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.name}</td>
                  <td>{DataModuleLabel[d.module]}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{d.source}</td>
                  <td>{d.communityLabel}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(d.totalUnits)}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(d.callableUnits)}</td>
                  <td style={{ fontSize: '0.75rem' }}>{fmtDate(d.importedAt)}</td>
                  {/* One row per data set — an update shows here, never as a 2nd row. */}
                  <td style={{ fontSize: '0.75rem', color: d.lastUpdatedAt ? 'var(--text)' : 'var(--text-tertiary)' }}>
                    {d.lastUpdatedAt ? (
                      <span title={d.updateCount > 0 ? `Updated ${d.updateCount} time${d.updateCount === 1 ? '' : 's'}` : undefined}>
                        {fmtDate(d.lastUpdatedAt)}{d.updateCount > 1 ? ` · ×${d.updateCount}` : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    {user.can(Permission.manageData) && (
                      <button className="btn btn-sm btn-ghost" style={{ color: 'var(--error)' }}
                        onClick={() => { if (window.confirm(`Delete "${d.name}" and all its records?`)) void deleteDataset(d); }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ControlScreen() {
  const [activeTab, setActiveTab] = useState('import');
  const { user } = useAuth();
  if (!user) return null;

  const tabs: { key: string; label: string; permission?: Permission }[] = [
    { key: 'import', label: 'Import & Files', permission: Permission.manageData },
    { key: 'users', label: 'Users', permission: Permission.manageUsers },
    { key: 'audit', label: 'Audit', permission: Permission.viewReports },
    { key: 'settings', label: 'Settings', permission: Permission.editSettings },
  ];
  const visible = tabs.filter(t => !t.permission || user.can(t.permission));
  const active = visible.some(t => t.key === activeTab) ? activeTab : visible[0]?.key;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 20 }}>Control</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {visible.map(tab => (
          <button key={tab.key} className={`btn ${active === tab.key ? 'btn-primary' : ''}`} onClick={() => setActiveTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'import' && <ImportAndFiles />}
      {active === 'users' && <UsersScreen />}
      {active === 'audit' && <AuditScreen />}
      {active === 'settings' && <SettingsScreen />}
    </div>
  );
}
