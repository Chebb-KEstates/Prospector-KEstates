import test from 'node:test';
import assert from 'node:assert/strict';
import { pool, closePool } from '../src/db/pool';
import {
  saveProperties, queryProperties, findByUnitKeys, findByOwnerKey,
  countByState, countCallable, propertyFacets, toProperty, countStalePortfolio,
  callableCoverageByBroker, followUpsDueByBroker,
} from '../src/repositories/propertyRepo';
import { areaBreakdown, areaAssignmentMatrix } from '../src/repositories/statsRepo';
import { insertCall, newInterestedUnitsByBroker, newInterestedUnitsByArea, newInterestedUnitsCount, distinctUnitsCount, distinctUnitsByBroker } from '../src/repositories/callRepo';
import { CallLog, CallOutcome } from '../../src/types/models';
import { newCallId } from '../src/domain/ids';
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

  // The inverse filter: units WITHOUT a number.
  const noContact = await queryProperties({ noContactOnly: true, limit: 50, offset: 0 });
  assert.equal(noContact.total, 1, 'no-contact filter returns the un-callable unit');
  assert.equal(noContact.rows[0].id, without.id);
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

test('Report per-broker coverage and follow-ups group correctly', async () => {
  await wipe();
  const a = makeProperty({ unitNumber: '1101', phone: '971500000010' }); // callable, called
  const b = makeProperty({ unitNumber: '1102', phone: '971500000011' }); // callable, follow-up due
  const c = makeProperty({ unitNumber: '1103' });                        // not callable (no phone)
  await saveProperties([a, b, c]);
  await pool.query(
    `UPDATE properties SET assigned_to = 'u-director', state = 'assigned' WHERE id IN (?, ?, ?)`,
    [a.id, b.id, c.id],
  );
  // a is "worked" because u-director actually logged a call on it.
  await insertCall(new CallLog(newCallId(), kOrgId, [a.id], [], 'u-director',
    new Date().toISOString(), CallOutcome.noAnswer));
  // b carries a last_called_at from a PREVIOUS holder (no call by u-director) — it
  // must NOT count as worked for u-director. It's the follow-up-due unit.
  await pool.query('UPDATE properties SET last_called_at = UTC_TIMESTAMP(3) WHERE id = ?', [b.id]);
  await pool.query('UPDATE properties SET next_follow_up_at = (UTC_TIMESTAMP(3) - INTERVAL 1 HOUR) WHERE id = ?', [b.id]);

  const cov = await callableCoverageByBroker();
  assert.deepEqual(cov.get('u-director'), { callable: 2, worked: 1 },
    'coverage counts only callable held units THIS broker has actually called (not a prior holder\'s last_called_at)');

  const fu = await followUpsDueByBroker();
  assert.equal(fu.get('u-director'), 1, 'only the unit with a past-due follow-up counts');
});

test('area breakdown groups by community + sub-community with per-broker holdings', async () => {
  await wipe();
  // "Palm" spans two sub-communities: Frond A (2 units) and Frond B (1 unit).
  // Distinct building+unit per row — unit identity is tower+number, so reusing a
  // tower+unit across clusters would (correctly) collapse to one unit.
  const a1 = makeProperty({ community: 'Palm', cluster: 'Frond A', building: 'Villa 1', unitNumber: '1', phone: '971500000021' });
  const a2 = makeProperty({ community: 'Palm', cluster: 'Frond A', building: 'Villa 2', unitNumber: '2' });
  const b1 = makeProperty({ community: 'Palm', cluster: 'Frond B', building: 'Villa 3', unitNumber: '3', phone: '971500000022' });
  await saveProperties([a1, a2, b1]);
  // a1 and b1 held by a broker; a2 stays in the pool.
  await pool.query(
    "UPDATE properties SET assigned_to = 'u-director', state = 'assigned' WHERE id IN (?, ?)",
    [a1.id, b1.id],
  );

  const areas = await areaBreakdown();
  const frondA = areas.find(x => x.community === 'Palm' && x.cluster === 'Frond A')!;
  assert.equal(frondA.properties, 2);
  assert.equal(frondA.assigned, 1, 'one of Frond A is held, one pooled');
  assert.equal(frondA.pool, 1);
  const frondB = areas.find(x => x.community === 'Palm' && x.cluster === 'Frond B')!;
  assert.equal(frondB.properties, 1);
  assert.equal(frondB.assigned, 1);

  // Per-area, per-broker holdings: one unit each in Frond A and Frond B.
  const matrix = await areaAssignmentMatrix();
  assert.equal(matrix.find(c => c.cluster === 'Frond A' && c.brokerId === 'u-director')?.units, 1);
  assert.equal(matrix.find(c => c.cluster === 'Frond B' && c.brokerId === 'u-director')?.units, 1);
});

