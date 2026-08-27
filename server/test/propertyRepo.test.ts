import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool';
import {
  saveProperties, queryProperties, findByUnitKeys, findByOwnerKey,
  countByState, countCallable, propertyFacets, toProperty, countStalePortfolio,
} from '../src/repositories/propertyRepo';
import { Property, OwnerInfo, PropertyState, kOrgId } from '../../src/types/models';
import { ownerKeyOf } from '../../src/logic/ownerGrouping';
import { ImportPipeline } from '../../src/logic/importPipeline';
import { newPropertyId } from '../src/domain/ids';

/**
 * These run against the real MySQL (docker, port 3307). They exist because the
 * interesting failures here are all dialect-level — generated columns, the
 * unit_key upsert, JSON round-tripping — and none of them show up in a mock.
 */

function makeProperty(over: Partial<{
  community: string; cluster: string; building: string; unitNumber: string;
  ownerName: string; phone: string; nationality: string; beds: number;
  extra: Record<string, string>;
}> = {}): Property {
  const community = over.community ?? 'Test Community';
  const cluster = over.cluster;
  const building = over.building ?? 'Tower A';
  const unitNumber = over.unitNumber ?? '101';
  const unitKey = ImportPipeline.unitKeyFor({ community, cluster, building, unitNumber })!;
  const now = new Date().toISOString();
  const p = new Property(
    newPropertyId(), kOrgId, '', PropertyState.pool, unitKey, community,
    cluster, building, unitNumber, undefined, 'Apartment',
    over.beds ?? 2, 1200, undefined, undefined, undefined, 0,
    undefined, undefined, undefined,
    new OwnerInfo(over.ownerName ?? 'Test Owner', over.phone, over.nationality),
    now, now,
  );
  p.extra = over.extra ?? {};
  return p;
}

async function wipe() {
  await pool.query('DELETE FROM properties WHERE org_id = ?', [kOrgId]);
}

test('saveProperties round-trips every field including JSON extra', async () => {
  await wipe();
  const p = makeProperty({
    phone: '971501234567',
    nationality: 'India',
    extra: { 'Service Charge': '12.5', 'Vendor Ref': 'ABC-9' },
  });
  await saveProperties([p]);

  const found = await findByUnitKeys([p.unitKey]);
  const back = found.get(p.unitKey)!;

  assert.equal(back.id, p.id);
  assert.equal(back.owner.name, 'Test Owner');
  assert.equal(back.owner.phone, '971501234567');
  assert.equal(back.owner.nationality, 'India');
  assert.equal(back.beds, 2);
  assert.deepEqual(back.extra, { 'Service Charge': '12.5', 'Vendor Ref': 'ABC-9' });
  assert.equal(back.state, PropertyState.pool);
});

test('unit_key is the dedupe key: re-importing the same unit updates, never duplicates', async () => {
  await wipe();
  const first = makeProperty({ ownerName: 'Original Owner', phone: '971500000001' });
  await saveProperties([first]);

  // Same unit (same unitKey), different id and owner — as a re-import produces.
  const second = makeProperty({ ownerName: 'Updated Owner', phone: '971500000002' });
  assert.equal(second.unitKey, first.unitKey, 'precondition: same unit key');
  assert.notEqual(second.id, first.id);
  await saveProperties([second]);

  const [rows] = await pool.query<any[]>(
    'SELECT id, owner_name, owner_phone FROM properties WHERE org_id = ?', [kOrgId],
  );
  assert.equal(rows.length, 1, 'must collapse to one row, not two');
  assert.equal(rows[0].owner_name, 'Updated Owner');
  assert.equal(rows[0].owner_phone, '971500000002');
  // The original row wins the id — the unique key is (org, unit_key), so the
  // upsert updates in place rather than inserting under the new id.
  assert.equal(rows[0].id, first.id);
});

test('unitKeyFor normalisation collides "Unit 007" with "unit 7" on purpose', async () => {
  await wipe();
  const a = makeProperty({ unitNumber: '007', ownerName: 'A' });
  const b = makeProperty({ unitNumber: '7', ownerName: 'B' });
  assert.equal(a.unitKey, b.unitKey);
  await saveProperties([a, b]);
  const [rows] = await pool.query<any[]>('SELECT COUNT(*) AS n FROM properties WHERE org_id = ?', [kOrgId]);
  assert.equal(Number(rows[0].n), 1);
});

test('generated `callable` column matches Property.callable', async () => {
  await wipe();
  const withPhone = makeProperty({ unitNumber: '201', phone: '971501111111' });
  const without = makeProperty({ unitNumber: '202' });
  await saveProperties([withPhone, without]);

  assert.equal(withPhone.callable, true);
  assert.equal(without.callable, false);
  assert.equal(await countCallable(), 1);

  const page = await queryProperties({ callableOnly: true, limit: 50, offset: 0 });
  assert.equal(page.total, 1);
  assert.equal(page.rows[0].id, withPhone.id);
});

