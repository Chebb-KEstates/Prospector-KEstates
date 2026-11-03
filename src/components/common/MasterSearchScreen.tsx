import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as api from '../../data/api';
import { ApiError } from '../../data/apiClient';
import { useAuth } from '../../state/AuthContext';
import { useVault } from '../../state/VaultContext';
import { Permission } from '../../types/user';
import { Icon } from './Icon';
import { saveBlob } from '../../logic/downloadFile';
import { fmtInt, fmtDateTime } from '../../utils/format';
import { UploadQueue, QueueStatus } from '../../data/uploadQueue';

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

/**
 * One queue for the whole app (module level), so a long batch keeps uploading
 * when the admin switches to another page and back.
 */
const uploadQueue = new UploadQueue<File, api.SearchFile>({
  extensions: ACCEPT.split(','),
  upload: file => api.masterSearch.upload(file),
  describe: f => `${fmtInt(f.rowCount)} rows · ${f.sheetCount} sheet${f.sheetCount === 1 ? '' : 's'}`,
});

const STATUS_LABEL: Record<QueueStatus, string> = {
  waiting: 'Waiting', uploading: 'Uploading…', done: 'Loaded', skipped: 'Skipped', failed: 'Failed', cancelled: 'Cancelled',
};
const STATUS_COLOR: Record<QueueStatus, string> = {
  waiting: 'var(--text-tertiary)', uploading: 'var(--gold-dark)', done: 'var(--success)',
  skipped: 'var(--text-secondary)', failed: 'var(--error)', cancelled: 'var(--text-tertiary)',
};

const reEsc =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
  const [busy, setBusy] = useState<string | null>(null); // file id being downloaded/deleted
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

  // The upload queue: many files, one at a time.
  const queue = useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot);
  const onPick = (list: FileList | null) => {
    const picked = list ? Array.from(list) : [];
    if (fileInput.current) fileInput.current.value = ''; // the same files can be picked again
    if (picked.length === 0) return;
    setFileMsg(null);
    uploadQueue.add(picked, files.map(f => f.fileName));
  };

  // Refresh the file list as the batch lands (every few files, and at the end)
  // and re-run the open search so new rows show up.
  const lastDone = useRef(queue.done);
  const qRef = useRef(q);
  qRef.current = q;
  useEffect(() => {
    const landed = queue.done !== lastDone.current;
    if (!landed) return;
    if (queue.running && queue.done % 5 !== 0) return;
    lastDone.current = queue.done;
    void loadFiles();
    if (qRef.current.trim().length >= MIN_CHARS) void runSearch(qRef.current);
  }, [queue.done, queue.running, loadFiles, runSearch]);

  // Closing the tab mid-batch would drop the rest — ask first.
  useEffect(() => {
    if (!queue.running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [queue.running]);

  const counts = useMemo(() => {
    const c: Record<QueueStatus, number> = { waiting: 0, uploading: 0, done: 0, skipped: 0, failed: 0, cancelled: 0 };
    for (const it of queue.items) c[it.status]++;
    return c;
  }, [queue.items]);
  const finished = queue.items.length - counts.waiting - counts.uploading;

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
            <input ref={fileInput} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
              onChange={e => onPick(e.target.files)} aria-label="Upload files to Master Search" />
            <button className="btn btn-sm btn-primary" onClick={() => fileInput.current?.click()}
              title="Pick one or many files — they upload one after another">
              <Icon name="upload" size={14} /> {queue.running ? 'Add more files' : 'Upload files'}
            </button>
          </div>
          {queue.items.length > 0 && (
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '0.8125rem' }}>
                <span style={{ fontWeight: 600 }}>
                  {queue.running
                    ? `Uploading ${fmtInt(finished + 1)} of ${fmtInt(queue.items.length)}…`
                    : `Upload finished — ${fmtInt(queue.items.length)} file${queue.items.length === 1 ? '' : 's'}`}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {[
                    counts.done && `${fmtInt(counts.done)} loaded`,
                    counts.skipped && `${fmtInt(counts.skipped)} skipped`,
                    counts.failed && `${fmtInt(counts.failed)} failed`,
                    counts.cancelled && `${fmtInt(counts.cancelled)} cancelled`,
                  ].filter(Boolean).join(' · ')}
                </span>
                <span style={{ flex: 1 }} />
                {queue.running && counts.waiting > 0 && (
                  <button className="btn btn-sm" onClick={() => uploadQueue.cancel()}>Stop after this file</button>
                )}
                {!queue.running && (
                  <button className="btn btn-sm btn-ghost" onClick={() => uploadQueue.clearFinished()}>Clear</button>
                )}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: 'var(--border-light)', margin: '8px 0', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(finished / queue.items.length) * 100}%`, background: 'var(--gold)', transition: 'width .2s' }} />
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', fontSize: '0.78rem' }}>
                {queue.items.map(it => (
                  <div key={it.id} style={{ display: 'flex', gap: 10, padding: '3px 0', alignItems: 'baseline' }}>
                    <span style={{ width: 82, flexShrink: 0, fontWeight: 600, color: STATUS_COLOR[it.status] }}>{STATUS_LABEL[it.status]}</span>
                    <span style={{ wordBreak: 'break-word', flex: 1 }}>{it.name}</span>
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'right' }}>{it.message ?? fmtSize(it.size)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
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