test('new-interested counts transitions INTO interested, deduped per unit', async () => {
  await wipe();
  const A = makeProperty({ unitNumber: '1301', phone: '971500000041' });
  const B = makeProperty({ unitNumber: '1302', phone: '971500000042' });
  const C = makeProperty({ unitNumber: '1303', phone: '971500000043' });
  const D = makeProperty({ unitNumber: '1304', phone: '971500000044' });
  await saveProperties([A, B, C, D]);
  await pool.query("UPDATE properties SET assigned_to = 'u-director', state = 'assigned' WHERE id IN (?, ?, ?, ?)", [A.id, B.id, C.id, D.id]);

  const t = (min: number) => new Date(Date.UTC(2026, 2, 1, 10, min, 0)).toISOString();
  const call = (propId: string, min: number, outcome: CallOutcome) =>
    insertCall(new CallLog(newCallId(), kOrgId, [propId], [], 'u-director', t(min), outcome));

  // A: no-answer → interested (transition), then sell+rent on the same unit → still ONE.
  await call(A.id, 0, CallOutcome.noAnswer);
  await call(A.id, 1, CallOutcome.interestedSell);
  await call(A.id, 2, CallOutcome.interestedRent);
  // B: first call interested (transition), later follow-up stays interested (NOT new).
  await call(B.id, 1, CallOutcome.interestedSell);
  await call(B.id, 3, CallOutcome.interestedSell);
  // C: interested → not-interested → interested again (a re-interest transition).
  await call(C.id, 0, CallOutcome.interestedSell);
  await call(C.id, 2, CallOutcome.notInterested);
  await call(C.id, 4, CallOutcome.interestedSell);
  // D: only no-answer — never interested.
  await call(D.id, 0, CallOutcome.noAnswer);

  const all = await newInterestedUnitsByBroker();
  assert.equal(all.get('u-director'), 3, 'A, B, C each became interested; D never did');

  // Window [min 3, min 5): B's follow-up (min 3) stays interested → excluded; C's
  // re-interest (min 4) is a fresh transition → counted. Only C.
  const from = new Date(Date.UTC(2026, 2, 1, 10, 3, 0));
  const to = new Date(Date.UTC(2026, 2, 1, 10, 5, 0));
  const win = await newInterestedUnitsByBroker(from, to);
  assert.equal(win.get('u-director'), 1, 'only C re-transitioned in the window; B merely stayed interested');
});