test('owner_key column agrees with the shared ownerKeyOf()', async () => {
  await wipe();
  // Two units, one owner (same phone) — the grouping assign() relies on.
  const u1 = makeProperty({ unitNumber: '301', ownerName: 'Shared Owner', phone: '971502222222' });
  const u2 = makeProperty({ unitNumber: '302', ownerName: 'Shared Owner', phone: '971502222222' });
  await saveProperties([u1, u2]);

  const key = ownerKeyOf(u1);
  assert.equal(key, ownerKeyOf(u2));

  const grouped = await findByOwnerKey(key);
  assert.equal(grouped.length, 2, 'both units resolve to the one owner');

  const [rows] = await pool.query<any[]>(
    'SELECT DISTINCT owner_key FROM properties WHERE org_id = ?', [kOrgId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owner_key, key, 'stored key == shared ownerKeyOf()');
});

test('filters mirror the client: outcome "none" means not called yet', async () => {
  await wipe();
  const called = makeProperty({ unitNumber: '401' });
  called.lastOutcome = 'noAnswer' as any;
  const never = makeProperty({ unitNumber: '402' });
  await saveProperties([called, never]);

  const none = await queryProperties({ outcome: 'none', limit: 50, offset: 0 });
  assert.equal(none.total, 1);
  assert.equal(none.rows[0].id, never.id);

  const specific = await queryProperties({ outcome: 'noAnswer', limit: 50, offset: 0 });
  assert.equal(specific.total, 1);
  assert.equal(specific.rows[0].id, called.id);
});

test('search matches the same haystack, and drops owner name when owner is hidden', async () => {
  await wipe();
  const p = makeProperty({ unitNumber: '501', ownerName: 'Zainab Hussein' });
  await saveProperties([p]);

  const visible = await queryProperties({ search: 'zainab', limit: 50, offset: 0 });
  assert.equal(visible.total, 1, 'owner name is searchable normally');

  const hidden = await queryProperties({ search: 'zainab', ownerHidden: true, limit: 50, offset: 0 });
  assert.equal(hidden.total, 0, 'owner name must not leak via search in teaser mode');

  const byUnit = await queryProperties({ search: 'Tower A', ownerHidden: true, limit: 50, offset: 0 });
  assert.equal(byUnit.total, 1, 'unit fields still searchable when owner is hidden');
});

test('pagination and total are consistent', async () => {
  await wipe();
  const many = Array.from({ length: 25 }, (_, i) =>
    makeProperty({ unitNumber: `6${String(i).padStart(2, '0')}` }));
  await saveProperties(many);

  const page1 = await queryProperties({ limit: 10, offset: 0 });
  assert.equal(page1.total, 25);
  assert.equal(page1.rows.length, 10);

  const page3 = await queryProperties({ limit: 10, offset: 20 });
  assert.equal(page3.total, 25);
  assert.equal(page3.rows.length, 5);

  const ids = new Set([...page1.rows, ...page3.rows].map(r => r.id));
  assert.equal(ids.size, 15, 'pages must not overlap');
});

test('facets reflect the whole scope, not the current page', async () => {
  await wipe();
  await saveProperties([
    makeProperty({ unitNumber: '701', community: 'Alpha', nationality: 'India', beds: 1 }),
    makeProperty({ unitNumber: '702', community: 'Beta', nationality: 'UK', beds: 3 }),
    makeProperty({ unitNumber: '703', community: 'Beta', nationality: 'UK', beds: 3,
      extra: { 'Vendor Ref': 'X1' } }),
  ]);

  const f = await propertyFacets({});
  assert.deepEqual(f.communities, ['Alpha', 'Beta']);
  assert.deepEqual(f.beds, [1, 3]);
  assert.deepEqual(f.nationalities.sort(), ['India', 'UK']);
  assert.deepEqual(f.extraKeys, ['Vendor Ref'], 'dynamic upload columns surface as facets');
});

test('countByState returns every state, zero-filled', async () => {
  await wipe();
  const pooled = makeProperty({ unitNumber: '801' });
  const assigned = makeProperty({ unitNumber: '802' });
  assigned.state = PropertyState.assigned;
  await saveProperties([pooled, assigned]);

  const counts = await countByState();
  assert.equal(counts[PropertyState.pool], 1);
  assert.equal(counts[PropertyState.assigned], 1);
  assert.equal(counts[PropertyState.dnc], 0, 'absent states report 0, not undefined');
});

/**
 * Timezone-frame regressions.
 *
 * The pool is opened with `timezone: 'Z'`, so every DATETIME the app writes is
 * UTC wall-clock. MySQL's NOW(3) answers in the *session* zone instead — UTC+4
 * on the Dubai box and on the dev Macs — so a UTC column compared against NOW(3)
 * skews by the whole UTC offset. These two filters are pure SQL with no JS
 * re-check, so the skew reached the screen: the "Due follow-up" chip listed
 * units up to four hours early, and the stale-portfolio tile over-counted.
 *
 * Each test calibrates itself against the box it runs on, planting a timestamp
 * half the local offset inside the window NOW(3) would wrongly sweep up. A box
 * already running UTC has no offset to exploit, so there the tests degrade to
 * asserting the plain invariant rather than failing to build a fixture.
 */
async function sessionSkewSeconds(): Promise<number> {
  const [rows] = await pool.query<any[]>(
    'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), NOW(3)) AS skew',
  );
  return Number(rows[0].skew);
}

test('dueOnly reads next_follow_up_at in UTC, not the session zone', async () => {
  await wipe();
  const skew = await sessionSkewSeconds();
  // Inside the buggy window where it exists; a plain hour ahead otherwise.
  const aheadMs = skew > 0 ? (skew * 1000) / 2 : 3600_000;

  const due = makeProperty({ unitNumber: '901' });
  due.nextFollowUpAt = new Date(Date.now() - 3600_000).toISOString();
  const notYet = makeProperty({ unitNumber: '902' });
  notYet.nextFollowUpAt = new Date(Date.now() + aheadMs).toISOString();
  await saveProperties([due, notYet]);

  const page = await queryProperties({ dueOnly: true, limit: 50, offset: 0 });
  assert.equal(page.total, 1, 'a follow-up still in the future is not due yet');
  assert.equal(page.rows[0].id, due.id);
});

test('countStalePortfolio measures the stale window in UTC', async () => {
  await wipe();
  const skew = await sessionSkewSeconds();
  const staleDays = 30;
  const windowMs = staleDays * 86400_000;
  const insideMs = skew > 0 ? (skew * 1000) / 2 : 3600_000;

  // Last called just *inside* the 30-day window — not stale. Under NOW(3) the
  // threshold slid forward by the UTC offset and swallowed it.
  const fresh = makeProperty({ unitNumber: '903' });
  fresh.state = PropertyState.portfolio;
  fresh.portfolioSince = new Date(Date.now() - windowMs * 2).toISOString();
  fresh.lastCalledAt = new Date(Date.now() - windowMs + insideMs).toISOString();

  const stale = makeProperty({ unitNumber: '904' });
  stale.state = PropertyState.portfolio;
  stale.portfolioSince = new Date(Date.now() - windowMs * 2).toISOString();
  stale.lastCalledAt = new Date(Date.now() - windowMs - 86400_000).toISOString();

  await saveProperties([fresh, stale]);

  assert.equal(await countStalePortfolio(staleDays), 1,
    'only the unit past the window counts as stale');
});

test('new filters: property type, price/size bands, follow-up and notes', async () => {
  await wipe();
  const a = makeProperty({ unitNumber: '1001' });
  a.propertyType = 'Villa'; a.sizeSqft = 3000; a.lastTransactionValue = 5_000_000;
  a.nextFollowUpAt = new Date(Date.now() + 86400_000).toISOString();
  const b = makeProperty({ unitNumber: '1002' });
  b.propertyType = 'Apartment'; b.sizeSqft = 900; b.lastTransactionValue = 1_200_000;
  await saveProperties([a, b]);
  // Notes are written by the popup's own path (updateNotes), not the bulk import
  // upsert — so set it directly to exercise the has-notes filter.
  await pool.query('UPDATE properties SET notes = ? WHERE id = ?', ['Owner keen to sell', a.id]);

  const villas = await queryProperties({ propertyType: 'Villa', limit: 50, offset: 0 });
  assert.equal(villas.total, 1); assert.equal(villas.rows[0].id, a.id);

  const pricey = await queryProperties({ valueFrom: 2_000_000, limit: 50, offset: 0 });
  assert.equal(pricey.total, 1, 'price band lower bound'); assert.equal(pricey.rows[0].id, a.id);

  const small = await queryProperties({ sizeTo: 1000, limit: 50, offset: 0 });
  assert.equal(small.total, 1, 'size band upper bound'); assert.equal(small.rows[0].id, b.id);

  const noted = await queryProperties({ hasNotes: true, limit: 50, offset: 0 });
  assert.equal(noted.total, 1, 'has-notes'); assert.equal(noted.rows[0].id, a.id);

  const scheduled = await queryProperties({ followUp: 'scheduled', limit: 50, offset: 0 });
  assert.equal(scheduled.total, 1, 'follow-up scheduled'); assert.equal(scheduled.rows[0].id, a.id);

  const f = await propertyFacets({});
  assert.deepEqual(f.propertyTypes.slice().sort(), ['Apartment', 'Villa'],
    'property_type surfaces as a facet');
});

test.after(async () => {
  await wipe();
  await closePool();
});
