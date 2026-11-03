import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { Icon } from './Icon';
import { saveBlob } from '../../logic/downloadFile';
import { fmtInt, fmtDateTime } from '../../utils/format';

/**
 * Master Search — one search bar over every row of every uploaded spreadsheet.
 *
 * Everyone searches. Admins (the "Import & delete data" permission) also manage
 * the files: upload, download the original, delete a file with all its rows.
 *
 * A search matches rows that contain EVERY typed word, in any column, ignoring
 * case. Results show where each row came from (file › sheet › row) and its
 * columns, with the typed words highlighted.
 */

const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
const ACCEPT = '.xlsx,.xls,.xlsm,.csv';

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `text` with every term wrapped in a highlight. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const re = new RegExp(`(${terms.map(reEsc).join('|')})`, 'gi');
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1
        ? <mark key={i} style={{ background: 'color-mix(in srgb, var(--gold) 35%, transparent)', color: 'inherit', borderRadius: 3, padding: '0 1px' }}>{part}</mark>
        : <React.Fragment key={i}>{part}</React.Fragment>))}
    </>
  );
}

export function MasterSearchScreen() {
  const { user } = useAuth();
  const { userById } = useVault();
  const isAdmin = !!user?.can(Permission.manageData);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<api.SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(500);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<api.SearchFile[]>([]);
  const [totals, setTotals] = useState({ files: 0, rows: 0 });
  const [busy, setBusy] = useState<string | null>(null); // 'upload' | file id
  const [fileMsg, setFileMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const loadFiles = useCallback(async () => {
    try {
      const r = await api.masterSearch.files();
      setFiles(r.files);
      setTotals({ files: r.totalFiles, rows: r.totalRows });
    } catch { /* the totals line just stays as it was */ }
  }, []);
  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const runSearch = useCallback(async (text: string) => {
    const query = text.trim();
    const mine = ++seq.current; // only the newest search may update the screen
    if (query.length < MIN_CHARS) {
      setResults([]); setTotal(0); setSearched(''); setSearching(false); setError(null);
      return;
    }
    setSearching(true); setError(null);
    try {
      const r = await api.masterSearch.search(query);
      if (mine !== seq.current) return;
      setResults(r.results); setTotal(r.total); setLimit(r.limit); setSearched(query);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof ApiError ? e.message : 'Search failed. Try again.');
    } finally {
      if (mine === seq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, runSearch]);

  const terms = useMemo(
    () => Array.from(new Set(searched.toLowerCase().split(/\s+/).filter(Boolean))),
    [searched],
  );

  const onUpload = async (file: File | undefined) => {
    if (!file || busy) return;
    setBusy('upload'); setFileMsg(null);
    try {
      const f = await api.masterSearch.upload(file);
      setFileMsg({ kind: 'ok', text: `Loaded "${f.fileName}" — ${fmtInt(f.rowCount)} rows from ${f.sheetCount} sheet${f.sheetCount === 1 ? '' : 's'}.` });
      await loadFiles();
      if (q.trim().length >= MIN_CHARS) void runSearch(q);
    } catch (e) {
      setFileMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not upload that file.' });
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const onDownload = async (f: api.SearchFile) => {
    if (busy) return;
    setBusy(f.id); setFileMsg(null);
    try {
      saveBlob(f.fileName, await api.masterSearch.download(f.id));
    } catch (e) {
      setFileMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not download that file.' });
    } finally { setBusy(null); }
  };

  const onDelete = async (f: api.SearchFile) => {
    if (busy) return;
    if (!window.confirm(`Delete "${f.fileName}"? Its ${fmtInt(f.rowCount)} rows will no longer be searchable. This can't be undone.`)) return;
    setBusy(f.id); setFileMsg(null);
    try {
      const r = await api.masterSearch.remove(f.id);
      setFileMsg({ kind: 'ok', text: `Deleted "${f.fileName}" and its ${fmtInt(r.removedRows)} rows.` });
      await loadFiles();
      if (q.trim().length >= MIN_CHARS) void runSearch(q);
    } catch (e) {
      setFileMsg({ kind: 'error', text: e instanceof ApiError ? e.message : 'Could not delete that file.' });
      await loadFiles();
    } finally { setBusy(null); }
  };

  const query = q.trim();
  const meta = query.length > 0 && query.length < MIN_CHARS
    ? `Type at least ${MIN_CHARS} characters`
    : searching && !searched ? 'Searching…'
      : searched
        ? (total > results.length
          ? `${fmtInt(total)} matching rows — showing the first ${fmtInt(results.length)}. Add a word to narrow it down.`
          : `${fmtInt(total)} matching row${total === 1 ? '' : 's'}`)
        : `${fmtInt(totals.files)} file${totals.files === 1 ? '' : 's'} · ${fmtInt(totals.rows)} rows searchable`;

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 6 }}>Master Search</h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
        Search every row of every uploaded spreadsheet. A row matches when it contains all the words you type, in any column.
      </p>

      {/* The search bar — pinned while results scroll. */}
      <div style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)', paddingBottom: 10 }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={18} style={{ position: 'absolute', left: 14, top: 14, color: 'var(--text-tertiary)' }} />
          <input className="input" type="search" autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search names, numbers, units, buildings…" aria-label="Master search"
            style={{ width: '100%', fontSize: '1rem', padding: '12px 14px 12px 42px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>{meta}</span>
          {searching && searched && <span style={{ color: 'var(--text-tertiary)' }}>· updating…</span>}
        </div>
        {error && <div style={{ marginTop: 6, color: 'var(--error)', fontSize: '0.8125rem' }}>{error}</div>}
      </div>

      {/* Results */}
      {searched && results.length === 0 && !searching && (
        <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>No matches.</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {results.map((r, i) => (
          <div key={`${r.file}|${r.sheet}|${r.row}|${i}`} className="card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--gold-dark)' }}>{r.file}</span>
              <span>›</span><span>{r.sheet}</span><span>›</span><span>row {r.row}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 220px) 1fr', gap: '4px 14px', fontSize: '0.85rem' }}>
              {r.cells.map(([k, v], j) => (
                <React.Fragment key={j}>
                  <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{k}</div>
                  <div style={{ wordBreak: 'break-word' }}><Highlight text={v} terms={terms} /></div>
                </React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>
      {searched && total > results.length && (
        <div style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-tertiary)', margin: '12px 0' }}>
          Showing the first {fmtInt(limit)} of {fmtInt(total)} — add another word to narrow the search.
        </div>
      )}

      {/* Admin: the files behind the search. */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 24, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
            <h3 style={{ fontWeight: 600, margin: 0, flex: 1 }}>Files</h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Excel (.xlsx, .xls, .xlsm) or CSV · first row = column names</span>
            <input ref={fileInput} type="file" accept={ACCEPT} style={{ display: 'none' }}
              onChange={e => void onUpload(e.target.files?.[0])} aria-label="Upload a file to Master Search" />
            <button className="btn btn-sm btn-primary" disabled={!!busy} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" size={14} /> {busy === 'upload' ? 'Uploading…' : 'Upload file'}
            </button>
          </div>
          {fileMsg && (
            <div style={{ padding: '8px 16px', fontSize: '0.8125rem', color: fileMsg.kind === 'ok' ? 'var(--success)' : 'var(--error)', borderBottom: '1px solid var(--border-light)' }}>
              {fileMsg.text}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th style={{ textAlign: 'right' }}>Sheets</th>
                  <th style={{ textAlign: 'right' }}>Rows</th>
                  <th style={{ textAlign: 'right' }}>Size</th>
                  <th>Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: 24, color: 'var(--text-secondary)' }}>No files yet — upload one to make it searchable.</td></tr>
                ) : files.map(f => (
                  <tr key={f.id}>
                    <td style={{ fontWeight: 500, wordBreak: 'break-word' }}>{f.fileName}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{f.sheetCount}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtInt(f.rowCount)}</td>
                    <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmtSize(f.sizeBytes)}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {fmtDateTime(f.uploadedAt)}{f.uploadedBy ? ` · ${userById(f.uploadedBy)?.name ?? '—'}` : ''}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <button className="btn btn-sm" disabled={!!busy} onClick={() => void onDownload(f)} title="Download the original file">
                        <Icon name="download" size={13} /> Download
                      </button>{' '}
                      <button className="btn btn-sm btn-danger" disabled={!!busy} onClick={() => void onDelete(f)} title="Delete this file and all its rows">
                        <Icon name="trash" size={13} /> {busy === f.id ? '…' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