test('new-interested per AREA groups transitions by community + sub-community', async () => {
  await wipe();
  // Two areas; distinct building+unit per row so unit identity never collapses.
  const m1 = makeProperty({ community: 'Marina', cluster: 'North', building: 'Tower M', unitNumber: '101', phone: '971500000051' });
  const m2 = makeProperty({ community: 'Marina', cluster: 'North', building: 'Tower M', unitNumber: '102', phone: '971500000052' });
  const d1 = makeProperty({ community: 'Downtown', cluster: undefined, building: 'Tower D', unitNumber: '201', phone: '971500000053' });
  await saveProperties([m1, m2, d1]);
  await pool.query("UPDATE properties SET assigned_to = 'u-director', state = 'assigned' WHERE id IN (?, ?, ?)", [m1.id, m2.id, d1.id]);

  const t = (min: number) => new Date(Date.UTC(2026, 2, 1, 10, min, 0)).toISOString();
  const call = (propId: string, min: number, outcome: CallOutcome) =>
    insertCall(new CallLog(newCallId(), kOrgId, [propId], [], 'u-director', t(min), outcome));

  // Marina/North: M1 no-answer→sell→rent (one transition, deduped); M2 sell then
  // follow-up sell (one transition, at min 1). → area all-time = 2.
  await call(m1.id, 0, CallOutcome.noAnswer);
  await call(m1.id, 1, CallOutcome.interestedSell);
  await call(m1.id, 2, CallOutcome.interestedRent);
  await call(m2.id, 1, CallOutcome.interestedSell);
  await call(m2.id, 3, CallOutcome.interestedSell);
  // Downtown (no cluster): D1 sell→not-interested→sell (one re-interest). → 1.
  await call(d1.id, 0, CallOutcome.interestedSell);
  await call(d1.id, 2, CallOutcome.notInterested);
  await call(d1.id, 4, CallOutcome.interestedSell);

  const all = await newInterestedUnitsByArea();
  const marina = all.find(a => a.community === 'Marina' && a.cluster === 'North');
  const downtown = all.find(a => a.community === 'Downtown' && a.cluster === '');
  assert.equal(marina?.n, 2, 'M1 and M2 each became interested');
  assert.equal(downtown?.n, 1, 'D1 became interested (re-interest counts once)');

  // Window [min 3, min 5): M2 follow-up (min 3) stays interested → excluded;
  // Marina drops to 0 (absent). D1 re-interest (min 4) counts → Downtown = 1.
  const from = new Date(Date.UTC(2026, 2, 1, 10, 3, 0));
  const to = new Date(Date.UTC(2026, 2, 1, 10, 5, 0));
  const win = await newInterestedUnitsByArea(from, to);
  assert.equal(win.find(a => a.community === 'Marina')?.n, undefined, 'no fresh Marina transition in window');
  assert.equal(win.find(a => a.community === 'Downtown' && a.cluster === '')?.n, 1, 'only D1 re-transitioned in the window');
});

test('newInterestedUnitsCount: org-wide dedups across brokers; broker + window filters', async () => {
  await wipe();
  // A second real broker (seeded) — calls.broker_id is FK'd to users.id.
  const [brokerRows] = await pool.query<any[]>("SELECT id FROM users WHERE role = 'broker' AND active = 1 LIMIT 1");
  const b2 = brokerRows[0]?.id as string;
  assert.ok(b2, 'seed provides at least one demo broker');

  const X = makeProperty({ unitNumber: '1401', phone: '971500000061' });
  const Y = makeProperty({ unitNumber: '1402', phone: '971500000062' });
  const Z = makeProperty({ unitNumber: '1403', phone: '971500000063' });
  await saveProperties([X, Y, Z]);

  const t = (min: number) => new Date(Date.UTC(2026, 2, 1, 10, min, 0)).toISOString();
  const callBy = (bid: string, propId: string, min: number, outcome: CallOutcome) =>
    insertCall(new CallLog(newCallId(), kOrgId, [propId], [], bid, t(min), outcome));

  // X: director makes it interested (min 0), b2 flips it not-interested (min 2),
  // b2 re-interests it (min 4) — two transitions on ONE unit, by two brokers.
  await callBy('u-director', X.id, 0, CallOutcome.interestedSell);
  await callBy(b2, X.id, 2, CallOutcome.notInterested);
  await callBy(b2, X.id, 4, CallOutcome.interestedSell);
  // Y: only no-answer. Z: director interests it once (min 1).
  await callBy('u-director', Y.id, 0, CallOutcome.noAnswer);
  await callBy('u-director', Z.id, 1, CallOutcome.interestedSell);

  assert.equal(await newInterestedUnitsCount(), 2, 'org-wide: X and Z, X counted once despite two brokers');
  assert.equal(await newInterestedUnitsCount(undefined, undefined, 'u-director'), 2, 'director turned X and Z interested');
  assert.equal(await newInterestedUnitsCount(undefined, undefined, b2), 1, 'b2 re-interested X');

  const from = new Date(Date.UTC(2026, 2, 1, 10, 3, 0));
  const to = new Date(Date.UTC(2026, 2, 1, 10, 5, 0));
  assert.equal(await newInterestedUnitsCount(from, to), 1, 'only X re-transitioned in the window');
  assert.equal(await newInterestedUnitsCount(from, to, 'u-director'), 0, 'director had no transition in the window');
  assert.equal(await newInterestedUnitsCount(from, to, b2), 1, 'b2 re-interested X inside the window');
});

