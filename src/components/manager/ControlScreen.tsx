import React, { useState } from 'react';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { DataModule, DataModuleLabel, DataSet } from '../../types/models';
import { ImportWizard } from './ImportWizard';
import { LeadImportWizard } from './LeadImportWizard';
import { UsersScreen } from './UsersScreen';
import { AuditScreen } from './AuditScreen';
import { SettingsScreen } from './SettingsScreen';
import { ApiError } from '../../data/apiClient';
import * as api from '../../data/api';
import { saveBlob } from '../../logic/downloadFile';
import { fmtDate, fmtInt, fmtAed } from '../../utils/format';

/** Import + the data-set manager, combined (the Flutter "Import & Files" section). */
function ImportAndFiles() {
  const { user } = useAuth();
  const { datasets, deleteDataset, updateDataset } = useVault();
  const [module, setModule] = useState<DataModule>(DataModule.owners);
  const [editing, setEditing] = useState<DataSet | null>(null);
  // A "Re-map columns…" request handed to the owners wizard (nonce re-triggers).
  const [remapReq, setRemapReq] = useState<{ datasetId: string; nonce: number }>();
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  if (!user) return null;

  const canManage = user.can(Permission.manageData);

  const exportSet = async (d: DataSet) => {
    setExportingId(d.id);
    setExportError(null);
    try {
      const blob = await api.datasets.exportBlob(d.id);
      saveBlob(`${d.name}.xlsx`, blob);
    } catch (e) {
      setExportError(e instanceof ApiError ? e.message : `Could not export "${d.name}".`);
    } finally {
      setExportingId(null);
    }
  };

  // Re-mapping columns is a re-upload: send the wizard into Update mode for this
  // set. Owner-only — that's the module the update-import flow supports.
  const startRemap = (d: DataSet) => {
    setEditing(null);
    setModule(DataModule.owners);
    setRemapReq({ datasetId: d.id, nonce: Date.now() });
  };

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

      {module === DataModule.owners ? <ImportWizard remapRequest={remapReq} /> : <LeadImportWizard />}

      <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '28px 0 12px' }}>Data sets</h3>
      {exportError && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--error)', color: 'var(--error)', fontSize: '0.8125rem' }}>
          {exportError}
        </div>
      )}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr><th>Name</th><th>Module</th><th>Source</th><th>Community</th>
                <th style={{ textAlign: 'right' }}>Records</th><th style={{ textAlign: 'right' }}>Callable</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th>Imported</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
              {datasets.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 24 }}>No data sets yet.</td></tr>
              ) : datasets.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.name}</td>
                  <td>{DataModuleLabel[d.module]}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{d.source}</td>
                  <td>{d.communityLabel}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(d.totalUnits)}</td>
                  <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(d.callableUnits)}</td>
                  {/* Running spend on the set — an update adds its cost here. */}
                  <td className="tabular-nums" style={{ textAlign: 'right', color: d.cost != null && d.cost > 0 ? 'var(--text)' : 'var(--text-tertiary)' }}>
                    {d.cost != null && d.cost > 0 ? fmtAed(d.cost) : '—'}
                  </td>
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
                    {canManage && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-ghost" disabled={exportingId === d.id}
                          onClick={() => void exportSet(d)}
                          title="Download this data set (units, calls, feedback and history) as Excel">
                          {exportingId === d.id ? 'Exporting…' : 'Export'}
                        </button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(d)}>
                          Edit
                        </button>
                        <button className="btn btn-sm btn-ghost" style={{ color: 'var(--error)' }}
                          onClick={() => { if (window.confirm(`Delete "${d.name}" and all its records?`)) void deleteDataset(d); }}>
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDatasetDialog dataset={editing} onClose={() => setEditing(null)}
          onSave={updateDataset} onRemap={startRemap} />
      )}
    </div>
  );
}

/**
 * Edit a data set's own details — name, source, community and the price paid —
 * without re-importing. "Re-map columns" is a re-upload (the original file is not
 * kept), so it hands off to the wizard's Update mode instead of pretending to
 * remap in place.
 */
function EditDatasetDialog({ dataset, onClose, onSave, onRemap }: {
  dataset: DataSet;
  onClose: () => void;
  onSave: (id: string, patch: {
    name?: string; source?: string; communityLabel?: string; cost?: number | null;
  }) => Promise<DataSet>;
  onRemap: (d: DataSet) => void;
}) {
  const [name, setName] = useState(dataset.name);
  const [source, setSource] = useState(dataset.source);
  const [community, setCommunity] = useState(dataset.communityLabel);
  const [cost, setCost] = useState(dataset.cost != null ? String(dataset.cost) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwners = dataset.module === DataModule.owners;

  const save = async () => {
    if (!name.trim()) { setError('Give the data set a name.'); return; }
    setBusy(true); setError(null);
    try {
      const c = cost.trim();
      await onSave(dataset.id, {
        name: name.trim(), source: source.trim(), communityLabel: community.trim(),
        cost: c === '' ? null : Number(c),
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save those changes.');
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void) => (
    <div>
      <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>{label}</label>
      <input className="input" value={value} onChange={e => set(e.target.value)} />
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 style={{ fontWeight: 600, marginBottom: 4 }}>Edit data set</h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          {DataModuleLabel[dataset.module]} · {fmtInt(dataset.totalUnits)} records
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {field('Name', name, setName)}
          {field('Source', source, setSource)}
          {field('Community', community, setCommunity)}
          <div>
            <label style={{ fontSize: '0.8125rem', display: 'block', marginBottom: 4 }}>Price paid (AED)</label>
            <input className="input" type="number" min={0} value={cost} placeholder="0"
              onChange={e => setCost(e.target.value)} />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 4 }}>
              What this data cost — leave blank if it was free.
            </div>
          </div>

          {isOwners && (
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: 4 }}>Re-map columns / headers</div>
              <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                Columns can't be re-mapped in place — the original file isn't kept. Re-upload the corrected
                file into this set: units are matched by location, and notes, calls and allocations are kept.
              </p>
              <button className="btn btn-sm" onClick={() => onRemap(dataset)}>
                Re-map columns (re-upload)…
              </button>
            </div>
          )}

          {error && <div style={{ fontSize: '0.8125rem', color: 'var(--error)' }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
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
