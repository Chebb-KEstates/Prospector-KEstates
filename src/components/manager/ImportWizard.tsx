import React, { useState, useRef, useEffect } from 'react';
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
/**
 * `remapRequest` — a "Re-map columns…" request from the Data Sets list. When its
 * nonce changes the wizard jumps to Update mode pre-targeted at that data set and
 * scrolls into view, so re-mapping headers is the same familiar upload flow.
 */
export function ImportWizard({ remapRequest, restageRequest }: {
  remapRequest?: { datasetId: string; nonce: number };
  /** In-app re-map: a set's retained rows, already staged, to map straight away. */
  restageRequest?: { nonce: number; payload: api.RestagePayload };
} = {}) {
  const { reloadDatasets, datasets } = useVault();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const appliedNonce = useRef<number | null>(null);
  const appliedRestageNonce = useRef<number | null>(null);

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
  // Create a brand-new set, or merge this file into an existing one.
  const [mode, setMode] = useState<'new' | 'update'>('new');
  const [targetDatasetId, setTargetDatasetId] = useState('');
  // Update mode only: is this file the full owner list (replace), or an add-only
  // patch (keep existing owners, never remove)?
  const [ownerMode, setOwnerMode] = useState<'replace' | 'patch'>('replace');
  const [dryRun, setDryRun] = useState<api.OwnerDryRun | null>(null);
  const [imported, setImported] = useState(0);

  // Only owner data sets can be updated with an owners file.
  const ownerDatasets = datasets.filter(d => d.module === DataModule.owners);
  const targetName = ownerDatasets.find(d => d.id === targetDatasetId)?.name ?? '';
  const updating = mode === 'update';

  const reset = () => {
    setStep(0); setStaged(null); setDryRun(null); setError(null);
    setColumns([]); setActiveSheet(0); setHeaderRow(0); setCost('');
    setMode('new'); setTargetDatasetId(''); setOwnerMode('replace');
  };

  // A "Re-map columns…" click on a data set drops the wizard into Update mode for
  // that set (step 0 → choose the corrected file). Guarded by nonce so it applies
  // once per click, never on an incidental re-render.
  useEffect(() => {
    if (!remapRequest || remapRequest.nonce === appliedNonce.current) return;
    appliedNonce.current = remapRequest.nonce;
    reset();
    setMode('update');
    setTargetDatasetId(remapRequest.datasetId);
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [remapRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  // In-app re-map: the set's stored rows arrive already staged, so drop straight
  // to the mapping step in update mode — no file to pick.
  useEffect(() => {
    if (!restageRequest || restageRequest.nonce === appliedRestageNonce.current) return;
    appliedRestageNonce.current = restageRequest.nonce;
    const p = restageRequest.payload;
    setError(null);
    setDryRun(null);
    setCost('');
    setStaged(p);
    setColumns(p.columns as ColumnSpec[]);
    setHeaderRow(p.headerRow);
    setType(p.type);
    setCommunityLabel(p.community);
    setActiveSheet(0);
    setMode('update');
    setTargetDatasetId(p.targetDatasetId);
    setStep(1);
    rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [restageRequest]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (updating && !targetDatasetId) {
      setError('Choose which data set to update, or switch to “Create a new data set”.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.imports.dryRunOwners(staged.sessionId, {
        sheetIndex: activeSheet, headerRow, columns, type,
        communityFallback: communityLabel,
        targetDatasetId: updating ? targetDatasetId : undefined,
        ownerMode: updating ? ownerMode : undefined,
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
        targetDatasetId: updating ? targetDatasetId : undefined,
        ownerMode: updating ? ownerMode : undefined,
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
    <div ref={rootRef}>
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
        <div>
          {/* First question: is this new data, or an update to data already here? */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <ModeCard active={!updating} onClick={() => setMode('new')}
              title="New data"
              desc="Properties not yet in the system. Creates a new data set." />
            <ModeCard active={updating} onClick={() => setMode('update')}
              title="Update existing data"
              desc="Refresh properties already in the system. Updates a data set in place — notes, calls and broker allocations are kept." />
          </div>

          {updating && (
            <div className="card" style={{ marginBottom: 16 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Data set to update</label>
              <select className="input" value={targetDatasetId} onChange={e => setTargetDatasetId(e.target.value)} style={{ minWidth: 280 }}>
                <option value="">Choose a data set…</option>
                {ownerDatasets.map(d => (
                  <option key={d.id} value={d.id}>{d.name} · {d.totalUnits} units</option>
                ))}
              </select>
              {ownerDatasets.length === 0 && (
                <div style={{ fontSize: '0.7rem', color: 'var(--warning)', marginTop: 4 }}>
                  No owner data sets yet — import one as “New data” first.
                </div>
              )}

              {/* The confirmed design decision: full owner list vs add-only patch. */}
              <div style={{ marginTop: 16 }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>
                  Owners in this file
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 640 }}>
                  <OwnerModeRow active={ownerMode === 'replace'} onClick={() => setOwnerMode('replace')}
                    title="Full owner list (replace)"
                    desc="Each unit's owners become exactly what this file lists — so a unit that used to have two owners and now shows one is reduced to one." />
                  <OwnerModeRow active={ownerMode === 'patch'} onClick={() => setOwnerMode('patch')}
                    title="Only add / patch (keep existing owners)"
                    desc="Add any new owners or numbers, but never remove one. Use for a partial file that doesn't re-list everyone." />
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <p style={{ marginBottom: 16, color: 'var(--text-secondary)' }}>
              Upload an Excel (.xlsx) or CSV file exported from a data vendor.
            </p>
            <input ref={fileInputRef} type="file" accept=".xlsx,.csv" onChange={handleFileSelect} style={{ display: 'none' }} />
            <button className="btn btn-primary" disabled={busy || (updating && !targetDatasetId)}
              onClick={() => fileInputRef.current?.click()}>
              {busy ? 'Reading…' : 'Choose file'}
            </button>
            {updating && !targetDatasetId && (
              <p style={{ marginTop: 10, fontSize: '0.75rem', color: 'var(--warning)' }}>
                Pick a data set to update first.
              </p>
            )}
            <p style={{ marginTop: 12, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              The file is parsed and discarded — only the rows are kept, and only until you commit.
            </p>
          </div>
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
            {/* Mode was chosen up front (step 0) — shown here as a reminder. */}
            <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="chip" style={{
                background: updating ? 'color-mix(in srgb, var(--info) 15%, transparent)' : 'color-mix(in srgb, var(--success) 15%, transparent)',
                color: updating ? 'var(--info)' : 'var(--success)', fontWeight: 600,
              }}>
                {updating ? `Updating: ${targetName || '—'}` : 'New data set'}
              </span>
              {updating && (
                <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                  Owners: {ownerMode === 'replace' ? 'full list (replace)' : 'add / patch only'}
                </span>
              )}
              <button className="btn btn-sm btn-ghost" onClick={reset}>Change</button>
            </div>
            {updating && (
              <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 660 }}>
                <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 2 }} />
                <span>Units are matched by location and only changed values are updated. Notes, call history,
                  portfolio and broker allocations are kept, and blank cells never overwrite existing data.</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Header row</label>
                <input className="input" type="number" value={headerRow + 1} min={1} style={{ width: 80 }}
                  onChange={e => { const r = parseInt(e.target.value, 10) - 1; if (r >= 0) void changeHeaderRow(r); }} />
              </div>
              {!updating && (
                <>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Dataset name</label>
                    <input className="input" value={datasetName} onChange={e => setDatasetName(e.target.value)} style={{ width: 200 }} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Source</label>
                    <input className="input" value={dataSource} onChange={e => setDataSource(e.target.value)} style={{ width: 160 }} />
                  </div>
                </>
              )}
              {/* Cost is asked on EVERY upload — a new set records it, an update
                  adds it to the set's running spend — so data cost is tracked. */}
              <div>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                  {updating ? 'Cost of this update (AED)' : 'Cost (AED)'}
                </label>
                <input className="input" type="number" value={cost} onChange={e => setCost(e.target.value)} style={{ width: 150 }} min={0} placeholder="0" />
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
            <button className="btn btn-primary" onClick={runDryRun} disabled={busy || (updating && !targetDatasetId)}>
              {busy ? 'Working…' : (updating ? 'Preview update' : 'Preview import')}
            </button>
          </div>
        </div>
      )}

      {step === 2 && dryRun && (
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <h3 style={{ fontWeight: 600, marginBottom: 12 }}>{updating ? `Update Summary — ${targetName}` : 'Import Summary'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
              <Stat label="Source rows" value={dryRun.sourceRows} />
              <Stat label="Invalid rows" value={dryRun.invalidRows} />
              <Stat label={updating ? 'New units added' : 'New properties'} value={dryRun.newCount} color="var(--success)" />
              <Stat label={updating ? 'Units updated' : 'Updated'} value={dryRun.updatedCount} color="var(--info)" />
              <Stat label="Callable" value={dryRun.callable} color={dryRun.callable === 0 ? 'var(--warning)' : undefined} />
              <Stat label="Duplicate rows" value={dryRun.inFileDuplicates} />
            </div>
          </div>

          {updating && (
            <div className="card" style={{
              marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start',
              borderColor: 'var(--success)', background: 'color-mix(in srgb, var(--success) 8%, transparent)',
            }}>
              <Icon name="check" size={18} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600, color: 'var(--success)' }}>
                  {dryRun.updatedCount} unit{dryRun.updatedCount === 1 ? '' : 's'} updated · {dryRun.newCount} new unit{dryRun.newCount === 1 ? '' : 's'} added
                </div>
                {/* Exactly what the update changes — so nothing is overwritten blindly. */}
                {(() => {
                  const c = dryRun.changes;
                  const bits: string[] = [];
                  if (c.ownerChanges) bits.push(`${c.ownerChanges} owner detail${c.ownerChanges === 1 ? '' : 's'}`);
                  if (c.ownerCountChanges) bits.push(`${c.ownerCountChanges} owner count`);
                  if (c.phoneChanges) bits.push(`${c.phoneChanges} number${c.phoneChanges === 1 ? '' : 's'}`);
                  if (c.rentalChanges) bits.push(`${c.rentalChanges} rental`);
                  if (c.saleChanges) bits.push(`${c.saleChanges} last sale`);
                  if (c.physicalChanges) bits.push(`${c.physicalChanges} property detail${c.physicalChanges === 1 ? '' : 's'}`);
                  return (
                    <div style={{ color: 'var(--text)', marginTop: 6, fontWeight: 500 }}>
                      {bits.length > 0 ? `Changing: ${bits.join(' · ')}.` : 'No field changes among the matched units — only touched dates refresh.'}
                    </div>
                  );
                })()}
                <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                  Broker notes, call history, portfolio and allocations are kept exactly as they are. Only changed
                  values are updated and blank cells are left unchanged. No new data set is created.
                </div>
              </div>
            </div>
          )}

          {/* Guard against importing a contactless file (e.g. a property-only
              export) — 0 callable means no "Owner mobile" column was mapped. */}
          {dryRun.callable === 0 && (dryRun.newCount + dryRun.updatedCount) > 0 && (
            <div className="card" style={{
              marginBottom: 16, display: 'flex', gap: 10, alignItems: 'flex-start',
              borderColor: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 8%, transparent)',
            }}>
              <Icon name="alert" size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: '0.8125rem' }}>
                <div style={{ fontWeight: 600, color: 'var(--warning)' }}>No phone numbers — nothing here will be callable</div>
                <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                  None of these {dryRun.newCount + dryRun.updatedCount} records have an owner mobile, so brokers
                  won't be able to call them. Go back and map an “Owner mobile” column, or import a file that
                  includes owner contacts.
                </div>
              </div>
            </div>
          )}

          {dryRun.sample.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <h4 style={{ fontWeight: 600, marginBottom: 8, color: 'var(--success)' }}>{updating ? 'New units being added' : 'New Properties'}</h4>
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

          {/* Soft nudge — cost is how the Data ROI is tracked. Not a blocker:
              some data is free, so the manager can still commit. */}
          {(!cost || parseFloat(cost) <= 0) && (
            <div style={{ marginBottom: 12, fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
              No cost recorded for this upload — go Back to add what you paid, or continue if this data was free.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => setStep(1)} disabled={busy}>← Back</button>
            <button className="btn btn-primary" onClick={handleCommit} disabled={busy}>
              {busy ? (updating ? 'Saving…' : 'Importing…') : (updating ? 'Save update' : 'Commit import')}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: '2rem', marginBottom: 16 }}>✓</div>
          <h3 style={{ fontWeight: 600, marginBottom: 8 }}>{updating ? 'Update complete' : 'Import complete'}</h3>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
            {updating
              ? `${targetName} refreshed — ${imported} units processed, everything the team added kept.`
              : `${imported} units imported successfully.`}
          </p>
          <button className="btn" onClick={reset}>{updating ? 'Import or update another file' : 'Import another file'}</button>
        </div>
      )}
    </div>
  );
}

/** A big selectable card — the New-vs-Update choice at the top of the wizard. */
function ModeCard({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button onClick={onClick} style={{
      flex: 1, minWidth: 240, textAlign: 'left', cursor: 'pointer',
      padding: '16px 18px', borderRadius: 12,
      border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
      background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
          background: active ? 'var(--primary)' : 'transparent',
        }} />
        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: active ? 'var(--primary)' : 'var(--text)' }}>{title}</span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingLeft: 24 }}>{desc}</div>
    </button>
  );
}

/** A compact selectable row — the replace/patch owner choice. */
function OwnerModeRow({ active, onClick, title, desc }: {
  active: boolean; onClick: () => void; title: string; desc: string;
}) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', cursor: 'pointer', padding: '10px 12px', borderRadius: 10,
      border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
      background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'var(--surface)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
          background: active ? 'var(--primary)' : 'transparent',
        }} />
        <span style={{ fontWeight: 600, fontSize: '0.82rem', color: active ? 'var(--primary)' : 'var(--text)' }}>{title}</span>
      </div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', paddingLeft: 22, marginTop: 2 }}>{desc}</div>
    </button>
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