test('distinctUnitsCount: units called vs reached, deduped, by broker + window', async () => {
  await wipe();
  const [brokerRows] = await pool.query<any[]>("SELECT id FROM users WHERE role = 'broker' AND active = 1 LIMIT 1");
  const b2 = brokerRows[0]?.id as string;
  assert.ok(b2, 'seed provides a demo broker');

  const X = makeProperty({ unitNumber: '1501', phone: '971500000071' });
  const Y = makeProperty({ unitNumber: '1502', phone: '971500000072' });
  const Z = makeProperty({ unitNumber: '1503', phone: '971500000073' });
  await saveProperties([X, Y, Z]);

  const t = (min: number) => new Date(Date.UTC(2026, 2, 1, 10, min, 0)).toISOString();
  const callBy = (bid: string, propId: string, min: number, outcome: CallOutcome) =>
    insertCall(new CallLog(newCallId(), kOrgId, [propId], [], bid, t(min), outcome));

  // X: director no-answer then interested (called AND reached; deduped to one unit).
  await callBy('u-director', X.id, 0, CallOutcome.noAnswer);
  await callBy('u-director', X.id, 1, CallOutcome.interestedSell);
  // Y: director no-answer only (called, NOT reached).
  await callBy('u-director', Y.id, 0, CallOutcome.noAnswer);
  // Z: b2 interested (called AND reached).
  await callBy(b2, Z.id, 1, CallOutcome.interestedSell);

  assert.equal(await distinctUnitsCount(), 3, 'X, Y, Z each had a call');
  assert.equal(await distinctUnitsCount(undefined, undefined, { connectedOnly: true }), 2, 'only X and Z were reached');
  assert.equal(await distinctUnitsCount(undefined, undefined, { brokerId: 'u-director' }), 2, 'director called X and Y');
  assert.equal(await distinctUnitsCount(undefined, undefined, { brokerId: 'u-director', connectedOnly: true }), 1, 'director reached only X');

  const called = await distinctUnitsByBroker();
  const reached = await distinctUnitsByBroker(undefined, undefined, true);
  assert.equal(called.get('u-director'), 2);
  assert.equal(called.get(b2), 1);
  assert.equal(reached.get('u-director'), 1);
  assert.equal(reached.get(b2), 1);

  // Window excludes the min-0 no-answers; only the min-1 connected calls remain.
  const from = new Date(Date.UTC(2026, 2, 1, 10, 1, 0));
  const to = new Date(Date.UTC(2026, 2, 1, 10, 2, 0));
  assert.equal(await distinctUnitsCount(from, to), 2, 'X and Z had a call at min 1');
  assert.equal(await distinctUnitsCount(from, to, { connectedOnly: true }), 2, 'both were interested (reached)');
});

test.after(async () => {
  await wipe();
  await closePool();
});
