import React, { useState, useRef } from 'react';
import { useVault } from '../../state/VaultContext';
import { DataModule } from '../../types/models';
import { LeadColumnSpec, LeadField, LeadFieldLabel } from '../../logic/leadPipeline';
import { buildLeadTemplateXlsx } from '../../logic/template';
import { saveFile } from '../../logic/downloadFile';
import { Icon } from '../common/Icon';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/**
 * Import Buyer Leads.
 *
 * Same server-side staging flow as ImportWizard — see the note there. Kept
 * deliberately parallel to it: two wizards, one import language.
 */
export function LeadImportWizard() {
  const { reloadDatasets } = useVault();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [staged, setStaged] = useState<api.StagedImport | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<LeadColumnSpec[]>([]);
  const [datasetName, setDatasetName] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [cost, setCost] = useState('');
  const [dryRun, setDryRun] = useState<api.LeadDryRunSummary | null>(null);
  const [imported, setImported] = useState(0);

  const reset = () => {
    setStep(0); setStaged(null); setDryRun(null); setError(null);
    setColumns([]); setHeaderRow(0); setCost('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.imports.stage(file, DataModule.leads);
      setStaged(s);
      setHeaderRow(s.headerRow);
      setColumns(s.columns as LeadColumnSpec[]);
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setDataSource(file.name.replace(/\.[^.]+$/, ''));
      setStep(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const changeHeaderRow = async (r: number) => {
    if (!staged || r < 0) return;
    setHeaderRow(r);
    setBusy(true);
    try {
      const res = await api.imports.columns(staged.sessionId, r, 0);
      setColumns(res.columns as LeadColumnSpec[]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not re-read that header row.');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Unmapped lead columns fall back to `extra` rather than `ignore` — a lead
   * file's stray columns are usually worth keeping.
   */
  const updateColumn = (index: number, field: LeadField) => {
    setColumns(prev => {
      const next = prev.map(c => ({ ...c }));
      next[index].field = field;
      const dup = next.findIndex((c, i) =>
        i !== index && c.field === field && field !== LeadField.ignore && field !== LeadField.extra);
      if (dup >= 0) next[dup].field = LeadField.extra;
      return next;
    });
  };

  const runDryRun = async () => {
    if (!staged) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.imports.dryRunLeads(staged.sessionId, {
        sheetIndex: 0, headerRow, columns,
      });
      setDryRun(result);
      setStep(2);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not preview that import.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommit = async () => {
    if (!staged || !dryRun) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.imports.commitLeads(staged.sessionId, {
        sheetIndex: 0, headerRow, columns,
        datasetName: datasetName.trim(),
        source: dataSource.trim(),
        cost: cost ? parseFloat(cost) : undefined,
      });
      setImported(r.imported);
      await reloadDatasets();
      setStep(3);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The import failed. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Import Buyer Leads</h2>
        <button className="btn btn-ghost" onClick={() => saveFile('prospector_leads_template.xlsx', buildLeadTemplateXlsx())}>
          Download template
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['Select file', 0], ['Map columns', 1], ['Review & commit', 2], ['Done', 3]].map(([label, s]) => (
          <div key={s as number} style={{
            flex: 1, padding: '8px 16px', borderRadius: 8, textAlign: 'center',
            background: step === s ? 'var(--primary)' : step > (s as number) ? 'var(--success)' : 'var(--surface-2)',
            color: step >= (s as number) ? 'white' : 'var(--text-secondary)',
            fontWeight: step === s ? 600 : 400, fontSize: '0.8125rem',
          }}>
            {label as string}
          </div>
        ))}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--error)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="alert" size={16} style={{ color: 'var(--error)' }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--error)' }}>{error}</span>
        </div>
      )}

      {step === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
            Upload an Excel (.xlsx) or CSV file of buyer enquiries.
          </p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button className="btn btn-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'Reading…' : 'Choose file'}
          </button>
        </div>
      )}

      {step === 1 && staged && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Header row</label>
                <input className="input" type="number" value={headerRow + 1} min={1} style={{ width: 80 }}
                  onChange={e => { const r = parseInt(e.target.value, 10) - 1; if (r >= 0) void changeHeaderRow(r); }} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Dataset name</label>
                <input className="input" value={datasetName} onChange={e => setDatasetName(e.target.value)} style={{ width: 200 }} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Source</label>
                <input className="input" value={dataSource} onChange={e => setDataSource(e.target.value)} style={{ width: 160 }} />
              </div>
              {/* Cost tracked on every upload, same as owner data. */}
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Cost (AED)</label>
                <input className="input" type="number" value={cost} onChange={e => setCost(e.target.value)} style={{ width: 150 }} min={0} placeholder="0" />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr><th style={{ width: 40 }}>#</th><th>Column header</th><th>Mapped to</th><th>Filled</th><th>Samples</th></tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-tertiary)' }}>{col.index + 1}</td>
                    <td style={{ fontWeight: 500 }}>{col.header}</td>
                    <td>
                      <select className="input" value={col.field} style={{ width: 'auto', minWidth: 180 }}
                        onChange={e => updateColumn(i, e.target.value as LeadField)}>
                        {Object.values(LeadField).map(f => (
                          <option key={f} value={f}>{LeadFieldLabel[f]}</option>
                        ))}
                      </select>
                    </td>
                    <td>{col.filled}/{col.sampled}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', maxWidth: 200 }}>
                      <span className="truncate" style={{ display: 'block' }}>{col.samples.join(', ') || '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="btn" onClick={reset}>← Start over</button>
            <button className="btn btn-primary" onClick={runDryRun} disabled={busy}>
              {busy ? 'Working…' : 'Preview import'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && dryRun && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Import Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              <Stat label="Source rows" value={dryRun.sourceRows} />
              <Stat label="Invalid rows" value={dryRun.invalidRows} />
              <Stat label="New leads" value={dryRun.newCount} color="var(--success)" />
              <Stat label="Updated" value={dryRun.updatedCount} color="var(--info)" />
              <Stat label="Callable" value={dryRun.callable} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)} disabled={busy}>← Back</button>
            <button className="btn btn-primary" onClick={handleCommit} disabled={busy}>
              {busy ? 'Importing…' : 'Commit import'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '2rem', marginBottom: 16 }}>✓</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Import complete</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            {imported} leads imported successfully.
          </p>
          <button className="btn" onClick={reset}>Import another file</button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{label}</div>
      <div style={{ fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
