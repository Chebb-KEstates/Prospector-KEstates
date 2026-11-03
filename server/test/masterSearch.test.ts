import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { pool, closePool } from '../src/db/pool';
import { insertUser } from '../src/repositories/userRepo';
import { createSession, SESSION_COOKIE, CSRF_HEADER } from '../src/auth/sessions';
import { parseSearchFile } from '../src/services/masterSearchService';
import { kOrgId } from '../../src/types/models';
import { AppUser, UserRole } from '../../src/types/user';
import { newUserId } from '../src/domain/ids';
import { ApiError } from '../src/http/errors';

/**
 * Master Search: uploaded spreadsheets become searchable rows. Everyone searches;
 * only admins (manageData) upload, download the original, and delete.
 */

let app: FastifyInstance;
let manager: string, broker: string;
const auth: Record<string, { cookie: string; csrf: string }> = {};

test.before(async () => {
  manager = newUserId(); broker = newUserId();
  const mk = (id: string, name: string, role: UserRole) => insertUser({
    user: new AppUser(id, name, `${id}@test.local`, role, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });
  await mk(manager, 'Manager', UserRole.manager);
  await mk(broker, 'Broker', UserRole.broker);
  for (const id of [manager, broker]) {
    const s = await createSession(id, {});
    auth[id] = { cookie: `${SESSION_COOKIE}=${s.token}`, csrf: s.csrfToken };
  }
  app = await buildApp();
  await app.ready();
});

test.after(async () => {
  await pool.query('DELETE FROM search_files WHERE org_id = ?', [kOrgId]);
  await app.close();
  await closePool();
});

const wipe = () => pool.query('DELETE FROM search_files WHERE org_id = ?', [kOrgId]);

function xlsx(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function call(who: string, method: 'GET' | 'POST' | 'DELETE', url: string) {
  const res = await app.inject({ method, url, headers: { cookie: auth[who].cookie, [CSRF_HEADER]: auth[who].csrf } });
  return { status: res.statusCode, body: res.rawPayload, json: () => JSON.parse(res.body) };
}

async function upload(who: string, fileName: string, bytes: Buffer) {
  const boundary = '----prospectortest' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n`
    + 'Content-Type: application/octet-stream\r\n\r\n');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const res = await app.inject({
    method: 'POST', url: '/api/master-search/files',
    headers: {
      cookie: auth[who].cookie, [CSRF_HEADER]: auth[who].csrf,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([head, bytes, tail]),
  });
  return { status: res.statusCode, json: () => JSON.parse(res.body) };
}

const search = async (who: string, q: string) => (await call(who, 'GET', `/api/master-search?q=${encodeURIComponent(q)}`)).json();

const CLIENTS = xlsx({
  Clients: [
    ['Name', 'Email', 'City', 'Phone'],
    ['Ahmed Khan', 'ahmed@example.com', 'Dubai', '0501234567'],
    ['Sara Ali', 'sara@example.com', 'Abu Dhabi', '0559876543'],
    ['John Smith', 'john@example.com', 'Dubai Marina', '0521112222'],
  ],
});
const PROPS = xlsx({
  Listings: [['Unit', 'Building', 'Price', 'Agent'], ['A-101', 'Marina Tower', '1200000', 'Sara Ali']],
  Sales: [['Date', 'Unit', 'Buyer'], ['2026-09-01', 'A-101', 'John Smith']],
});

// ── Parsing ──────────────────────────────────────────────────────────────────

test('parse: every sheet, header = first non-empty row, true Excel row numbers, empties skipped', () => {
  const bytes = xlsx({
    One: [[], [], ['Name', '', 'Name'], ['Ann', 'x', 'Dup'], [], ['', '', ''], ['Bob']],
    Empty: [],
  });
  const p = parseSearchFile('t.xlsx', bytes);
  assert.equal(p.sheetCount, 1, 'the empty sheet is skipped');
  assert.deepEqual(p.rows.map(r => r.rowNo), [4, 7], 'header on row 3; blank rows skipped; numbers as in Excel');
  assert.deepEqual(p.rows[0].cells, [['Name', 'Ann'], ['Column B', 'x'], ['Name (2)', 'Dup']]);
  assert.deepEqual(p.rows[1].cells, [['Name', 'Bob']], 'empty cells left out');
});

test('parse: CSV is read as UTF-8 (Arabic survives)', () => {
  const csv = Buffer.from('الاسم,City\nأحمد خان,Dubai\n', 'utf8');
  const p = parseSearchFile('people.csv', csv);
  assert.deepEqual(p.rows[0].cells, [['الاسم', 'أحمد خان'], ['City', 'Dubai']]);
});

test('parse: unsupported or empty files are refused with a clear message', () => {
  assert.throws(() => parseSearchFile('notes.pdf', Buffer.from('x')), (e: unknown) => e instanceof ApiError && e.statusCode === 400);
  assert.throws(() => parseSearchFile('~$lock.xlsx', CLIENTS), (e: unknown) => e instanceof ApiError && e.statusCode === 400);
  assert.throws(() => parseSearchFile('only-header.xlsx', xlsx({ S: [['A', 'B']] })),
    (e: unknown) => e instanceof ApiError && e.statusCode === 422);
});

// ── Permissions ──────────────────────────────────────────────────────────────

test('agents search; only admins upload, download and delete', async () => {
  await wipe();
  const up = await upload(broker, 'clients.xlsx', CLIENTS);
  assert.equal(up.status, 403, 'a broker cannot upload');
  assert.equal((await upload(manager, 'clients.xlsx', CLIENTS)).status, 200);
  const files = (await call(broker, 'GET', '/api/master-search/files')).json();
  assert.equal(files.totalFiles, 1);
  assert.equal(files.totalRows, 3);
  const id = files.files[0].id;
  assert.equal((await call(broker, 'GET', `/api/master-search/files/${id}/download`)).status, 403);
  assert.equal((await call(broker, 'DELETE', `/api/master-search/files/${id}`)).status, 403);
  const r = await search(broker, 'ahmed');
  assert.equal(r.total, 1, 'a broker can search');
});

// ── Searching ────────────────────────────────────────────────────────────────

test('search: every word must match, in any column, any order, ignoring case', async () => {
  await wipe();
  await upload(manager, 'clients.xlsx', CLIENTS);
  await upload(manager, 'properties.xlsx', PROPS);

  assert.equal((await search(broker, 'dubai')).total, 2, 'Dubai + Dubai Marina');
  assert.equal((await search(broker, 'DUBAI marina')).total, 1);
  assert.equal((await search(broker, 'marina john')).total, 1, 'two words in two columns');
  const john = await search(broker, 'john smith');
  assert.equal(john.total, 2, 'the client and the sale');
  const sale = john.results.find((h: { sheet: string }) => h.sheet === 'Sales');
  assert.deepEqual(sale, {
    file: 'properties.xlsx', sheet: 'Sales', row: 2,
    cells: [['Date', '2026-09-01'], ['Unit', 'A-101'], ['Buyer', 'John Smith']],
  });
  assert.equal((await search(broker, 'ahmed zzz')).total, 0);
  assert.equal((await search(broker, '   ')).total, 0, 'blank query → nothing');
  // Only values are searched, not column names.
  assert.equal((await search(broker, 'email')).total, 0);
});

test('search: % and _ are matched literally, not as wildcards', async () => {
  await wipe();
  await upload(manager, 'wild.xlsx', xlsx({ S: [['Note'], ['50% off'], ['5000 off'], ['a_b'], ['axb']] }));
  assert.equal((await search(broker, '50%')).total, 1);
  assert.equal((await search(broker, 'a_b')).total, 1);
});

test('search: results are capped at 500 but the total is exact', async () => {
  await wipe();
  const rows: unknown[][] = [['Ref', 'Tag']];
  for (let i = 1; i <= 620; i++) rows.push([`R${i}`, 'bulkrow']);
  await upload(manager, 'big.xlsx', xlsx({ S: rows }));
  const r = await search(broker, 'bulkrow');
  assert.equal(r.total, 620);
  assert.equal(r.results.length, 500);
  assert.equal(r.limit, 500);
});

// ── Files ────────────────────────────────────────────────────────────────────

test('the original file downloads byte for byte; same-name uploads are refused', async () => {
  await wipe();
  const up = await upload(manager, 'clients.xlsx', CLIENTS);
  const meta = up.json();
  assert.equal(meta.fileName, 'clients.xlsx');
  assert.equal(meta.rowCount, 3);
  assert.equal(meta.sheetCount, 1);
  assert.equal(meta.sizeBytes, CLIENTS.length);
  const dl = await call(manager, 'GET', `/api/master-search/files/${meta.id}/download`);
  assert.equal(dl.status, 200);
  assert.ok(Buffer.compare(dl.body, CLIENTS) === 0, 'identical bytes');
  const again = await upload(manager, 'clients.xlsx', PROPS);
  assert.equal(again.status, 409);
  assert.match(again.json().error.message, /already loaded/);
});

test('each row keeps its source file name; deleting a file removes exactly its rows', async () => {
  await wipe();
  const a = (await upload(manager, 'clients.xlsx', CLIENTS)).json();
  await upload(manager, 'properties.xlsx', PROPS);
  const [byFile] = await pool.query<any[]>(
    'SELECT file_name, COUNT(*) AS n FROM search_rows WHERE org_id = ? GROUP BY file_name ORDER BY file_name', [kOrgId]);
  assert.deepEqual(byFile.map((r: { file_name: string; n: number }) => [r.file_name, Number(r.n)]),
    [['clients.xlsx', 3], ['properties.xlsx', 2]]);

  const del = await call(manager, 'DELETE', `/api/master-search/files/${a.id}`);
  assert.equal(del.status, 200);
  assert.equal(del.json().removedRows, 3);
  assert.equal((await search(broker, 'ahmed')).total, 0, 'its rows are gone');
  assert.equal((await search(broker, 'marina tower')).total, 1, 'the other file is untouched');
  assert.equal((await call(manager, 'DELETE', `/api/master-search/files/${a.id}`)).status, 404);
  // Re-uploading the same name works once the old one is gone.
  assert.equal((await upload(manager, 'clients.xlsx', CLIENTS)).status, 200);
});

test('a batch of many files uploads back to back without hitting the rate limit', async () => {
  await wipe();
  for (let i = 1; i <= 40; i++) {
    const r = await upload(manager, `batch-${i}.csv`, Buffer.from(`Ref,Tag\nB${i},batchrow\n`, 'utf8'));
    assert.equal(r.status, 200, `file ${i} → ${r.status}`);
  }
  const files = (await call(manager, 'GET', '/api/master-search/files')).json();
  assert.equal(files.totalFiles, 40);
  assert.equal((await search(broker, 'batchrow')).total, 40);
});

test('searches, uploads, downloads and deletes are audited', async () => {
  await wipe();
  await pool.query("DELETE FROM audit WHERE detail LIKE 'Master search%'");
  const f = (await upload(manager, 'clients.xlsx', CLIENTS)).json();
  await search(broker, 'ahmed');
  await call(manager, 'GET', `/api/master-search/files/${f.id}/download`);
  await call(manager, 'DELETE', `/api/master-search/files/${f.id}`);
  const [rows] = await pool.query<any[]>(
    "SELECT actor_id, action, detail FROM audit WHERE detail LIKE 'Master search%' ORDER BY at");
  assert.deepEqual(rows.map((r: { action: string }) => r.action), ['import', 'search', 'export', 'delete']);
  assert.equal(rows[1].actor_id, broker);
  assert.equal(rows[1].detail, 'Master search "ahmed" — 1 row');
});
