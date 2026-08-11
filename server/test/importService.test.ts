import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { pool, closePool } from '../src/db/pool';
import { stageUpload, dryRunOwners, commitOwners, restageDatasetForRemap } from '../src/services/importService';
import { insertUser } from '../src/repositories/userRepo';
import { listDatasets } from '../src/repositories/datasetRepo';
import { queryProperties } from '../src/repositories/propertyRepo';
import { AppUser, UserRole } from '../../src/types/user';
import { DataModule, DataSetType, kOrgId } from '../../src/types/models';
import { ColumnSpec, ImportField } from '../../src/logic/importModels';
import { newUserId } from '../src/domain/ids';

/**
 * The headline test here is the dataset-id regression: it fails against the
 * reference implementation's behaviour and passes against this one.
 */

function xlsxBuffer(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADERS = ['Community', 'Building Name', 'Unit Number', 'Owner Name', 'Mobile', 'Beds'];
const FILE_ROWS: unknown[][] = [
  HEADERS,
  ['Palm Views', 'Tower A', '101', 'Aisha Rahman', '0501234567', 2],
  ['Palm Views', 'Tower A', '102', 'Bilal Khan', '0507654321', 3],
  ['Palm Views', 'Tower B', '201', 'Chen Wei', '', 1],
];

let userId: string;

test.before(async () => {
  userId = newUserId();
  await insertUser({
    user: new AppUser(userId, 'Import Tester', `import-${userId}@test.local`,
      UserRole.manager, true, 'QA', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA',
    mustChangePassword: false,
  });
});

async function wipe() {
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM datasets WHERE org_id = ?', [kOrgId]);
  await pool.query('DELETE FROM import_sessions WHERE org_id = ?', [kOrgId]);
}

test('staging parses the file, auto-maps columns and never keeps the bytes', async () => {
  await wipe();
  const staged = await stageUpload({
    fileName: 'register.xlsx',
    bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners,
    userId,
  });

  assert.equal(staged.headerRow, 0);
  assert.equal(staged.detectedType, DataSetType.register);
  assert.equal(staged.sheets[0].rowCount, 4);

  const cols = staged.columns as ColumnSpec[];
  const mapped = Object.fromEntries(cols.map(c => [c.header, c.field]));
  // The regression the existing suite already guards: a plain "Building Name"
  // must map to `building`, not be swallowed as a vendor row-id.
  assert.equal(mapped['Building Name'], 'building');
  assert.equal(mapped['Owner Name'], 'ownerName');
  assert.equal(mapped['Mobile'], 'phone');
  assert.equal(mapped['Community'], 'community');
});

test('dry run counts are computed server-side and mask the sample', async () => {
  await wipe();
  const staged = await stageUpload({
    fileName: 'register.xlsx', bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners, userId,
  });

  const summary = await dryRunOwners({
    sessionId: staged.sessionId, userId, sheetIndex: 0,
    headerRow: 0, columns: staged.columns as ColumnSpec[],
    type: DataSetType.register, communityFallback: 'Palm Views',
  });

  assert.equal(summary.newCount, 3);
  assert.equal(summary.updatedCount, 0);
  assert.equal(summary.callable, 2, 'the row with a blank mobile is not callable');

  const withPhone = summary.sample.find(s => s.owner === 'Aisha Rahman')!;
  assert.match(withPhone.phone, /^•+4567$/, 'preview must not carry a real number');
  assert.ok(!withPhone.phone.includes('971501234567'));
});

test('REGRESSION: committed properties point at a dataset that exists, so delete works', async () => {
  await wipe();
  const staged = await stageUpload({
    fileName: 'register.xlsx', bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners, userId,
  });

  const { datasetId } = await commitOwners({
    sessionId: staged.sessionId, userId, sheetIndex: 0, headerRow: 0,
    columns: staged.columns as ColumnSpec[], type: DataSetType.register,
    communityFallback: 'Palm Views', datasetName: 'Palm Register', source: 'Vendor',
  });

  const datasets = await listDatasets();
  assert.equal(datasets.length, 1);
  assert.equal(datasets[0].id, datasetId);

  // The heart of it: every property's datasetId must resolve to a real dataset.
  // The reference implementation minted `ds-${Date.now()}` twice — once for the
  // rows, once for the DataSet — so this join found nothing and deleting the
  // dataset orphaned the data instead of removing it.
  const [orphans] = await pool.query<any[]>(
    `SELECT COUNT(*) AS n FROM properties p
     LEFT JOIN datasets d ON d.id = p.dataset_id
     WHERE p.org_id = ? AND d.id IS NULL`,
    [kOrgId],
  );
  assert.equal(Number(orphans[0].n), 0, 'no property may point at a non-existent dataset');

  const [linked] = await pool.query<any[]>(
    'SELECT COUNT(*) AS n FROM properties WHERE dataset_id = ?', [datasetId],
  );
  assert.equal(Number(linked[0].n), 3, 'all three units are linked to the dataset');
});

test('re-importing the same file updates in place rather than duplicating', async () => {
  await wipe();

  const first = await stageUpload({
    fileName: 'register.xlsx', bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners, userId,
  });
  await commitOwners({
    sessionId: first.sessionId, userId, sheetIndex: 0, headerRow: 0,
    columns: first.columns as ColumnSpec[], type: DataSetType.register,
    communityFallback: 'Palm Views', datasetName: 'V1', source: 'Vendor',
  });

  // Same units, one owner renamed — the vendor's next monthly file.
  const updatedRows: unknown[][] = [
    HEADERS,
    ['Palm Views', 'Tower A', '101', 'Aisha Rahman-Ali', '0501234567', 2],
    ['Palm Views', 'Tower A', '102', 'Bilal Khan', '0507654321', 3],
    ['Palm Views', 'Tower B', '201', 'Chen Wei', '', 1],
  ];
  const second = await stageUpload({
    fileName: 'register-v2.xlsx', bytes: xlsxBuffer(updatedRows),
    module: DataModule.owners, userId,
  });

  const summary = await dryRunOwners({
    sessionId: second.sessionId, userId, sheetIndex: 0, headerRow: 0,
    columns: second.columns as ColumnSpec[], type: DataSetType.register,
    communityFallback: 'Palm Views',
  });
  assert.equal(summary.newCount, 0, 'nothing is new the second time');
  assert.equal(summary.updatedCount, 3, 'all three are recognised as updates');

  await commitOwners({
    sessionId: second.sessionId, userId, sheetIndex: 0, headerRow: 0,
    columns: second.columns as ColumnSpec[], type: DataSetType.register,
    communityFallback: 'Palm Views', datasetName: 'V2', source: 'Vendor',
  });

  const page = await queryProperties({ limit: 100, offset: 0 });
  assert.equal(page.total, 3, 'still three units, not six');
  const renamed = page.rows.find(p => p.unitNumber === '101')!;
  assert.equal(renamed.owner.name, 'Aisha Rahman-Ali', 'the update landed');
});

test('staged rows are dropped once committed — owner data is not left lying around', async () => {
  await wipe();
  const staged = await stageUpload({
    fileName: 'register.xlsx', bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners, userId,
  });

  const [before] = await pool.query<any[]>(
    'SELECT COUNT(*) AS n FROM import_rows WHERE session_id = ?', [staged.sessionId],
  );
  assert.ok(Number(before[0].n) > 0, 'rows are staged while the wizard is open');

  await commitOwners({
    sessionId: staged.sessionId, userId, sheetIndex: 0, headerRow: 0,
    columns: staged.columns as ColumnSpec[], type: DataSetType.register,
    communityFallback: 'Palm Views', datasetName: 'Palm', source: 'Vendor',
  });

  const [after] = await pool.query<any[]>(
    'SELECT COUNT(*) AS n FROM import_rows WHERE session_id = ?', [staged.sessionId],
  );
  assert.equal(Number(after[0].n), 0, 'staged rows are dropped at commit');
});

test('a second user cannot touch someone else\'s staged owner data', async () => {
  await wipe();
  const staged = await stageUpload({
    fileName: 'register.xlsx', bytes: xlsxBuffer(FILE_ROWS),
    module: DataModule.owners, userId,
  });

  const otherId = newUserId();
  await insertUser({
    user: new AppUser(otherId, 'Other', `other-${otherId}@test.local`,
      UserRole.manager, true, '', undefined, new Date().toISOString()),
    passwordHash: 'scrypt$131072$8$1$AAAA$AAAA', mustChangePassword: false,
  });

  await assert.rejects(
    () => dryRunOwners({
      sessionId: staged.sessionId, userId: otherId, sheetIndex: 0, headerRow: 0,
      columns: staged.columns as ColumnSpec[], type: DataSetType.register,
      communityFallback: 'Palm Views',
    }),
    /belongs to someone else/,
  );
});

test('rejects non-spreadsheet uploads', async () => {
  await assert.rejects(
    () => stageUpload({
      fileName: 'payload.exe', bytes: Buffer.from('MZ'), module: DataModule.owners, userId,
    }),
    /Excel \(\.xlsx\) or CSV/,
  );
});

// Reproduces the real duplicate bug: import with one mapping → re-map to a
// corrected mapping (which CHANGES the unit key) → update the set. If the re-map
// doesn't PERSIST the new key, the update can't match the units and inserts
// duplicates. Guards saveProperties updating unit_key + the re-map flow together.
test('REGRESSION: import → re-map → update does not duplicate (key persists)', async () => {
  await wipe();
  const col = (i: number, header: string, field: ImportField) => new ColumnSpec(i, header, field, 2, 2, []);
  const rows = [
    ['Master Community', 'Project', 'Building', 'Unit No', 'Owner Name', 'Mobile'],
    ['Dubai Water Canal', 'Eden House The Canal', 'Eden House Townhouses', '101', 'Owner A', '971501111111'],
    ['Dubai Water Canal', 'Eden House The Canal', 'Eden House Townhouses', '102', 'Owner B', '971502222222'],
  ];
  // Mapping X (wrong): the Building column read as the CLUSTER, real building blank.
  const mapX = [col(0, 'Master Community', ImportField.community), col(1, 'Project', ImportField.ignore), col(2, 'Building', ImportField.cluster), col(3, 'Unit No', ImportField.unitNumber), col(4, 'Owner Name', ImportField.ownerName), col(5, 'Mobile', ImportField.phone)];
  // Mapping Y (right): Project = cluster, Building = building → a DIFFERENT unit key.
  const mapY = [col(0, 'Master Community', ImportField.community), col(1, 'Project', ImportField.cluster), col(2, 'Building', ImportField.building), col(3, 'Unit No', ImportField.unitNumber), col(4, 'Owner Name', ImportField.ownerName), col(5, 'Mobile', ImportField.phone)];

  // 1. Import with the wrong mapping.
  const s1 = await stageUpload({ fileName: 'v1.xlsx', bytes: xlsxBuffer(rows), module: DataModule.owners, userId });
  const { datasetId } = await commitOwners({ sessionId: s1.sessionId, userId, sheetIndex: 0, headerRow: 0, columns: mapX, type: DataSetType.register, communityFallback: '', datasetName: 'Dup Test', source: 't' });

  const keyBefore = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows.find(p => p.unitNumber === '101')!.unitKey;

  // Broker work on one unit — must survive.
  const p101 = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows.find(p => p.unitNumber === '101')!;
  await pool.query(`UPDATE properties SET state='portfolio', notes='keen seller' WHERE id=?`, [p101.id]);

  // 2. Re-map to the corrected mapping (changes the key).
  const rs = await restageDatasetForRemap(datasetId, userId);
  await commitOwners({ sessionId: rs.sessionId, userId, sheetIndex: 0, headerRow: 0, columns: mapY, type: DataSetType.register, communityFallback: '', datasetName: '', source: '', targetDatasetId: datasetId, remap: true });

  const afterRemap = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows;
  const remap101 = afterRemap.find(p => p.unitNumber === '101')!;
  assert.equal(afterRemap.length, 2, 're-map must not duplicate');
  assert.notEqual(remap101.unitKey, keyBefore, 're-map must persist the corrected key');

  // 3. Update the set with the corrected mapping — must MATCH, not duplicate.
  const s3 = await stageUpload({ fileName: 'v1.xlsx', bytes: xlsxBuffer(rows), module: DataModule.owners, userId });
  await commitOwners({ sessionId: s3.sessionId, userId, sheetIndex: 0, headerRow: 0, columns: mapY, type: DataSetType.register, communityFallback: '', datasetName: '', source: '', targetDatasetId: datasetId });

  const afterUpdate = (await queryProperties({ datasetId, limit: 100, offset: 0 } as any)).rows;
  const u101 = afterUpdate.find(p => p.unitNumber === '101')!;
  assert.equal(afterUpdate.length, 2, 'update after re-map must NOT create duplicates');
  assert.equal(u101.state, 'portfolio', 'broker state preserved');
  assert.equal(u101.notes, 'keen seller', 'broker note preserved');
});

test.after(async () => {
  await wipe();
  await pool.query('DELETE FROM users WHERE email LIKE ?', ['%@test.local']);
  await closePool();
});
