import React, { useState, useRef } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { Lead, DataSet, DataModule, DataSetType, kOrgId } from '../../types/models';
import { parseVendorFile, saveFile } from '../../logic/fileParser';
import { LeadPipeline, LeadColumnSpec, LeadField, LeadFieldLabel, LeadDryRun } from '../../logic/leadPipeline';
import { ParsedSheet } from '../../logic/importModels';
import { buildLeadTemplateXlsx } from '../../logic/template';

export function LeadImportWizard() {
  const { byLeadKey, commitLeadImport } = useVault();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  // Single dataset id reused by dry-run rows and the committed DataSet (see the
  // note in ImportWizard) so lead rows are never orphaned on delete.
  const [datasetId, setDatasetId] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<unknown[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<LeadColumnSpec[]>([]);
  const [datasetName, setDatasetName] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [dryRun, setDryRun] = useState<LeadDryRun | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDatasetId(`ds-${Date.now()}`);
    setFileName(file.name);
    const data = await file.arrayBuffer();
    const parsed = parseVendorFile(file.name, data);
    const nonEmpty = parsed.nonEmptySheets;
    if (nonEmpty.length === 0) return;
    const sheet = nonEmpty[0];
    const allRows = sheet.rows.map(r => [...r]);
    setRows(allRows);
    const hRow = LeadPipeline.buildColumns([], 0).length > 0 ? 0 : 0; // placeholder
    const detectedHR = detectLeadHeaderRow(allRows);
    setHeaderRow(detectedHR);
    const cols = LeadPipeline.buildColumns(allRows, detectedHR);
    setColumns(cols);
    setStep(1);
    setDatasetName(file.name.replace(/\.[^.]+$/, ''));
    setDataSource(file.name.replace(/\.[^.]+$/, ''));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateColumn = (index: number, field: LeadField) => {
    setColumns(prev => {
      const next = prev.map(c => ({ ...c }));
      const oldField = next[index].field;
      next[index].field = field;
      const dup = next.findIndex((c, i) => i !== index && c.field === field && field !== LeadField.ignore && field !== LeadField.extra);
      if (dup >= 0) next[dup].field = LeadField.extra;
      return next;
    });
  };

  const runDryRun = () => {
    const result = LeadPipeline.dryRun({
      sheet: new ParsedSheet('Sheet1', rows),
      headerRow, columns,
      datasetId,
      existingByKey: byLeadKey,
    });
    setDryRun(result);
    setStep(2);
  };

  const handleCommit = async () => {
    if (!dryRun || !user) return;
    const dataset = new DataSet(
      datasetId, datasetName, dataSource,
      DataSetType.register, DataModule.leads, fileName,
      '', new Date().toISOString(),
      undefined, dryRun.uniqueLeads, dryRun.callable,
      dryRun.updatedLeads.length,
    );
    const allLeads = [...dryRun.newLeads, ...dryRun.updatedLeads];
    await commitLeadImport(dataset, allLeads, user.id, (done, total) => {
      setProgress({ done, total });
    });
    setStep(3);
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
        {[
          ['Select file', 0],
          ['Map columns', 1],
          ['Review & commit', 2],
          ['Done', 3],
        ].map(([label, s]) => (
          <div key={s as number} style={{
            flex: 1, padding: '8px 16px', borderRadius: 8, textAlign: 'center',
            background: step === s ? 'var(--primary)' : step > s ? 'var(--success)' : 'var(--surface-2)',
            color: step >= s ? 'white' : 'var(--text-secondary)',
            fontWeight: step === s ? 600 : 400, fontSize: '0.8125rem',
          }}>
            {label as string}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
            Upload an Excel (.xlsx) or CSV file of buyer enquiries.
          </p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>Choose file</button>
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Header row</label>
                <input className="input" type="number" value={headerRow + 1}
                  onChange={e => {
                    const r = parseInt(e.target.value) - 1;
                    if (r >= 0) { setHeaderRow(r); setColumns(LeadPipeline.buildColumns(rows, r)); }
                  }}
                  style={{ width: 80 }} min={1} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Dataset name</label>
                <input className="input" value={datasetName} onChange={e => setDatasetName(e.target.value)} style={{ width: 200 }} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Source</label>
                <input className="input" value={dataSource} onChange={e => setDataSource(e.target.value)} style={{ width: 160 }} />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Column header</th>
                  <th>Mapped to</th>
                  <th>Filled</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col, i) => (
                  <tr key={i}>
                    <td style={{ color: 'var(--text-tertiary)' }}>{col.index + 1}</td>
                    <td style={{ fontWeight: 500 }}>{col.header}</td>
                    <td>
                      <select className="input" value={col.field}
                        onChange={e => updateColumn(i, e.target.value as LeadField)}
                        style={{ width: 'auto', minWidth: 180 }}>
                        {Object.values(LeadField).map(f => (
                          <option key={f} value={f}>{LeadFieldLabel[f]}</option>
                        ))}
                      </select>
                    </td>
                    <td>{col.filled}/{col.sampled}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', maxWidth: 200 }}>
                      <span className="truncate" style={{ display: 'block' }}>
                        {col.samples.join(', ') || '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16 }}>
            <button className="btn btn-primary" onClick={runDryRun}>Preview import</button>
          </div>
        </div>
      )}

      {step === 2 && dryRun && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Import Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              <div><div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Source rows</div><div style={{ fontWeight: 600 }}>{dryRun.sourceRows}</div></div>
              <div><div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Invalid rows</div><div style={{ fontWeight: 600 }}>{dryRun.invalidRows}</div></div>
              <div><div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>New leads</div><div style={{ fontWeight: 600, color: 'var(--success)' }}>{dryRun.newLeads.length}</div></div>
              <div><div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Updated</div><div style={{ fontWeight: 600, color: 'var(--info)' }}>{dryRun.updatedLeads.length}</div></div>
              <div><div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Callable</div><div style={{ fontWeight: 600 }}>{dryRun.callable}</div></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={handleCommit}>
              {progress ? `Importing ${progress.done}/${progress.total}…` : 'Commit import'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '2rem', marginBottom: 16 }}>✓</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>Import complete</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            {dryRun?.uniqueLeads ?? 0} leads imported successfully.
          </p>
          <button className="btn" onClick={() => { setStep(0); setDryRun(null); setProgress(null); }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}

function detectLeadHeaderRow(rows: unknown[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const score = rows[i].filter(c => typeof c === 'string' && String(c).trim().length > 0).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}
