import React, { useState, useRef } from 'react';
import { useVault } from '../../state/VaultContext';
import { DataSetType, DataModule } from '../../types/models';
import { ColumnSpec, ImportField, ImportFieldLabel } from '../../logic/importModels';
import { buildTemplateXlsx } from '../../logic/template';
import { saveFile } from '../../logic/downloadFile';
import { Icon } from '../common/Icon';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';

/**
 * Import Properties.
 *
 * The flow is unchanged — choose file, map columns, review, commit — but the
 * work moved server-side:
 *
 *   upload → the server parses and STAGES the rows (the file's bytes are
 *   discarded, never written to disk) → re-mapping and the dry run are computed
 *   against the staged rows → commit inserts in one transaction and drops the
 *   staging.
 *
 * This is what makes the preview trustworthy: the counts the user approves are
 * the server's own, computed from the same rows it will insert, rather than
 * numbers the browser worked out and asked the server to believe.
 *
 * It also fixes a real bug. The old wizard minted `ds-${Date.now()}` twice —
 * once for the rows in runDryRun(), once for the DataSet in handleCommit() — so
 * every imported property pointed at a dataset id that never existed and
 * deleting the data set silently orphaned its owner data. The id is now minted
 * once, at staging, and used for both.
 */
export function ImportWizard() {
  const { reloadDatasets } = useVault();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [staged, setStaged] = useState<api.StagedImport | null>(null);
  const [activeSheet, setActiveSheet] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  const [type, setType] = useState<DataSetType>(DataSetType.register);
  const [communityLabel, setCommunityLabel] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [cost, setCost] = useState('');
  const [dryRun, setDryRun] = useState<api.OwnerDryRun | null>(null);
  const [imported, setImported] = useState(0);

  const reset = () => {
    setStep(0); setStaged(null); setDryRun(null); setError(null);
    setColumns([]); setActiveSheet(0); setHeaderRow(0); setCost('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.imports.stage(file, DataModule.owners);
      setStaged(s);
      setHeaderRow(s.headerRow);
      setColumns(s.columns as ColumnSpec[]);
      setType(s.detectedType ?? DataSetType.register);
      setActiveSheet(0);
      setDatasetName(file.name.replace(/\.[^.]+$/, ''));
      setDataSource(file.name.replace(/\.[^.]+$/, ''));
      // The community fallback defaulted to the first non-empty header cell.
      setCommunityLabel(String(s.preview[s.headerRow]?.find(c => c != null) ?? ''));
      setStep(1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /** Re-derive the columns for a new header row, against the staged rows. */
  const changeHeaderRow = async (r: number) => {
    if (!staged || r < 0) return;
    setHeaderRow(r);
    setBusy(true);
    try {
      const res = await api.imports.columns(staged.sessionId, r, activeSheet);
      setColumns(res.columns as ColumnSpec[]);
      if (res.detectedType) setType(res.detectedType);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not re-read that header row.');
    } finally {
      setBusy(false);
    }
  };

  const changeSheet = async (i: number) => {
    if (!staged) return;
    setActiveSheet(i);
    setBusy(true);
    try {
      const res = await api.imports.columns(staged.sessionId, headerRow, i);
      setColumns(res.columns as ColumnSpec[]);
      if (res.detectedType) setType(res.detectedType);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that sheet.');
    } finally {
      setBusy(false);
    }
  };

  /** Mapping one column to a field steals it from whichever column had it. */
  const updateColumn = (index: number, field: ImportField) => {
    setColumns(prev => {
      const next = prev.map(c => ({ ...c }));
      next[index].field = field;
      const dup = next.findIndex((c, i) => i !== index && c.field === field && field !== ImportField.ignore);
      if (dup >= 0) next[dup].field = ImportField.ignore;
      return next;
    });
  };

  const runDryRun = async () => {
    if (!staged) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.imports.dryRunOwners(staged.sessionId, {
        sheetIndex: activeSheet, headerRow, columns, type,
        communityFallback: communityLabel,
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
      const r = await api.imports.commitOwners(staged.sessionId, {
        sheetIndex: activeSheet, headerRow, columns, type,
        communityFallback: communityLabel,
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
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Import Properties</h2>
        <button className="btn btn-ghost" onClick={() => saveFile('prospector_template.xlsx', buildTemplateXlsx())}>
          Download template
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {[['Select file', 0], ['Map columns', 1], ['Review & commit', 2], ['Done', 3]].map(([label, s]) => (
          <div key={s as number} style={{
            flex: 1, padding: '8px 16px', borderRadius: 8, textAlign: 'center',
            background: step === s ? 'var(--primary)' : step > (s as number) ? 'var(--success)' : 'var(--surface-2)',
            color: step >= (s as number) ? 'white' : 'var(--text-secondary)',
            fontWeight: step === s ? 600 : 400,
            fontSize: '0.8125rem', transition: 'all 0.2s',
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
            Upload an Excel (.xlsx) or CSV file exported from a data vendor.
          </p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button className="btn btn-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
            {busy ? 'Reading…' : 'Choose file'}
          </button>
          <p style={{ marginTop: 12, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
            The file is parsed and discarded — only the rows are kept, and only until you commit.
          </p>
        </div>
      )}

      {step === 1 && staged && (
        <div>
          {staged.sheets.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              {staged.sheets.map((s, i) => (
                <button key={s.name} className={`btn btn-sm ${activeSheet === i ? 'btn-primary' : ''}`}
                  onClick={() => changeSheet(i)}>
                  {s.name} ({s.rowCount})
                </button>
              ))}
            </div>
          )}

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
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Cost (AED)</label>
                <input className="input" type="number" value={cost} onChange={e => setCost(e.target.value)} style={{ width: 120 }} min={0} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Community fallback</label>
                <input className="input" value={communityLabel} onChange={e => setCommunityLabel(e.target.value)} style={{ width: 160 }} />
              </div>
            </div>

            <div className="chip" style={{ background: 'var(--info)15', color: 'var(--info)', marginBottom: 16 }}>
              Detected: {type === DataSetType.register ? 'Ownership register' : 'DLD transactions'}
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              Map columns to fields. Columns marked "ignore" that still have a header are kept as extra columns.
            </p>
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
                        onChange={e => updateColumn(i, e.target.value as ImportField)}>
                        {Object.values(ImportField).map(f => (
                          <option key={f} value={f}>{ImportFieldLabel[f]}</option>
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
              <Stat label="New properties" value={dryRun.newCount} color="var(--success)" />
              <Stat label="Updated" value={dryRun.updatedCount} color="var(--info)" />
              <Stat label="Callable" value={dryRun.callable} />
              <Stat label="Duplicate rows" value={dryRun.inFileDuplicates} />
            </div>
          </div>

          {dryRun.sample.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ fontWeight: 600, marginBottom: 8, color: 'var(--success)' }}>New Properties</h4>
              <table className="data-table">
                <thead>
                  <tr><th>Owner</th><th>Community</th><th>Unit</th><th>Phone</th></tr>
                </thead>
                <tbody>
                  {dryRun.sample.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{s.owner}</td>
                      <td>{s.community}</td>
                      <td>{s.unit}</td>
                      {/* Masked even in the preview — it was never needed here. */}
                      <td style={{ fontVariant: 'tabular-nums' }}>{s.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dryRun.newCount > dryRun.sample.length && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                  +{dryRun.newCount - dryRun.sample.length} more
                </p>
              )}
            </div>
          )}

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
            {imported} units imported successfully.
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
