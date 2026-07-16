import React, { useState, useRef } from 'react';
import { useVault } from '../../state/VaultContext';
import { useAuth } from '../../state/AuthContext';
import { Property, DataSet, DataSetType, DataModule, kOrgId } from '../../types/models';
import { parseVendorFile, saveFile } from '../../logic/fileParser';
import { ImportPipeline } from '../../logic/importPipeline';
import { ColumnSpec, DryRunResult, ImportField, ImportFieldLabel, ParsedSheet } from '../../logic/importModels';
import { buildTemplateXlsx } from '../../logic/template';
import { StateChip } from '../common/StateChip';

export function ImportWizard() {
  const { byUnitKey, commitImport } = useVault();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<{ name: string; rows: unknown[][] }[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<ColumnSpec[]>([]);
  const [type, setType] = useState<DataSetType>(DataSetType.register);
  const [communityLabel, setCommunityLabel] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [dataSource, setDataSource] = useState('');
  const [cost, setCost] = useState('');
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const data = await file.arrayBuffer();
    const parsed = parseVendorFile(file.name, data);
    const nonEmpty = parsed.nonEmptySheets;
    if (nonEmpty.length === 0) return;
    setSheets(nonEmpty.map(s => ({ name: s.name, rows: s.rows.map(r => [...r]) })));
    const firstRows = nonEmpty[0].rows;
    const hRow = ImportPipeline.detectHeaderRow(firstRows);
    setHeaderRow(hRow);
    const cols = ImportPipeline.buildColumns(firstRows, hRow);
    setColumns(cols);
    setType(ImportPipeline.detectType(cols));
    setActiveSheet(0);
    setStep(1);
    setCommunityLabel(nonEmpty[0].rows[hRow]?.find(c => c != null)?.toString() ?? '');
    setDatasetName(file.name.replace(/\.[^.]+$/, ''));
    setDataSource(file.name.replace(/\.[^.]+$/, ''));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCommit = async () => {
    if (!dryRun || !user) return;
    const dataset = new DataSet(
      `ds-${Date.now()}`, datasetName, dataSource, type,
      DataModule.owners, fileName, communityLabel,
      new Date().toISOString(),
      cost ? parseFloat(cost) : undefined,
      dryRun.uniqueUnits, dryRun.callable, dryRun.updatedProperties.length,
    );
    const allProps = [...dryRun.newProperties, ...dryRun.updatedProperties];
    await commitImport(dataset, allProps, user.id, (done, total) => {
      setProgress({ done, total });
    });
    setStep(3);
  };

  const updateColumn = (index: number, field: ImportField) => {
    setColumns(prev => {
      const next = prev.map(c => ({ ...c }));
      const oldField = next[index].field;
      next[index].field = field;
      const dup = next.findIndex((c, i) => i !== index && c.field === field && field !== ImportField.ignore);
      if (dup >= 0) next[dup].field = ImportField.ignore;
      if (oldField !== ImportField.ignore) {
        const orphan = next.findIndex((c, i) => i !== index && c.field === ImportField.ignore);
        // don't auto-set orphan
      }
      return next;
    });
  };

  const runDryRun = () => {
    if (sheets.length === 0) return;
    const result = ImportPipeline.dryRun({
      sheet: new ParsedSheet(sheets[activeSheet].name, sheets[activeSheet].rows),
      headerRow, columns, type,
      communityFallback: communityLabel,
      datasetId: `ds-${Date.now()}`,
      existingByUnitKey: byUnitKey,
    });
    setDryRun(result);
    setStep(2);
  };

  const downloadTemplate = () => {
    saveFile('prospector_template.xlsx', buildTemplateXlsx());
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Import Properties</h2>
        <button className="btn btn-ghost" onClick={downloadTemplate}>
          Download template
        </button>
      </div>

      {/* Step progress */}
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
            fontWeight: step === s ? 600 : 400,
            fontSize: '0.8125rem', transition: 'all 0.2s',
          }}>
            {label as string}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
            Upload an Excel (.xlsx) or CSV file exported from a data vendor.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.csv"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            Choose file
          </button>
        </div>
      )}

      {step === 1 && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {sheets.map((s, i) => (
              <button
                key={s.name}
                className={`btn btn-sm ${activeSheet === i ? 'btn-primary' : ''}`}
                onClick={() => setActiveSheet(i)}
              >
                {s.name}
              </button>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Header row
                </label>
                <input
                  className="input"
                  type="number"
                  value={headerRow + 1}
                  onChange={e => {
                    const r = parseInt(e.target.value) - 1;
                    if (r >= 0) {
                      setHeaderRow(r);
                      const cols = ImportPipeline.buildColumns(sheets[activeSheet].rows, r);
                      setColumns(cols);
                      setType(ImportPipeline.detectType(cols));
                    }
                  }}
                  style={{ width: 80 }}
                  min={1}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Dataset name
                </label>
                <input
                  className="input"
                  value={datasetName}
                  onChange={e => setDatasetName(e.target.value)}
                  style={{ width: 200 }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Source
                </label>
                <input
                  className="input"
                  value={dataSource}
                  onChange={e => setDataSource(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Cost (AED)
                </label>
                <input
                  className="input"
                  type="number"
                  value={cost}
                  onChange={e => setCost(e.target.value)}
                  style={{ width: 120 }}
                  min={0}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  Community fallback
                </label>
                <input
                  className="input"
                  value={communityLabel}
                  onChange={e => setCommunityLabel(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
            </div>

            <div className="chip" style={{ background: 'var(--info)15', color: 'var(--info)', marginBottom: 16 }}>
              Detected: {type === DataSetType.register ? 'Ownership register' : 'DLD transactions'}
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
              Map columns to fields. Columns marked "ignore" will be skipped.
            </p>
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
                      <select
                        className="input"
                        value={col.field}
                        onChange={e => updateColumn(i, e.target.value as ImportField)}
                        style={{ width: 'auto', minWidth: 180 }}
                      >
                        {Object.values(ImportField).map(f => (
                          <option key={f} value={f}>{ImportFieldLabel[f]}</option>
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
            <button className="btn btn-primary" onClick={runDryRun}>
              Preview import
            </button>
          </div>
        </div>
      )}

      {step === 2 && dryRun && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>Import Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Source rows</div>
                <div style={{ fontWeight: 600 }}>{dryRun.sourceRows}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Invalid rows</div>
                <div style={{ fontWeight: 600 }}>{dryRun.invalidRows}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>New properties</div>
                <div style={{ fontWeight: 600, color: 'var(--success)' }}>{dryRun.newProperties.length}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Updated</div>
                <div style={{ fontWeight: 600, color: 'var(--info)' }}>{dryRun.updatedProperties.length}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Callable</div>
                <div style={{ fontWeight: 600 }}>{dryRun.callable}</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Duplicate rows</div>
                <div style={{ fontWeight: 600 }}>{dryRun.inFileDuplicates}</div>
              </div>
            </div>
          </div>

          {dryRun.newProperties.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ fontWeight: 600, marginBottom: 8, color: 'var(--success)' }}>New Properties</h4>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Owner</th>
                    <th>Community</th>
                    <th>Unit</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {dryRun.newProperties.slice(0, 20).map(p => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 500 }}>{p.owner.name}</td>
                      <td>{p.community}</td>
                      <td>{p.unitLabel}</td>
                      <td style={{ fontVariant: 'tabular-nums' }}>{p.owner.phone ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dryRun.newProperties.length > 20 && (
                <p style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
                  +{dryRun.newProperties.length - 20} more
                </p>
              )}
            </div>
          )}

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
            {dryRun?.uniqueUnits ?? 0} units imported successfully.
          </p>
          <button className="btn" onClick={() => { setStep(0); setDryRun(null); setProgress(null); }}>
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
